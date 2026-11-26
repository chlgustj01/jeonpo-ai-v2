// tests/imp-11-after.js
//
// IMP-11 수정 "후" 테스트 (TC-11-01 ~ TC-11-14).
// tests/harness.js를 통해 실제 index.html 로직 + shared/allergens.js를
// 실제 브라우저 로드 순서 그대로 실행시켜 검증한다.

const assert = require('assert');
const path = require('path');
const { loadApp, pick } = require('./harness.js');

const INDEX_HTML = path.join(__dirname, '..', 'index.html');

const results = [];
function record(id, description, status, detail) {
  results.push({ id, description, status, detail });
  console.log(`[${status}] ${id} ${description}${detail ? ' — ' + detail : ''}`);
}
function tc(id, description, fn) {
  try {
    fn();
    record(id, description, 'PASS', '');
  } catch (e) {
    record(id, description, 'FAIL', e.message);
  }
}

function freshApp() {
  const { context } = loadApp(INDEX_HTML);
  return {
    context,
    ...pick(context, [
      'state', 'standardAllergens', 'locations', 'checkDishSafety',
      'LEGACY_ALLERGEN_ID_MAP', 'migrateLegacyAllergyIds',
      'saveProfileToStorage', 'loadProfileFromStorage',
      'translations', 'getSpeechScript', 'renderAllergiesGrid',
    ]),
  };
}

// ---------------------------------------------------------------------
// TC-11-01: 프론트엔드와 서버의 표준 ID 일치
// ---------------------------------------------------------------------
tc('TC-11-01', '프론트엔드(index.html)와 서버(api/analyze-menu.js)의 표준 ID 목록이 완전히 일치', () => {
  const { standardAllergens } = freshApp();
  // 서버 쪽 ALLOWED_ALLERGEN_IDS는 이제 shared/allergens.js에서 직접 파생되므로,
  // 그 공유 파일을 "서버 쪽 소스 오브 트루스"로 비교 대상에 쓴다.
  const serverRegistry = require('../shared/allergens.js');
  // 주의: standardAllergens는 vm Context(별도 JS realm)의 배열이라, host realm의
  // 배열과 그대로 deepStrictEqual하면 "구조는 같지만 Array 생성자가 다른 realm"
  // 이라는 이유로 실패한다(Node assert의 cross-realm 한계, R4와 동일 패턴).
  // host realm의 Array.from으로 감싸 host realm 배열로 변환한 뒤 비교한다.
  const frontendIds = Array.from(standardAllergens.map((a) => a.id)).sort();
  const serverIds = Array.from(serverRegistry.map((a) => a.id)).sort();
  assert.deepStrictEqual(frontendIds, serverIds);
});

// ---------------------------------------------------------------------
// TC-11-02 / TC-11-03: fish / sesame가 포함된 데모 데이터 정상 매칭
// ---------------------------------------------------------------------
tc('TC-11-02', "fish 교차접촉 알레르기가 selectedAllergies에 있으면 ORANGE로 정상 매칭", () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set(['fish']);
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: [], crossContactAllergens: ['fish'], spicy: 0 });
  assert.strictEqual(result.safetyState, 'orange');
  assert.strictEqual(result.isCrossContact, true);
});

tc('TC-11-03', "sesame 알레르기가 마라탕(malatang) 교차접촉 경고를 ORANGE로 정상 매칭", () => {
  const { state, locations, checkDishSafety } = freshApp();
  const malatang = locations.find((l) => l.matchedFoodObj && l.matchedFoodObj.foodId === 'malatang');
  state.selectedAllergies = new Set(['sesame']);
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety(malatang.matchedFoodObj);
  assert.strictEqual(result.safetyState, 'orange');
});

// ---------------------------------------------------------------------
// TC-11-04: 성분이 직접 포함된 경우 RED
// ---------------------------------------------------------------------
tc('TC-11-04', "allergens에 직접 포함된 성분(sesame)은 RED", () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set(['sesame']);
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: ['sesame'], crossContactAllergens: [], spicy: 0 });
  assert.strictEqual(result.safetyState, 'red');
});

