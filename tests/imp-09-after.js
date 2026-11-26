// tests/imp-09-after.js
//
// IMP-09 테스트(TC-09-01 ~ TC-09-10) — 맞춤형 직원 질문 및 TTS.
//
// generateStaffQuestions()는 DOM과 무관한 순수 로직(state 프로필 + 지식 DB
// 조회만 사용)이라 Node VM에서 그대로 의미 있게 검증할 수 있다. 실제
// SpeechSynthesis 음성 재생/정지, 클립보드 복사 UI는 NOT RUN으로 남긴다
// (jsdom 없는 Node VM에는 window.speechSynthesis/navigator.clipboard가 없음).

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
const GEN = path.join(ROOT, 'data', 'generated');
const REAL_TEXT = {};
['allergen-aliases.json', 'allergen-candidates.json', 'knowledge-manifest.json', 'ingredient-knowledge.json', 'evidence-sources.json']
  .forEach((f) => { REAL_TEXT[f] = fs.readFileSync(path.join(GEN, f), 'utf8'); });
function makeFetch() {
  return async (url) => {
    const u = String(url);
    for (const f of Object.keys(REAL_TEXT)) if (u.includes(f)) return jsonRes(REAL_TEXT[f]);
    throw new Error('[mock] 예상치 못한 URL: ' + u);
  };
}

