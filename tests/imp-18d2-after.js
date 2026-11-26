// tests/imp-18d2-after.js
//
// IMP-18D-2 개선 후 테스트(TC-18D2-01 ~ TC-18D2-30).
//
// - 실제 생성 데이터(data/generated/*.json)를 그대로 Mock fetch로 서빙한다.
//   실제 데이터에 없는 상황(pending 관계, 색인 충돌, 버전 불일치, 악성 URL 등)은
//   이 파일 안의 메모리 fixture로만 만들고, 서비스 데이터 파일에는 절대 쓰지 않는다.
// - index.html 로직은 tests/harness.js(Node vm)로 "있는 그대로" 실행한다.
// - 실제 Gemini API는 호출하지 않는다(/api/analyze-menu 응답은 Mock).
// - 실제 브라우저가 필요한 항목은 NOT RUN으로 따로 기록한다.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadApp, pick } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const GEN = path.join(ROOT, 'data', 'generated');
const FK = require('../shared/food-knowledge.js');
const DS = require('../shared/dish-schema.js');
const REG = require('../shared/allergens.js');
const ACTIVE_IDS = REG.map((r) => r.id);

const REAL_TEXT = {};
['allergen-aliases.json', 'allergen-candidates.json', 'knowledge-manifest.json', 'ingredient-knowledge.json', 'evidence-sources.json', 'dishes-demo.json']
  .forEach((f) => { REAL_TEXT[f] = fs.readFileSync(path.join(GEN, f), 'utf8'); });
const REAL = {};
Object.keys(REAL_TEXT).forEach((f) => { REAL[f] = JSON.parse(REAL_TEXT[f]); });
const clone = (x) => JSON.parse(JSON.stringify(x));
const plain = clone; // vm context(다른 realm) 객체 비교용

let assertionCount = 0;
const A = new Proxy(assert, {
  get(target, prop) {
    const fn = target[prop];
    if (typeof fn !== 'function') return fn;
    return (...args) => { assertionCount += 1; return fn.apply(target, args); };
  },
});

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
function deferred() { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; }
const tick = () => new Promise((r) => setImmediate(r));

// overrides: { urlFragment: (url) => response | Promise<response> }
function makeFetch({ overrides = {}, log = [], texts = REAL_TEXT } = {}) {
  return async (url, init) => {
    const u = String(url);
    log.push(u);
    for (const frag of Object.keys(overrides)) {
      if (u.includes(frag)) return overrides[frag](u, init);
    }
    for (const f of Object.keys(texts)) {
      if (u.includes(f)) return jsonRes(texts[f]);
    }
    throw new Error('[mock] 예상치 못한 URL에 fetch 호출됨: ' + u);
  };
}

const APP_NAMES = [
  'state', 'foodKB', 'allergenKB', 'allergenKnowledgeBaseReady', 'foodKnowledgeBaseReady', 'FOOD_KB_STATUS',
  'buildKnowledgeReportForDish', 'checkDishSafety', 'renderMultiDishScanResult', 'renderScanResultUI',
  'analyzeMenuPhotoWithAI', 'renderKnowledgeSectionHtml', 'composeGreenBannerDesc', 'translations',
  'locations', 'getSpeechScript', 'clearStaleScanResult', 'KNOWN_AMBIGUOUS_CUSTOM_TERMS',
];
async function freshApp(fetchOpts = {}, loadOpts = {}) {
  const log = fetchOpts.log || [];
  const { context } = loadApp(INDEX_HTML, Object.assign({ fetchImpl: makeFetch(Object.assign({}, fetchOpts, { log })) }, loadOpts));
  const app = pick(context, APP_NAMES);
  await app.allergenKnowledgeBaseReady;
  await app.foodKnowledgeBaseReady;
  app.state.selectedSpicy = 3; // 맵기 경고가 테스트 결과에 섞이지 않게
  app.fetchLog = log;
  return app;
}

function mkDish(overrides) {
  const raw = Object.assign({
    name_ko: '테스트', name_en: 'Test dish', translated_name: 'Test dish',
    ingredients: '', allergens: [], crossContactAllergens: [], spicy: 0,
    eatingMethod: ['Eat'], description: 'd', culturalNote: '',
  }, overrides);
  return DS.validateAndNormalizeDishesResponse({ dishes: [raw] }, ACTIVE_IDS).dishes[0];
}

function realKb(mutate) {
  const input = {
    manifest: clone(REAL['knowledge-manifest.json']),
    ingredientKnowledge: clone(REAL['ingredient-knowledge.json']),
    evidenceSources: clone(REAL['evidence-sources.json']),
    activeAllergenIds: ACTIVE_IDS,
  };
  if (mutate) mutate(input);
  return FK.buildFoodKnowledgeBase(input);
}
const AMBIGUOUS = { shellfish: { candidateIds: ['shrimp', 'crab', 'shellfish'] } };
function pureReport(kb, dish, extra) {
  const activeSet = new Set(ACTIVE_IDS);
  return FK.buildDishKnowledgeReport(kb, dish, Object.assign({
    kbStatus: kb.status, analysisSource: 'ai_scan', dishKey: 't:0',
    isActiveAllergen: (id) => activeSet.has(id), ambiguousTerms: AMBIGUOUS,
  }, extra));
}

const metrics = {};

