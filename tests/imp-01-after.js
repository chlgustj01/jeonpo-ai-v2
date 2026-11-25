// tests/imp-01-after.js
//
// IMP-01 테스트(TC-01-01 ~ TC-01-20).
//
// [검증 범위 구분] 이 파일은 Node VM으로 index.html의 실제 로직
// (normalizeSpicy/checkDishSafety/getSpicyDisplayLabel)을 그대로 실행해서
// 검증한다. 화면에 실제로 어떤 픽셀/DOM 노드가 그려지는지는 검증하지
// 않는다 — tests/harness.js의 document stub은 getElementById 호출마다
// 새 더미를 돌려주므로 "실제 배지에 'undefined' 글자가 안 보이는지"
// 자체는 이 하네스로 확인할 수 없고, 그 대신 "getSpicyDisplayLabel이
// 반환하는 문자열 자체에 'undefined'가 없는지"를 직접 확인하는 방식으로
// 같은 결함을 더 아래 단계에서 가로막는다. DOM 렌더링 자체는 NOT RUN으로
// 명시한다.
//
// "테스트 케이스 개수"와 "실행한 assertion 개수"를 혼동하지 않기 위해,
// 각 TC 안에서 실제로 몇 개의 assert를 실행했는지도 함께 기록한다.

const assert = require('assert');
const path = require('path');
const { loadApp, pick } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');

const results = [];
function record(id, description, status, detail) {
  results.push({ id, description, status, detail });
  console.log(`[${status}] ${id} ${description}${detail ? ' — ' + detail : ''}`);
}

let totalAssertions = 0;
const originalAssertions = {
  strictEqual: assert.strictEqual,
  notStrictEqual: assert.notStrictEqual,
  ok: assert.ok,
  deepStrictEqual: assert.deepStrictEqual,
};
// 실제로 실행된 assert 호출 수를 세기 위한 아주 얕은 계측(assert 모듈
// 자체를 바꾸지 않고, 이 파일 안에서 호출 횟수만 센다).
function countedAssert(fn) {
  return (...args) => {
    totalAssertions += 1;
    return fn(...args);
  };
}
const A = {
  strictEqual: countedAssert(originalAssertions.strictEqual),
  notStrictEqual: countedAssert(originalAssertions.notStrictEqual),
  ok: countedAssert(originalAssertions.ok),
  deepStrictEqual: countedAssert(originalAssertions.deepStrictEqual),
};

function freshApp() {
  const { context } = loadApp(INDEX_HTML);
  return pick(context, [
    'state', 'standardAllergens', 'locations', 'checkDishSafety',
    'normalizeSpicy', 'SPICY_VALIDATION_STATUS', 'getSpicyDisplayLabel',
    'translations',
  ]);
}

function tc(id, description, fn) {
  try {
    fn();
    record(id, description, 'PASS', '');
  } catch (e) {
    record(id, description, 'FAIL', e.message);
  }
}

// ---------------------------------------------------------------------
// TC-01-01~10: normalizeSpicy 입력 행렬 전수 검사
// ---------------------------------------------------------------------
tc('TC-01-01', "0이 정상값(valid)으로 유지됨", () => {
  const { normalizeSpicy, SPICY_VALIDATION_STATUS } = freshApp();
  const r = normalizeSpicy(0);
  A.strictEqual(r.value, 0);
  A.strictEqual(r.status, SPICY_VALIDATION_STATUS.VALID);
});

tc('TC-01-02', "1~3의 유효한 맵기 값 유지", () => {
  const { normalizeSpicy, SPICY_VALIDATION_STATUS } = freshApp();
  [1, 2, 3].forEach((v) => {
    const r = normalizeSpicy(v);
    A.strictEqual(r.value, v);
    A.strictEqual(r.status, SPICY_VALIDATION_STATUS.VALID);
  });
});

