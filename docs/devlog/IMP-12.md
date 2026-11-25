# IMP-12 — 지식 DB 기반 커스텀 알레르기 매칭 개선

> 브랜치: `v2-dev` / 기준 커밋: `cb33752`(IMP-18D-1 완료)
> `main`/원격 저장소 무변경. `shared/allergens.js`, `api/analyze-menu.js`,
> `dev-server.js`, `data/master/`, `data/generated/`는 **읽기만** 했고
> 한 바이트도 바꾸지 않았다 — 이번 작업은 "이미 만들어진 데이터를 서비스에
> 연결"하는 것이지 데이터를 다시 만드는 것이 아니다.

---

## 1. 기존 문제 및 데이터 확인 결과

IMP-18D-1까지 완료된 `data/generated/allergen-aliases.json`(검증된 동의어
14건), `allergen-candidates.json`(후보 18종)이 **서비스 코드 어디에서도
읽히지 않고 있었다.** `addCustomAllergy()`는 여전히 사용자가 뭘 입력하든
무조건 비공식 Google Translate 엔드포인트로 번역부터 하고, 그 번역 결과가
표준 알레르기 한국어 라벨과 "글자 하나까지 똑같은지"만 비교했다
(`checkDishSafety`의 `x.translated === standardItem.ko`) — 번역 품질이
조금만 흔들려도(예: "참깨" vs "참깨류") 매칭이 깨지는 구조였다.

## 2. 실제 조사 대상 (파일 확인)

- `shared/allergens.js`: 21종, 각 `{id, legacyIds, labels, icon}` — 변경 없음.
- `data/generated/allergen-aliases.json`: `{reviewed:[], literatureBacked:[14건], note}` —
  `reviewed`가 빈 배열인 것도 실제로 확인(IMP-18D-1의 알려진 결과 그대로).
- `data/generated/allergen-candidates.json`: 18건, 각 `{id, labels:{ko,en,...}, icon,
  autoApplyToRiskJudgment:false, ...}`.
- `data/generated/knowledge-manifest.json`: `schemaVersion: "1.0.0"`, `dataVersion`,
  `recordCounts` — 실제 파일에서 그대로 읽음.
- `addCustomAllergy()`(`index.html:2548` 부근), `translateToKorean()`,
  `checkDishSafety()`(두 곳의 `x.translated === standardItem.ko`),
  `getSpeechScript()`, `loadProfileFromStorage`/`saveProfileToStorage`,
  `migrateLegacyAllergyIds` — 전부 실제 줄 번호를 확인한 뒤 수정했다.

## 3. 조사 자료 및 출처

이번 단계는 "새 문헌 조사"가 아니라 "이미 확보한 데이터 연결"이라, 신규
외부 출처는 없다. 유일한 참고는 IMP-18D-1의 발견 — **"shellfish"가 영어권
에서 갑각류를 뜻하는 경우가 흔한데, 우리 `shellfish` id는 한국 식품공전에
따라 연체동물(조개류)만 가리킨다**(§6에서 그대로 구현).

## 4. 검증 방법 — 데이터 파이프라인 연동 설계

| 항목 | 결정 |
|---|---|
| 브라우저에서 JSON을 읽는 방식 | `fetch('data/generated/*.json')` — 3개 파일(aliases/candidates/manifest)을 `Promise.all`로 병렬 로드. `dev-server.js`가 IMP-11에서 이미 추가한 범용 정적 파일 핸들러(.json 포함)로 그대로 서빙됨을 실제 HTTP 요청으로 확인(status 200) |
| Node.js/Vercel에서의 활용 | **검토만 하고 연동하지 않음.** IMP-12는 "사용자가 입력한 커스텀 텍스트"를 다루는 순수 브라우저 기능이라 서버(API)가 이 동의어 데이터를 쓸 이유가 지금은 없다 — Gemini 스키마 변경은 이번 범위에서 명시적으로 제외됐다(§13) |
| 비동기 로딩/초기화 순서 | `const allergenKnowledgeBaseReady = loadAllergenKnowledgeBase();`를 스크립트 최상단(온로드를 기다리지 않음)에 선언해 즉시 fetch 시작. `addCustomAllergy()`/마이그레이션 둘 다 이 Promise를 `await`해 race condition을 구조적으로 제거 |
| 로딩 실패 처리 | 실패해도 `allergenKB.loaded=false`로 **조용히** 남고, `resolveCustomAllergyInput()`이 `mappingStatus:'kb_unavailable'`을 명시적으로 돌려준다 — "매칭 안 됨(성분 없음)"이 아니라 "확인을 못 했음"으로 구분(TC-12-20) |
| schemaVersion 호환성 | `knowledge-manifest.json.schemaVersion`이 코드가 기대하는 `'1.0.0'`과 다르면 로딩 자체를 실패로 처리(구조가 바뀐 데이터를 잘못 해석하는 것보다 안전) |
| `shared/allergens.js`와의 책임 구분 | **활성 21종의 id/라벨은 여전히 `shared/allergens.js`(→`standardAllergens`)가 유일한 소스.** 새로 연동한 JSON은 ①검증된 "동의어"(aliases)와 ②"후보 성분"(candidates) 정보만 추가로 제공 — 21종 자체의 정의를 대체하지 않는다 |

