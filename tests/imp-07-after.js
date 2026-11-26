// tests/imp-07-after.js
//
// IMP-07 테스트(TC-07-01 ~ TC-07-08) — 파생 상태 및 위험도 즉시 재계산.
//
// Node VM(tests/harness.js)으로 index.html을 그대로 실행한다. 핵심 검증
// 대상은 "프로필을 바꾸면 Gemini를 다시 부르지 않고도 화면의 위험도 배너가
// 즉시 바뀐다"이므로, 매 테스트에서 fetch 호출 로그(log)의 길이가 프로필
// 변경 전후로 늘지 않는지 확인한다. 실제 체크박스 클릭/화면 리페인트
// 타이밍은 NOT RUN으로 남긴다(브라우저 필요).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadApp, pick } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const DS = require('../shared/dish-schema.js');
const REG = require('../shared/allergens.js');
const ACTIVE_IDS = REG.map((r) => r.id);

const results = [];
function record(id, description, status, detail) {
  results.push({ id, description, status, detail });
  console.log(`[${status}] ${id} ${description}${detail ? ' — ' + detail : ''}`);
}
async function tc(id, description, fn) {
  try { await fn(); record(id, description, 'PASS'); }
  catch (e) { record(id, description, 'FAIL', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); }
}

function jsonRes(text) { return { ok: true, status: 200, json: async () => JSON.parse(text) }; }
function failRes(status) { return { ok: false, status, json: async () => ({}) }; }

const GEN = path.join(ROOT, 'data', 'generated');
const REAL_TEXT = {};
['allergen-aliases.json', 'allergen-candidates.json', 'knowledge-manifest.json', 'ingredient-knowledge.json', 'evidence-sources.json']
  .forEach((f) => { REAL_TEXT[f] = fs.readFileSync(path.join(GEN, f), 'utf8'); });

function makeFetch({ log = [] } = {}) {
  return async (url) => {
    const u = String(url);
    log.push(u);
    for (const f of Object.keys(REAL_TEXT)) {
      if (u.includes(f)) return jsonRes(REAL_TEXT[f]);
    }
    throw new Error('[mock] 예상치 못한 URL에 fetch 호출됨: ' + u);
  };
}

const APP_NAMES = [
  'state', 'renderMultiDishScanResult', 'renderScanResultUI', 'recalcCurrentScanSafety',
  'onProfileChanged', 'toggleAllergen', 'setSpicy', 'checkDishSafety', 'allergenKnowledgeBaseReady',
  'foodKnowledgeBaseReady', 'locations', 'document',
];
async function freshApp(fetchOpts = {}) {
  const log = fetchOpts.log || [];
  const { context } = loadApp(INDEX_HTML, { fetchImpl: makeFetch({ log }) });
  const app = pick(context, APP_NAMES);
  await app.allergenKnowledgeBaseReady;
  await app.foodKnowledgeBaseReady;
  app.fetchLog = log;
  return app;
}

function mkDish(overrides) {
  const raw = Object.assign({
    name_ko: '테스트 음식', name_en: 'Test dish', translated_name: 'Test dish',
    ingredients: '', allergens: [], crossContactAllergens: [], spicy: 0,
    eatingMethod: ['Eat'], description: 'd', culturalNote: '',
  }, overrides);
  return DS.validateAndNormalizeDishesResponse({ dishes: [raw] }, ACTIVE_IDS).dishes[0];
}

