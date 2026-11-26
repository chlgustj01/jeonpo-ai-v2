// tests/imp-06-after.js
// [IMP-06] 비동기 요청 및 상태 관리 — 수정 "후" 테스트.
const assert = require('assert');
const path = require('path');
const vm = require('vm');
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

function dishEnvelope(analysisId, foodId, name) {
  return { schemaVersion: '1.0.0', validationStatus: 'valid', validationIssues: [], analysisId, dishes: [{ foodId, name, nameKo: name, nameEn: name, ingredients: 'x', allergens: [], crossContactAllergens: [], spicy: 0, spicyStatus: 'valid', eatingMethod: [], description: '', culturalNote: '', fieldStatus: {}, dishValidationStatus: 'valid' }] };
}

async function main() {
  await tc('TC-06-01', '같은 이미지에 대한 분석이 진행 중일 때 중복 트리거는 두 번째 네트워크 호출을 만들지 않음', async () => {
    let calls = 0;
    let resolveFirst;
    // 백그라운드 지식 DB 로더(IMP-12/18D-2)도 페이지 로드 즉시 fetch를 호출하므로,
    // /api/analyze-menu 호출만 센다(그 외 URL은 즉시 실패시켜 앱의 기존
    // Graceful Degradation 경로로 처리되게 둔다 — 이 테스트와 무관).
    const fetchImpl = async (url) => {
      if (!String(url).includes('/api/analyze-menu')) throw new Error('unrelated: ' + url);
      calls++;
      await new Promise((r) => { resolveFirst = r; });
      return { ok: true, json: async () => dishEnvelope('h1', 'd1', 'D1') };
    };
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    const p1 = vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,DUP_CLICK')`, context);
    // 같은 이미지로 즉시 재트리거(실제 UI에서 버튼을 두 번 빠르게 눌렀을 때와 동일)
    const p2 = vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,DUP_CLICK')`, context);
    resolveFirst();
    await Promise.all([p1, p2]);
    A.strictEqual(calls, 1, '진행 중인 동일 이미지 분석에 중복 호출이 있으면 안 됨');
  });

  await tc('TC-06-02', '이미지를 교체(다른 사진)하면 이전 분석 요청이 취소되고, 최종 결과는 새 이미지 것만 반영됨', async () => {
    const callLog = [];
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const isFirst = body.imageBase64.includes('IMG_SWAP_A');
      callLog.push(isFirst ? 'A' : 'B');
      if (isFirst) {
        // 첫 번째 요청은 신호가 끝날 때까지(취소될 때까지) 오래 걸리는 것처럼 대기
        return new Promise((resolve, reject) => {
          opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
        });
      }
      return { ok: true, json: async () => dishEnvelope('hB', 'dB', 'DishB') };
    };
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    const p1 = vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,IMG_SWAP_A')`, context);
    const p2 = vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,IMG_SWAP_B')`, context);
    await Promise.all([p1, p2]);
    const { state } = pick(context, ['state']);
    A.strictEqual(state.lastAnalysis.canonicalDishes[0].foodId, 'dB', '최종 결과는 나중에 올린 이미지(B)의 것이어야 함');
  });

  await tc('TC-06-03', '응답 순서 역전: 먼저 보낸 분석 요청의 응답이 나중에 도착해도 화면에 반영되지 않음', async () => {
    let resolveA;
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.imageBase64.includes('ORDER_A')) {
        return new Promise((resolve) => { resolveA = () => resolve({ ok: true, json: async () => dishEnvelope('hA', 'dA', 'DishA') }); });
      }
      return { ok: true, json: async () => dishEnvelope('hC', 'dC', 'DishC') };
    };
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    const pA = vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,ORDER_A')`, context);
    const pC = vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,ORDER_C')`, context);
    await pC; // C(나중 요청)가 먼저 끝남
    const { state: stateAfterC } = pick(context, ['state']);
    A.strictEqual(stateAfterC.lastAnalysis.canonicalDishes[0].foodId, 'dC');
    resolveA(); // 이제야 A(먼저 보낸 요청)의 응답이 도착
    await pA;
    const { state: stateAfterA } = pick(context, ['state']);
    A.strictEqual(stateAfterA.lastAnalysis.canonicalDishes[0].foodId, 'dC', 'A의 늦은 응답이 화면/상태를 덮어쓰면 안 됨');
  });

  await tc('TC-06-04', '언어를 빠르게 두 번 바꾸면(번역 요청 2개 발생) 마지막 언어의 번역만 최종 반영됨', async () => {
    // ja 번역은 영원히 응답하지 않는 Promise로 만들어 "아직 진행 중"을
    // 흉내낸다 — abort()로만 끝나야 한다(정상 응답으로 resolve되면 안 됨).
    const fetchImpl = async (url, opts) => {
      const u = String(url);
      if (u.includes('/api/analyze-menu')) return { ok: true, json: async () => dishEnvelope('hLang', 'dLang', 'DishLang') };
      if (u.includes('/api/translate-dish')) {
        const body = JSON.parse(opts.body);
        if (body.targetLanguage === 'ja') {
          return new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
          });
        }
        return { ok: true, json: async () => ({ translationsByFoodId: { dLang: { translatedName: 'KO-NAME', ingredients: 'i', eatingMethod: [], description: '', culturalNote: '' } }, validationIssues: [] }) };
      }
      throw new Error('unexpected: ' + u);
    };
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    const { pick: pick2 } = require('./harness.js');
    pick2(context, ['state']).state.lang = 'ja';
    // p1을 직접 await하지 않는다 — ja 번역 fetch가 (의도적으로) 끝나지 않는
    // Promise라 그 자리에서 영원히 막히기 때문이다. 분석 단계가 끝나고 번역
    // 요청이 "시작"될 때까지만 매크로태스크 한 틱을 기다린다(그 사이의 모든
    // await 체인은 마이크로태스크라 setTimeout 한 번이면 전부 소진된다).
    const p1 = vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,LANG_RACE')`, context);
    await new Promise((r) => setTimeout(r, 0));
    // 번역이 아직 진행 중인 상태에서 언어를 ko로 바꿔 재트리거 — 이 호출
    // 내부에서 ja용 translationAbortController를 abort시키므로, p1도
    // AbortError로 조용히 끝나며 함께 정리된다(별도 처리 불필요).
    pick2(context, ['state']).state.lang = 'ko';
    const p2 = vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,LANG_RACE')`, context);
    await Promise.all([p1, p2]);
    const koCache = pick2(context, ['state']).state.translationCache.get(
      Array.from(pick2(context, ['state']).state.translationCache.keys()).find((k) => k.endsWith(':ko'))
    );
    A.ok(koCache, 'ko 번역 결과가 캐시에 반영돼 있어야 함');
    A.strictEqual(koCache.dishes[0].name.includes('KO-NAME'), true);
    const jaCache = Array.from(pick2(context, ['state']).state.translationCache.keys()).find((k) => k.endsWith(':ja'));
    A.strictEqual(jaCache, undefined, '취소된 ja 요청은 캐시에 남으면 안 됨');
  });

  await tc('TC-06-05', 'resetScanner(): 진행 중인 분석을 취소하고 이후 늦게 도착하는 응답을 무시함', async () => {
    const fetchImpl = async (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    const p = vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,RESET_MIDFLIGHT')`, context);
    vm.runInContext(`resetScanner()`, context);
    await p; // AbortError로 조용히 끝나야 함(예외가 바깥으로 전파되면 테스트 자체가 실패)
    const { state } = pick(context, ['state']);
    A.strictEqual(state.hasScannedResult, false);
    A.strictEqual(state.lastAnalysis, null);
  });

  await tc('TC-06-06', '중복 클릭 가드는 "다른" 이미지에는 적용되지 않음(가드가 과도하게 막지 않는지 확인)', async () => {
    let calls = 0;
    const fetchImpl = async (url) => {
      if (!String(url).includes('/api/analyze-menu')) throw new Error('unrelated: ' + url);
      calls++;
      return { ok: true, json: async () => dishEnvelope('hX', 'dX', 'DishX') };
    };
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    await vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,IMG_X1')`, context);
    await vm.runInContext(`analyzeMenuPhotoWithAI('data:image/jpeg;base64,IMG_X2')`, context);
    A.strictEqual(calls, 2, '서로 다른 이미지는 각각 분석되어야 함');
  });

  notRun('TC-06-UI-1', '실제 브라우저에서 사진 업로드 → 즉시 교체 → 최종 화면이 새 사진 결과로만 채워지는지', 'harness의 document stub은 실제 렌더링 반영을 눈으로 확인할 수 없음 — 핵심 로직은 TC-06-02로 검증');
  notRun('TC-06-UI-2', 'AbortController.abort()가 실제로 Gemini 쪽 과금/처리를 중단시키는지', '클라이언트 취소는 우리 서버로의 fetch만 중단한다 — 서버가 Gemini 호출을 실제로 중단하는지는 검증/보장하지 않음(요청사항에 명시된 한계)');

  const summary = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log('\n=== 요약 ===');
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건 / 실행된 assertion 총 개수: ${totalAssertions}건`);
  if (summary.FAIL > 0) process.exitCode = 1;
}

main();