## 5. 커스텀 알레르기 데이터 구조 (§5 요청 필드 그대로 구현)

```js
// 기존: { original, translated }
// 신규:
{
  original,       // 사용자가 입력한 그대로(불변)
  normalized,     // NFC 정규화 + trim + lowercase
  translated,     // 화면/TTS 표시용 한국어(또는 원문)
  canonicalId,    // 정규 식별자(매칭 성공 시만), 그 외엔 null
  mappingStatus,  // 'exact_standard'|'exact_alias'|'ambiguous'|'candidate_db'
                  // |'custom_unlisted'|'translation_failed'|'kb_unavailable'
  mappingSource,  // 'standard_label'|'legacy_id'|'alias_db'|'candidate_db'
                  // |'ambiguous_term_table'|'user_confirmed_disambiguation'|null
  candidateIds,   // mappingStatus==='ambiguous'일 때만 채워짐
  userConfirmed,  // 정확 일치=true, 모호한데 아직 선택 안 함=false
  dataVersion,    // 매칭 당시 knowledge-manifest.json의 dataVersion
}
```
A~E 분류는 `mappingStatus`로 그대로 표현된다(`exact_standard`/`exact_alias`=A/B,
`ambiguous`=C, `candidate_db`/`custom_unlisted`=D, `translation_failed`=E).

## 6. Shellfish 의미 모호성 처리

```js
const KNOWN_AMBIGUOUS_CUSTOM_TERMS = {
  shellfish: { candidateIds: ['shrimp', 'crab', 'shellfish'], explanation: '...' },
};
```
`resolveCustomAllergyInput()`은 **이 검사를 다른 무엇보다 먼저** 한다 —
우리 자신의 `standardAllergens`의 `en` 라벨이 글자 그대로 "Shellfish"라서,
이 검사가 없으면 "완전 일치"로 둔갑해버리기 때문이다(IMP-18D-1에서 발견한
문제의 근본 원인을 그대로 코드화). 기존 `shellfish` id의 의미는 전혀
바꾸지 않았다 — 그 id가 "조개류(연체동물)"를 뜻한다는 사실은 그대로 두고,
**"shellfish"라는 입력 텍스트 쪽을 더 이상 그 id에 자동으로 연결하지 않을
뿐**이다(기존 LocalStorage에 이미 저장된 `shellfish` id 데이터는 전혀
건드리지 않음 — TC-12-07/08로 확인).

상위 분류(갑각류 전체/연체동물 전체)를 표현하는 새 id는 만들지 않았다 —
대신 모호한 입력은 `candidateIds:['shrimp','crab','shellfish']`(전부 이미
존재하는 실제 id)로 제시하고, 사용자가 `resolveAmbiguousCustomAllergy()`를
통해 **직접 하나를 선택**하게 한다(Human-in-the-loop, 아래 §12 설명 참고).

## 7~9. 표준 목록 외 성분 · 위험도 매칭 · 프로필/TTS 일관성

- `userHasAllergyTo(allergenId)` 신규 공통 헬퍼 — `checkDishSafety`의 중복된
  취약한 비교 두 곳을 이걸로 교체. canonicalId 기반이라 peanut/pinenut처럼
  철자가 비슷한 다른 성분을 착각하는 것이 구조적으로 불가능해졌다.
- `findUncertainCustomAllergyMatches(dish)` — 모호하고 미확인(`userConfirmed:false`)
  인 커스텀 입력의 `candidateIds`가 이 요리의 성분과 겹치면 "불확실 매칭"으로
  기록. green을 그대로 두지 않고 orange로(§8: "정보 부족 시 안전 판정 방지"),
  단 이미 RED면 유지(§8: "RED를 미확인 정보가 덮어쓰지 않음").
- `getSpeechScript()` — `canonicalId`(없으면 정규화된 번역 텍스트) 기준으로
  중복 제거 — 표준 체크박스와 커스텀 입력이 같은 성분이면 TTS에서 한 번만
  말한다(State Consistency, 아래 §12).
- 번역 실패 시 `translateToKorean()`이 `{text: 원본, success:false}`를
  반환하도록 바꿔, 원본 보존과 "안내 필요" 상태(`translation_failed`)를
  명확히 구분했다(기존엔 "실패해도 조용히 원문 반환"이라 호출부가 실패
  여부를 알 방법이 없었음).