tc('TC-01-03', "null이 0으로 변환되지 않음(missing으로 분류)", () => {
  const { normalizeSpicy, SPICY_VALIDATION_STATUS } = freshApp();
  const r = normalizeSpicy(null);
  A.strictEqual(r.value, null);
  A.notStrictEqual(r.value, 0);
  A.strictEqual(r.status, SPICY_VALIDATION_STATUS.MISSING);
});

tc('TC-01-04', "undefined 및 누락 필드 처리(missing)", () => {
  const { normalizeSpicy, SPICY_VALIDATION_STATUS } = freshApp();
  const r1 = normalizeSpicy(undefined);
  A.strictEqual(r1.status, SPICY_VALIDATION_STATUS.MISSING);
  const obj = {}; // 필드 자체가 없는 경우 — 구조분해/속성 접근 시 undefined로 들어옴
  const r2 = normalizeSpicy(obj.spicy);
  A.strictEqual(r2.status, SPICY_VALIDATION_STATUS.MISSING);
});

tc('TC-01-05', "NaN 및 Infinity 처리(non_integer)", () => {
  const { normalizeSpicy, SPICY_VALIDATION_STATUS } = freshApp();
  A.strictEqual(normalizeSpicy(NaN).status, SPICY_VALIDATION_STATUS.NON_INTEGER);
  A.strictEqual(normalizeSpicy(Infinity).status, SPICY_VALIDATION_STATUS.NON_INTEGER);
  A.strictEqual(normalizeSpicy(-Infinity).status, SPICY_VALIDATION_STATUS.NON_INTEGER);
  A.strictEqual(normalizeSpicy(NaN).value, null);
});

tc('TC-01-06', "음수 처리(out_of_range, 0으로 클램핑하지 않음)", () => {
  const { normalizeSpicy, SPICY_VALIDATION_STATUS } = freshApp();
  const r = normalizeSpicy(-1);
  A.strictEqual(r.status, SPICY_VALIDATION_STATUS.OUT_OF_RANGE);
  A.strictEqual(r.value, null); // 0으로 조용히 바뀌지 않음(기존 버그였던 지점)
});

tc('TC-01-07', "3을 초과하는 값 처리(out_of_range, 3으로 클램핑하지 않음)", () => {
  const { normalizeSpicy, SPICY_VALIDATION_STATUS } = freshApp();
  const r = normalizeSpicy(5);
  A.strictEqual(r.status, SPICY_VALIDATION_STATUS.OUT_OF_RANGE);
  A.strictEqual(r.value, null); // 기존엔 3으로 조용히 바뀌었음(재현 스크립트 참고)
});

tc('TC-01-08', "소수 처리 정책 검증(non_integer, 반올림하지 않음)", () => {
  const { normalizeSpicy, SPICY_VALIDATION_STATUS } = freshApp();
  const r = normalizeSpicy(1.7);
  A.strictEqual(r.status, SPICY_VALIDATION_STATUS.NON_INTEGER);
  A.strictEqual(r.value, null); // 기존엔 Math.round(1.7)=2로 조용히 바뀌었음
});

tc('TC-01-09', "숫자형 문자열 처리 정책 검증(invalid_type, 자동 변환하지 않음)", () => {
  const { normalizeSpicy, SPICY_VALIDATION_STATUS } = freshApp();
  const r = normalizeSpicy('2');
  A.strictEqual(r.status, SPICY_VALIDATION_STATUS.INVALID_TYPE);
  A.strictEqual(r.value, null); // Number('2')=2로 자동 변환하지 않음(의도적 정책)
});

tc('TC-01-10', "빈 문자열, 배열, 객체 처리(invalid_type)", () => {
  const { normalizeSpicy, SPICY_VALIDATION_STATUS } = freshApp();
  ['', [2], {}, [], 'spicy'].forEach((v) => {
    const r = normalizeSpicy(v);
    A.strictEqual(r.status, SPICY_VALIDATION_STATUS.INVALID_TYPE, `입력 ${JSON.stringify(v)}`);
    A.strictEqual(r.value, null);
  });
});

