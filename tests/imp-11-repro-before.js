// tests/imp-11-repro-before.js
//
// IMP-11 수정 "전" 결함 재현 테스트.
// index.html의 실제 로직을 harness.js로 그대로 실행시켜, 코드를 고치기 전에
// 실제로 결함이 존재하는지부터 증명한다. 외부 네트워크(Gemini API 등) 호출 없이
// 데모 데이터 + 최소 Mock만 사용한다.

const assert = require('assert');
const { loadApp, pick } = require('./harness.js');

const results = [];
function record(id, description, status, detail) {
  results.push({ id, description, status, detail });
  console.log(`[${status}] ${id} ${description}${detail ? ' — ' + detail : ''}`);
}

function run() {
  const { context } = loadApp(require('path').join(__dirname, '..', 'index.html'));
  const { state, standardAllergens, locations, checkDishSafety } = pick(context, [
    'state',
    'standardAllergens',
    'locations',
    'checkDishSafety',
  ]);

  // R1 — standardAllergens에 'fish'가 없는지 확인
  try {
    const found = standardAllergens.find((a) => a.id === 'fish');
    assert.strictEqual(found, undefined);
    record('R1', "standardAllergens에 'fish' id 누락 확인", 'PASS', '재현됨(find() => undefined)');
  } catch (e) {
    record('R1', "standardAllergens에 'fish' id 누락 확인", 'FAIL', '예상과 다름: ' + e.message);
  }

  // R2 — standardAllergens에 'sesame'가 없는지 확인
  try {
    const found = standardAllergens.find((a) => a.id === 'sesame');
    assert.strictEqual(found, undefined);
    record('R2', "standardAllergens에 'sesame' id 누락 확인", 'PASS', '재현됨(find() => undefined)');
  } catch (e) {
    record('R2', "standardAllergens에 'sesame' id 누락 확인", 'FAIL', '예상과 다름: ' + e.message);
  }

  // R3 — 'fish' 교차접촉 위험이 실제로 무시되는지 (checkDishSafety 직접 호출)
  //      selectedAllergies에 'fish'를 직접 넣어도(=UI 우회) 경고가 뜨지 않아야
  //      "표준 목록에 없어서 무조건 무시된다"는 걸 증명할 수 있다.
  try {
    state.selectedAllergies = new Set(['fish']);
    state.dietary = 'none';
    state.selectedSpicy = 3;
    const dish = { allergens: [], crossContactAllergens: ['fish'], spicy: 0 };
    const result = checkDishSafety(dish);
    assert.strictEqual(result.safetyState, 'green');
    record(
      'R3',
      "crossContactAllergens:['fish']가 selectedAllergies에 있어도 무시됨",
      'PASS',
      `재현됨(safetyState='green', 기대했던 경고='orange')`
    );
  } catch (e) {
    record('R3', "crossContactAllergens:['fish'] 무시 확인", 'FAIL', '예상과 다름: ' + e.message);
  }

  // R4 — 지도 데모 데이터(마라탕, locations[1])의 crossContactAllergens:['sesame']가
  //      "이상적인" 커스텀 알레르기(완벽히 '참깨'로 번역된 경우)로도 매칭되지 않는지
  try {
    const malatang = locations.find((l) => l.matchedFoodObj && l.matchedFoodObj.foodId === 'malatang');
    assert.ok(malatang, 'locations에서 malatang을 찾지 못함');
    // 주의: malatang은 vm Context(별도 JS realm)에서 만들어진 객체라
    // assert.deepStrictEqual로 host realm의 배열과 비교하면 "구조는 같지만
    // reference가 다른 Array 생성자"라는 이유로 실패한다(Node assert의 cross-realm 한계).
    // 테스트 목적상 내용만 비교하면 되므로 Array.from으로 host realm 배열로 변환한다.
    assert.deepStrictEqual(Array.from(malatang.matchedFoodObj.crossContactAllergens), ['sesame']);

    state.selectedAllergies = new Set(); // 표준 체크박스에는 'sesame' 자체가 없어 선택 불가
    state.customAllergies = [{ original: 'Sesame', translated: '참깨' }]; // 번역이 100% 이상적으로 됐다고 가정
    state.dietary = 'none';
    state.selectedSpicy = 3;

    const result = checkDishSafety(malatang.matchedFoodObj);
    assert.strictEqual(result.safetyState, 'green');
    record(
      'R4',
      "마라탕(malatang) 교차접촉 'sesame' — 완벽한 커스텀 번역('참깨')로도 미매칭",
      'PASS',
      "재현됨(safetyState='green'). 원인: standardAllergens에 'sesame' 자체가 없어 standardItem이 undefined → 번역 품질과 무관하게 무조건 무시"
    );
  } catch (e) {
    record('R4', 'malatang sesame 교차접촉 미매칭 확인', 'FAIL', '예상과 다름: ' + e.message);
  }

  // R5 — pineneut/pinenut 사용 현황: 루트 파일 내부 일관성 확인 (버그는 아니지만 표준화 대상)
  try {
    const teahouse = locations.find((l) => l.matchedFoodObj && l.matchedFoodObj.foodId === 'teahouse');
    const usesPineneut =
      standardAllergens.some((a) => a.id === 'pineneut') &&
      teahouse &&
      (teahouse.matchedFoodObj.allergens || []).includes('pineneut');
    assert.ok(usesPineneut);
    record(
      'R5',
      "루트 index.html 내부는 'pineneut'(오타)로 일관 — 단, app/ 실험 버전은 'pinenut' 사용",
      'PASS',
      "재현됨. 내부 일관성은 있으나 올바른 영어 철자(pinenut)가 아니며 다른 버전과 불일치"
    );
  } catch (e) {
    record('R5', 'pineneut 사용 현황 확인', 'FAIL', '예상과 다름: ' + e.message);
  }

  // R6 — 현재 LocalStorage 저장 구조 확인 (마이그레이션 로직이 아예 없다는 것을 확인)
  try {
    const { loadProfileFromStorage, saveProfileToStorage } = pick(context, [
      'loadProfileFromStorage',
      'saveProfileToStorage',
    ]);
    state.selectedAllergies = new Set(['pineneut', 'shellfish']);
    state.customAllergies = [{ original: 'Sesame', translated: '참깨' }];
    state.lang = 'en';
    state.dietary = 'vegan';
    state.nationality = 'USA';
    state.selectedSpicy = 2;
    saveProfileToStorage();

    const raw = context.localStorage.getItem('fitbridge_profile_v1');
    const parsed = JSON.parse(raw);
    assert.deepStrictEqual(parsed.selectedAllergies.sort(), ['pineneut', 'shellfish'].sort());
    assert.strictEqual(parsed.onboardingComplete, true);
    assert.ok(!('schemaVersion' in parsed) && !('version' in parsed));
    record(
      'R6',
      "현재 LocalStorage 스키마에는 버전/마이그레이션 필드가 전혀 없음",
      'PASS',
      `재현됨. 저장된 raw 구조: ${raw}`
    );
  } catch (e) {
    record('R6', 'LocalStorage 구조 확인', 'FAIL', '예상과 다름: ' + e.message);
  }

  // R7 — Gemini API 프롬프트(ALLOWED_ALLERGEN_IDS)에도 fish/sesame가 없는지는
  //      api/analyze-menu.js 쪽 파일이라 이 harness(index.html 전용)로는 직접 실행할 수 없다.
  record(
    'R7',
    "api/analyze-menu.js의 ALLOWED_ALLERGEN_IDS에 fish/sesame 누락 여부",
    'NOT RUN',
    '이 harness는 index.html 전용 — 별도로 정적 코드 조사(grep)로 확인함(섹션 3-1 표 참조). 실행 테스트는 수행하지 않음'
  );

  // R8 — 실제 Gemini API를 호출해 AI가 돌려주는 allergens 값이 ALLOWED_ALLERGEN_IDS를
  //      벗어나는지 확인하는 테스트는 의도적으로 실행하지 않음(실제 API 호출 지양 요청사항).
  record(
    'R8',
    '실제 Gemini API 응답에서의 ID 불일치 여부',
    'NOT RUN',
    '요청사항에 따라 실제 API 호출 없이 데모 데이터 중심으로만 재현 — 이 경로는 의도적으로 생략'
  );

  console.log('\n=== 요약 ===');
  const summary = { PASS: 0, FAIL: 0, 'NOT RUN': 0 };
  results.forEach((r) => (summary[r.status] = (summary[r.status] || 0) + 1));
  console.log(summary);

  const anyFail = results.some((r) => r.status === 'FAIL');
  process.exit(anyFail ? 1 : 0);
}

run();