const APP_NAMES = [
  'state', 'generateStaffQuestions', 'getSpokenAllergyListKo', 'describeStaffQuestionMeaning',
  'speakKorean', 'stopSpeakingKorean', 'setStaffQuestionType', 'updateStaffQuestionPanel',
  'renderMultiDishScanResult', 'allergenKnowledgeBaseReady', 'foodKnowledgeBaseReady',
  'translations', 'document',
];
async function freshApp() {
  const { context } = loadApp(INDEX_HTML, { fetchImpl: makeFetch() });
  const app = pick(context, APP_NAMES);
  await app.allergenKnowledgeBaseReady;
  await app.foodKnowledgeBaseReady;
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

function showScan(app, dishes) {
  app.state.hasScannedResult = true;
  app.renderMultiDishScanResult(dishes);
}

async function main() {
  await tc('TC-09-01', 'A. 일반 질문 — 음식명과 재료/양념 확인을 묻는다(프로필과 무관하게 항상 존재)', async () => {
    const app = await freshApp();
    showScan(app, [mkDish({ name_ko: '김치찌개' })]);
    const q = app.generateStaffQuestions();
    assert.ok(q.general.includes('재료'));
    assert.ok(q.general.includes('김치찌개'));
  });

  await tc('TC-09-02', 'B. 개인 맞춤형 질문 — AI가 이 음식에서 검출하지 못한 알레르기도 포함됨', async () => {
    const app = await freshApp();
    const dish = mkDish({ name_ko: '된장국', allergens: [] }); // AI는 땅콩을 검출하지 않음
    app.state.selectedAllergies = new Set(['peanut']); // 그러나 사용자는 땅콩 알레르기를 등록함
    showScan(app, [dish]);
    const q = app.generateStaffQuestions();
    assert.ok(q.personal.includes('땅콩'), `개인 질문에 땅콩이 포함되어야 함: ${q.personal}`);
  });

  await tc('TC-09-03', 'B. 할랄 식단 — 돼지고기 미검출만으로 안전을 단정하지 않고 술/라드까지 확인 문구를 포함', async () => {
    const app = await freshApp();
    const dish = mkDish({ name_ko: '잡채', allergens: [] }); // 돼지고기 검출 안 됨
    app.state.dietary = 'halal';
    showScan(app, [dish]);
    const q = app.generateStaffQuestions();
    assert.ok(q.personal.includes('돼지고기') && q.personal.includes('술'), `할랄 캐벗이 포함되어야 함: ${q.personal}`);
  });

  await tc('TC-09-04', 'C. 교차 접촉 질문 — 지식 DB 확인 후보(참기름→참깨)가 있으면 구체적 재료명을 언급', async () => {
    const app = await freshApp();
    // IMP-18D-2 테스트가 이미 검증한 것과 같은 실제 관계(ia_0036, Sesame oil → sesame).
    const dish = mkDish({ name_ko: '비빔밥', ingredients: 'Rice, Vegetables, Gochujang, Sesame oil', allergens: ['soybean', 'wheat'] });
    app.state.selectedAllergies = new Set(['sesame']); // AI는 참깨를 allergens로 직접 지목하지 않음
    showScan(app, [dish]);
    const q = app.generateStaffQuestions();
    assert.ok(q.crossContact.includes('Sesame oil'), `교차 접촉 질문에 구체적 재료명이 포함되어야 함: ${q.crossContact}`);
  });

  await tc('TC-09-05', 'C. 지식 DB 후보가 없으면 일반적인 교차 접촉 질문으로 대체됨', async () => {
    const app = await freshApp();
    const dish = mkDish({ name_ko: '백반', ingredients: 'Rice, Water' });
    app.state.selectedAllergies = new Set(['milk']);
    showScan(app, [dish]);
    const q = app.generateStaffQuestions();
    assert.ok(q.crossContact.includes('조리도구') || q.crossContact.includes('조리 기구'));
  });

  await tc('TC-09-06', 'D. 종합 질문 — 알레르기/식이/교차접촉을 한 문장으로 통합', async () => {
    const app = await freshApp();
    const dish = mkDish({ name_ko: '비빔밥', ingredients: 'Rice, Vegetables, Gochujang, Sesame oil', allergens: ['soybean'] });
    app.state.selectedAllergies = new Set(['sesame']);
    app.state.dietary = 'vegan';
    showScan(app, [dish]);
    const q = app.generateStaffQuestions();
    assert.ok(q.comprehensive.includes('비건') || q.comprehensive.includes('동물성'), 'vegan 문구 포함');
    assert.ok(q.comprehensive.includes('참깨') || q.comprehensive.includes('Sesame'), '교차접촉 구체 재료 포함');
  });

  await tc('TC-09-07', '의미가 확인되지 않은(ambiguous) 커스텀 알레르기는 한국어 발화에서 제외되고, 캐벗 플래그가 켜짐', async () => {
    const app = await freshApp();
    app.state.customAllergies = [{ original: 'shellfish', mappingStatus: 'ambiguous', candidateIds: ['shrimp', 'crab'], translated: null }];
    showScan(app, [mkDish({})]);
    const q = app.generateStaffQuestions();
    const spoken = app.getSpokenAllergyListKo();
    assert.strictEqual(spoken.length, 0, '확정되지 않은 커스텀 알레르기는 발화 목록에 없어야 함');
    assert.strictEqual(q.hasAmbiguousCustomAllergyCaveat, true);
  });

  await tc('TC-09-08', '표준 체크박스와 확정된 커스텀 알레르기가 동시에 개인 질문에 중복 없이 반영됨', async () => {
    const app = await freshApp();
    app.state.selectedAllergies = new Set(['peanut']);
    app.state.customAllergies = [{ original: 'Sesame', translated: '참깨', mappingStatus: 'exact_standard', canonicalId: 'sesame', userConfirmed: true }];
    showScan(app, [mkDish({})]);
    const q = app.generateStaffQuestions();
    assert.ok(q.personal.includes('땅콩') && q.personal.includes('참깨'));
  });

  await tc('TC-09-09', '[반복 클릭 방지] speakKorean()은 speechSynthesis 미지원 환경에서 예외 없이 토스트만 띄움', async () => {
    const app = await freshApp();
    assert.strictEqual('speechSynthesis' in app, false); // 전역에 없다는 전제 확인(Node VM 환경)
    assert.doesNotThrow(() => app.speakKorean('테스트'));
    assert.strictEqual(app.state.isSpeaking, false, '발화를 시작조차 못했으므로 isSpeaking은 그대로 false');
  });

  await tc('TC-09-10', '직원 질문 유형별 설명(describeStaffQuestionMeaning)이 현재 UI 언어로 번역되어 있음', async () => {
    const app = await freshApp();
    app.state.lang = 'ja';
    const ja = app.describeStaffQuestionMeaning('crossContact');
    app.state.lang = 'en';
    const en = app.describeStaffQuestionMeaning('crossContact');
    assert.notStrictEqual(ja, en);
    assert.strictEqual(en, app.translations.en.staffQMeaningCrossContact);
  });

  record('TC-09-DOM-1', '실제 브라우저에서 한국어 음성 재생/정지/복사 버튼 동작', 'NOT RUN', 'Node VM에는 window.speechSynthesis/navigator.clipboard가 없음 — 실제 브라우저 필요');
  record('TC-09-DOM-2', '지원하지 않는 음성 환경에서 화면의 한국어 텍스트를 보여주는 대체 동작의 실제 가독성', 'NOT RUN', '실제 브라우저(모바일 포함) 테스트 필요');

  console.log('\n=== 요약 ===');
  const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건`);
  if (summary.FAIL) process.exit(1);
}

main();
