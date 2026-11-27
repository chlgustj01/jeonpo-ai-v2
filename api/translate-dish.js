// Vercel Serverless Function: /api/translate-dish
//
// [IMP-04] 이미지 분석(api/analyze-menu.js)과 완전히 분리된 번역 전용
// 엔드포인트. 입력은 이미지가 아니라 분석 결과의 "정준(canonical) 영어
// 텍스트"뿐이다 — allergens/crossContactAllergens/spicy/foodId 같은 위험도
// 판정 관련 값은 아예 이 핸들러에 들어오지 않으므로, 번역 과정에서 그 값이
// 바뀌는 사고 자체가 설계상 불가능하다. 사용자 알레르기 프로필도 여기로
// 보내지 않는다(요청 바디에 그런 필드가 없음).
const crypto = require('crypto');
const { validateAndNormalizeTranslationResponse, TRANSLATION_SCHEMA_VERSION } = require('../shared/dish-schema.js');
const { fetchWithRetry } = require('../shared/http-retry.js');
const { createTtlCache } = require('../shared/server-cache.js');

const gemini = require('../shared/gemini-client.js');

// [PKG5-01] Same env override as analyze-menu.js (validated id only).
const GEMINI_MODEL = gemini.resolveGeminiModel(process.env.GEMINI_MODEL);
const TRANSLATE_PROMPT_VERSION = '1.0.0';
// [PKG5-01] The old cap (2048) shared its budget with default thinking, the
// same way that truncated analyze-menu's answer. Plain translation does not
// need thinking, so turn it off (budget 0 on 2.5 models) and allow room for
// 10 dishes in CJK languages.
const TRANSLATE_MAX_OUTPUT_TOKENS = 8192;
const TRANSLATE_THINKING_BUDGET = 0;
const ATTEMPT_TIMEOUT_MS = 30000;
const TOTAL_BUDGET_MS = 40000;

const LANGUAGE_NAMES = {
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese (Simplified)',
  vi: 'Vietnamese',
  es: 'Spanish',
  ko: 'Korean'
};

// [IMP-05] 번역 캐시는 (분석 결과 식별자 + 목표 언어 + 프롬프트/스키마 버전)
// 으로 키를 만든다 — 같은 분석 결과를 같은 언어로 또 번역 요청하면(예: 사용자가
// en → ja → en으로 언어를 왔다갔다 바꾸는 경우) Gemini를 다시 부르지 않는다.
const translationCache = createTtlCache({ maxEntries: 200, ttlMs: 30 * 60 * 1000 });

function buildTranslationCacheKey(analysisId, targetLanguage) {
  return [analysisId, targetLanguage, TRANSLATE_PROMPT_VERSION, TRANSLATION_SCHEMA_VERSION].join(':');
}

function isValidDishInput(d) {
  return d && typeof d === 'object' && typeof d.foodId === 'string' && d.foodId.length > 0;
}

// targetLanguage === 'en'일 때 호출할 필요가 없다 — 분석 결과 자체가 이미
// 영어이므로, 그대로 "번역 결과"로 돌려주면 Gemini 호출 자체를 아낄 수 있다.
function echoEnglishAsTranslation(dishes) {
  const translationsByFoodId = {};
  dishes.forEach((d) => {
    translationsByFoodId[d.foodId] = {
      translatedName: typeof d.nameEn === 'string' ? d.nameEn : (typeof d.nameKo === 'string' ? d.nameKo : ''),
      ingredients: typeof d.ingredients === 'string' ? d.ingredients : '',
      eatingMethod: Array.isArray(d.eatingMethod) ? d.eatingMethod : [],
      description: typeof d.description === 'string' ? d.description : '',
      culturalNote: typeof d.culturalNote === 'string' ? d.culturalNote : '',
      fieldStatus: { translatedName: 'valid', ingredients: 'valid', eatingMethod: 'valid', description: 'valid', culturalNote: 'valid' },
    };
  });
  return { translationSchemaVersion: TRANSLATION_SCHEMA_VERSION, targetLanguage: 'en', translationsByFoodId, validationIssues: [], skippedTranslationCall: true };
}