// ---------------------------------------------------------------------
// TC-11-05: 교차 접촉 가능성이 명시된 경우 ORANGE (RED보다 낮은 단계)
// ---------------------------------------------------------------------
tc('TC-11-05', '직접 성분이 없고 교차접촉만 있는 경우 ORANGE (RED 아님)', () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set(['fish']);
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: ['soybean'], crossContactAllergens: ['fish'], spicy: 0 });
  assert.strictEqual(result.safetyState, 'orange');
});

// ---------------------------------------------------------------------
// TC-11-06: 어류(fish)와 갑각류(shellfish/shrimp/crab) 등 다른 분류를 잘못 매칭하지 않음
// ---------------------------------------------------------------------
tc('TC-11-06', "fish 알레르기만 있는 사용자는 shellfish만 포함된 음식에 반응하지 않음(과다 경고 방지)", () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set(['fish']);
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: [], crossContactAllergens: ['shellfish'], spicy: 0 });
  assert.strictEqual(result.safetyState, 'green');
});

tc('TC-11-06b', "shellfish 알레르기만 있는 사용자는 fish만 포함된 음식에 반응하지 않음(역방향도 확인)", () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set(['shellfish']);
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: [], crossContactAllergens: ['fish'], spicy: 0 });
  assert.strictEqual(result.safetyState, 'green');
});

// ---------------------------------------------------------------------
// TC-11-07: pineneut 기존 저장 데이터가 pinenut으로 정상 변환
// ---------------------------------------------------------------------
tc('TC-11-07', "레거시 pineneut 저장값이 pinenut으로 자동 변환됨", () => {
  const { migrateLegacyAllergyIds } = freshApp();
  const migration = migrateLegacyAllergyIds(['pineneut', 'shellfish']);
  assert.deepStrictEqual(Array.from(migration.ids), ['pinenut', 'shellfish']);
  assert.strictEqual(migration.changed, true);
});

// ---------------------------------------------------------------------
// TC-11-08: 마이그레이션 반복 실행 시 중복/손실 없음 (idempotent)
// ---------------------------------------------------------------------
tc('TC-11-08', '마이그레이션을 두 번 실행해도 결과가 같고 중복/손실이 없음', () => {
  const { migrateLegacyAllergyIds } = freshApp();
  const first = migrateLegacyAllergyIds(['pineneut', 'shellfish', 'pineneut']); // 중복 포함
  assert.deepStrictEqual(Array.from(first.ids), ['pinenut', 'shellfish']);
  assert.strictEqual(first.changed, true);

  const second = migrateLegacyAllergyIds(Array.from(first.ids));
  assert.deepStrictEqual(Array.from(second.ids), ['pinenut', 'shellfish']);
  assert.strictEqual(second.changed, false); // 이미 표준형이라 "변경 없음"이어야 idempotent
});

// ---------------------------------------------------------------------
// TC-11-09: 알 수 없는 ID가 미확인 정보로 유지됨 (삭제/무시되지 않음)
// ---------------------------------------------------------------------
tc('TC-11-09', "표준 목록에 없는 완전히 알 수 없는 id가 무시되지 않고 unknownAllergenIds에 보존됨", () => {
  // [IMP-03] 이 테스트는 원래 safetyState === 'green'을 기대했다 — IMP-11
  // 당시에는 "등록 안 된 id"가 안전 판정에 전혀 영향을 주지 않고 그냥 로그만
  // 남겼기 때문이다(코드 주석에도 "지금은 UI에서 아직 쓰지 않지만(IMP-03에서
  // 노출 예정)"이라고 이미 적혀 있었다). IMP-03이 "등록 성분이 발견되지
  // 않았더라도 안전하다고 표시하지 않는다"는 요구사항을 구현하면서, 미등록
  // id가 있으면(사용자 알레르기와 직접 일치하는 게 없어도) green에서
  // unknown으로 바뀐다 — "AI가 뭔가 언급했는데 우리가 모르는 것"은 안전
  // 확정이 아니기 때문이다.
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set();
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: ['msg_unknown'], crossContactAllergens: [], spicy: 0 });
  assert.strictEqual(result.safetyState, 'unknown');
  assert.deepStrictEqual(Array.from(result.unknownAllergenIds), ['msg_unknown']); // 값 자체는 버려지지 않아야 함
});

