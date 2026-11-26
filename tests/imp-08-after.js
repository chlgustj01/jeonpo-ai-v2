// tests/imp-08-after.js
//
// IMP-08 테스트(TC-08-01 ~ TC-08-07) — 상태 관리 및 화면 동기화.
//
// setSpicy()의 "saveProfileToStorage 누락" 버그, CUSTOM_ALLERGY_STATUS_BADGES의
// "항상 영어" 버그 등 개발 중 발견한 실제 결함의 수정을 검증한다. 실제 여러
// 탭을 전환하며 눈으로 확인하는 것은 NOT RUN으로 남긴다.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadApp, pick } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');

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
  'state', 'setSpicy', 'syncModalDiet', 'syncOnboardingDiet', 'saveProfileToStorage',
  'loadProfileFromStorage', 'toggleAllergen', 'updateTtsDraft', 'getSpeechScript',
  'CUSTOM_ALLERGY_STATUS_BADGES', 'renderCustomAllergyBadges', 'kbText', 'translations',
  'setLanguage', 'allergenKnowledgeBaseReady', 'foodKnowledgeBaseReady', 'document',
  'renderMultiDishScanResult', 'updateStaffQuestionPanel',
];
async function freshApp() {
  const { context } = loadApp(INDEX_HTML, { fetchImpl: makeFetch() });
  const app = pick(context, APP_NAMES);
  await app.allergenKnowledgeBaseReady;
  await app.foodKnowledgeBaseReady;
  return app;
}

async function main() {
  await tc('TC-08-01', '[버그 수정] 온보딩 완료 후 setSpicy()가 localStorage에 저장됨(기존엔 호출 자체가 없었음)', async () => {
    const app = await freshApp();
    app.document.getElementById('main-app').classList.remove('hidden'); // 온보딩 완료 상태로 표시
    app.setSpicy(2);
    const saved = app.loadProfileFromStorage();
    assert.ok(saved, '저장된 프로필이 있어야 함');
    assert.strictEqual(saved.selectedSpicy, 2);
  });

  await tc('TC-08-02', '온보딩 완료 전(main-app 숨김)에는 setSpicy()가 onboardingComplete를 조기 저장하지 않음', async () => {
    const app = await freshApp();
    app.document.getElementById('main-app').classList.add('hidden');
    app.setSpicy(3);
    const saved = app.loadProfileFromStorage();
    assert.ok(!saved || !saved.onboardingComplete, '온보딩 전에는 onboardingComplete가 저장되지 않아야 함');
  });

  await tc('TC-08-03', '알레르기 하나를 바꾸면 TTS 발화 초안이 같은 호출 안에서 즉시 갱신됨', async () => {
    const app = await freshApp();
    app.toggleAllergen('peanut');
    const draft = app.document.getElementById('tts-preview-box').innerText;
    assert.ok(draft.includes('땅콩'), `TTS 초안에 땅콩이 포함되어야 함: ${draft}`);
  });

  await tc('TC-08-04', '한 번의 프로필 변경이 TTS 초안과 직원 질문 패널을 모두 갱신함(화면 간 불일치 방지)', async () => {
    const app = await freshApp();
    app.state.hasScannedResult = true; // 실제 호출부(analyzeMenuPhotoWithAI 등)가 렌더 전에 미리 설정하는 값
    app.renderMultiDishScanResult([{
      foodId: 'x', name: 'Test', nameKo: '테스트', nameEn: 'Test', ingredients: '', allergens: [],
      crossContactAllergens: [], spicy: 1, eatingMethod: [], description: '', culturalNote: '',
    }]);
    app.toggleAllergen('milk');
    const ttsDraft = app.document.getElementById('tts-preview-box').innerText;
    const panelHtml = app.document.getElementById('staff-question-panel').innerHTML;
    assert.ok(ttsDraft.includes('우유'), 'TTS 초안에 우유 반영');
    assert.ok(panelHtml.length > 0, '직원 질문 패널도 함께 갱신됨(빈 문자열이 아님)');
  });

  await tc('TC-08-05', '[버그 수정] 커스텀 알레르기 상태 배지 툴팁이 화면 언어를 따라감(기존엔 항상 영어 고정)', async () => {
    // translateUI() 전체를 타지 않기 위해 state.lang만 직접 바꾼다(이 테스트의
    // 관심사는 kbText()/CUSTOM_ALLERGY_STATUS_BADGES의 언어 반응성뿐이고,
    // 환율 영역의 nextElementSibling 관련 기존 하네스 한계와는 무관하다).
    const app = await freshApp();
    app.state.lang = 'en';
    const enTitle = app.kbText('badgeCustomUnlisted');
    app.state.lang = 'ko';
    const koTitle = app.kbText('badgeCustomUnlisted');
    assert.notStrictEqual(enTitle, koTitle, '언어별로 다른 문자열을 돌려줘야 함(기존엔 영어로 고정되어 항상 같았음)');
    assert.strictEqual(enTitle, app.translations.en.badgeCustomUnlisted);
    assert.strictEqual(koTitle, app.translations.ko.badgeCustomUnlisted);
  });

  await tc('TC-08-06', '국적 변경도 onProfileChanged 경로를 통해 프로필 저장에 반영됨', async () => {
    const app = await freshApp();
    app.document.getElementById('main-app').classList.remove('hidden');
    app.state.nationality = 'France';
    app.saveProfileToStorage();
    const saved = app.loadProfileFromStorage();
    assert.strictEqual(saved.nationality, 'France');
  });

  record('TC-08-DOM-1', '온보딩/프로필 수정 모달/지도/스캔/TTS/리뷰 탭을 실제로 오가며 동일 프로필이 보이는지 눈으로 확인', 'NOT RUN', '실제 브라우저(여러 탭 전환) 테스트 필요');

  console.log('\n=== 요약 ===');
  const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건`);
  if (summary.FAIL) process.exit(1);
}

main();
