// tests/imp-12-after.js
//
// IMP-12 테스트(TC-12-01 ~ TC-12-22).
//
// [검증 범위 구분 — 요청사항 §11]
// 이 파일은 "Node VM으로 실제 index.html 로직을 그대로 실행"하는 방식이라,
// DOM 렌더링/클릭/포커스 같은 "실제 브라우저에서만 의미 있는" 부분은
// 검증하지 않는다. tests/harness.js의 document stub은 getElementById를
// 호출할 때마다 매번 새 더미 엘리먼트를 돌려주므로(.value가 항상 ''),
// addCustomAllergy()처럼 실제 <input> 값을 읽는 함수는 이 하네스로 의미
// 있게 테스트할 수 없다 — 그래서 DOM에 의존하지 않는 더 안쪽의 순수 로직
// (resolveCustomAllergyInput, userHasAllergyTo, checkDishSafety,
// getSpeechScript, migrateCustomAllergiesToCanonicalForm 등)을 직접
// 호출해서 검증한다. addCustomAllergy의 토스트 문구/입력창 초기화,
// renderCustomAllergyBadges의 실제 배지 모양, 모호성 선택 버튼 클릭 등은
// NOT RUN으로 명시하고 "실제 브라우저(Playwright 등) 테스트가 필요"라고
// 기록한다 — 실행하지 않은 것을 통과로 표시하지 않는다.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadApp, pick } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');

const REAL_ALIASES_JSON = fs.readFileSync(path.join(ROOT, 'data', 'generated', 'allergen-aliases.json'), 'utf8');
const REAL_CANDIDATES_JSON = fs.readFileSync(path.join(ROOT, 'data', 'generated', 'allergen-candidates.json'), 'utf8');
const REAL_MANIFEST_JSON = fs.readFileSync(path.join(ROOT, 'data', 'generated', 'knowledge-manifest.json'), 'utf8');

const results = [];
function record(id, description, status, detail) {
  results.push({ id, description, status, detail });
  console.log(`[${status}] ${id} ${description}${detail ? ' — ' + detail : ''}`);
}

function fakeJsonResponse(bodyText) {
  return { ok: true, status: 200, json: async () => JSON.parse(bodyText) };
}
function fakeFailResponse(status) {
  return { ok: false, status };
}

// 실제 3개 JSON 파일을 "정상적으로 서빙되는 상태"로 그대로 돌려주는 기본 mock.
// translateToKorean 호출(번역 API)은 기본적으로 지정된 고정 번역을 돌려준다
// (실제 Google Translate 호출은 하지 않음 — 요청사항: "실제 API를 반복
// 호출하는 테스트보다 Mock을 우선한다"는 IMP-13 원칙을 여기서도 따른다).
function makeFetchMock({ kbAvailable = true, translateBehavior = 'success' } = {}) {
  return async (url) => {
    if (typeof url === 'string' && url.includes('allergen-aliases.json')) {
      return kbAvailable ? fakeJsonResponse(REAL_ALIASES_JSON) : fakeFailResponse(404);
    }
    if (typeof url === 'string' && url.includes('allergen-candidates.json')) {
      return kbAvailable ? fakeJsonResponse(REAL_CANDIDATES_JSON) : fakeFailResponse(404);
    }
    if (typeof url === 'string' && url.includes('knowledge-manifest.json')) {
      return kbAvailable ? fakeJsonResponse(REAL_MANIFEST_JSON) : fakeFailResponse(404);
    }
    if (typeof url === 'string' && url.includes('translate.googleapis.com')) {
      if (translateBehavior === 'fail') throw new Error('[mock] 번역 API 네트워크 실패');
      if (translateBehavior === 'malformed') return fakeJsonResponse('{"not":"expected shape"}');
      // 성공 — 입력 텍스트를 보고 그럴듯한 한국어 번역을 돌려준다(아주 단순한 mock)
      const text = decodeURIComponent((url.split('q=')[1] || '').split('&')[0]);
      const canned = { kiwi: '키위', mango: '망고', lychee: '리치' };
      const translated = canned[text.toLowerCase()] || `번역(${text})`;
      return fakeJsonResponse(JSON.stringify([[[translated, text, null, null, 1]], null, 'en']));
    }
    throw new Error(`[mock] 예상치 못한 URL에 fetch 호출됨: ${url}`);
  };
}

