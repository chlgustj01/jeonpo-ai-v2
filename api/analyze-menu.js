// Vercel Serverless Function: /api/analyze-menu
//
// Receives a base64 photo from the browser, sends it to Google's Gemini
// vision model (server-side, where the API key stays hidden), and returns a
// structured JSON description of the dish: translated name, ingredients,
// allergens, spice level, dietary flags, and a short eating guide.
//
// SETUP REQUIRED:
// 1. Get a free API key at https://aistudio.google.com/apikey
//    (No credit card needed — sign in with a Google account, click
//    "Create API Key", done in about a minute.)
// 2. In your Vercel project settings > Environment Variables, add:
//      Name:  GEMINI_API_KEY
//      Value: <your key>
// 3. Redeploy. The key never appears in the browser or in this file.
//
// Note: Google's free tier may use free-tier requests/responses to improve
// their models. If that matters for your use case, review Gemini's terms
// or switch to a paid tier / different provider.

// [IMP-11] 이 목록은 더 이상 여기서 직접 손으로 관리하지 않는다.
// 수정 전에는 이 배열과 index.html의 standardAllergens가 서로 다른 파일에
// "복사-붙여넣기"로 각자 존재해서, fish/sesame 같은 id가 한쪽(데모 데이터)에만
// 쓰이고 다른 쪽(여기, 그리고 index.html 표준 목록)에는 등록되지 않는 불일치가
// 생겼다. 이제 index.html과 똑같은 shared/allergens.js를 require해서, 프론트와
// 서버가 "정의가 다른 두 목록"이 아니라 "하나의 목록을 각자 불러와 쓰는" 구조가
// 되게 한다. Vercel은 require로 참조된 로컬 파일을 함수 배포 시 자동으로
// 같이 포함시키므로(File Tracing) vercel.json 등 별도 설정이 필요 없다.
const ALLERGEN_REGISTRY = require('../shared/allergens.js');
const ALLOWED_ALLERGEN_IDS = ALLERGEN_REGISTRY.map((entry) => entry.id);

// [IMP-02] Gemini가 돌려준 원시 JSON은 지금까지 구조 검증 없이 그대로
// res.status(200).json(parsed)로 클라이언트에 전달되고 있었다(이 파일을
// 처음부터 끝까지 읽어 확인한 내용 — docs/devlog/IMP-02.md §2 참고).
// dishes가 배열이 아니거나, 원소가 null이거나, allergens가 문자열 하나
// ("egg")로 오거나, 등록되지 않은 알레르겐 id가 섞여 있어도 서버는 전혀
// 걸러내지 않았다 — 검증/정규화는 지금까지 index.html 쪽에서만, 그것도
// spicy 필드 하나만(IMP-01) 하고 있었다. shared/dish-schema.js는 이 공백을
// 메우는 서버·프론트 공용 검증기다(index.html도 동일 모듈을 재사용).
const { validateAndNormalizeDishesResponse, SCHEMA_VERSION: DISH_SCHEMA_VERSION } = require('../shared/dish-schema.js');

// [IMP-04] 이미지 분석과 번역 분리.
//
// 수정 전엔 이 한 번의 Gemini 호출이 "사진 속 음식 식별"과 "그 결과를
// targetLanguage로 번역"을 동시에 했다(프롬프트의 `${targetLangName}` 자리
// 전부). 그 결과 사용자가 언어만 바꿔도(알레르겐/식재료/위험도는 전혀
// 바뀌지 않는데) 이 무거운 비전 호출 전체를 처음부터 다시 실행해야 했다
// (index.html의 setLanguage()가 analyzeMenuPhotoWithAI를 다시 불렀음 —
// 수정 전 코드는 git show 3bb5d8e:index.html로 확인).
//
// 이제 이 핸들러는 사진을 영어로만 분석한다(name_ko/name_en은 원래부터
// 언어와 무관한 고유 식별 정보였으므로 그대로 유지). 화면 언어로의 번역은
// 완전히 분리된 api/translate-dish.js가 맡고, 그 입력은 이 핸들러가 돌려주는
// "정준(canonical) 영어 텍스트"뿐이다 — allergens/crossContactAllergens/spicy/
// foodId 등 위험도 판정에 쓰이는 값은 번역 과정에 아예 전달되지 않으므로
// "번역 중에 바뀔 수 없다"는 요구사항이 설계상 보장된다.
const crypto = require('crypto');
const { fetchWithRetry } = require('../shared/http-retry.js');
const { createTtlCache } = require('../shared/server-cache.js');
const gemini = require('../shared/gemini-client.js');