// ---------------------------------------------------------------------
// TC-01-11~16: checkDishSafety / 렌더링 일관성
// ---------------------------------------------------------------------
tc('TC-01-11', "정상 맵기가 사용자 허용 수준을 초과할 때 ORANGE(기존 동작 유지)", () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set();
  state.customAllergies = [];
  state.dietary = 'none';
  state.selectedSpicy = 0;
  const result = checkDishSafety({ allergens: [], crossContactAllergens: [], spicy: 3 });
  A.strictEqual(result.safetyState, 'orange');
  A.strictEqual(result.hasUnknownSpicy, false);
});

tc('TC-01-12', "맵기 미확인 상태에서 정상값(green)으로 오인하지 않음", () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set();
  state.customAllergies = [];
  state.dietary = 'none';
  state.selectedSpicy = 3; // 가장 매운 것까지 허용하는 사용자라도
  const result = checkDishSafety({ allergens: [], crossContactAllergens: [], spicy: null });
  A.notStrictEqual(result.safetyState, 'green'); // 맵기를 몰라서 green일 수 없음
  A.strictEqual(result.safetyState, 'orange');
  A.strictEqual(result.hasUnknownSpicy, true);
});

tc('TC-01-13', "직접 알레르기 위험(RED)과 맵기 미확인이 동시에 있으면 RED 유지", () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set(['peanut']);
  state.customAllergies = [];
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: ['peanut'], crossContactAllergens: [], spicy: null });
  A.strictEqual(result.safetyState, 'red');
  A.strictEqual(result.hasUnknownSpicy, true); // RED로 가려졌어도 사실 자체는 보존됨
});

tc('TC-01-14', "교차 접촉 경고(ORANGE)와 맵기 미확인 정보가 동시에 유지됨", () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set(['sesame']);
  state.customAllergies = [];
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: [], crossContactAllergens: ['sesame'], spicy: null });
  A.strictEqual(result.safetyState, 'orange');
  A.strictEqual(result.isCrossContact, true);
  A.strictEqual(result.hasUnknownSpicy, true); // 두 정보 다 사라지지 않음
});

tc('TC-01-15', "여러 음식 중 일부의 맵기 정보가 누락된 경우에도 그 사실이 개별적으로 보존됨", () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set(['peanut']); // 두 번째 요리만 RED를 유발
  state.customAllergies = [];
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const dishes = [
    { nameKo: '요리1(맵기미확인)', allergens: [], crossContactAllergens: [], spicy: null },
    { nameKo: '요리2(땅콩,RED유발)', allergens: ['peanut'], crossContactAllergens: [], spicy: 1 },
  ];
  // renderMultiDishScanResult와 동일한 집계 로직(전체 중 최악 상태를 overall로)
  const severityRank = { green: 0, orange: 1, red: 2 };
  let overall = { safetyState: 'green' };
  const perDish = dishes.map((d) => {
    const r = checkDishSafety(d);
    if (severityRank[r.safetyState] > severityRank[overall.safetyState]) overall = r;
    return { dish: d, result: r };
  });
  A.strictEqual(overall.safetyState, 'red'); // 전체 배너는 요리2 때문에 RED
  // 그렇다고 요리1의 "맵기 미확인" 사실 자체가 사라지면 안 됨(개별 결과에 남아있어야 함)
  A.strictEqual(perDish[0].result.hasUnknownSpicy, true);
  A.strictEqual(perDish[1].result.hasUnknownSpicy, false);
});

