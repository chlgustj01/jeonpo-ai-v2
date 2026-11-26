// tests/imp-14-after.js
//
// IMP-14 테스트(TC-14-01 ~ TC-14-12) — 리뷰 데이터 영속성.
//
// submitReview()는 실제 <input>/<textarea> DOM 값을 읽으므로, harness의
// id-키 캐시된 document stub에 .value를 직접 심어서 "폼 제출"을 흉내낸다
// (IMP-12 테스트 때는 이 방식이 안 됐지만, IMP-03 당시 harness를 id-캐시
// 방식으로 바꿔둔 덕에 이제는 가능하다).

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
  'state', 'submitReview', 'editReview', 'deleteReview', 'cancelEditReview',
  'renderReviewsList', 'saveUserReviewsToStorage', 'loadUserReviewsFromStorage',
  'escapeHtml', 'document', 'localStorage', 'REVIEWS_DATABASE', 'translations',
  'allergenKnowledgeBaseReady', 'foodKnowledgeBaseReady',
];
async function freshApp(opts = {}) {
  const { context } = loadApp(INDEX_HTML, Object.assign({ fetchImpl: makeFetch() }, opts));
  const app = pick(context, APP_NAMES);
  await app.allergenKnowledgeBaseReady;
  await app.foodKnowledgeBaseReady;
  return app;
}

function fakeSubmitEvent() {
  return { preventDefault: () => {} };
}

// harness의 document.createElement 스텁은 appendChild를 no-op으로 둬서
// (기존부터 그래왔음 — IMP-14가 처음 만든 한계가 아니다) 컨테이너의
// innerHTML에는 자식이 반영되지 않는다. renderReviewsList()가 실제로
// 어떤 카드 HTML을 만들었는지 보려면 createElement 호출 자체를 가로채야
// 한다 — 이 헬퍼가 그 역할을 한다.
function captureCreatedElements(app) {
  const created = [];
  const original = app.document.createElement;
  app.document.createElement = (tag) => {
    const el = original(tag);
    created.push(el);
    return el;
  };
  return created;
}

function setFormValues(app, { rating = '5', spice = '3', text = '맛있었어요' } = {}) {
  app.document.getElementById('review-rating-input').value = rating;
  app.document.getElementById('review-spice-input').value = spice;
  app.document.getElementById('review-comment-input').value = text;
}