// [PKG5-01] Can be overridden with the GEMINI_MODEL env var (validated id only).
const GEMINI_MODEL = gemini.resolveGeminiModel(process.env.GEMINI_MODEL);
// [IMP-05] 캐시 키에 포함해, 프롬프트/모델/스키마를 바꾸면 예전 캐시가
// 새 계약을 모르는 채로 재사용되지 않게 한다("분석 모델, 프롬프트 버전,
// 응답 스키마 버전을 캐시 키에 고려" 요구사항).
// [PKG5-01] 2.1.0: menuItemCount + ingredientSource, shorter per-dish text.
const ANALYSIS_PROMPT_VERSION = '2.1.0';

// [PKG5-01] Output budget. The reproduced failure used 2044 thinking tokens
// + 1013 answer tokens and hit the 3072 cap after ~3 of 9 dishes. A 10-dish
// answer needs roughly 3-4k tokens, so: cap thinking at 1024 and leave
// 8192 total. Both numbers are re-checked by the real-API check in
// docs/TEST-REPORT.md.
const ANALYSIS_MAX_OUTPUT_TOKENS = 8192;
const ANALYSIS_THINKING_BUDGET = 1024;
const MAX_DISHES = 10; // same as LIMITS.MAX_DISHES in shared/dish-schema.js and translate-dish's cap
// [PKG5-08] Vercel rejects request bodies over 4.5MB anyway; reject earlier
// with a clear code. The client resizes to 1024px JPEG (~100-300KB).
const MAX_IMAGE_BASE64_CHARS = 4 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
// One attempt must finish within this; the retry loop has its own total budget.
const ATTEMPT_TIMEOUT_MS = 45000;
const TOTAL_BUDGET_MS = 55000;

// [IMP-05] 서버 프로세스 메모리 캐시. 같은 사진(해시 동일)을 다시 분석
// 요청하면 Gemini를 다시 부르지 않고 캐시된 결과를 그대로 돌려준다. 실패한
// 응답(validationStatus: 'invalid', 네트워크/HTTP 오류)은 절대 캐시하지
// 않는다 — 일시적 오류를 "정상 결과"로 고정시키지 않기 위함.
const analysisCache = createTtlCache({ maxEntries: 200, ttlMs: 30 * 60 * 1000 });

function buildAnalysisCacheKey(imageHash) {
  return [imageHash, GEMINI_MODEL, ANALYSIS_PROMPT_VERSION, DISH_SCHEMA_VERSION].join(':');
}