async function main() {
  // ------------------------------------------------------------------
  await tc('TC-18D2-01', '실제 생성 JSON 정상 로딩', async () => {
    const app = await freshApp();
    A.strictEqual(app.foodKB.status, 'ready');
    const s = app.foodKB.kb.stats;
    A.strictEqual(s.ingredientCount, 39);
    A.strictEqual(s.sourceRelationCount.confirmedRelations, 22);
    A.strictEqual(s.sourceRelationCount.literatureBackedCandidates, 23);
    A.strictEqual(s.usableRelationTotal, 44);
    A.strictEqual(s.evidenceCount, 31);
    A.strictEqual(app.foodKB.kb.dataVersion, REAL['knowledge-manifest.json'].dataVersion);
    metrics.stats = plain(s);
  });

  await tc('TC-18D2-02', '기존 IMP-12 JSON 로딩 및 색인 재사용(manifest 1회, alias 색인 재사용)', async () => {
    const log = [];
    const app = await freshApp({ log });
    const gen = log.filter((u) => u.includes('data/generated/'));
    A.strictEqual(gen.filter((u) => u.includes('knowledge-manifest.json')).length, 1, 'manifest는 한 번만 다운로드');
    A.strictEqual(gen.length, 5, 'IMP-12 3개 + 신규 2개 = 5개 파일');
    A.ok(!gen.some((u) => u.includes('dishes-demo.json')), '데모 레시피 데이터는 로딩하지 않음');
    A.strictEqual(app.allergenKB.loaded, true);
    A.strictEqual(app.allergenKB.index.size, 241, 'IMP-12 색인 241건 그대로');
    const r = app.buildKnowledgeReportForDish(mkDish({ ingredients: 'groundnut' }), 'ai_scan', 'x');
    const f = r.knowledgeFindings.find((x) => x.allergenId === 'peanut');
    A.ok(f && f.knowledgeTier === 'allergen_term');
    A.strictEqual(f.evidencePath[1].indexSource, 'alias_db', 'IMP-12 alias 색인을 통해 매핑');
    metrics.loadedFiles = gen.map((u) => u.split('/').pop());
  });

  const kb = realKb();

  await tc('TC-18D2-03', '실제 표준 식재료 ID 매핑(id / 한글명 / 영문명)', async () => {
    for (const t of ['sesame_oil', '참기름', 'Sesame oil']) {
      const r = FK.resolveIngredientTerm(kb, t, { ambiguousTerms: AMBIGUOUS });
      A.strictEqual(r.status, 'resolved', t);
      A.strictEqual(r.ingredientId, 'sesame_oil', t);
    }
    A.strictEqual(FK.resolveIngredientTerm(kb, 'sesame_oil').matchedBy, 'ingredient_id');
    A.strictEqual(FK.resolveIngredientTerm(kb, '참기름').matchedBy, 'name_ko');
    A.strictEqual(FK.resolveIngredientTerm(kb, 'Sesame oil').matchedBy, 'name_en');
  });

  await tc('TC-18D2-04', '검증된 다국어 식재료명 매핑(정규화) — DB에 없는 언어 표기는 만들어내지 않음', async () => {
    for (const t of ['  SESAME   OIL ', '참기름'.normalize('NFD'), 'sesame oil']) {
      A.strictEqual(FK.resolveIngredientTerm(kb, t).ingredientId, 'sesame_oil', JSON.stringify(t));
    }
    // 실제 DB에는 ko/en 명칭만 있다 — 일본어/중국어 표기는 매핑하지 않는다(정직).
    A.strictEqual(FK.resolveIngredientTerm(kb, 'ごま油').status, 'unresolved');
    A.strictEqual(FK.resolveIngredientTerm(kb, '芝麻油').status, 'unresolved');
  });

  await tc('TC-18D2-05', '서로 다른 식재료의 잘못된 매핑 방지(참기름/들기름, 땅콩/잣, 부분 문자열)', async () => {
    A.strictEqual(FK.resolveIngredientTerm(kb, '들기름').status, 'unresolved');
    A.strictEqual(FK.resolveIngredientTerm(kb, 'perilla oil').status, 'unresolved');
    A.strictEqual(FK.resolveIngredientTerm(kb, '땅콩').ingredientId, 'raw_peanut');
    A.strictEqual(FK.resolveIngredientTerm(kb, '잣').ingredientId, 'raw_pinenut');
    A.strictEqual(FK.resolveIngredientTerm(kb, 'sesame').ingredientId, 'raw_sesame');
    A.strictEqual(FK.resolveIngredientTerm(kb, 'sesame oil dressing').status, 'unresolved', '부분 문자열 매칭 금지');
    A.strictEqual(FK.resolveIngredientTerm(kb, 'oil').status, 'unresolved');
    const r = pureReport(kb, mkDish({ ingredients: '들기름, peanut' }));
    A.ok(!r.knowledgeFindings.some((f) => f.allergenId === 'sesame' || f.allergenId === 'pinenut'));
  });

  await tc('TC-18D2-06', '모호한 식재료 입력 처리(shellfish, 색인 충돌 fixture)', async () => {
    const r = pureReport(kb, mkDish({ ingredients: 'Shellfish' }), { isUserAllergicTo: (id) => id === 'shrimp' });
    A.strictEqual(r.ambiguousIngredients.length, 1);
    A.deepStrictEqual(r.ambiguousIngredients[0].candidateAllergenIds.slice().sort(), ['crab', 'shellfish', 'shrimp']);
    A.strictEqual(r.ambiguousIngredients[0].matchesUserProfile, true);
    A.strictEqual(r.knowledgeFindings.length, 0, '모호어는 자동 확정하지 않음');
    // fixture: 서로 다른 식재료가 같은 영문명을 가진 경우(실제 데이터에는 충돌 0건)
    const kbCollide = realKb((inp) => { inp.ingredientKnowledge.ingredients.find((i) => i.id === 'raw_walnut').nameEn = 'Peanut'; });
    A.strictEqual(kbCollide.stats.indexCollisionCount, 1);
    const c = FK.resolveIngredientTerm(kbCollide, 'peanut');
    A.strictEqual(c.status, 'ambiguous');
    A.strictEqual(c.reason, 'ingredient_index_collision');
    metrics.realIndexCollisions = kb.stats.indexCollisionCount;
  });

  await tc('TC-18D2-07', '미등록 식재료 원본값 보존', async () => {
    const r = pureReport(kb, mkDish({ ingredients: '들기름, Garlic, 고사리 나물' }));
    A.deepStrictEqual(r.unresolvedIngredients.map((u) => u.original), ['들기름', 'Garlic', '고사리 나물']);
    A.ok(r.unresolvedIngredients.every((u) => u.reason === 'not_in_knowledge_db'));
  });

  await tc('TC-18D2-08', '식재료-알레르기 관계 조회(간장)', async () => {
    const rels = FK.getRelationsForIngredient(kb, 'ganjang');
    A.deepStrictEqual(rels.map((r) => [r.id, r.allergenId, r.relationType]).sort(), [
      ['ia_0001', 'soybean', 'CONTAINS_AS_RAW_MATERIAL'], ['ia_0002', 'wheat', 'PRODUCT_VARIANT_DEPENDENT'],
    ]);
    A.deepStrictEqual(FK.getRelationsForIngredient(kb, 'no_such'), []);
  });

  await tc('TC-18D2-09', '검토 대기 관계 제외(실제 데이터 + pending fixture)', async () => {
    // build-report.md §6의 대기 관계 쌍이 서비스 색인에 없음을 확인
    const pendingPairs = [['ssamjang', 'sesame'], ['kimchi', 'wheat'], ['eomuk', 'wheat'], ['yuksu', 'soybean'], ['bakery_general', 'peanut']];
    for (const [ing, al] of pendingPairs) {
      A.ok(!FK.getRelationsForIngredient(kb, ing).some((r) => r.allergenId === al), `${ing}->${al}`);
    }
    const kbPending = realKb((inp) => {
      inp.ingredientKnowledge.literatureBackedCandidates.push({ id: 'fx_pending', ingredientId: 'ssamjang', allergenId: 'sesame', relationType: 'TYPICAL_RECIPE_INCLUSION', reviewStatus: 'pending_expert_review', autoApplyToRiskJudgment: false, evidenceId: '' });
      inp.manifest.recordCounts['ingredient-knowledge.json'] += 1;
    });
    A.strictEqual(kbPending.status, 'ready');
    A.ok(!FK.getRelationsForIngredient(kbPending, 'ssamjang').some((r) => r.id === 'fx_pending'));
    A.strictEqual(kbPending.stats.excludedRelations['unexpected_review_status:pending_expert_review'], 1);
  });

  await tc('TC-18D2-10', '관계 유형 및 근거 적용 범위 유지', async () => {
    const r = pureReport(kb, mkDish({ ingredients: 'Imitation crab (surimi), Sesame' }));
    const f = r.knowledgeFindings.find((x) => x.relationId === 'ia_0018');
    A.strictEqual(f.relationType, 'CONTAINS_AS_RAW_MATERIAL');
    A.strictEqual(f.evidenceScope, 'investigative_journalism');
    A.strictEqual(f.knowledgeTier, 'literature_candidate');
    A.strictEqual(f.reviewStatus, 'literature_reviewed');
    const u = r.knowledgeFindings.find((x) => x.relationId === 'ia_0019');
    A.strictEqual(u.relationCategory, 'unconfirmed');
    A.strictEqual(u.informationClass, 'G_unconfirmed');
    const c = r.knowledgeFindings.find((x) => x.relationId === 'ia_0059');
    A.strictEqual(c.knowledgeTier, 'confirmed_relation');
    A.strictEqual(c.reviewStatus, 'reviewed');
    A.strictEqual(c.evidenceScope, null, 'confirmedRelations에는 evidenceScope 필드가 없음 — 지어내지 않음');
  });

  await tc('TC-18D2-11', 'AI 분석 결과와 DB 조회 결과 분리(원본 dish 불변)', async () => {
    const app = await freshApp();
    app.state.selectedAllergies.add('sesame');
    const dish = mkDish({ ingredients: 'Rice, Sesame oil', allergens: ['soybean'] });
    const before = clone(dish);
    const r = app.buildKnowledgeReportForDish(dish, 'ai_scan', 'k');
    app.renderMultiDishScanResult([dish]);
    A.deepStrictEqual(clone(dish), before, '원본 AI dish가 변경되지 않음');
    A.deepStrictEqual(plain(r.aiAnalysis.allergens), ['soybean']);
    r.aiAnalysis.allergens.push('sesame');
    A.deepStrictEqual(dish.allergens, ['soybean'], '보고서의 aiAnalysis는 복사본');
    A.ok(Array.isArray(dish.allergensUnknownIds) && dish.fieldStatus, 'IMP-02 필드 유지');
  });

  await tc('TC-18D2-12', 'AI 응답에 없는 추가 확인 후보 조회(참기름 → 참깨)', async () => {
    const app = await freshApp();
    app.state.selectedAllergies.add('sesame');
    const dish = mkDish({ ingredients: 'Rice, Vegetables, Gochujang, Sesame oil', allergens: ['soybean', 'wheat'] });
    const r = app.buildKnowledgeReportForDish(dish, 'ai_scan', 'k');
    A.strictEqual(r.userAdvisories.length, 1);
    A.strictEqual(r.userAdvisories[0].allergenId, 'sesame');
    A.strictEqual(r.userAdvisories[0].findings[0].relationId, 'ia_0036');
    A.strictEqual(r.userAdvisories[0].inAiAllergens, false);
    const html = app.renderKnowledgeSectionHtml(r);
    A.ok(html.includes(app.translations.en.kbCheckNeeded) && html.includes('Sesame oil') && html.includes(app.translations.en.kbAskStaff));
    metrics.advisoryExample = { allergen: 'sesame', path: plain(r.userAdvisories[0].findings[0].evidencePath).map((s) => s.step) };
  });

  await tc('TC-18D2-13', '동일 성분의 중복 표시 방지(그룹 1개, 중복 토큰 병합)', async () => {
    const r = pureReport(kb, mkDish({ ingredients: 'peanut, Peanut, 땅콩' }), { isUserAllergicTo: (id) => id === 'peanut' });
    const groups = r.groups.filter((g) => g.allergenId === 'peanut');
    A.strictEqual(groups.length, 1);
    A.strictEqual(r.userAdvisories.length, 1);
    A.strictEqual(r.mergedDuplicateCount, 1, '"peanut"과 "Peanut"은 정규화 후 같은 토큰 → 같은 관계 1회만');
    metrics.dedupe = { tokens: 3, findings: groups[0].findings.length, groups: 1, merged: r.mergedDuplicateCount };
  });

  await tc('TC-18D2-14', '여러 관계 근거 경로 보존(대두: 간장/된장/soy)', async () => {
    const lookup = (t) => (FK.normalizeKnowledgeText(t) === 'soy' ? { allergenId: 'soybean', source: 'alias_db', evidenceId: '', evidenceScope: 'general_culinary_knowledge' } : null);
    const r = pureReport(kb, mkDish({ ingredients: 'Soy sauce, 된장, soy' }), { allergenTermLookup: lookup });
    const g = r.groups.find((x) => x.allergenId === 'soybean');
    A.strictEqual(g.evidencePathCount, 3);
    A.deepStrictEqual(g.findings.map((f) => f.relationId), ['ia_0001', 'ia_0003', 'term:alias_db:soybean']);
    A.ok(g.findings.every((f) => Array.isArray(f.evidencePath) && f.evidencePath[0].step === 'ai_ingredient'));
  });

  await tc('TC-18D2-15', '사용자 알레르기 정보와 관계 조회 결과 비교(표준/커스텀/모호 커스텀)', async () => {
    const app = await freshApp();
    app.state.selectedAllergies.add('sesame');
    app.state.customAllergies.push({ original: 'gluten-ish', translated: '밀', canonicalId: 'wheat', mappingStatus: 'exact_alias', userConfirmed: true, candidateIds: [] });
    app.state.customAllergies.push({ original: 'shellfish', translated: '', canonicalId: null, mappingStatus: 'ambiguous', userConfirmed: false, candidateIds: ['shrimp', 'crab', 'shellfish'] });
    const r = app.buildKnowledgeReportForDish(mkDish({ ingredients: 'Sesame oil, Soy sauce, Oyster sauce' }), 'ai_scan', 'k');
    const byId = Object.fromEntries(r.groups.map((g) => [g.allergenId, g.profileMatch]));
    A.strictEqual(byId.sesame, 'confirmed');
    A.strictEqual(byId.wheat, 'confirmed');
    A.strictEqual(byId.shellfish, 'uncertain_custom');
    A.strictEqual(byId.soybean, null);
    A.deepStrictEqual(plain(r.userAdvisories.map((g) => g.allergenId)).sort(), ['sesame', 'shellfish', 'wheat']);
    // 국적은 판정에 쓰이지 않음 — 국적을 바꿔도 결과 동일
    const before = JSON.stringify(r.groups.map((g) => [g.allergenId, g.profileMatch]));
    app.state.nationality = 'JP';
    const r2 = app.buildKnowledgeReportForDish(mkDish({ ingredients: 'Sesame oil, Soy sauce, Oyster sauce' }), 'ai_scan', 'k');
    A.strictEqual(JSON.stringify(r2.groups.map((g) => [g.allergenId, g.profileMatch])), before);
  });

  await tc('TC-18D2-16', '기존 RED 및 ORANGE 경고 유지(지식 DB 결과로 상향/하향 없음)', async () => {
    const okApp = await freshApp();
    const failApp = await freshApp({ overrides: { 'ingredient-knowledge.json': () => failRes(404) } });
    for (const app of [okApp, failApp]) { app.state.selectedAllergies.add('sesame'); app.state.selectedAllergies.add('peanut'); }
    const red = mkDish({ ingredients: 'Sesame oil', allergens: ['sesame'] });
    const orange = mkDish({ ingredients: 'Peanut sauce', crossContactAllergens: ['peanut'] });
    const green = mkDish({ ingredients: 'Sesame oil' });
    A.strictEqual(okApp.checkDishSafety(red).safetyState, 'red');
    A.strictEqual(okApp.checkDishSafety(orange).safetyState, 'orange');
    for (const d of [red, orange, green]) {
      A.deepStrictEqual(plain(okApp.checkDishSafety(d)), plain(failApp.checkDishSafety(d)), '지식 DB 유무와 무관하게 판정 동일');
    }
    const rRed = okApp.buildKnowledgeReportForDish(red, 'ai_scan', 'k');
    A.strictEqual(rRed.userAdvisories.length, 0, 'AI가 이미 RED로 잡은 성분은 "추가 확인"으로 중복 표시하지 않음');
    const rOrange = okApp.buildKnowledgeReportForDish(orange, 'ai_scan', 'k');
    A.strictEqual(rOrange.userAdvisories[0].inAiCrossContact, true);
    const rGreen = okApp.buildKnowledgeReportForDish(green, 'ai_scan', 'k');
    A.ok(okApp.composeGreenBannerDesc([rGreen]).includes(okApp.translations.en.kbBannerAdvisoryNote), 'GREEN 배너에 추가 확인 안내 덧붙임');
  });

  await tc('TC-18D2-17', '일반 레시피의 실제 음식 성분 승격 방지(김치 → 생선)', async () => {
    const app = await freshApp();
    app.state.selectedAllergies.add('fish');
    const dish = mkDish({ ingredients: 'Kimchi' });
    const r = app.buildKnowledgeReportForDish(dish, 'ai_scan', 'k');
    const f = r.knowledgeFindings.find((x) => x.relationId === 'ia_0012');
    A.strictEqual(f.relationCategory, 'typical_recipe');
    A.strictEqual(f.informationClass, 'D_general_recipe_possibility');
    A.strictEqual(f.usedForRiskJudgment, false);
    A.deepStrictEqual(dish.allergens, [], 'AI allergens에 fish가 추가되지 않음');
    A.strictEqual(app.checkDishSafety(dish).safetyState, 'green', '위험도 자동 판정에 반영하지 않음');
  });

  await tc('TC-18D2-18', '후보 알레르기 자동 활성화 방지(mustard ia_0035, celery)', async () => {
    A.strictEqual(kb.stats.excludedRelations.allergen_not_active, 1);
    A.ok(kb.issues.some((i) => i.relationId === 'ia_0035' && i.reason === 'allergen_not_active'));
    const app = await freshApp();
    const r = app.buildKnowledgeReportForDish(mkDish({ ingredients: 'Mustard sauce, Celery' }), 'ai_scan', 'k');
    A.ok(!r.knowledgeFindings.some((f) => f.allergenId === 'mustard' || f.allergenId === 'celery'));
    A.deepStrictEqual(plain(r.candidateAllergenTerms).map((c) => c.allergenId), ['celery']);
    A.ok(r.unresolvedIngredients.some((u) => u.original === 'Celery'), '후보 성분 문자열 원본은 보존');
    A.ok(r.noRelationIngredients.some((n) => n.ingredientId === 'mustard_sauce'), '머스터드는 DB에 있지만 서비스 관계 없음');
  });

  await tc('TC-18D2-19', '관계 조회 결과 없음과 성분 없음 구분', async () => {
    const app = await freshApp();
    const r = app.buildKnowledgeReportForDish(mkDish({ ingredients: 'Broth/stock, Garlic' }), 'ai_scan', 'k');
    A.strictEqual(r.lookupStatus, 'ready');
    A.strictEqual(r.knowledgeFindings.length, 0);
    A.deepStrictEqual(plain(r.noRelationIngredients).map((n) => n.ingredientId), ['yuksu']);
    const html = app.renderKnowledgeSectionHtml(r);
    A.ok(html.includes(app.translations.en.kbNoRelations));
    A.ok(!html.includes(app.translations.en.safeTitle));
    const empty = app.buildKnowledgeReportForDish(mkDish({ ingredients: '' }), 'ai_scan', 'k');
    A.strictEqual(empty.ingredientsAvailable, false);
    A.ok(app.renderKnowledgeSectionHtml(empty).includes(app.translations.en.kbNoIngredients));
  });

  await tc('TC-18D2-20', '지식 DB 로딩 실패 처리(404 / JSON 손상 / 모듈 미로드)', async () => {
    const a404 = await freshApp({ overrides: { 'evidence-sources.json': () => failRes(500) } });
    A.strictEqual(a404.foodKB.status, 'load_failed');
    const badJson = await freshApp({ overrides: { 'ingredient-knowledge.json': () => ({ ok: true, status: 200, json: async () => JSON.parse('{"ingredients": [') }) } });
    A.strictEqual(badJson.foodKB.status, 'load_failed');
    const wrongShape = await freshApp({ overrides: { 'ingredient-knowledge.json': () => jsonRes('[1,2,3]') } });
    A.strictEqual(wrongShape.foodKB.status, 'load_failed');
    A.ok(String(wrongShape.foodKB.reason).startsWith('invalid_structure'));
    const noModule = await freshApp({}, { skipFoodKnowledge: true });
    A.strictEqual(noModule.foodKB.status, 'load_failed');
    for (const app of [a404, badJson, noModule]) {
      app.state.selectedAllergies.add('sesame');
      const dish = mkDish({ ingredients: 'Sesame oil', allergens: ['sesame'] });
      A.strictEqual(app.checkDishSafety(dish).safetyState, 'red', 'AI 기반 RED 판정은 그대로');
      app.renderMultiDishScanResult([dish]); // 예외 없이 AI 결과 렌더링
      const r = app.state.lastKnowledgeReports[0];
      const html = app.renderKnowledgeSectionHtml(r);
      A.ok(html.includes(app.translations.en.kbUnavailable));
    }
    A.ok(a404.composeGreenBannerDesc([a404.buildKnowledgeReportForDish(mkDish({ ingredients: 'x' }), 'ai_scan', 'k')]).includes(a404.translations.en.kbBannerUnavailableNote));
  });

  await tc('TC-18D2-21', '스키마 및 데이터 버전 불일치 처리', async () => {
    const m = clone(REAL['knowledge-manifest.json']); m.schemaVersion = '2.0.0';
    const app = await freshApp({ texts: Object.assign({}, REAL_TEXT, { 'knowledge-manifest.json': JSON.stringify(m) }) });
    A.strictEqual(app.foodKB.status, 'schema_version_mismatch');
    A.strictEqual(app.allergenKB.loaded, false, 'IMP-12 기존 동작(스키마 불일치 시 비활성) 유지');
    const kbMis = realKb((inp) => { inp.ingredientKnowledge.literatureBackedCandidates.pop(); });
    A.strictEqual(kbMis.status, 'data_version_mismatch');
    const kbEv = realKb((inp) => { inp.evidenceSources.pop(); });
    A.strictEqual(kbEv.status, 'data_version_mismatch');
    const kbNoVer = realKb((inp) => { delete inp.manifest.dataVersion; });
    A.strictEqual(kbNoVer.status, 'data_version_mismatch');
    const kbBrokenRef = realKb((inp) => { inp.ingredientKnowledge.confirmedRelations[1].ingredientId = 'ghost_ingredient'; });
    A.strictEqual(kbBrokenRef.status, 'ready');
    A.strictEqual(kbBrokenRef.stats.excludedRelations.broken_ingredient_reference, 1, '존재하지 않는 식재료를 가리키는 관계는 제외');
  });

  await tc('TC-18D2-22', '여러 음식의 조회 결과 분리', async () => {
    const app = await freshApp();
    app.state.selectedAllergies.add('sesame');
    app.state.selectedAllergies.add('soybean');
    const a = mkDish({ name_en: 'Dish A', ingredients: 'Sesame oil' });
    const b = mkDish({ name_en: 'Dish B', ingredients: 'Soy sauce' });
    app.renderMultiDishScanResult([a, b]);
    const reps = app.state.lastKnowledgeReports;
    A.strictEqual(reps.length, 2);
    A.deepStrictEqual(plain(reps[0].groups.map((g) => g.allergenId)), ['sesame']);
    A.deepStrictEqual(plain(reps[1].groups.map((g) => g.allergenId)).sort(), ['soybean', 'wheat']);
    A.notStrictEqual(reps[0].dishKey, reps[1].dishKey);
    A.ok(reps[0].knowledgeFindings.every((f) => f.findingId.startsWith(reps[0].dishKey)));
  });

  await tc('TC-18D2-23', '이전 분석 결과의 잘못된 반영 방지(늦게 도착한 AI 응답 / 화면 초기화)', async () => {
    const first = deferred();
    const second = deferred();
    let call = 0;
    const envFor = (name, ingredients) => JSON.stringify(DS.validateAndNormalizeDishesResponse({ dishes: [{ name_ko: name, name_en: name, translated_name: name, ingredients, allergens: [], crossContactAllergens: [], spicy: 0, eatingMethod: ['x'], description: 'd', culturalNote: '' }] }, ACTIVE_IDS));
    const app = await freshApp({ overrides: { '/api/analyze-menu': () => (++call === 1 ? first.p : second.p) } });
    app.state.selectedAllergies.add('sesame');
    const p1 = app.analyzeMenuPhotoWithAI('data:image/jpeg;base64,AAAA');
    const p2 = app.analyzeMenuPhotoWithAI('data:image/jpeg;base64,BBBB');
    second.resolve(jsonRes(envFor('Second', 'Soy sauce')));
    await p2;
    first.resolve(jsonRes(envFor('First', 'Sesame oil'))); // 늦게 도착한 이전 요청
    await p1;
    A.strictEqual(app.state.lastKnowledgeReports.length, 1);
    A.strictEqual(app.state.lastKnowledgeReports[0].foodId, 'second', '최신 요청 결과만 화면에 남음');
    A.ok(!app.state.lastKnowledgeReports[0].groups.some((g) => g.allergenId === 'sesame'));
    app.clearStaleScanResult();
    A.strictEqual(app.state.lastKnowledgeReports.length, 0, '화면 초기화 시 지식 DB 결과도 제거');
  });

  await tc('TC-18D2-24', '데모 데이터와 실제 AI 분석 데이터의 출처 구분', async () => {
    const log = [];
    const app = await freshApp({ log });
    app.state.selectedAllergies.add('sesame');
    app.renderScanResultUI(app.locations[0].matchedFoodObj); // 삼겹살 데모: "Pork, garlic, sesame oil, ..."
    const r = app.state.lastKnowledgeReports[0];
    A.strictEqual(r.aiAnalysis.source, 'demo_location');
    const html = app.renderKnowledgeSectionHtml(r);
    A.ok(html.includes(app.translations.en.kbDemoIngredientLabel));
    A.ok(!html.includes(app.translations.en.kbAiIngredientLabel));
    A.ok(!log.some((u) => u.includes('dishes-demo.json')), 'dishes-demo.json을 실제 레시피 근거로 쓰지 않음');
    A.ok(!r.knowledgeFindings.some((f) => /^F_/.test(f.informationClass)), '음식점 확인(F) 정보는 생성되지 않음');
    A.ok(REAL['dishes-demo.json'].restaurantVerification.every((v) => v.isDemo === true && v.doNotUseAsRealVerification === true));
    app.renderMultiDishScanResult([mkDish({ ingredients: 'Sesame oil' })]);
    A.strictEqual(app.state.lastKnowledgeReports[0].aiAnalysis.source, 'ai_scan');
  });

  await tc('TC-18D2-25', '신규 문자열의 안전한 렌더링(XSS, URL 스킴)', async () => {
    const app = await freshApp();
    app.state.selectedAllergies.add('sesame');
    const evil = '<img src=x onerror=alert(1)>';
    const r = app.buildKnowledgeReportForDish(mkDish({ ingredients: `${evil}, Sesame oil, "quoted'` }), 'ai_scan', 'k');
    const html = app.renderKnowledgeSectionHtml(r);
    A.ok(!html.includes('<img'), '원본 태그가 그대로 삽입되지 않음');
    A.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    A.ok(html.includes('href="https://www.foodsafetykorea.go.kr/'), '정상 https 출처는 링크');
    A.ok(html.includes('rel="noopener noreferrer"'));
    const kbEvil = realKb((inp) => { inp.evidenceSources.find((e) => e.id === 'EV-KR-FOODCODE-SESAMEOIL').url = 'javascript:alert(1)'; });
    const r2 = pureReport(kbEvil, mkDish({ ingredients: 'Sesame oil' }));
    A.strictEqual(r2.knowledgeFindings[0].source.url, null, 'javascript: URL 차단');
    A.strictEqual(FK.isSafeHttpUrl('data:text/html,x'), false);
    A.strictEqual(FK.isSafeHttpUrl('https://example.org/a?b=1'), true);
  });

  await tc('TC-18D2-26', '신규 핵심 안내 문구의 6개 언어 호환성', async () => {
    const app = await freshApp();
    const langs = ['en', 'ja', 'zh', 'vi', 'es', 'ko'];
    const keys = Object.keys(app.translations.en).filter((k) => k.startsWith('kb'));
    A.strictEqual(keys.length, 27);
    for (const lang of langs) {
      for (const k of keys) A.ok(typeof app.translations[lang][k] === 'string' && app.translations[lang][k].length > 0, `${lang}.${k}`);
    }
    app.state.selectedAllergies.add('sesame');
    for (const lang of langs) {
      app.state.lang = lang;
      const html = app.renderKnowledgeSectionHtml(app.buildKnowledgeReportForDish(mkDish({ ingredients: 'Sesame oil' }), 'ai_scan', 'k'));
      A.ok(html.includes(app.translations[lang].kbCheckNeeded), lang);
    }
    metrics.i18nKeys = keys.length * langs.length;
  });

  await tc('TC-18D2-27', 'autoApplyToRiskJudgment:false 관계의 자동 위험도 판정 제외', async () => {
    const allCandidates = Array.from(kb.relationsByIngredient.values()).flat().filter((r) => r.knowledgeTier === 'literature_candidate');
    A.strictEqual(allCandidates.length, 23);
    A.ok(allCandidates.every((r) => r.autoApplyToRiskJudgment === false));
    const r = pureReport(kb, mkDish({ ingredients: 'Soy sauce, Kimchi, Mayonnaise, Peanut sauce, Sesame oil' }));
    A.ok(r.knowledgeFindings.length > 0 && r.knowledgeFindings.every((f) => f.usedForRiskJudgment === false));
    const kbForced = realKb((inp) => { inp.ingredientKnowledge.literatureBackedCandidates[0].autoApplyToRiskJudgment = true; });
    A.strictEqual(FK.getRelationsForIngredient(kbForced, 'ganjang').find((x) => x.id === 'ia_0001').autoApplyToRiskJudgment, false);
    A.ok(kbForced.issues.some((i) => i.kind === 'candidate_auto_apply_forced_false'));
  });

  await tc('TC-18D2-28', 'CRLF 및 LF JSON 파일의 동일한 파싱 결과', async () => {
    const files = ['knowledge-manifest.json', 'ingredient-knowledge.json', 'evidence-sources.json'];
    const workingTreeEol = {};
    files.forEach((f) => { workingTreeEol[f] = REAL_TEXT[f].includes('\r\n') ? 'CRLF' : 'LF'; });
    const variant = (eol) => Object.fromEntries(files.map((f) => [f, JSON.parse(REAL_TEXT[f].replace(/\r?\n/g, eol))]));
    const lf = variant('\n');
    const crlf = variant('\r\n');
    A.deepStrictEqual(lf, crlf, '파싱된 객체가 완전히 동일');
    const build = (v) => FK.buildFoodKnowledgeBase({ manifest: v['knowledge-manifest.json'], ingredientKnowledge: v['ingredient-knowledge.json'], evidenceSources: v['evidence-sources.json'], activeAllergenIds: ACTIVE_IDS });
    const kLf = build(lf); const kCr = build(crlf);
    A.deepStrictEqual(kLf.stats, kCr.stats);
    const d = mkDish({ ingredients: 'Sesame oil, Soy sauce' });
    A.deepStrictEqual(pureReport(kLf, d), pureReport(kCr, d));
    metrics.workingTreeEol = workingTreeEol;
  });

  await tc('TC-18D2-29', '실제 출처 ID 및 근거 경로 추적', async () => {
    const evIds = new Set(REAL['evidence-sources.json'].map((e) => e.id));
    const lookup = (t) => (FK.normalizeKnowledgeText(t) === 'groundnut' ? { allergenId: 'peanut', source: 'alias_db', evidenceId: 'EV-FAO-GROUNDNUT-PEANUT', evidenceScope: 'international_standard' } : null);
    const r = pureReport(kb, mkDish({ ingredients: 'Sesame oil, Soy sauce, Kimchi, Oyster sauce, Mayonnaise, Peanut, groundnut, Mustard sauce' }), { allergenTermLookup: lookup });
    const sesame = r.knowledgeFindings.find((f) => f.relationId === 'ia_0036');
    A.strictEqual(sesame.sourceId, 'EV-KR-FOODCODE-SESAMEOIL');
    A.strictEqual(sesame.source.url, REAL['evidence-sources.json'].find((e) => e.id === 'EV-KR-FOODCODE-SESAMEOIL').url);
    A.deepStrictEqual(sesame.evidencePath.map((s) => s.step), ['ai_ingredient', 'ingredient_resolution', 'relation', 'evidence', 'profile_match']);
    A.ok(r.knowledgeFindings.filter((f) => f.sourceId).every((f) => evIds.has(f.sourceId)), '모든 출처 ID가 실제 evidence-sources.json에 존재');
    const g = r.knowledgeFindings.find((f) => f.relationId === 'term:alias_db:peanut');
    A.strictEqual(g.sourceId, 'EV-FAO-GROUNDNUT-PEANUT');
    // 전체 서비스 관계 44건 중 출처 연결 상태 집계
    const all = Array.from(kb.relationsByIngredient.values()).flat();
    metrics.evidenceLinked = all.filter((x) => x.evidenceStatus === 'linked').length;
    metrics.evidenceMissingId = all.filter((x) => x.evidenceStatus === 'no_evidence_id').length;
    A.strictEqual(metrics.evidenceLinked + metrics.evidenceMissingId, all.length);
    metrics.tracedPathsInSample = r.knowledgeFindings.length;
  });

  await tc('TC-18D2-30', '지식 DB 로딩 중 분석 완료 및 지연 결과 처리', async () => {
    const gate = deferred();
    const log = [];
    const { context } = loadApp(INDEX_HTML, { fetchImpl: makeFetch({ log, overrides: { 'ingredient-knowledge.json': () => gate.p } }) });
    const app = pick(context, APP_NAMES);
    await app.allergenKnowledgeBaseReady;
    app.state.selectedAllergies.add('sesame');
    app.state.selectedSpicy = 3;
    A.strictEqual(app.foodKB.status, 'loading');
    // (1) 로딩 중 AI 결과 도착 → "확인 중" 표시, 로딩 완료 후 같은 화면이면 갱신
    app.renderMultiDishScanResult([mkDish({ name_en: 'A', ingredients: 'Sesame oil' })]);
    A.strictEqual(app.state.lastKnowledgeReports[0].lookupStatus, 'loading');
    A.ok(app.renderKnowledgeSectionHtml(app.state.lastKnowledgeReports[0]).includes(app.translations.en.kbLoading));
    // (2) 로딩이 끝나기 전에 새 음식 B 결과로 화면이 바뀜 → A의 지연 갱신은 버려져야 함
    app.renderMultiDishScanResult([mkDish({ name_en: 'B', ingredients: 'Soy sauce' })]);
    gate.resolve(jsonRes(REAL_TEXT['ingredient-knowledge.json']));
    await app.foodKnowledgeBaseReady;
    await tick(); await tick();
    A.strictEqual(app.foodKB.status, 'ready');
    const reps = app.state.lastKnowledgeReports;
    A.strictEqual(reps.length, 1);
    A.strictEqual(reps[0].foodId, 'b', '현재 화면(B)만 갱신됨');
    A.strictEqual(reps[0].lookupStatus, 'ready');
    A.ok(!reps[0].groups.some((g) => g.allergenId === 'sesame'), '이전 음식(A)의 참깨 결과가 섞이지 않음');
    // 여러 번 분석해도 JSON을 다시 받지 않음
    app.renderMultiDishScanResult([mkDish({ ingredients: 'Sesame oil' })]);
    app.renderMultiDishScanResult([mkDish({ ingredients: 'Kimchi' })]);
    A.strictEqual(log.filter((u) => u.includes('ingredient-knowledge.json')).length, 1);
    A.strictEqual(log.filter((u) => u.includes('evidence-sources.json')).length, 1);
    metrics.ingredientKnowledgeFetchCount = 1;
  });

  // 실제 브라우저/실제 API가 필요한 항목 — 실행하지 않았으므로 NOT RUN
  record('TC-18D2-UI-1', '실제 브라우저에서 추가 확인 영역의 시각적 배치/색상/링크 클릭 확인', 'NOT RUN',
    'harness의 document stub은 innerHTML을 파싱하지 않음 — 실제 브라우저(Playwright 등) 필요');
  record('TC-18D2-UI-2', '실제 Gemini 응답(사용자 언어별 ingredients 표기)으로 식재료 매핑률 측정', 'NOT RUN',
    '실제 API 호출 지양 방침 — Mock으로만 검증, 실제 매핑률은 미측정');

  // ---- 정량 측정(실제 데이터 기준) ----
  const demoMeasure = (() => {
    const { context } = loadApp(INDEX_HTML, { fetchImpl: makeFetch() });
    return pick(context, ['locations']).locations.map((l) => l.matchedFoodObj);
  })();
  const demoReports = demoMeasure.map((d, i) => pureReport(kb, d, { analysisSource: 'demo_location', dishKey: 'demo:' + i }));
  metrics.demoDishes = {
    dishes: demoReports.length,
    tokens: demoReports.reduce((n, r) => n + r.ingredientTokens.length, 0),
    resolvedTokens: demoReports.reduce((n, r) => n + r.ingredientTokens.filter((t) => t.status === 'resolved').length, 0),
    unresolvedTokens: demoReports.reduce((n, r) => n + r.unresolvedIngredients.length, 0),
    findings: demoReports.reduce((n, r) => n + r.knowledgeFindings.length, 0),
    findingsNotInDemoAllergens: demoReports.reduce((n, r) => n + r.knowledgeFindings.filter((f) => !f.inAiAllergens).length, 0),
  };

  console.log('\n=== 정량 측정(Mock/실제 생성 데이터 기준) ===');
  console.log(JSON.stringify(metrics, null, 2));

  console.log('\n=== 요약 ===');
  const summary = { PASS: 0, FAIL: 0, 'NOT RUN': 0 };
  results.forEach((r) => { summary[r.status] = (summary[r.status] || 0) + 1; });
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건 / 실행된 assertion 총 개수: ${assertionCount}건`);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