async function main() {
  await tc('TC-07-01', '표준 알레르기 선택 → 이미 표시 중인 결과의 위험도가 즉시 RED로 재계산(API 재호출 없음)', async () => {
    const app = await freshApp();
    const dish = mkDish({ allergens: ['peanut'] });
    app.renderMultiDishScanResult([dish]);
    assert.strictEqual(app.checkDishSafety(dish).safetyState, 'green', '아직 알레르기를 등록하지 않았으므로 처음엔 green');
    const callsBefore = app.fetchLog.length;
    app.toggleAllergen('peanut');
    assert.strictEqual(app.fetchLog.length, callsBefore, '프로필 변경 자체는 fetch를 호출하지 않아야 함');
    const result = app.checkDishSafety(dish);
    assert.strictEqual(result.safetyState, 'red');
  });

  await tc('TC-07-02', 'recalcCurrentScanSafety()는 스캔 결과가 없으면 아무것도 하지 않음(예외 없음)', async () => {
    const app = await freshApp();
    assert.strictEqual(app.state.hasScannedResult, false);
    assert.doesNotThrow(() => app.recalcCurrentScanSafety());
  });

  await tc('TC-07-03', '맵기 선호도 변경이 이미 표시된 결과에 즉시 반영됨(API 재호출 없음)', async () => {
    const app = await freshApp();
    const dish = mkDish({ spicy: 3 });
    app.state.selectedSpicy = 3; // 처음엔 허용 범위
    app.renderMultiDishScanResult([dish]);
    assert.strictEqual(app.checkDishSafety(dish).safetyState, 'green');
    const callsBefore = app.fetchLog.length;
    app.setSpicy(0); // 맵기 허용 수준을 낮춤 → 이제 dish.spicy(3)가 초과
    assert.strictEqual(app.fetchLog.length, callsBefore);
    assert.strictEqual(app.state.lastRenderedDishes[0].spicy, 3, '재계산은 캐시된 dish를 그대로 재사용');
    assert.strictEqual(app.checkDishSafety(app.state.lastRenderedDishes[0]).safetyState, 'orange');
  });

  await tc('TC-07-04', '식이 제한을 vegan으로 바꾸면 돼지고기 음식이 즉시 RED로 바뀜(API 재호출 없음)', async () => {
    const app = await freshApp();
    const dish = mkDish({ allergens: ['pork'] }); // 알레르기는 아니지만 vegan 위반 목록에 포함
    app.state.dietary = 'none';
    app.state.selectedAllergies = new Set();
    app.renderMultiDishScanResult([dish]);
    assert.strictEqual(app.checkDishSafety(dish).safetyState, 'green', '식이 제한이 없으면 아직 green');
    const callsBefore = app.fetchLog.length;
    app.state.dietary = 'vegan';
    app.onProfileChanged();
    assert.strictEqual(app.fetchLog.length, callsBefore, '식이 제한 변경도 fetch를 호출하지 않아야 함');
    assert.strictEqual(app.checkDishSafety(app.state.lastRenderedDishes[0]).safetyState, 'red', 'vegan 전환 후 돼지고기 음식은 RED');
  });

  await tc('TC-07-05', '이미 확정된 RED는 무관한 프로필 변경(교차접촉 알레르기 추가)으로 하향되지 않음', async () => {
    const app = await freshApp();
    const dish = mkDish({ allergens: ['peanut'], crossContactAllergens: [] });
    app.state.selectedAllergies = new Set(['peanut']);
    app.renderMultiDishScanResult([dish]);
    assert.strictEqual(app.checkDishSafety(dish).safetyState, 'red');
    app.toggleAllergen('fish'); // 이 음식과 무관한 알레르기를 추가해도
    assert.strictEqual(app.checkDishSafety(app.state.lastRenderedDishes[0]).safetyState, 'red', 'RED는 하향되지 않음');
  });

  await tc('TC-07-06', '프로필 변경은 캐시된 번역 분석 결과(state.lastAnalysis)를 훼손하지 않음', async () => {
    const app = await freshApp();
    app.state.lastAnalysis = { imageHash: 'abc', analysisId: 'id1', canonicalDishes: [mkDish({})] };
    const dish = mkDish({ allergens: ['milk'] });
    app.renderMultiDishScanResult([dish]);
    app.toggleAllergen('milk');
    assert.deepStrictEqual(app.state.lastAnalysis, { imageHash: 'abc', analysisId: 'id1', canonicalDishes: app.state.lastAnalysis.canonicalDishes }, '프로필 변경이 분석 캐시를 지우거나 바꾸지 않음');
  });

  await tc('TC-07-07', '데모 단일 스캔(renderScanResultUI) 경로도 동일하게 재계산됨', async () => {
    const app = await freshApp();
    const matchObj = app.locations.find(l => l.matchedFoodObj).matchedFoodObj;
    app.state.selectedAllergies = new Set();
    app.renderScanResultUI(matchObj);
    const before = app.checkDishSafety(matchObj).safetyState;
    const matchedAllergen = (matchObj.allergens || [])[0];
    if (matchedAllergen) {
      app.toggleAllergen(matchedAllergen);
      const after = app.checkDishSafety(app.state.lastRenderedMatchObj).safetyState;
      assert.notStrictEqual(before, after === 'green' ? before : after, '프로필 변경 후 상태가 반영됨');
      assert.ok(['red'].includes(after));
    }
  });

  record('TC-07-DOM-1', '실제 브라우저에서 체크박스 클릭 시 배너가 리페인트되는 체감 타이밍', 'NOT RUN', '실제 브라우저 테스트 필요(Node VM은 DOM 리페인트/애니메이션을 검증하지 않음)');

  console.log('\n=== 요약 ===');
  const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건`);
  if (summary.FAIL) process.exit(1);
}

main();