// [IMP-04] 더 이상 ${targetLangName}이 프롬프트에 들어가지 않는다 — 전부
// 영어로만 분석을 요청한다. ingredients/eatingMethod/description/
// culturalNote는 이제 "번역 전 정준 텍스트"이고, translated_name 필드 자체는
// 완전히 제거했다(번역은 api/translate-dish.js 몫).
const ANALYSIS_PROMPT_TEXT = `You are a menu-reading assistant helping foreign travelers understand Korean food. You will be shown one of these kinds of photos:
(a) a restaurant menu board or printed menu listing several dishes,
(b) a single plated dish on a table,
(c) a packaged food product's ingredient/nutrition label (성분표).

Identify what food item(s) are actually present, based on which of these it is:
- If it's a menu board/printed menu (a): identify EVERY distinct food or drink item that has a clearly readable name — return all of them, not just one.
- If it's a single plated dish (b): return just that one dish.
- If it's a packaged product's ingredient label (c): treat the WHOLE label as describing ONE product. Read its actual printed ingredient list and allergen notices directly from the label text, and return exactly one dish entry for that product (its name, and its ingredients drawn from what's printed on the label) — do NOT split the individual listed ingredients into separate "dishes".

Do NOT treat these as food items at all: restaurant/store names or logos, addresses, phone numbers, prices shown alone, section headers (e.g. "Set Menu", "Side Dishes"), barcodes, nutrition facts numbers (calories/sodium/etc. by themselves), or any other non-food text. Only include actual food/drink/product names.

Respond with ONLY strict JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "menuItemCount": 0,
  "dishes": [
    {
      "name_ko": "Korean name in Hangul, e.g. 삼겹살",
      "name_en": "Romanized or English name, e.g. Samgyeopsal",
      "ingredientSource": "printed or inferred",
      "ingredients": "Comma-separated key ingredients, written in English",
      "allergens": ["zero or more ids from this exact list: ${ALLOWED_ALLERGEN_IDS.join(', ')}"],
      "crossContactAllergens": ["optional ids from the same list, for trace/shared-sauce risk only"],
      "spicy": 0,
      "eatingMethod": ["2 short steps for how to eat this dish, written in English"],
      "description": "1 short sentence describing what this dish/product is, written in English",
      "culturalNote": "1 short sentence with a cultural tip, written in English (empty string if nothing noteworthy)"
    }
  ]
}

Rules:
- "menuItemCount" is the total number of distinct food/drink items you can see in the photo, INCLUDING any you did not return because of the 10-item limit.
- Return between 1 and 10 dish entries — as many distinct food/drink items as you can clearly read, but never invent items that aren't actually visible in the photo. If there are more than 10, return the first 10 in reading order.
- "ingredientSource" is "printed" only when the ingredients/allergens come from text actually printed in the photo (an ingredient label or a menu description line). If you only see the dish name and are describing the usual recipe, use "inferred". Most menu boards that list only names are "inferred".
- Keep every text field short (the whole answer must fit in a limited output budget).
- "spicy" must be an integer from 0 to 3 (0 = none, 1 = mild, 2 = hot, 3 = extreme).
- Only use allergen ids from the exact list given — never invent new ones.
- If you genuinely cannot identify any food item at all, return {"dishes": []}.
- Never return anything other than that JSON object shape.
- Write every text field in English regardless of what language the photo's text is in — translation into other languages happens in a separate step.

Now analyze the attached photo and return the JSON described above.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { imageBase64 } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    res.status(400).json({ error: 'imageBase64 (a data: URL string) is required' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY. Add it in Vercel > Project Settings > Environment Variables, then redeploy.', code: 'AI_CONFIG', retryable: false });
    return;
  }

  // [PKG5-08] Size check before the regex runs on a huge string.
  if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
    gemini.sendFailure(res, gemini.ERROR_CODES.IMAGE_TOO_LARGE, 'Image is too large. Resize it before uploading.');
    return;
  }

  // Strip the "data:image/jpeg;base64," prefix — Gemini wants the raw
  // base64 payload plus a separate mime type field.
  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    res.status(400).json({ error: 'imageBase64 must be a data: URL (e.g. "data:image/jpeg;base64,...")', code: 'IMAGE_INVALID', retryable: false });
    return;
  }
  const mimeType = match[1].toLowerCase();
  const base64Data = match[2];
  if (ALLOWED_IMAGE_MIME_TYPES.indexOf(mimeType) === -1) {
    gemini.sendFailure(res, gemini.ERROR_CODES.IMAGE_INVALID, `Unsupported image type: ${mimeType}`);
    return;
  }

  // [IMP-05] 이미지 식별: 사진 바이트 자체(SHA-256)를 캐시 키로 쓴다 —
  // 같은 사진을 다시 올리면(언어만 바꿔 재요청하거나, 실수로 같은 사진을
  // 두 번 올리는 경우) 항상 같은 해시가 나와 캐시가 적중한다.
  const imageHash = crypto.createHash('sha256').update(base64Data).digest('hex');
  const cacheKey = buildAnalysisCacheKey(imageHash);

  const cached = analysisCache.get(cacheKey);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  const requestBody = {
    contents: [
      {
        parts: [
          { text: ANALYSIS_PROMPT_TEXT },
          { inline_data: { mime_type: mimeType, data: base64Data } }
        ]
      }
    ],
    generationConfig: gemini.buildGenerationConfig(GEMINI_MODEL, {
      maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
      thinkingBudget: ANALYSIS_THINKING_BUDGET,
    }),
  };
  const startedAt = Date.now();

  let response;
  try {
    response = await fetchWithRetry(
      () => {
        // [PKG5-01] Per-attempt timeout, capped by what is left of the total budget.
        const remaining = Math.max(1000, Math.min(ATTEMPT_TIMEOUT_MS, TOTAL_BUDGET_MS - (Date.now() - startedAt)));
        const { url, init } = gemini.buildGeminiRequest(GEMINI_MODEL, apiKey, requestBody, AbortSignal.timeout(remaining));
        return fetch(url, init);
      },
      {
        // [IMP-13] 429/502/503/504 및 네트워크 오류만 재시도한다. 400처럼
        // 영구적인 요청 오류는 fetchWithRetry가 즉시 그대로 돌려준다.
        maxAttempts: 3,
        maxTotalMs: TOTAL_BUDGET_MS,
        baseDelayMs: 500,
        maxDelayMs: 8000,
        onRetry: (attempt, delayMs, reason) => {
          console.warn(`[IMP-13] Gemini 이미지 분석 재시도 #${attempt}(${Math.round(delayMs)}ms 대기) — 사유: ${reason}`);
        },
      }
    );
  } catch (err) {
    const failure = gemini.classifyThrownError(err);
    gemini.logFailure('analyze-menu', failure);
    gemini.sendFailure(res, failure, failure.code === 'AI_TIMEOUT' ? 'The AI provider timed out.' : 'Could not reach the AI provider.');
    return;
  }

  try {
    if (!response.ok) {
      const errText = await response.text();
      const failure = gemini.classifyHttpFailure(response.status, errText, true);
      gemini.logFailure('analyze-menu', failure);
      gemini.sendFailure(res, failure, `The AI provider request failed (${failure.code}).`);
      return;
    }

    const data = await response.json();
    const extracted = gemini.extractCandidateText(data);
    if (extracted.failure) {
      gemini.logFailure('analyze-menu', extracted.failure, data.usageMetadata);
      const message = extracted.failure.code === 'AI_OUTPUT_TRUNCATED'
        ? 'The AI answer was cut off before it finished (too many items in one photo).'
        : extracted.failure.code === 'AI_BLOCKED'
          ? 'The AI provider declined to analyze this image.'
          : 'No content returned from the AI provider.';
      gemini.sendFailure(res, extracted.failure, message);
      return;
    }
    const content = extracted.text;

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      // Log only the size, not the model text.
      gemini.logFailure('analyze-menu', { ...gemini.ERROR_CODES.RESPONSE_INVALID, finishReason: extracted.finishReason }, data.usageMetadata);
      console.error('[analyze-menu] JSON.parse failed, text length', content.length);
      gemini.sendFailure(res, gemini.ERROR_CODES.RESPONSE_INVALID, 'The AI response was not valid JSON.');
      return;
    }

    // [IMP-02] Gemini가 JSON 파싱 자체는 성공했지만 내용물이 계약과 다를 수
    // 있는 모든 경우를 validateAndNormalizeDishesResponse()가 걸러/정규화한다
    // (dishes 누락/비배열 → 'invalid', dishes: [] → 'empty', 일부 dish만
    // 깨짐 → 그 원소만 버리고 나머지 생존 → 'partial', 전부 정상 → 'valid').
    const validated = validateAndNormalizeDishesResponse(parsed, ALLOWED_ALLERGEN_IDS);

    if (validated.validationStatus === 'invalid') {
      console.error('[IMP-02] AI 응답이 스키마 계약을 벗어나 사용 가능한 dish가 하나도 없음:', JSON.stringify(validated.validationIssues));
      // [IMP-05] 실패 응답은 캐시하지 않는다 — 다음 요청(예: 재시도)이
      // 이번과 같은 일시적 실패를 그대로 재사용하면 안 되기 때문이다.
      gemini.sendFailure(res, gemini.ERROR_CODES.RESPONSE_INVALID, 'The AI response did not match the expected schema.', { validationIssues: validated.validationIssues });
      return;
    }

    if (validated.validationIssues.length > 0) {
      console.warn('[IMP-02] AI 응답 일부 필드가 계약을 벗어남(정규화 후 진행):', JSON.stringify(validated.validationIssues));
    }

    // [PKG5-02] Enforce the 10-dish cap (LIMITS.MAX_DISHES was declared in
    // dish-schema.js but never applied; translate-dish rejects >10 with 400).
    const returnedBeforeCap = validated.dishes.length;
    if (validated.dishes.length > MAX_DISHES) validated.dishes = validated.dishes.slice(0, MAX_DISHES);
    validated.coverage = buildCoverage(parsed, returnedBeforeCap, validated.dishes.length);

    // [PKG5-02] Where the ingredient info came from: read from the photo
    // ("printed") or the model's guess from the dish name ("inferred").
    // Unknown/missing values become "inferred" (the safer reading).
    const rawDishes = Array.isArray(parsed.dishes) ? parsed.dishes : [];
    validated.dishes.forEach((dish) => {
      const raw = rawDishes.find((d) => d && (d.name_ko === dish.nameKo || d.name_en === dish.nameEn));
      dish.ingredientSource = raw && raw.ingredientSource === 'printed' ? 'printed' : 'inferred';
    });

    // [IMP-04] analysisId: 클라이언트가 이후 /api/translate-dish를 호출할 때
    // "이 번역이 어느 분석 결과에 속하는지"를 밝히는 안정적인 식별자로 쓴다.
    // 이미지 해시를 그대로 재사용하므로 서버가 추가로 발급/저장할 상태가 없다.
    validated.analysisId = imageHash;

    // [IMP-05] 성공(valid/partial/empty)한 응답만 캐시한다.
    analysisCache.set(cacheKey, validated);

    res.status(200).json(validated);
  } catch (err) {
    console.error('analyze-menu handler error:', err && err.name, err && err.message);
    res.status(500).json({ error: 'Internal server error while analyzing the photo.', code: 'AI_RESPONSE_INVALID', retryable: true });
  }
}