async function main() {
  await tc('TC-14-01', '리뷰 저장 — submitReview()가 state.userReviews에 고유 id로 추가하고 localStorage에 즉시 저장함', async () => {
    const app = await freshApp();
    app.state.currentReviewFoodId = 'samgyeopsal';
    setFormValues(app, { text: '정말 맛있었어요' });
    app.submitReview(fakeSubmitEvent());
    const list = app.state.userReviews.samgyeopsal;
    assert.strictEqual(list.length, 1);
    assert.ok(list[0].id, '고유 id가 있어야 함');
    assert.strictEqual(list[0].isUserReview, true);
    assert.strictEqual(list[0].text, '정말 맛있었어요');
    const raw = JSON.parse(app.localStorage.getItem('fitbridge_user_reviews_v1'));
    assert.strictEqual(raw.reviews.samgyeopsal.length, 1, 'localStorage에도 즉시 반영됨');
  });

  await tc('TC-14-02', '리뷰 복원 — 새로고침(새 loadApp 인스턴스)에도 저장된 리뷰가 그대로 복원됨', async () => {
    const app1 = await freshApp();
    app1.state.currentReviewFoodId = 'malatang';
    setFormValues(app1, { text: '매웠지만 좋았어요' });
    app1.submitReview(fakeSubmitEvent());
    const savedRaw = app1.localStorage.getItem('fitbridge_user_reviews_v1');

    // 두 번째 앱 인스턴스가 "새로고침 후"를 흉내낸다 — 같은 localStorage 내용을 주입.
    const app2 = await freshApp({ localStorageData: { fitbridge_user_reviews_v1: savedRaw } });
    const loaded = app2.loadUserReviewsFromStorage();
    assert.strictEqual(loaded.malatang.length, 1);
    assert.strictEqual(loaded.malatang[0].text, '매웠지만 좋았어요');
  });

  await tc('TC-14-03', '리뷰 수정 — editReview() 후 submitReview()가 새 리뷰를 추가하지 않고 기존 항목을 갱신함', async () => {
    const app = await freshApp();
    app.state.currentReviewFoodId = 'samgyeopsal';
    setFormValues(app, { text: '원본 리뷰', rating: '3' });
    app.submitReview(fakeSubmitEvent());
    const id = app.state.userReviews.samgyeopsal[0].id;

    app.editReview(id);
    assert.strictEqual(app.state.editingReviewId, id);
    setFormValues(app, { text: '수정된 리뷰', rating: '5' });
    app.submitReview(fakeSubmitEvent());

    assert.strictEqual(app.state.userReviews.samgyeopsal.length, 1, '새 항목이 추가되지 않고 같은 항목이 갱신됨');
    assert.strictEqual(app.state.userReviews.samgyeopsal[0].text, '수정된 리뷰');
    assert.strictEqual(app.state.userReviews.samgyeopsal[0].rating, 5);
    assert.strictEqual(app.state.editingReviewId, null, '수정 완료 후 편집 상태가 풀림');
  });

  await tc('TC-14-04', '리뷰 삭제 — deleteReview()가 해당 항목만 제거하고 localStorage에도 반영됨', async () => {
    const app = await freshApp();
    app.state.currentReviewFoodId = 'samgyeopsal';
    setFormValues(app, { text: '첫 번째' });
    app.submitReview(fakeSubmitEvent());
    setFormValues(app, { text: '두 번째' });
    app.submitReview(fakeSubmitEvent());
    const [first, second] = app.state.userReviews.samgyeopsal;

    app.deleteReview(first.id); // harness의 window.confirm은 기본적으로 true를 돌려줌


    assert.strictEqual(app.state.userReviews.samgyeopsal.length, 1);
    assert.strictEqual(app.state.userReviews.samgyeopsal[0].id, second.id);
    const raw = JSON.parse(app.localStorage.getItem('fitbridge_user_reviews_v1'));
    assert.strictEqual(raw.reviews.samgyeopsal.length, 1);
  });

  await tc('TC-14-05', '중복 저장 방지 — 동기 재진입(이중 클릭 흉내)에도 리뷰가 두 번 저장되지 않음', async () => {
    const app = await freshApp();
    app.state.currentReviewFoodId = 'samgyeopsal';
    setFormValues(app, { text: '중복 테스트' });
    // submitReview 내부에서 재진입을 흉내: isSubmittingReview를 미리 true로 설정
    app.state.isSubmittingReview = true;
    app.submitReview(fakeSubmitEvent());
    assert.strictEqual((app.state.userReviews.samgyeopsal || []).length, 0, '재진입 중에는 저장되지 않음');
    app.state.isSubmittingReview = false;
    app.submitReview(fakeSubmitEvent());
    assert.strictEqual(app.state.userReviews.samgyeopsal.length, 1, '가드가 풀린 뒤에는 정상 저장');
  });

  await tc('TC-14-06', '손상된 저장 데이터 처리 — JSON 파싱 실패 시 예외 없이 null을 반환(리셋 신호)', async () => {
    const app = await freshApp({ localStorageData: { fitbridge_user_reviews_v1: '{broken json' } });
    const loaded = app.loadUserReviewsFromStorage();
    assert.strictEqual(loaded, null);
  });

  await tc('TC-14-07', '손상된 저장 데이터 처리 — 예상과 다른 구조(reviews가 배열)여도 null을 반환', async () => {
    const app = await freshApp({ localStorageData: { fitbridge_user_reviews_v1: JSON.stringify({ schemaVersion: 1, reviews: [] }) } });
    const loaded = app.loadUserReviewsFromStorage();
    assert.strictEqual(loaded, null);
  });

  await tc('TC-14-08', '손상된 저장 데이터 처리 — foodId 중 일부만 배열이 아니면 그 항목만 제외하고 나머지는 보존', async () => {
    const app = await freshApp({
      localStorageData: {
        fitbridge_user_reviews_v1: JSON.stringify({ schemaVersion: 1, reviews: { samgyeopsal: [{ id: 'a' }], broken: 'not-an-array' } })
      }
    });
    const loaded = app.loadUserReviewsFromStorage();
    assert.deepStrictEqual(Object.keys(loaded), ['samgyeopsal']);
  });

  await tc('TC-14-09', '데모 리뷰와 사용자 리뷰 구분 — REVIEWS_DATABASE(데모)는 submitReview로 전혀 변경되지 않음', async () => {
    const app = await freshApp();
    const demoCountBefore = app.REVIEWS_DATABASE.samgyeopsal.length;
    app.state.currentReviewFoodId = 'samgyeopsal';
    setFormValues(app, { text: '사용자 작성 리뷰' });
    app.submitReview(fakeSubmitEvent());
    assert.strictEqual(app.REVIEWS_DATABASE.samgyeopsal.length, demoCountBefore, '데모 시드 데이터는 그대로');
    assert.strictEqual(app.state.userReviews.samgyeopsal.length, 1, '사용자 리뷰는 별도 저장소에');
  });

  await tc('TC-14-10', '렌더링 시 데모 리뷰와 사용자 리뷰가 합쳐져 목록에 함께 반영되지만 데모 배열 자체는 건드리지 않음', async () => {
    const app = await freshApp();
    app.state.currentReviewFoodId = 'samgyeopsal';
    const demoCount = app.REVIEWS_DATABASE.samgyeopsal.length;
    setFormValues(app, { text: '내 리뷰', rating: '5' });
    app.submitReview(fakeSubmitEvent());
    const created = captureCreatedElements(app);
    assert.doesNotThrow(() => app.renderReviewsList());
    const cardHtml = created.map((c) => c.innerHTML).join('\n');
    assert.ok(cardHtml.includes('내 리뷰'), '사용자 리뷰 카드가 생성되어야 함');
    assert.strictEqual(app.state.userReviews.samgyeopsal.length, 1);
    assert.strictEqual(app.REVIEWS_DATABASE.samgyeopsal.length, demoCount, '합산 렌더링이 데모 배열 자체를 건드리지 않음');
  });

  await tc('TC-14-11', '[XSS 방어] 사용자가 입력한 리뷰 텍스트의 HTML 특수문자가 escapeHtml로 무해화됨', async () => {
    const app = await freshApp();
    app.state.currentReviewFoodId = 'samgyeopsal';
    setFormValues(app, { text: '<img src=x onerror=alert(1)>' });
    app.submitReview(fakeSubmitEvent());
    const created = captureCreatedElements(app);
    app.renderReviewsList();
    const cardHtml = created.map((c) => c.innerHTML).join('\n');
    assert.ok(!cardHtml.includes('<img src=x onerror'), '원본 태그가 그대로 들어가면 안 됨');
    assert.ok(cardHtml.includes('&lt;img'), 'escapeHtml로 치환된 형태여야 함');
  });

  await tc('TC-14-12', '민감 정보 미복제 — 저장된 리뷰 객체에 selectedAllergies/customAllergies가 포함되지 않음', async () => {
    const app = await freshApp();
    app.state.selectedAllergies = new Set(['peanut', 'milk']);
    app.state.customAllergies = [{ original: 'kiwi' }];
    app.state.currentReviewFoodId = 'samgyeopsal';
    setFormValues(app, { text: '알레르기 정보 테스트' });
    app.submitReview(fakeSubmitEvent());
    const saved = app.state.userReviews.samgyeopsal[0];
    assert.strictEqual(Object.prototype.hasOwnProperty.call(saved, 'selectedAllergies'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(saved, 'customAllergies'), false);
  });

  console.log('\n=== 요약 ===');
  const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건`);
  if (summary.FAIL) process.exit(1);
}

main();
