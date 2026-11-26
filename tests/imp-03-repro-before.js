// tests/imp-03-repro-before.js
//
// [IMP-03] 수정 "전" 결함 재현.
//
// 아래 OLD_CHECK_DISH_SAFETY는 index.html(IMP-03 수정 전 커밋 35c6d06,
// `git show 35c6d06:index.html`로 확인)의 checkDishSafety() 본문을 글자
// 그대로 옮긴 것이다(재구현 아님 — tests/imp-01-repro-before.js와 같은 방식).
const assert = require('assert');

function OLD_checkDishSafety(dish, ctx) {
  const { standardAllergens, userHasAllergyTo, violatesDietary, dietary, findUncertainCustomAllergyMatches, selectedSpicy } = ctx;

  if (!Array.isArray(standardAllergens) || standardAllergens.length === 0) {
    return {
      safetyState: 'red', // ← IMP-03 이전: red(확정 위험)와 구분 안 됨
      isCrossContact: false,
      matchedDangers: ['DATA_UNAVAILABLE'],
      dataUnavailable: true,
      unknownAllergenIds: []
    };
  }

  let safetyState = 'green';
  let isCrossContact = false;
  const matchedDangers = [];
  const unknownAllergenIds = [];

  (dish.allergens || []).forEach(allg => {
    const standardItem = standardAllergens.find(x => x.id === allg);
    if (!standardItem) { unknownAllergenIds.push(allg); return; }
    if (userHasAllergyTo(allg)) { safetyState = 'red'; matchedDangers.push(allg); }
  });

  if (safetyState !== 'red' && violatesDietary(dish, dietary)) {
    safetyState = 'red';
    matchedDangers.push(dietary);
  }

  if (safetyState !== 'red' && dish.crossContactAllergens) {
    dish.crossContactAllergens.forEach(allg => {
      const standardItem = standardAllergens.find(x => x.id === allg);
      if (!standardItem) { unknownAllergenIds.push(allg); return; }
      if (userHasAllergyTo(allg)) { safetyState = 'orange'; isCrossContact = true; matchedDangers.push(allg); }
    });
  }

  const spicyIsUnknown = (dish.spicy === null || dish.spicy === undefined);
  if (!spicyIsUnknown && safetyState === 'green' && dish.spicy > selectedSpicy) {
    safetyState = 'orange';
  }
  // ↓ 맵기 "모름"도 orange — 교차오염(확정 경미 위험)과 같은 색
  if (spicyIsUnknown && safetyState === 'green') {
    safetyState = 'orange';
  }

  // ↓ 등록 안 된 id는 로그만 남기고 safetyState에는 전혀 영향 없음
  // (console.warn 생략 — 재현 목적상 상태값만 비교)

  const uncertainMatches = findUncertainCustomAllergyMatches(dish);
  // ↓ 모호한 커스텀 일치도 orange — 역시 교차오염과 같은 색
  if (uncertainMatches.length > 0 && safetyState === 'green') {
    safetyState = 'orange';
  }

  return { safetyState, isCrossContact, matchedDangers, unknownAllergenIds, hasUncertainMatch: uncertainMatches.length > 0, uncertainMatches, hasUnknownSpicy: spicyIsUnknown };
}

console.log('=== [IMP-03] 수정 전 결함 재현 ===\n');

console.log('--- 결함 1: 안전 점검 시스템 고장(registry 로드 실패)이 "확정된 직접 위험"과 같은 색(red) ---');
const r1 = OLD_checkDishSafety(
  { allergens: [], crossContactAllergens: [], spicy: 0 },
  { standardAllergens: [], userHasAllergyTo: () => false, violatesDietary: () => false, dietary: 'none', findUncertainCustomAllergyMatches: () => [], selectedSpicy: 3 }
);
console.log('registry 없음 →', r1.safetyState);
assert.strictEqual(r1.safetyState, 'red');
console.log('→ "땅콩이 확실히 들어있어 위험"과 "안전 점검 자체가 안 됨"이 화면에서 똑같은 빨간 배너로 보인다.\n');

console.log('--- 결함 2: 등록 안 된 알레르겐 id가 있어도 green — 아무 신호 없음 ---');
const r2 = OLD_checkDishSafety(
  { allergens: ['msg_unknown'], crossContactAllergens: [], spicy: 0 },
  { standardAllergens: [{ id: 'peanut' }], userHasAllergyTo: () => false, violatesDietary: () => false, dietary: 'none', findUncertainCustomAllergyMatches: () => [], selectedSpicy: 3 }
);
console.log('미등록 id 포함 →', r2.safetyState, '(unknownAllergenIds:', r2.unknownAllergenIds, ')');
assert.strictEqual(r2.safetyState, 'green');
console.log('→ AI가 우리가 모르는 성분을 언급했는데도 배너는 그냥 "안전"으로 보인다.\n');

console.log('--- 결함 3: 맵기 모름 / 모호한 커스텀 일치가 "확정된 경미 위험(교차오염)"과 같은 색(orange) ---');
const r3a = OLD_checkDishSafety(
  { allergens: [], crossContactAllergens: [], spicy: null },
  { standardAllergens: [{ id: 'peanut' }], userHasAllergyTo: () => false, violatesDietary: () => false, dietary: 'none', findUncertainCustomAllergyMatches: () => [], selectedSpicy: 3 }
);
const r3b = OLD_checkDishSafety(
  { allergens: [], crossContactAllergens: ['shellfish'], spicy: 0 },
  { standardAllergens: [{ id: 'shellfish' }], userHasAllergyTo: (id) => id === 'shellfish', violatesDietary: () => false, dietary: 'none', findUncertainCustomAllergyMatches: () => [], selectedSpicy: 3 }
);
console.log('맵기 모름 →', r3a.safetyState, '/ 확정 교차오염 →', r3b.safetyState);
assert.strictEqual(r3a.safetyState, 'orange');
assert.strictEqual(r3b.safetyState, 'orange');
console.log('→ "맵기를 그냥 모름"과 "교차오염이 실제로 확인됨"이 구분 안 되는 같은 주황 배너.\n');

console.log('=== 요약 ===');
console.log('재현된 결함 3건 — tests/imp-03-after.js에서 error/unknown 전용 상태로 분리됐음을 확인한다.');