tc('TC-11-09b', '레거시 마이그레이션도 전혀 모르는 id는 삭제하지 않고 원본 그대로 보존', () => {
  const { migrateLegacyAllergyIds } = freshApp();
  const migration = migrateLegacyAllergyIds(['totally_unknown_id', 'shellfish']);
  assert.deepStrictEqual(Array.from(migration.ids), ['totally_unknown_id', 'shellfish']);
});

// ---------------------------------------------------------------------
// TC-11-10: 기존 6개 언어의 알레르기 UI 정상 작동 (번역 라벨 존재 확인)
// ---------------------------------------------------------------------
tc('TC-11-10', '6개 언어 모두에서 새 id(fish, sesame)와 기존 id(pinenut) 라벨이 정상 제공됨', () => {
  const { standardAllergens } = freshApp();
  const langs = ['ko', 'en', 'ja', 'zh', 'vi', 'es'];
  ['fish', 'sesame', 'pinenut', 'peanut', 'sulfites'].forEach((id) => {
    const entry = standardAllergens.find((a) => a.id === id);
    assert.ok(entry, `standardAllergens에 ${id}가 없음`);
    langs.forEach((lang) => {
      assert.ok(entry[lang] && entry[lang].length > 0, `${id}.${lang} 라벨이 비어있음`);
    });
  });
});

// ---------------------------------------------------------------------
// TC-11-11: 기존 프로필 저장 및 복원 정상 작동 (언어/국적/맵기/식이 보존)
// ---------------------------------------------------------------------
tc('TC-11-11', '프로필 저장 후 복원 시 언어/국적/맵기/식이/알레르기가 모두 그대로 복원됨', () => {
  const { context, state, saveProfileToStorage } = freshApp();
  state.lang = 'ja';
  state.dietary = 'vegan';
  state.nationality = 'Japan';
  state.selectedSpicy = 3;
  state.selectedAllergies = new Set(['sesame', 'fish', 'shellfish']);
  saveProfileToStorage();

  const raw = context.localStorage.getItem('fitbridge_profile_v1');
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.lang, 'ja');
  assert.strictEqual(parsed.dietary, 'vegan');
  assert.strictEqual(parsed.nationality, 'Japan');
  assert.strictEqual(parsed.selectedSpicy, 3);
  assert.deepStrictEqual(parsed.selectedAllergies.sort(), ['fish', 'sesame', 'shellfish'].sort());
  assert.strictEqual(parsed.schemaVersion, 2);
});

// ---------------------------------------------------------------------
// TC-11-12: 기존 TTS 문구 생성 정상 작동 (sesame 포함해도 깨지지 않음)
// ---------------------------------------------------------------------
tc('TC-11-12', "getSpeechScript가 sesame 커스텀 알레르기를 포함해도 정상적으로 한국어 문장을 생성", () => {
  const { state, getSpeechScript } = freshApp();
  state.selectedAllergies = new Set(['shellfish']);
  state.customAllergies = [{ original: 'Sesame', translated: '참깨' }];
  state.dietary = 'none';
  const script = getSpeechScript('마라탕');
  assert.ok(typeof script === 'string' && script.length > 0);
  assert.ok(script.includes('조개류')); // shellfish 표준 라벨
  assert.ok(script.includes('참깨'));   // 커스텀 알레르기 번역값
});