## 10. UI 개선 (최소 범위)

`renderCustomAllergyBadges()`에 `mappingStatus`별 짧은 아이콘(✓/ℹ️/⚠️/❗/❔/❓)과
설명을 추가했고, `ambiguous` 상태인 배지 아래에 후보 id들을 버튼으로
보여줘 그 자리에서 바로 선택할 수 있게 했다(모달 없이 기존 배지 디자인
안에서 해결). 내부 id나 `evidenceScope` 같은 데이터 구조는 노출하지
않는다. 전체 알레르기 검색 UI 개편이나 후보 18종 일괄 활성화는 하지
않았다(§13 그대로).

## 11. 테스트 결과

**Node VM**(`tests/imp-12-after.js`, 실제 `index.html` 로직을 그대로 실행 —
`fetch`만 실제 `data/generated/*.json` 내용을 돌려주는 mock으로 대체):

| TC | 결과 |
|---|---|
| TC-12-01~06 (DB 로딩/호환/언어매칭/정규화/동의어/pending제외) | 전부 **PASS** |
| TC-12-07~08 (shellfish 모호성 차단·후보 제시) | **PASS** |
| TC-12-09 (모호성 사용자 확인) | **PASS** |
| TC-12-10~12 (원본 보존/후보·미등록 보존/peanut≠pinenut) | **PASS** |
| TC-12-13~16 (RED/ORANGE/불확실성/RED 우선순위) | **PASS** |
| TC-12-17~17b (구형 LocalStorage 마이그레이션 + 멱등성) | **PASS** |
| TC-12-18 (TTS 중복 방지) | **PASS** |
| TC-12-19~20b (번역 실패/DB 로딩 실패 시 안전 처리) | **PASS** |
| TC-12-21 (IMP-11 22개 재실행) | **PASS** |
| TC-12-22 (IMP-18C/18D-1 31개 재실행) | **PASS** |
| TC-12-MEASURE (번역 API 생략 실측) | **PASS** |

**합계 23개 요청 TC + 2개 보조 변형 = 25개 PASS, FAIL 0.**

**브라우저 전용 — 의도적으로 NOT RUN**(`tests/harness.js`의 `document`
스텁은 `getElementById` 호출마다 새 더미를 돌려줘 `.value`가 항상 빈
문자열이라, 실제 `<input>` 값을 읽는 코드는 Node VM으로 의미 있게 검증할
수 없다):
- `addCustomAllergy()`의 실제 입력값 읽기/토스트/배지초기화
- `renderCustomAllergyBadges()`의 실제 렌더링 모양
- 모호성 선택 버튼의 실제 클릭 이벤트 바인딩

**⚠️ 테스트 작성 중 발견한 버그 2건(정직하게 기록)**:
1. `tests/harness.js`의 `document` 스텁에 `createTextNode`가 없어
   `renderCustomAllergyBadges()`가 호출되는 모든 테스트(TC-12-09/17/17b)가
   `TypeError`로 실패했다 — 하네스에 `createTextNode` 스텁을 추가해 해결.
2. IMP-11/Python 테스트를 자식 프로세스로 재실행하는 TC-12-21/22에서
   `execSync`가 Windows의 `cmd.exe`를 거치는데, `cmd.exe`는 UNC 경로
   (`\\wsl.localhost\...`)를 작업 디렉터리로 받아들이지 못해 엉뚱한
   디렉터리로 떨어지는 문제를 발견했다 — 셸을 거치지 않는 `execFileSync`로
   바꿔 해결(이 환경 특유의 Windows/UNC 제약, docs/devlog/IMP-18C.md의
   cp949 인코딩 이슈와 같은 계열의 환경 의존 버그).

전체 재실행 결과: **IMP-12 25 PASS / IMP-11 21 PASS / Python(IMP-18C·18D-1)
31 PASS — 시스템 전체 77 PASS, FAIL 0.**

## 12. 정량적 개선 효과 (실측, 추측 없음)

| 항목 | 실측값 |
|---|---:|
| 활용 가능한 검증 동의어 수 | **14건**(`allergen-aliases.json.literatureBacked`) |
| 지식 DB 색인 총 항목 수(표준라벨+legacyId+동의어+후보라벨) | **241건**(콘솔 로그로 실측) |
| 모호한 입력의 잘못된 자동 매핑 방지 | **1개 용어("shellfish") × 4개 테스트로 확인**(TC-12-07/08/15/16) |
| 위험도 매칭 테스트(RED/ORANGE/불확실성) | **4/4 PASS** |
| 기존 프로필 호환성 테스트 | **2/2 PASS**(+ IMP-11 21개 전부 PASS) |
| 번역 API 호출 생략 사례(실측) | **6건 입력에서 0회 호출**, 대조군(mango) 1건은 정상적으로 1회 호출 — "항상 생략"이 아니라 "매칭될 때만 생략"됨을 직접 측정 |
| 신규 테스트 통과율 | 25/25(NOT RUN 3건 별도 표시) |
| 시스템 전체 테스트 통과율 | 77/77(IMP-12 25 + IMP-11 21 + Python 31) |