function buildTranslatePrompt(dishes, targetLangName) {
  const itemsText = dishes.map((d, idx) => {
    const eatingMethodLines = (Array.isArray(d.eatingMethod) ? d.eatingMethod : [])
      .map((step, i) => `     ${i + 1}) ${step}`).join('\n');
    return [
      `${idx + 1}. foodId: "${d.foodId}"`,
      `   name: "${d.nameEn || d.nameKo || ''}"`,
      `   ingredients: "${d.ingredients || ''}"`,
      `   eatingMethod:`,
      eatingMethodLines || '     (none)',
      `   description: "${d.description || ''}"`,
      `   culturalNote: "${d.culturalNote || ''}"`,
    ].join('\n');
  }).join('\n\n');

  return `You are a translation assistant for a Korean food travel app. Translate the following food item fields into ${targetLangName}. Keep the meaning accurate and natural for a traveler; do not add or remove information, and do not translate the "foodId" value itself.

Respond with ONLY strict JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "translations": [
    { "foodId": "<copied exactly from input>", "translatedName": "...", "ingredients": "...", "eatingMethod": ["...", "..."], "description": "...", "culturalNote": "..." }
  ]
}

Items to translate:
${itemsText}

Rules:
- Return exactly one translation entry per item above, with "foodId" copied exactly as given (do not translate it).
- Translate every other text field into ${targetLangName}.
- If "culturalNote" was an empty string, keep it an empty string in the translation.
- Never return anything other than that JSON object shape.`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { analysisId, dishes, targetLanguage } = req.body || {};

  if (!analysisId || typeof analysisId !== 'string') {
    res.status(400).json({ error: 'analysisId (string) is required' });
    return;
  }
  if (!Array.isArray(dishes) || dishes.length === 0 || !dishes.every(isValidDishInput)) {
    res.status(400).json({ error: 'dishes must be a non-empty array of { foodId, ... } objects' });
    return;
  }
  if (dishes.length > 10) {
    res.status(400).json({ error: 'dishes must contain at most 10 entries' });
    return;
  }

  const lang = typeof targetLanguage === 'string' && LANGUAGE_NAMES[targetLanguage] ? targetLanguage : 'en';

  // [IMP-04/05] 영어는 번역이 필요 없다 — Gemini를 호출하지 않고 즉시 반환.
  if (lang === 'en') {
    res.status(200).json(echoEnglishAsTranslation(dishes));
    return;
  }

  const cacheKey = buildTranslationCacheKey(analysisId, lang);
  const cached = translationCache.get(cacheKey);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY. Add it in Vercel > Project Settings > Environment Variables, then redeploy.', code: 'AI_CONFIG', retryable: false });
    return;
  }

  const expectedFoodIds = dishes.map((d) => d.foodId);
  const promptText = buildTranslatePrompt(dishes, LANGUAGE_NAMES[lang]);

  // [QUOTA] Daily quota already spent (seen on an earlier request): answer
  // locally instead of spending a request on a certain 429. Cached results
  // above are still served.
  const quotaBlocked = gemini.quotaBlock(GEMINI_MODEL);
  if (quotaBlocked) {
    gemini.logFailure('translate-dish', quotaBlocked);
    gemini.sendFailure(res, quotaBlocked, 'The daily AI translation limit has been reached.');
    return;
  }

  const requestBody = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: gemini.buildGenerationConfig(GEMINI_MODEL, {
      maxOutputTokens: TRANSLATE_MAX_OUTPUT_TOKENS,
      thinkingBudget: TRANSLATE_THINKING_BUDGET,
    }),
  };
  const startedAt = Date.now();

  let response;
  try {
    response = await fetchWithRetry(
      () => {
        const remaining = Math.max(1000, Math.min(ATTEMPT_TIMEOUT_MS, TOTAL_BUDGET_MS - (Date.now() - startedAt)));
        const { url, init } = gemini.buildGeminiRequest(GEMINI_MODEL, apiKey, requestBody, AbortSignal.timeout(remaining));
        return fetch(url, init);
      },
      {
        maxAttempts: 3,
        maxTotalMs: TOTAL_BUDGET_MS,
        baseDelayMs: 400,
        maxDelayMs: 6000,
        // [QUOTA] no retry on a daily quota; follow RetryInfo for minute/token quotas
        inspectResponse: gemini.inspectRetry,
        onRetry: (attempt, delayMs, reason) => {
          console.warn(`[IMP-13] 번역 재시도 #${attempt}(${Math.round(delayMs)}ms 대기) — 사유: ${reason}`);
        },
      }
    );
  } catch (err) {
    const failure = gemini.classifyThrownError(err);
    gemini.logFailure('translate-dish', failure);
    gemini.sendFailure(res, failure, 'The translation request failed.');
    return;
  }

  try {
    if (!response.ok) {
      const errText = await response.text();
      const failure = gemini.classifyHttpFailure(response.status, errText, false, response.headers && response.headers.get ? response.headers.get('retry-after') : null);
      gemini.noteQuotaFailure(GEMINI_MODEL, failure);
      gemini.logFailure('translate-dish', failure);
      gemini.sendFailure(res, failure, 'The translation request failed.');
      return;
    }

    const data = await response.json();
    const extracted = gemini.extractCandidateText(data);
    if (extracted.failure) {
      gemini.logFailure('translate-dish', extracted.failure, data.usageMetadata);
      gemini.sendFailure(res, extracted.failure, 'No usable content returned from the translation provider.');
      return;
    }
    const content = extracted.text;

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      gemini.logFailure('translate-dish', { ...gemini.ERROR_CODES.RESPONSE_INVALID, finishReason: extracted.finishReason }, data.usageMetadata);
      gemini.sendFailure(res, gemini.ERROR_CODES.RESPONSE_INVALID, 'The translation response was not valid JSON.');
      return;
    }

    const validated = validateAndNormalizeTranslationResponse(parsed, expectedFoodIds);
    validated.targetLanguage = lang;

    // 전부 실패(translations 자체가 없거나 배열이 아님)했으면 캐시하지 않고 502.
    // 일부만 빠진 경우(개별 foodId 누락)는 200으로 돌려주고, 클라이언트가
    // 그 dish만 영어 원문으로 대체 표시한다("번역 실패 시 원본 데이터 보존").
    const totallyFailed = Object.keys(validated.translationsByFoodId).length === 0 && expectedFoodIds.length > 0;
    if (totallyFailed) {
      console.error('[IMP-04] 번역 응답이 계약을 완전히 벗어남:', JSON.stringify(validated.validationIssues));
      gemini.sendFailure(res, gemini.ERROR_CODES.RESPONSE_INVALID, 'The translation response did not match the expected schema.', { validationIssues: validated.validationIssues });
      return;
    }

    translationCache.set(cacheKey, validated);
    res.status(200).json(validated);
  } catch (err) {
    console.error('translate-dish handler error:', err && err.name, err && err.message);
    res.status(500).json({ error: 'Internal server error while translating.', code: 'AI_RESPONSE_INVALID', retryable: true });
  }
}

module.exports._translationCache = translationCache;
module.exports._buildTranslationCacheKey = buildTranslationCacheKey;
