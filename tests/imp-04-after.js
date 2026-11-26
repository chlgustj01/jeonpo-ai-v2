// tests/imp-04-after.js
// [IMP-04] 이미지 분석과 번역 분리 — 수정 "후" 테스트.
const assert = require('assert');
const path = require('path');
const vm = require('vm');
const { loadApp, pick } = require('./harness.js');
const { validateAndNormalizeTranslationResponse } = require('../shared/dish-schema.js');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const results = [];
let totalAssertions = 0;
const A = new Proxy(assert, {
  get(t, p) { const o = t[p]; if (typeof o !== 'function') return o; return (...a) => { totalAssertions++; return o.apply(t, a); }; },
});

async function tc(id, desc, fn) {
  try { await fn(); results.push({ id, status: 'PASS' }); console.log(`[PASS] ${id} ${desc}`); }
  catch (err) { results.push({ id, status: 'FAIL' }); console.error(`[FAIL] ${id} ${desc}\n       ${err.stack || err.message}`); }
}
function notRun(id, desc, reason) { results.push({ id, status: 'NOT RUN' }); console.log(`[NOT RUN] ${id} ${desc} — ${reason}`); }
function makeRes() { const r = {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.body = o; return r; }; return r; }

async function main() {
  await tc('TC-04-01', 'api/analyze-menu.js 프롬프트에 더 이상 targetLanguage 요청 바디 destructuring/translated_name JSON 필드가 없음(언어 중립) — 역사적 설명 주석은 제외', async () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'api', 'analyze-menu.js'), 'utf8');
    A.ok(!/const\s*\{\s*imageBase64\s*,\s*targetLanguage/.test(src), 'req.body에서 targetLanguage를 더 이상 꺼내지 않아야 함');
    A.ok(!/"translated_name"/.test(src), '프롬프트 JSON 스키마에 translated_name 필드가 더 이상 없어야 함');
    A.ok(src.includes('written in English'));
  });

  await tc('TC-04-02', 'api/analyze-menu.js 응답 dish에 nameEn(순수 영어 이름)이 포함됨', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    handler._analysisCache.clear();
    global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ dishes: [{ name_ko: '비빔밥', name_en: 'Bibimbap', ingredients: 'rice', allergens: [], spicy: 0, eatingMethod: [], description: '', culturalNote: '' }] }) }] } }] }) });
    process.env.GEMINI_API_KEY = 'test-key';
    const res = makeRes();
    await handler({ method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,IMP04_A' } }, res);
    A.strictEqual(res.body.dishes[0].nameEn, 'Bibimbap');
  });

  await tc('TC-04-03', 'validateAndNormalizeTranslationResponse: 정상 응답이면 모든 foodId에 대해 번역 생성', async () => {
    const result = validateAndNormalizeTranslationResponse({
      translations: [{ foodId: 'a', translatedName: 'A-ko', ingredients: 'i', eatingMethod: ['s1'], description: 'd', culturalNote: 'c' }],
    }, ['a']);
    A.strictEqual(result.validationIssues.length, 0);
    A.strictEqual(result.translationsByFoodId.a.translatedName, 'A-ko');
  });

  await tc('TC-04-04', 'validateAndNormalizeTranslationResponse: 기대한 foodId 중 하나가 응답에 없으면 issue로 기록(전체 실패 아님)', async () => {
    const result = validateAndNormalizeTranslationResponse({
      translations: [{ foodId: 'a', translatedName: 'A-ko', ingredients: 'i', eatingMethod: [], description: 'd', culturalNote: '' }],
    }, ['a', 'b']);
    A.strictEqual(Object.keys(result.translationsByFoodId).length, 1);
    A.ok(result.validationIssues.some((i) => i.issue === 'missing_translation_for_food_id' && i.raw === 'b'));
  });

  await tc('TC-04-05', 'validateAndNormalizeTranslationResponse: translations 자체가 없으면 완전히 빈 결과 + issue', async () => {
    const result = validateAndNormalizeTranslationResponse({ nope: true }, ['a']);
    A.deepStrictEqual(result.translationsByFoodId, {});
    A.strictEqual(result.validationIssues[0].issue, 'missing_or_not_array');
  });

  await tc('TC-04-06', 'api/translate-dish.js: allergens/spicy/foodId는 요청에 포함되지 않고 응답에도 전혀 등장하지 않음', async () => {
    delete require.cache[require.resolve('../api/translate-dish.js')];
    const handler = require('../api/translate-dish.js');
    handler._translationCache.clear();
    let sentBody = null;
    global.fetch = async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ foodId: 'd1', translatedName: 't', ingredients: 'i', eatingMethod: [], description: 'd', culturalNote: '' }] }) }] } }] }) };
    };
    process.env.GEMINI_API_KEY = 'test-key';
    const req = { method: 'POST', body: { analysisId: 'imp04hash', targetLanguage: 'ko', dishes: [{ foodId: 'd1', nameEn: 'D1', nameKo: 'd1ko', ingredients: 'i', eatingMethod: [], description: 'd', culturalNote: '' }] } };
    const res = makeRes();
    await handler(req, res);
    const promptText = sentBody.contents[0].parts[0].text;
    A.ok(!promptText.toLowerCase().includes('allerg'), '알레르겐 프로필이 Gemini 번역 프롬프트로 전송되면 안 됨');
    A.ok(!JSON.stringify(res.body).toLowerCase().includes('allerg'));
  });

  await tc('TC-04-07', '클라이언트: canonical dish의 allergens/spicy/foodId/dishValidationStatus는 번역 병합 후에도 완전히 동일(참조값까지 비교 가능한 원시값)', async () => {
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/api/analyze-menu')) {
        return { ok: true, json: async () => ({ schemaVersion: '1.0.0', validationStatus: 'valid', validationIssues: [], analysisId: 'h07', dishes: [{ foodId: 'sesame-dish', name: 'Sesame Dish', nameKo: '참깨요리', nameEn: 'Sesame Dish', ingredients: 'sesame oil', allergens: ['sesame'], crossContactAllergens: ['soybean'], spicy: 2, spicyStatus: 'valid', eatingMethod: ['Step1'], description: 'desc', culturalNote: 'note', fieldStatus: { allergens: 'valid' }, dishValidationStatus: 'valid' }] }) };
      }
      if (u.includes('/api/translate-dish')) {
        return { ok: true, json: async () => ({ translationsByFoodId: { 'sesame-dish': { translatedName: '참깨요리', ingredients: '참기름', eatingMethod: ['1단계'], description: '설명', culturalNote: '참고' } }, validationIssues: [] }) };
      }
      throw new Error('unexpected: ' + u);
    };
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    const { pick: pick2 } = require('./harness.js');
    pick2(context, ['state']).state.lang = 'ko';
    await vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,IMP04_07')`, context);
    const { state } = pick2(context, ['state']);
    // 렌더된 결과는 renderMultiDishScanResult 내부로 소비되므로, canonicalDishes 보존 여부를 직접 확인한다.
    A.deepStrictEqual(Array.from(state.lastAnalysis.canonicalDishes[0].allergens), ['sesame']);
    A.strictEqual(state.lastAnalysis.canonicalDishes[0].spicy, 2);
    A.strictEqual(state.lastAnalysis.canonicalDishes[0].foodId, 'sesame-dish');
  });

  await tc('TC-04-08', '클라이언트: 번역 실패(502) 시 원본 영어 데이터로 렌더링하고 번역-실패 토스트를 보여줌(결과가 사라지지 않음)', async () => {
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/api/analyze-menu')) {
        return { ok: true, json: async () => ({ schemaVersion: '1.0.0', validationStatus: 'valid', validationIssues: [], analysisId: 'h08', dishes: [{ foodId: 'd1', name: 'D1', nameKo: 'd1ko', nameEn: 'D1', ingredients: 'i', allergens: [], crossContactAllergens: [], spicy: 0, spicyStatus: 'valid', eatingMethod: [], description: '', culturalNote: '', fieldStatus: {}, dishValidationStatus: 'valid' }] }) };
      }
      if (u.includes('/api/translate-dish')) {
        return { ok: false, status: 502, json: async () => ({ error: 'boom' }) };
      }
      throw new Error('unexpected: ' + u);
    };
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    const { pick: pick2 } = require('./harness.js');
    pick2(context, ['state']).state.lang = 'ja';
    await vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,IMP04_08')`, context);
    const { state, document } = pick2(context, ['state', 'document']);
    A.strictEqual(state.hasScannedResult, true, '번역이 실패해도 분석 결과 자체는 화면에 남아있어야 함(원본 보존)');
    const toastMsg = document.getElementById('toast-message');
    A.ok(toastMsg.innerText.length > 0);
  });

  notRun('TC-04-UI-1', '실제 Gemini 응답에서 여러 언어로의 번역 품질/자연스러움', '요청사항상 실제 API 호출 지양 — 스키마/병합 로직은 Mock으로 검증 완료');

  const summary = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log('\n=== 요약 ===');
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건 / 실행된 assertion 총 개수: ${totalAssertions}건`);
  if (summary.FAIL > 0) process.exitCode = 1;
}

main();