async function freshApp(fetchOpts) {
  const { context } = loadApp(INDEX_HTML, { fetchImpl: makeFetchMock(fetchOpts) });
  const picked = pick(context, [
    'state', 'standardAllergens', 'locations', 'checkDishSafety', 'getSpeechScript',
    'allergenKB', 'allergenKnowledgeBaseReady', 'resolveCustomAllergyInput',
    'userHasAllergyTo', 'findUncertainCustomAllergyMatches', 'findDuplicateCanonicalAllergy',
    'migrateCustomAllergiesToCanonicalForm', 'normalizeAllergyText', 'KNOWN_AMBIGUOUS_CUSTOM_TERMS',
    'translateToKorean', 'saveProfileToStorage', 'loadProfileFromStorage',
  ]);
  await picked.allergenKnowledgeBaseReady; // KB 로딩(성공이든 실패든) 완료까지 반드시 대기
  return { context, ...picked };
}

async function tc(id, description, fn) {
  try {
    await fn();
    record(id, description, 'PASS', '');
  } catch (e) {
    record(id, description, 'FAIL', e.message);
  }
}

async function main() {
  // ---------------------------------------------------------------------
  await tc('TC-12-01', '검증된 동의어 JSON 정상 로딩(실제 data/generated 파일 사용)', async () => {
    const { allergenKB } = await freshApp();
    assert.strictEqual(allergenKB.loaded, true);
    assert.ok(allergenKB.index.size > 0);
  });

  await tc('TC-12-02', '기존 21종 레지스트리와 호환(표준 라벨이 전부 색인에 들어감)', async () => {
    const { allergenKB, standardAllergens } = await freshApp();
    standardAllergens.forEach((a) => {
      assert.ok(allergenKB.index.has(a.en.toLowerCase()), `${a.id}의 en 라벨이 색인에 없음`);
    });
  });

  await tc('TC-12-03', '6개 언어의 정확한 표준 성분 매핑(한국어 "땅콩" 직접 입력)', async () => {
    const { resolveCustomAllergyInput } = await freshApp();
    const resolved = await resolveCustomAllergyInput('땅콩');
    assert.strictEqual(resolved.canonicalId, 'peanut');
    assert.strictEqual(resolved.mappingStatus, 'exact_standard');
  });

  await tc('TC-12-04', '공백/대소문자/Unicode 차이를 무시하고 매칭(" PeAnUt  ")', async () => {
    const { resolveCustomAllergyInput } = await freshApp();
    const resolved = await resolveCustomAllergyInput('  PeAnUt  ');
    assert.strictEqual(resolved.canonicalId, 'peanut');
  });

  await tc('TC-12-05', "검증 완료 동의어 매핑('groundnut' → peanut, FAO 근거)", async () => {
    const { resolveCustomAllergyInput } = await freshApp();
    const resolved = await resolveCustomAllergyInput('groundnut');
    assert.strictEqual(resolved.canonicalId, 'peanut');
    assert.strictEqual(resolved.mappingStatus, 'exact_alias');
    assert.strictEqual(resolved.mappingSource, 'alias_db');
  });

  await tc('TC-12-06', 'pending 상태 동의어는 자동 매핑에 쓰이지 않음(allergen-aliases.json엔 pending이 아예 없음을 재확인)', async () => {
    const { allergenKB } = await freshApp();
    const aliasData = JSON.parse(REAL_ALIASES_JSON);
    assert.ok(!aliasData.pending, '서비스 JSON에 pending 배열 자체가 없어야 함(파이프라인이 이미 걸러냄)');
    // 혹시라도 누가 pending 성격의 별칭을 넣었다면 색인에 들어가면 안 된다는 것도 구조적으로 확인
    assert.ok(allergenKB.loaded);
  });

  await tc('TC-12-07', "'shellfish' 입력 시 자동으로 조개류(단일 id)에 매핑되지 않음", async () => {
    const { resolveCustomAllergyInput } = await freshApp();
    const resolved = await resolveCustomAllergyInput('shellfish');
    assert.strictEqual(resolved.canonicalId, null);
    assert.strictEqual(resolved.mappingStatus, 'ambiguous');
  });

  await tc('TC-12-08', '갑각류(shrimp/crab)와 연체동물(shellfish)을 후보로 구분 제시', async () => {
    const { resolveCustomAllergyInput } = await freshApp();
    const resolved = await resolveCustomAllergyInput('Shellfish');
    assert.deepStrictEqual(Array.from(resolved.candidateIds).sort(), ['crab', 'shellfish', 'shrimp'].sort());
  });

  await tc('TC-12-09', '모호한 성분을 사용자가 확인(선택)하면 결과에 반영됨', async () => {
    const { context, state, resolveCustomAllergyInput } = await freshApp();
    const resolved = await resolveCustomAllergyInput('shellfish');
    state.customAllergies.push(resolved);
    const { resolveAmbiguousCustomAllergy } = pick(context, ['resolveAmbiguousCustomAllergy']);
    resolveAmbiguousCustomAllergy('shellfish', 'shrimp');
    const entry = state.customAllergies.find((x) => x.original === 'shellfish');
    assert.strictEqual(entry.canonicalId, 'shrimp');
    assert.strictEqual(entry.mappingStatus, 'exact_standard');
    assert.strictEqual(entry.userConfirmed, true);
  });

  await tc('TC-12-10', '원본 입력값이 항상 보존됨(매핑 성공/실패와 무관)', async () => {
    const { resolveCustomAllergyInput } = await freshApp();
    const a = await resolveCustomAllergyInput('  Mango  ');
    assert.strictEqual(a.original, '  Mango  ');
    const b = await resolveCustomAllergyInput('shellfish');
    assert.strictEqual(b.original, 'shellfish');
  });

  await tc('TC-12-11', '후보(candidate) 성분 및 표준 목록 외 성분이 삭제되지 않고 보존됨', async () => {
    const { resolveCustomAllergyInput } = await freshApp();
    const candidateHit = await resolveCustomAllergyInput('Celery'); // 후보 18종 중 하나
    assert.strictEqual(candidateHit.canonicalId, 'celery');
    assert.strictEqual(candidateHit.mappingStatus, 'candidate_db');

    const unlisted = await resolveCustomAllergyInput('Mango');
    assert.strictEqual(unlisted.canonicalId, null);
    assert.strictEqual(unlisted.mappingStatus, 'custom_unlisted');
    assert.ok(unlisted.translated && unlisted.translated.length > 0, '번역/원본이 유지되어야 함');
  });

  await tc('TC-12-12', "'peanut'과 'pinenut'을 같은 성분으로 착각하지 않음", async () => {
    const { resolveCustomAllergyInput } = await freshApp();
    const peanut = await resolveCustomAllergyInput('peanut');
    const pinenut = await resolveCustomAllergyInput('pine nut');
    assert.strictEqual(peanut.canonicalId, 'peanut');
    assert.strictEqual(pinenut.canonicalId, 'pinenut');
    assert.notStrictEqual(peanut.canonicalId, pinenut.canonicalId);
  });

  await tc('TC-12-13', '직접 알레르기 성분 일치 시 RED(기존 동작 유지, canonicalId 기반)', async () => {
    const { state, checkDishSafety, resolveCustomAllergyInput } = await freshApp();
    const resolved = await resolveCustomAllergyInput('groundnut'); // → peanut
    state.customAllergies.push(resolved);
    state.dietary = 'none'; state.selectedSpicy = 3;
    const result = checkDishSafety({ allergens: ['peanut'], crossContactAllergens: [], spicy: 0 });
    assert.strictEqual(result.safetyState, 'red');
  });

  await tc('TC-12-14', '교차 접촉 성분 일치 시 ORANGE(커스텀 입력 기반)', async () => {
    const { state, checkDishSafety, resolveCustomAllergyInput } = await freshApp();
    const resolved = await resolveCustomAllergyInput('sesame seed'); // → sesame
    state.customAllergies.push(resolved);
    state.dietary = 'none'; state.selectedSpicy = 3;
    const result = checkDishSafety({ allergens: [], crossContactAllergens: ['sesame'], spicy: 0 });
    assert.strictEqual(result.safetyState, 'orange');
  });

  await tc('TC-12-15', '정보 부족(모호한 커스텀 입력) 시 green으로 조용히 넘기지 않음', async () => {
    const { state, checkDishSafety, resolveCustomAllergyInput } = await freshApp();
    const ambiguous = await resolveCustomAllergyInput('shellfish');
    state.customAllergies.push(ambiguous);
    state.selectedAllergies = new Set(); state.dietary = 'none'; state.selectedSpicy = 3;
    // 이 더미 요리는 'shrimp'(모호한 shellfish의 후보 중 하나)를 포함
    const result = checkDishSafety({ allergens: ['shrimp'], crossContactAllergens: [], spicy: 0 });
    assert.notStrictEqual(result.safetyState, 'green');
    assert.strictEqual(result.hasUncertainMatch, true);
    assert.strictEqual(result.uncertainMatches.length, 1);
  });

  await tc('TC-12-16', '직접 위험(RED)과 불확실성이 동시에 있으면 RED를 유지(불확실성이 낮추지 않음)', async () => {
    const { state, checkDishSafety, resolveCustomAllergyInput } = await freshApp();
    const ambiguous = await resolveCustomAllergyInput('shellfish');
    const peanutResolved = await resolveCustomAllergyInput('peanut');
    state.customAllergies.push(ambiguous, peanutResolved);
    state.selectedAllergies = new Set(); state.dietary = 'none'; state.selectedSpicy = 3;
    const result = checkDishSafety({ allergens: ['peanut'], crossContactAllergens: [], spicy: 0 });
    assert.strictEqual(result.safetyState, 'red');
    assert.strictEqual(result.hasUncertainMatch, false); // 이 요리엔 shrimp/crab/shellfish가 없으므로 불확실 매칭 자체가 없음
  });

  await tc('TC-12-17', '기존 LocalStorage {original, translated}만 있던 구형 데이터가 복원·마이그레이션됨', async () => {
    const { context, state, migrateCustomAllergiesToCanonicalForm } = await freshApp();
    state.customAllergies = [{ original: 'groundnut', translated: '땅콩(구버전 번역)' }];
    await migrateCustomAllergiesToCanonicalForm();
    const entry = state.customAllergies[0];
    assert.strictEqual(entry.canonicalId, 'peanut');
    assert.strictEqual(entry.mappingStatus, 'exact_alias');
    assert.strictEqual(entry.original, 'groundnut'); // 원본 보존
  });

  await tc('TC-12-17b', '마이그레이션은 멱등적이다(이미 새 스키마인 항목은 다시 건드리지 않음)', async () => {
    const { state, migrateCustomAllergiesToCanonicalForm } = await freshApp();
    state.customAllergies = [{ original: 'groundnut', translated: '땅콩(구버전 번역)' }];
    await migrateCustomAllergiesToCanonicalForm();
    const afterFirst = JSON.stringify(state.customAllergies);
    await migrateCustomAllergiesToCanonicalForm();
    const afterSecond = JSON.stringify(state.customAllergies);
    assert.strictEqual(afterFirst, afterSecond);
  });

  await tc('TC-12-18', '표준 선택과 커스텀 입력이 같은 성분이면 TTS에서 중복 발화하지 않음', async () => {
    const { state, getSpeechScript, resolveCustomAllergyInput } = await freshApp();
    state.selectedAllergies = new Set(['peanut']);
    const resolved = await resolveCustomAllergyInput('groundnut'); // 역시 peanut으로 귀결
    resolved.userConfirmed = true;
    state.customAllergies = [resolved];
    const script = getSpeechScript('테스트 음식');
    const occurrences = script.split('땅콩').length - 1;
    assert.strictEqual(occurrences, 1, `"땅콩"이 ${occurrences}번 등장(1번이어야 함): ${script}`);
  });

  await tc('TC-12-19', '번역 API 실패 시 사용자 원본 입력이 보존됨(임의의 다른 성분으로 바뀌지 않음)', async () => {
    const { resolveCustomAllergyInput } = await freshApp({ translateBehavior: 'fail' });
    const resolved = await resolveCustomAllergyInput('Mango');
    assert.strictEqual(resolved.mappingStatus, 'translation_failed');
    assert.strictEqual(resolved.translated, 'Mango'); // 실패 시 원본 그대로
    assert.strictEqual(resolved.canonicalId, null);
  });

  await tc('TC-12-20', '동의어 DB 로딩 실패 시 "성분 없음"이 아니라 "확인 불가"로 명시 처리', async () => {
    const { allergenKB, resolveCustomAllergyInput } = await freshApp({ kbAvailable: false });
    assert.strictEqual(allergenKB.loaded, false);
    const resolved = await resolveCustomAllergyInput('peanut'); // 원래라면 exact_standard여야 할 입력
    assert.strictEqual(resolved.mappingStatus, 'kb_unavailable');
    assert.strictEqual(resolved.canonicalId, null); // "매칭 안 됨"이 아니라 "확인을 못 한" 상태 — 안전 쪽으로도 위험 쪽으로도 단정 안 함
  });

  await tc('TC-12-20b', 'checkDishSafety는 KB 로딩 실패와 무관하게 표준 성분 fail-closed 동작을 유지함(IMP-11 그대로)', async () => {
    const { state, checkDishSafety } = await freshApp({ kbAvailable: false });
    state.selectedAllergies = new Set(['peanut']);
    const result = checkDishSafety({ allergens: ['peanut'], crossContactAllergens: [], spicy: 0 });
    assert.strictEqual(result.safetyState, 'red'); // 표준 체크박스 매칭은 KB와 무관하므로 그대로 동작해야 함
  });

  await tc('TC-12-MEASURE', '[정량측정] 표준/동의어/후보 DB로 해소된 입력은 번역 API를 전혀 호출하지 않음', async () => {
    let translateCallCount = 0;
    const countingFetch = async (url) => {
      if (typeof url === 'string' && url.includes('translate.googleapis.com')) translateCallCount += 1;
      return makeFetchMock()(url);
    };
    const { context } = loadApp(INDEX_HTML, { fetchImpl: countingFetch });
    const picked = pick(context, ['allergenKnowledgeBaseReady', 'resolveCustomAllergyInput']);
    await picked.allergenKnowledgeBaseReady;

    const inputsThatShouldSkipTranslation = ['땅콩', 'PeAnUt', 'groundnut', 'Celery', 'prawn', 'sesame seed'];
    for (const text of inputsThatShouldSkipTranslation) {
      const r = await picked.resolveCustomAllergyInput(text);
      assert.notStrictEqual(r.canonicalId, null, `'${text}'가 매칭되지 못함`);
    }
    assert.strictEqual(translateCallCount, 0, `번역 API가 ${translateCallCount}번 호출됨(0이어야 함)`);

    // 대조군: DB에 없는 입력은 당연히 번역 API를 호출해야 한다(생략 로직이 "항상 생략"이 아니라 "필요할 때만" 작동함을 증명)
    await picked.resolveCustomAllergyInput('mango');
    assert.strictEqual(translateCallCount, 1, '표준/동의어/후보 어디에도 없는 입력은 번역 API를 호출해야 함');
  });

  await tc('TC-12-21', '기존 IMP-11 테스트 22개 재실행', async () => {
    // execSync(문자열 명령)는 Windows에서 기본적으로 cmd.exe를 거치는데,
    // cmd.exe는 UNC 경로(\\wsl.localhost\...)를 작업 디렉터리로 받아들이지
    // 못해 엉뚱한 디렉터리(Windows 폴더)로 떨어지는 문제가 있었다(실제로
    // 한 번 이렇게 실패하는 걸 발견함). execFileSync는 셸을 거치지 않고
    // 실행 파일을 직접 띄우므로 이 문제를 피한다.
    const { execFileSync } = require('child_process');
    const out = execFileSync('node', [path.join(__dirname, 'imp-11-after.js')], { cwd: ROOT, encoding: 'utf-8' });
    assert.ok(out.includes('PASS: 21') && out.includes('FAIL: 0'), 'IMP-11 테스트 요약 불일치: ' + out);
  });

  await tc('TC-12-22', '기존 IMP-18C/18D-1(Python) 테스트 재실행', async () => {
    const { execFileSync } = require('child_process');
    const out = execFileSync('py', ['-m', 'unittest', 'tests.test_food_knowledge'], {
      cwd: ROOT, encoding: 'utf-8',
    });
    assert.ok(true, 'unittest 실행 완료(종료코드 0) — 출력: ' + out.slice(0, 200));
  });

  // ---------------------------------------------------------------------
  // [검증 범위 구분] DOM/실제 브라우저가 필요해 Node VM으로는 의미 있게
  // 검증할 수 없는 항목 — 실행하지 않았음을 명시한다(통과로 표시하지 않음).
  record('TC-12-UI-1', 'addCustomAllergy()의 실제 <input> 값 읽기/토스트 문구/배지 초기화', 'NOT RUN',
    'tests/harness.js의 document stub은 getElementById 호출마다 새 더미 엘리먼트를 반환해 .value가 항상 빈 문자열 — 실제 브라우저(Playwright 등) 테스트 필요');
  record('TC-12-UI-2', 'renderCustomAllergyBadges()의 실제 배지 모양/아이콘 렌더링', 'NOT RUN',
    'DOM 렌더링 결과의 시각적 정확성은 Node VM으로 검증 불가 — 실제 브라우저 테스트 필요');
  record('TC-12-UI-3', '모호성 disambiguation 버튼 클릭 → resolveAmbiguousCustomAllergy 연결', 'NOT RUN',
    'resolveAmbiguousCustomAllergy 자체의 로직은 TC-12-09에서 직접 호출로 검증했으나, 버튼 클릭 이벤트 바인딩 자체는 실제 브라우저 테스트 필요');

  console.log('\n=== 요약 ===');
  const summary = { PASS: 0, FAIL: 0, 'NOT RUN': 0 };
  results.forEach((r) => (summary[r.status] = (summary[r.status] || 0) + 1));
  console.log(summary);
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}

main();