tc('TC-01-16', "지도 데모 음식(정수 spicy)과 AI 결과(null 가능)가 같은 함수로 표시되어 일관됨", () => {
  const { locations, getSpicyDisplayLabel, state } = freshApp();
  state.lang = 'en';
  const samgyeopsal = locations.find((l) => l.matchedFoodObj && l.matchedFoodObj.foodId === 'samgyeopsal');
  A.strictEqual(typeof samgyeopsal.matchedFoodObj.spicy, 'number'); // 데모 데이터는 항상 정수
  const demoLabel = getSpicyDisplayLabel(samgyeopsal.matchedFoodObj.spicy);
  A.ok(demoLabel && demoLabel.indexOf('undefined') === -1);
  const aiUnknownLabel = getSpicyDisplayLabel(null); // AI가 못 정한 경우
  A.ok(aiUnknownLabel && aiUnknownLabel.indexOf('undefined') === -1);
  A.notStrictEqual(demoLabel, aiUnknownLabel); // 서로 다른 상태는 서로 다른 문구여야 함
});

// ---------------------------------------------------------------------
// TC-01-17: 6개 언어
// ---------------------------------------------------------------------
tc('TC-01-17', "기존 6개 언어 전부에서 맵기 표시 문구가 비어있지 않고, null일 때도 undefined가 찍히지 않음", () => {
  const { state, getSpicyDisplayLabel } = freshApp();
  ['ko', 'en', 'ja', 'zh', 'vi', 'es'].forEach((lang) => {
    state.lang = lang;
    [0, 1, 2, 3, null, undefined].forEach((v) => {
      const label = getSpicyDisplayLabel(v);
      A.ok(typeof label === 'string' && label.length > 0, `lang=${lang} value=${v}`);
      A.ok(label.indexOf('undefined') === -1, `lang=${lang} value=${v} -> "${label}"`);
    });
  });
});

// ---------------------------------------------------------------------
// TC-01-18~20: 회귀
// ---------------------------------------------------------------------
tc('TC-01-18', "기존 IMP-11 테스트 22개 재실행", () => {
  const { execFileSync } = require('child_process');
  const out = execFileSync('node', [path.join(__dirname, 'imp-11-after.js')], { cwd: ROOT, encoding: 'utf-8' });
  A.ok(out.includes('PASS: 21') && out.includes('FAIL: 0'), out);
});

tc('TC-01-19', "기존 IMP-12 테스트 재실행", () => {
  const { execFileSync } = require('child_process');
  const out = execFileSync('node', [path.join(__dirname, 'imp-12-after.js')], { cwd: ROOT, encoding: 'utf-8' });
  A.ok(out.includes('PASS: 25') && out.includes('FAIL: 0'), out);
});

tc('TC-01-20', "기존 ETL 및 지식 DB(Python, IMP-18C/18D-1) 테스트 재실행", () => {
  const { execFileSync } = require('child_process');
  const out = execFileSync('py', ['-m', 'unittest', 'tests.test_food_knowledge'], { cwd: ROOT, encoding: 'utf-8' });
  A.ok(true, 'unittest 종료코드 0 — 출력: ' + out.slice(0, 100));
});

// ---------------------------------------------------------------------
// [검증 범위 구분] DOM/브라우저 전용 — Node VM으로 의미 있게 검증 불가
// ---------------------------------------------------------------------
record('TC-01-DOM-1', '실제 화면에서 맵기 배지에 undefined 텍스트가 보이지 않는지', 'NOT RUN',
  'tests/harness.js의 document stub은 실제 렌더링 결과를 보존하지 않음 — getSpicyDisplayLabel()의 반환값 자체는 TC-01-16/17로 검증, 실제 DOM 반영은 브라우저 테스트 필요');
record('TC-01-DOM-2', '위험도 배너의 실제 시각적 표시(색상/아이콘)', 'NOT RUN',
  '배너 문구/상태 로직은 checkDishSafety 반환값으로 검증, 실제 렌더링은 브라우저 테스트 필요');

console.log('\n=== 요약 ===');
const summary = { PASS: 0, FAIL: 0, 'NOT RUN': 0 };
results.forEach((r) => (summary[r.status] = (summary[r.status] || 0) + 1));
console.log(summary);
console.log(`실행한 assertion 총 개수: ${totalAssertions}건 (테스트 케이스 수와는 별개 지표)`);
process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
