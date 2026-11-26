// tests/imp-05-after.js
// [IMP-05] 캐싱 및 중복 API 호출 방지 — 수정 "후" 테스트.
const assert = require('assert');
const path = require('path');
const { createTtlCache } = require('../shared/server-cache.js');
const { loadApp, pick } = require('./harness.js');

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
function geminiDishResponse(dish) { return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ dishes: [dish] }) }] } }] }) }; }

const SAMPLE_DISH = { name_ko: '김치찌개', name_en: 'Kimchi Jjigae', ingredients: 'kimchi, pork, tofu', allergens: ['soybean'], spicy: 2, eatingMethod: ['Eat hot'], description: 'A stew', culturalNote: '' };

async function main() {
  // ---------------- shared/server-cache.js 순수 로직 ----------------
  await tc('TC-05-01', 'createTtlCache: set 후 즉시 get하면 적중', async () => {
    const cache = createTtlCache({ maxEntries: 10, ttlMs: 10000 });
    cache.set('k', { v: 1 });
    A.deepStrictEqual(cache.get('k'), { v: 1 });
  });

  await tc('TC-05-02', 'createTtlCache: TTL 만료 후 get하면 undefined', async () => {
    const cache = createTtlCache({ maxEntries: 10, ttlMs: 5 });
    cache.set('k', { v: 1 });
    await new Promise((r) => setTimeout(r, 15));
    A.strictEqual(cache.get('k'), undefined);
  });

  await tc('TC-05-03', 'createTtlCache: 최대 크기 초과 시 가장 오래된(가장 최근에 안 읽힌) 항목부터 제거', async () => {
    const cache = createTtlCache({ maxEntries: 2, ttlMs: 10000 });
    cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
    A.strictEqual(cache.size(), 2);
    A.strictEqual(cache.get('a'), undefined, '가장 먼저 들어간 a가 제거되어야 함');
    A.strictEqual(cache.get('c'), 3);
  });

  await tc('TC-05-04', 'createTtlCache: 다시 읽은 항목은 "최근 사용"으로 갱신되어 더 오래 살아남음(LRU 근사)', async () => {
    const cache = createTtlCache({ maxEntries: 2, ttlMs: 10000 });
    cache.set('a', 1); cache.set('b', 2);
    cache.get('a'); // a를 다시 읽어 최근 사용으로 갱신
    cache.set('c', 3); // 이제 b가 가장 오래된 항목
    A.strictEqual(cache.get('b'), undefined);
    A.strictEqual(cache.get('a'), 1);
  });

  // ---------------- api/analyze-menu.js 서버 캐시 ----------------
  await tc('TC-05-05', '같은 이미지를 다시 분석 요청하면 Gemini를 다시 호출하지 않음(캐시 적중)', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    handler._analysisCache.clear();
    let geminiCalls = 0;
    global.fetch = async () => { geminiCalls++; return geminiDishResponse(SAMPLE_DISH); };
    process.env.GEMINI_API_KEY = 'test-key';
    const req = { method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,SAME_IMAGE_05' } };
    await handler(req, makeRes());
    await handler(req, makeRes());
    A.strictEqual(geminiCalls, 1, '두 번째 요청은 캐시에서 바로 응답해야 함');
  });

  await tc('TC-05-06', '다른 이미지는 캐시가 적중하지 않고 각자 Gemini를 호출함', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    handler._analysisCache.clear();
    let geminiCalls = 0;
    global.fetch = async () => { geminiCalls++; return geminiDishResponse(SAMPLE_DISH); };
    process.env.GEMINI_API_KEY = 'test-key';
    await handler({ method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,IMG_A' } }, makeRes());
    await handler({ method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,IMG_B' } }, makeRes());
    A.strictEqual(geminiCalls, 2);
  });

  await tc('TC-05-07', '실패(validationStatus: invalid) 응답은 캐시되지 않음 — 다음 요청이 다시 Gemini를 호출', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    handler._analysisCache.clear();
    let geminiCalls = 0;
    global.fetch = async () => {
      geminiCalls++;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ notDishes: 'oops' }) }] } }] }) };
    };
    process.env.GEMINI_API_KEY = 'test-key';
    const req = { method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,FAIL_IMG_05' } };
    const res1 = makeRes();
    await handler(req, res1);
    A.strictEqual(res1.statusCode, 502);
    await handler(req, makeRes());
    A.strictEqual(geminiCalls, 2, '실패 응답은 캐시되지 않아 두 번째도 다시 Gemini를 호출해야 함');
  });

  await tc('TC-05-08', '응답에 analysisId(이미지 해시)가 포함되어 번역 요청에 재사용 가능', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    handler._analysisCache.clear();
    global.fetch = async () => geminiDishResponse(SAMPLE_DISH);
    process.env.GEMINI_API_KEY = 'test-key';
    const res = makeRes();
    await handler({ method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,IMG_ID_05' } }, res);
    A.ok(typeof res.body.analysisId === 'string' && res.body.analysisId.length > 0);
  });

  // ---------------- api/translate-dish.js 서버 캐시 ----------------
  await tc('TC-05-09', '같은 (분석ID, 언어)로 다시 번역 요청하면 Gemini를 다시 호출하지 않음', async () => {
    delete require.cache[require.resolve('../api/translate-dish.js')];
    const handler = require('../api/translate-dish.js');
    handler._translationCache.clear();
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ foodId: 'kimchijjigae', translatedName: '김치찌개', ingredients: '김치, 돼지고기', eatingMethod: ['뜨거울 때 드세요'], description: '찌개', culturalNote: '' }] }) }] } }] }) };
    };
    process.env.GEMINI_API_KEY = 'test-key';
    const body = { analysisId: 'hash123', targetLanguage: 'ko', dishes: [{ foodId: 'kimchijjigae', nameEn: 'Kimchi Jjigae', nameKo: '김치찌개', ingredients: 'kimchi', eatingMethod: ['eat hot'], description: 'stew', culturalNote: '' }] };
    await handler({ method: 'POST', body }, makeRes());
    await handler({ method: 'POST', body }, makeRes());
    A.strictEqual(calls, 1);
  });

  await tc('TC-05-10', '같은 분석ID라도 다른 언어면 캐시가 별도로 적용됨', async () => {
    delete require.cache[require.resolve('../api/translate-dish.js')];
    const handler = require('../api/translate-dish.js');
    handler._translationCache.clear();
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ foodId: 'x', translatedName: 't', ingredients: 'i', eatingMethod: [], description: 'd', culturalNote: '' }] }) }] } }] }) };
    };
    process.env.GEMINI_API_KEY = 'test-key';
    const dishes = [{ foodId: 'x', nameEn: 'X', nameKo: 'ex', ingredients: 'i', eatingMethod: [], description: 'd', culturalNote: '' }];
    await handler({ method: 'POST', body: { analysisId: 'hashABC', targetLanguage: 'ko', dishes } }, makeRes());
    await handler({ method: 'POST', body: { analysisId: 'hashABC', targetLanguage: 'ja', dishes } }, makeRes());
    A.strictEqual(calls, 2);
  });

  await tc('TC-05-11', 'targetLanguage: "en"은 캐시 확인 전에 Gemini 호출 자체를 하지 않음', async () => {
    delete require.cache[require.resolve('../api/translate-dish.js')];
    const handler = require('../api/translate-dish.js');
    handler._translationCache.clear();
    let calls = 0;
    global.fetch = async () => { calls++; return { ok: true, json: async () => ({}) }; };
    process.env.GEMINI_API_KEY = 'test-key';
    const dishes = [{ foodId: 'x', nameEn: 'X', nameKo: 'ex', ingredients: 'i', eatingMethod: [], description: 'd', culturalNote: '' }];
    const res = makeRes();
    await handler({ method: 'POST', body: { analysisId: 'hashEN', targetLanguage: 'en', dishes } }, res);
    A.strictEqual(calls, 0);
    A.strictEqual(res.body.translationsByFoodId.x.translatedName, 'X');
  });

  // ---------------- 클라이언트 측(index.html) 캐시 ----------------
  await tc('TC-05-12', '클라이언트: 같은 이미지로 재분석 트리거 시 /api/analyze-menu를 다시 호출하지 않음', async () => {
    let analyzeCalls = 0;
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/api/analyze-menu')) {
        analyzeCalls++;
        return { ok: true, json: async () => ({ schemaVersion: '1.0.0', validationStatus: 'valid', validationIssues: [], analysisId: 'imgHash1', dishes: [{ foodId: 'bibimbap', name: 'Bibimbap', nameKo: '비빔밥', nameEn: 'Bibimbap', ingredients: 'rice', allergens: [], crossContactAllergens: [], spicy: 0, spicyStatus: 'valid', eatingMethod: [], description: '', culturalNote: '', fieldStatus: {}, dishValidationStatus: 'valid' }] }) };
      }
      throw new Error('unexpected: ' + u);
    };
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    const vm = require('vm');
    await vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,CLIENT_SAME_IMG')`, context);
    await vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,CLIENT_SAME_IMG')`, context);
    A.strictEqual(analyzeCalls, 1, '두 번째 트리거는 state.lastAnalysis 캐시로 처리되어야 함(lang=en 기본값이라 번역 호출도 없음)');
  });

  await tc('TC-05-13', '클라이언트: 언어를 바꿔도 /api/analyze-menu는 다시 호출되지 않고 /api/translate-dish만 호출됨', async () => {
    let analyzeCalls = 0, translateCalls = 0;
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/api/analyze-menu')) {
        analyzeCalls++;
        return { ok: true, json: async () => ({ schemaVersion: '1.0.0', validationStatus: 'valid', validationIssues: [], analysisId: 'imgHash2', dishes: [{ foodId: 'bibimbap', name: 'Bibimbap', nameKo: '비빔밥', nameEn: 'Bibimbap', ingredients: 'rice', allergens: [], crossContactAllergens: [], spicy: 0, spicyStatus: 'valid', eatingMethod: [], description: '', culturalNote: '', fieldStatus: {}, dishValidationStatus: 'valid' }] }) };
      }
      if (u.includes('/api/translate-dish')) {
        translateCalls++;
        return { ok: true, json: async () => ({ translationSchemaVersion: '1.0.0', targetLanguage: 'ko', translationsByFoodId: { bibimbap: { translatedName: '비빔밥', ingredients: '밥', eatingMethod: [], description: '', culturalNote: '', fieldStatus: {} } }, validationIssues: [] }) };
      }
      throw new Error('unexpected: ' + u);
    };
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    const vm = require('vm');
    const { pick: pick2 } = require('./harness.js');
    await vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,CLIENT_LANG_SWITCH')`, context);
    const picked = pick2(context, ['state']);
    picked.state.lang = 'ko';
    await vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,CLIENT_LANG_SWITCH')`, context);
    A.strictEqual(analyzeCalls, 1, '언어를 바꿔도 이미지 분석은 1번만 호출돼야 함');
    A.strictEqual(translateCalls, 1, '새 언어(ko)에 대한 번역은 1번 호출돼야 함');
  });

  await tc('TC-05-14', '클라이언트: 같은 (이미지, 언어) 조합을 또 요청하면 번역도 다시 호출하지 않음(클라이언트 캐시)', async () => {
    let translateCalls = 0;
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('/api/analyze-menu')) {
        return { ok: true, json: async () => ({ schemaVersion: '1.0.0', validationStatus: 'valid', validationIssues: [], analysisId: 'imgHash3', dishes: [{ foodId: 'd1', name: 'D1', nameKo: 'd1ko', nameEn: 'D1', ingredients: 'x', allergens: [], crossContactAllergens: [], spicy: 0, spicyStatus: 'valid', eatingMethod: [], description: '', culturalNote: '', fieldStatus: {}, dishValidationStatus: 'valid' }] }) };
      }
      if (u.includes('/api/translate-dish')) {
        translateCalls++;
        return { ok: true, json: async () => ({ translationsByFoodId: { d1: { translatedName: 't', ingredients: 'i', eatingMethod: [], description: 'd', culturalNote: '' } }, validationIssues: [] }) };
      }
      throw new Error('unexpected: ' + u);
    };
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    const vm = require('vm');
    const { pick: pick2 } = require('./harness.js');
    const picked = pick2(context, ['state']);
    picked.state.lang = 'ja';
    await vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,CLIENT_CACHE_14')`, context);
    await vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,CLIENT_CACHE_14')`, context);
    A.strictEqual(translateCalls, 1, '같은 이미지+같은 언어 재요청은 캐시로 처리돼야 함');
  });

  notRun('TC-05-UI-1', '실제 Vercel 콜드 스타트 환경에서 서버 캐시가 유지되지 않는 것(최선 노력 캐시)의 실제 동작', '실제 Vercel 배포 환경 없이 로컬에서 검증 불가 — 한계로 문서화');

  const summary = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log('\n=== 요약 ===');
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건 / 실행된 assertion 총 개수: ${totalAssertions}건`);
  if (summary.FAIL > 0) process.exitCode = 1;
}

main();