// ---------------------------------------------------------------------
// TC-11-13: 공통 데이터 로딩 실패 시 잘못된 위험도 안내를 제공하지 않음 (fail-closed)
// ---------------------------------------------------------------------
tc('TC-11-13', 'shared/allergens.js 로드 실패 시 checkDishSafety가 green으로 거짓 안심시키지 않고 fail-closed(error)로 처리', () => {
  // [IMP-03] 이 테스트는 원래 safetyState === 'red'를 기대했다. 그 당시 UI는
  // 3단계(red/orange/green)뿐이라 "판단 불가"를 가장 가까운 red로 임시
  // 대체했기 때문이다(이 사실 자체가 IMP-11 당시 index.html 주석에 "IMP-03에서
  // 전용 상태를 추가할 예정"이라고 이미 예고되어 있었다 — 우연한 회귀가 아니라
  // 예정된 변경). IMP-03이 RED(확정된 직접 위험)와 분리된 ERROR(안전 점검
  // 시스템 자체 고장) 상태를 추가하면서, 이 분기도 이제 'error'를 반환한다.
  const { context } = loadApp(INDEX_HTML, { skipAllergenRegistry: true }); // 레지스트리 로드를 의도적으로 건너뜀
  const { standardAllergens, checkDishSafety } = pick(context, ['standardAllergens', 'checkDishSafety']);
  assert.strictEqual(standardAllergens.length, 0); // 레지스트리가 없으니 표준 목록도 비어있어야 함(의도된 상태)

  // 사용자가 알레르기를 전혀 선택하지 않은 상태로, 원래라면 위험한 음식을 스캔
  const dangerousDish = { allergens: ['peanut'], crossContactAllergens: [], spicy: 0 };
  const result = checkDishSafety(dangerousDish);
  assert.notStrictEqual(result.safetyState, 'green'); // 데이터가 없는데 "안전"이라고 하면 안 됨
  assert.strictEqual(result.safetyState, 'error');
  assert.strictEqual(result.dataUnavailable, true);
});

// ---------------------------------------------------------------------
// TC-11-14: 기존 주요 기능 회귀 테스트
// ---------------------------------------------------------------------
tc('TC-11-14a', '[회귀] 기존에 정상이던 shellfish 직접 매칭(RED)이 계속 정상 동작', () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set(['shellfish']);
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: ['shellfish'], crossContactAllergens: [], spicy: 0 });
  assert.strictEqual(result.safetyState, 'red');
});

tc('TC-11-14b', '[회귀] 식이 제한(vegan) 위반 로직이 계속 정상 동작', () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set();
  state.dietary = 'vegan';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: ['pork'], crossContactAllergens: [], spicy: 0 });
  assert.strictEqual(result.safetyState, 'red');
});

tc('TC-11-14c', "[회귀+개선] vegan 식이 제한에 fish도 새로 포함되어 생선(액젓) 음식도 위반으로 잡힘", () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set();
  state.dietary = 'vegan';
  state.selectedSpicy = 3;
  const result = checkDishSafety({ allergens: ['fish'], crossContactAllergens: [], spicy: 0 });
  assert.strictEqual(result.safetyState, 'red');
});

tc('TC-11-14d', '[회귀] 맵기 레벨 초과 시 ORANGE 경고가 계속 정상 동작', () => {
  const { state, checkDishSafety } = freshApp();
  state.selectedAllergies = new Set();
  state.dietary = 'none';
  state.selectedSpicy = 0;
  const result = checkDishSafety({ allergens: [], crossContactAllergens: [], spicy: 3 });
  assert.strictEqual(result.safetyState, 'orange');
});

tc('TC-11-14e', '[회귀] locations 데모 데이터 14곳이 전부 정상 로드됨', () => {
  const { locations } = freshApp();
  assert.strictEqual(locations.length, 14);
});

tc('TC-11-14f', '[개선] 삼겹살(samgyeopsal) 데모 — fish 단독 선택만으로도 ORANGE (수정 전엔 불가능했음)', () => {
  const { state, locations, checkDishSafety } = freshApp();
  const samgyeopsal = locations.find((l) => l.matchedFoodObj && l.matchedFoodObj.foodId === 'samgyeopsal');
  state.selectedAllergies = new Set(['fish']); // shellfish는 선택 안 함 — fish 단독으로도 잡혀야 함
  state.dietary = 'none';
  state.selectedSpicy = 3;
  const result = checkDishSafety(samgyeopsal.matchedFoodObj);
  assert.strictEqual(result.safetyState, 'orange');
});

console.log('\n=== 요약 ===');
const summary = { PASS: 0, FAIL: 0, 'NOT RUN': 0 };
results.forEach((r) => (summary[r.status] = (summary[r.status] || 0) + 1));
console.log(summary);
process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