**의학적 정확도에 대한 주장은 하지 않는다.** 이번 개선은 "텍스트가 같은
대상을 가리키는지"를 더 정확히 판별하는 **소프트웨어 엔지니어링** 개선이지,
"실제 음식의 알레르기 유발 여부를 더 정확히 검출한다"는 의학적 주장이
아니다 — 그런 주장은 임상 검증 없이 하지 않는다(§12 지시 그대로).

## 기술 개념 설명 (초급 개발자를 위해, 실제 코드와 연결)

| 개념 | 설명 | 코드 위치 |
|---|---|---|
| **Semantic Ambiguity** | 같은 단어가 둘 이상의 의미로 해석될 수 있는 것 | `KNOWN_AMBIGUOUS_CUSTOM_TERMS.shellfish` |
| **Canonical ID** | 여러 표현을 하나로 묶는 대표 식별자 | `standardAllergens[].id`, `resolveCustomAllergyInput()`의 `canonicalId` |
| **Unicode Normalization** | 겉보기엔 같은 문자열도 내부 인코딩이 다를 수 있어 통일하는 처리 | `normalizeAllergyText()`의 `.normalize('NFC')` |
| **Alias Mapping** | "표현 → 정규 식별자" 사전 | `allergenKB.index`(Map), 데이터 출처는 `allergen-aliases.json` |
| **Entity Resolution** | 입력 텍스트가 이미 아는 개체와 같은지 판별하는 작업 전반 | `resolveCustomAllergyInput()` 전체 |
| **Data Provenance** | 이 결과가 "어디서" 나왔는지 추적 가능하게 남기는 것 | `mappingSource`, `dataVersion` 필드 |
| **Human-in-the-loop** | 기계가 확신 없으면 사람에게 되물어 그 답을 신뢰하는 설계 | `mappingStatus==='ambiguous'` + `candidateIds` + `resolveAmbiguousCustomAllergy()` |
| **State Consistency** | 앱 전체에서 "같은 사실"이 하나로만 취급되도록 하는 것 | `getSpeechScript()`의 `spokenKeys` 중복 제거, `userHasAllergyTo()`를 `checkDishSafety` 두 곳 모두가 공유 |

## 변경된 파일

- `index.html`: 지식 DB 로더 + `resolveCustomAllergyInput`/`userHasAllergyTo`/
  `findUncertainCustomAllergyMatches`/`resolveAmbiguousCustomAllergy`/
  `migrateCustomAllergiesToCanonicalForm` 신규, `addCustomAllergy`/
  `renderCustomAllergyBadges`/`removeCustomAllergy`/`translateToKorean`/
  `getSpeechScript`/`checkDishSafety`/`window.onload` 수정.
- `tests/harness.js`: `document.createTextNode` 스텁 추가(공용 테스트 인프라 보강).
- `tests/imp-12-after.js`: 신규, TC-12-01~22 + 보조 3개.

## 기존 기능에 미친 영향

- 표준 알레르기 체크/식이 제한/맵기 경고: **무변경**(IMP-11 21개 테스트 전부 PASS).
- 지도/리뷰/환율/스캔 등 다른 탭: **무변경**(건드리지 않음).
- 기존 커스텀 알레르기 UX: 입력 → 번역 → 배지 표시라는 큰 흐름은 동일,
  다만 이제 상태 아이콘이 추가되고 모호한 입력엔 선택지가 뜬다.

## 남은 한계

- **UI 문구가 전부 영어로만 제공된다**(새 토스트/상태 텍스트 6개 언어
  번역은 하지 않음 — `translations` 객체 전체를 손대는 작업은 이번 범위를
  벗어난다고 판단).
- **DOM 상호작용 자체의 실제 브라우저 테스트는 하지 않았다**(§11 NOT RUN 3건).
- **18종 후보 성분은 여전히 위험도 판정에 자동 적용되지 않는다**(의도된
  제한 — `candidate_db` 매칭은 정보성 안내일 뿐).
- **"shellfish" 외의 다른 잠재적 모호어는 아직 조사하지 않았다**(예:
  "nuts"가 땅콩/견과류 전체를 모호하게 가리킬 가능성 등 — 후속 과제).