// [PKG5-02] How much of the menu this result covers. visibleItemCount comes
// from the model's own count, so it is an estimate; it is null when the
// model did not report a usable number. isComplete is false whenever we know
// some visible items are missing, and null when we cannot tell.
function buildCoverage(parsed, returnedBeforeCap, returnedCount) {
  const raw = parsed && parsed.menuItemCount;
  const visible = Number.isInteger(raw) && raw >= 0 && raw <= 200 ? raw : null;
  const effectiveVisible = visible === null ? null : Math.max(visible, returnedBeforeCap);
  let isComplete;
  if (returnedBeforeCap > returnedCount) isComplete = false;
  else if (effectiveVisible === null) isComplete = null;
  else isComplete = effectiveVisible <= returnedCount;
  return { returnedCount, visibleItemCount: effectiveVisible, maxDishes: MAX_DISHES, isComplete };
}

// [IMP-05] 테스트에서 캐시 적중/크기/만료를 직접 들여다볼 수 있게 노출한다
// (요청 처리 계약(module.exports = handler)과는 별개의 보조 속성 — 실제
// Vercel 런타임은 이 속성을 쓰지 않는다).
module.exports._analysisCache = analysisCache;
module.exports._buildAnalysisCacheKey = buildAnalysisCacheKey;
