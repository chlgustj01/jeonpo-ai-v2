// tests/imp-02-repro-before.js
//
// [IMP-02] 수정 "전" 결함 재현.
//
// 아래 OLD_DISH_MAP 함수는 index.html(IMP-02 수정 전 커밋 f3a5d51,
// `git show HEAD:index.html`로 확인)의 analyzeMenuPhotoWithAI() 안에 있던
// `rawDishes.map(d => {...})` 화살표 함수 리터럴 본문을 글자 하나 바꾸지
// 않고 그대로 옮긴 것이다(재구현이 아니라 복사 — tests/imp-01-repro-before.js와
// 같은 방식). 서버(api/analyze-menu.js)는 당시 검증을 전혀 하지 않고
// `res.status(200).json(parsed)`로 Gemini 원본을 그대로 돌려줬으므로
// (`git show HEAD:api/analyze-menu.js`로 확인), 아래 OLD_DISH_MAP에
// 들어가는 `d`는 곧 Gemini가 실제로 돌려줄 수 있는 임의의(검증되지 않은)
// 값이라고 봐도 된다.
const assert = require('assert');

function slugifyFoodNameOld(name) {
  return (name || 'dish')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40) || 'dish';
}

function normalizeSpicyOld(rawValue) {
  // IMP-01이 이미 고쳐놓은 부분이라 스스로는 안전하다 — 여기서는 그대로 가져와서만 쓴다.
  if (rawValue === null || rawValue === undefined) return { value: null, status: 'missing', raw: rawValue };
  if (typeof rawValue !== 'number') return { value: null, status: 'invalid_type', raw: rawValue };
  if (!Number.isInteger(rawValue)) return { value: null, status: 'non_integer', raw: rawValue };
  if (rawValue < 0 || rawValue > 3) return { value: null, status: 'out_of_range', raw: rawValue };
  return { value: rawValue, status: 'valid', raw: rawValue };
}

// ↓↓↓ index.html:3474-3492 (수정 전) .map() 콜백 본문 그대로 ↓↓↓
function OLD_DISH_MAP(d) {
  const spicyResult = normalizeSpicyOld(d.spicy);
  return {
    foodId: slugifyFoodNameOld(d.name_en || d.name_ko),
    name: d.name_ko && (d.translated_name || d.name_en)
      ? `${d.translated_name || d.name_en} (${d.name_ko})`
      : (d.translated_name || d.name_en || d.name_ko || 'Unknown dish'),
    nameKo: d.name_ko || d.name_en || 'Unknown dish',
    ingredients: d.ingredients || '',
    allergens: Array.isArray(d.allergens) ? d.allergens : [],
    crossContactAllergens: Array.isArray(d.crossContactAllergens) ? d.crossContactAllergens : [],
    spicy: spicyResult.value,
    spicyStatus: spicyResult.status,
    eatingMethod: Array.isArray(d.eatingMethod) ? d.eatingMethod : [],
    description: d.description || '',
    culturalNote: d.culturalNote || ''
  };
}
// ↑↑↑ 여기까지 복사 ↑↑↑

console.log('=== [IMP-02] 수정 전 결함 재현 ===\n');

console.log('--- 결함 1: allergens 결측/오타입이 "빈 배열(= 안전 확정)"과 구분되지 않음 ---');
const allergenCases = [
  { label: 'allergens 필드 자체 없음', value: undefined },
  { label: 'allergens: null', value: null },
  { label: 'allergens: "egg" (배열이 아니라 문자열 하나)', value: 'egg' },
  { label: 'allergens: {} (객체)', value: {} },
  { label: 'allergens: ["egg"] (정상)', value: ['egg'] },
  { label: 'allergens: [] (AI가 실제로 없다고 확인한 경우)', value: [] },
];
allergenCases.forEach(({ label, value }) => {
  const out = OLD_DISH_MAP({ name_ko: '테스트', allergens: value }).allergens;
  console.log(`입력: ${label.padEnd(42)} → 결과 allergens: ${JSON.stringify(out)}`);
});
const collapsedToEmpty = allergenCases
  .filter(c => c.label !== 'allergens: ["egg"] (정상)' && c.label !== 'allergens: [] (AI가 실제로 없다고 확인한 경우)')
  .every(c => JSON.stringify(OLD_DISH_MAP({ allergens: c.value }).allergens) === '[]');
assert.strictEqual(collapsedToEmpty, true, '결측/오타입 케이스가 전부 빈 배열로 뭉개져야 결함이 재현된 것');
console.log(
  '→ "필드가 아예 없음"과 "문자열 하나로 잘못 옴"과 "AI가 정말로 없다고 확인함"이 전부\n' +
  '  checkDishSafety()에는 똑같이 "빈 배열"로 보인다 — 알레르기 확인 자체가 안 됐는데도\n' +
  '  "확인했더니 없음(안전)"과 구분되지 않는다. IMP-11의 fail-closed 원칙 위반.\n'
);

console.log('--- 결함 2: 등록되지 않은 id/대소문자 변형/중복이 전혀 걸러지지 않고 그대로 통과 ---');
const messyAllergens = OLD_DISH_MAP({ allergens: ['egg', 'EGG', 'Egg', 'not_a_real_allergen_id'] }).allergens;
console.log('입력: ["egg", "EGG", "Egg", "not_a_real_allergen_id"] → 결과:', JSON.stringify(messyAllergens));
assert.deepStrictEqual(messyAllergens, ['egg', 'EGG', 'Egg', 'not_a_real_allergen_id'], '구버전은 배열이기만 하면 내용 검증을 전혀 하지 않았음');
console.log('→ "egg"/"EGG"/"Egg"가 서로 다른 항목인 것처럼 3번 중복 집계되고, 실존하지 않는\n  id도 그대로 통과한다 — checkDishSafety의 unknownAllergenIds 로그에만 남고 수정되지 않음.\n');

console.log('--- 결함 3: dishes[] 배열 원소 중 하나라도 null이면 "그 요리만" 아니라 "배치 전체"가 날아감 ---');
const rawDishesWithNullEntry = [
  { name_ko: '김치찌개', name_en: 'Kimchi Jjigae', allergens: ['soybean'] },
  null, // 깨진 항목 하나
  { name_ko: '된장찌개', name_en: 'Doenjang Jjigae', allergens: ['soybean'] },
];
let crashed = false;
try {
  rawDishesWithNullEntry.map(OLD_DISH_MAP);
} catch (err) {
  crashed = true;
  console.log(`입력: [정상, null, 정상] 3개짜리 배열 → map() 도중 예외 발생: ${err.constructor.name}: ${err.message}`);
}
assert.strictEqual(crashed, true, 'null 원소가 섞이면 .map() 전체가 예외를 던져야 결함이 재현된 것');
console.log(
  '→ analyzeMenuPhotoWithAI() 전체가 try/catch로 감싸여 있어 페이지가 멈추진 않지만,\n' +
  '  catch 블록이 "AI 분석 실패" 토스트만 띄우고 끝나버린다 — 정상이었던 김치찌개/된장찌개\n' +
  '  2개까지 전부 화면에 안 보이게 된다("부분 응답 생존" 정책이 전혀 없었음).\n'
);

console.log('--- 결함 4: 서버가 Gemini 원본 응답을 전혀 검증하지 않고 그대로 통과시킴 ---');
console.log(
  '(git show HEAD:api/analyze-menu.js 마지막 try 블록 확인 결과)\n' +
  '  parsed = JSON.parse(content);\n' +
  '  res.status(200).json(parsed);  // ← 구조 검증 호출이 전혀 없음\n' +
  '→ 클라이언트가 결함 1~3을 전부 "원본 그대로" 받게 되는 근본 원인.\n'
);

console.log('=== 요약 ===');
console.log('재현된 결함 4건 — 전부 아래에서 IMP-02 수정 후 테스트(tests/imp-02-after.js)로 고쳐졌음을 확인한다.');
