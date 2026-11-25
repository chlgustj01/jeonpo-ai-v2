# IMP-11 — 알레르기 ID 체계 통일 및 LocalStorage 마이그레이션

> 브랜치: `v2-dev` / 기준 커밋: `a91f46c` (해커톤 원본 베이스라인)
> 이 문서는 **개인 후속 개선(V2) 작업**의 기록이며, 해커톤 팀의 원본 구현과는
> 명확히 구분된다. "기존 문제"로 서술된 내용은 해커톤 팀의 산출물(`main` 브랜치)에
> 대한 사실 기술이고, "적용한 기술/해결 방법"부터는 이번 개인 작업의 결과다.

---

## 1. 기존 문제

해커톤 원본(`main` 브랜치, `index.html` / `api/analyze-menu.js`)에서 알레르기 ID를
다음 4곳이 **서로 다른 하드코딩된 배열**로 각자 관리하고 있었다.

1. `index.html`의 `standardAllergens` (19종, 사용자가 체크하는 UI 목록)
2. `api/analyze-menu.js`의 `ALLOWED_ALLERGEN_IDS` (19종, Gemini 프롬프트에 전달하는 허용 목록)
3. `locations[].matchedFoodObj.allergens` / `crossContactAllergens` (지도 데모 데이터)
4. 사용자가 저장하는 LocalStorage(`fitbridge_profile_v1`)의 `selectedAllergies`

이 중 3번(데모 데이터)에만 `fish`, `sesame`라는 id가 등장하는데, 1·2번 목록
어디에도 그 id가 정의되어 있지 않았다. 또한 "잣(pine nut)"의 id가 `pineneut`으로
오타가 나 있었는데, 참고용으로 보존 중인 실험 버전(`app/`)에는 올바른 철자
`pinenut`으로 들어가 있어 두 버전 간에도 불일치가 있었다.

## 2. 실제 재현 결과

코드를 수정하기 전, `tests/imp-11-repro-before.js`로 **실제 배포되는 로직을
Node.js vm 모듈에서 그대로 실행**시켜 재현했다(로직을 손으로 다시 구현하지
않고, index.html의 `<script>` 블록 자체를 실행). 외부 Gemini API 호출은
전혀 하지 않았고, 데모 데이터 + 최소 Mock만 사용했다.

| ID | 테스트 내용 | 결과 |
|---|---|---|
| R1 | `standardAllergens.find(a => a.id === 'fish')` | **PASS**(재현됨) — `undefined` |
| R2 | `standardAllergens.find(a => a.id === 'sesame')` | **PASS**(재현됨) — `undefined` |
| R3 | `selectedAllergies`에 `'fish'`를 직접 넣고 `checkDishSafety({crossContactAllergens:['fish']})` 호출 | **PASS**(재현됨) — `safetyState: 'green'` (기대: `'orange'`) |
| R4 | 마라탕(`locations[1]`)에 커스텀 알레르기 `{original:'Sesame', translated:'참깨'}`(이상적인 번역)로 매칭 시도 | **PASS**(재현됨) — `safetyState: 'green'`. 번역이 완벽해도 `standardAllergens`에 `sesame` 자체가 없어 애초에 비교 대상이 없음 |
| R5 | 루트 파일 내부 `pineneut` 일관성 확인 | **PASS**(재현됨) — 내부는 일관되지만 올바른 철자가 아니고 `app/`과 불일치 |
| R6 | 현행 LocalStorage 저장 구조에 버전/마이그레이션 필드 존재 여부 | **PASS**(재현됨) — 전혀 없음 |
| R7 | `api/analyze-menu.js`의 `ALLOWED_ALLERGEN_IDS`에도 fish/sesame가 없는지 | **NOT RUN** — 이 harness는 index.html 전용. 정적 조사(grep)로 별도 확인(3-1 표) |
| R8 | 실제 Gemini API 응답에서의 ID 불일치 여부 | **NOT RUN** — 요청사항에 따라 실제 API 호출 의도적으로 생략 |

재현 테스트 전체 결과: `PASS 6 / FAIL 0 / NOT RUN 2`. **FAIL 없이 모든 재현
시나리오가 예상대로 결함을 확인시켜줬다.**

## 3. 오류 발생 원인

표면적 원인은 "데모 데이터 작성 시 두 군데(표준 목록, 서버 허용 목록)에
`fish`/`sesame`를 추가하는 걸 빠뜨렸다"이지만, 더 근본적인 원인은 **같은
의미를 갖는 데이터(알레르기 ID 목록)가 한 파일이 아니라 프론트엔드와 서버에
각각 복사되어 존재했다**는 구조적 문제다. 복사본이 여러 개면, 한쪽만
업데이트하고 다른 쪽을 빠뜨리는 실수가 구조적으로 반복될 수밖에 없다.
`pineneut` 오타가 다른 버전(`app/`)에는 교정되어 있었다는 사실도 "표준을
어디서 가져와야 하는지가 명확하지 않았다"는 같은 원인에서 나온 증상이다.

`checkDishSafety()` 내부의 `standardAllergens.find(x => x.id === allg)`는
찾지 못하면 `undefined`를 반환하고, `if (standardItem && ...)` 조건이
`false`가 되어 **그 알레르기 검사 자체가 조용히 생략**된다. 에러도, 로그도,
경고도 없다 — 이것이 "알레르기 안전 기능이 조용히 실패한다"는 가장 위험한
형태의 버그였다.

## 4. 적용한 기술 및 설계 원칙

- **Single Source of Truth(단일 진실 공급원)**: 같은 데이터를 두 곳에서
  각자 관리하지 않고, 한 곳에서 정의해 양쪽이 "참조"하게 한다. 웹 개발에서
  가장 흔한 버그 원인 중 하나(데이터 중복 정의로 인한 drift)를 구조적으로
  막는 원칙이다.
- **UMD(Universal Module Definition) 패턴**: 이 프로젝트는 빌드 도구
  (Webpack/Rollup/ESM)가 전혀 없는 "순수 HTML + Vanilla JS + Node 서버리스"
  구조다. 새 빌드 도구를 들이지 않으면서 같은 파일을 브라우저(`<script src>`
  전역 변수)와 Node(`require`/`module.exports`) 양쪽에서 쓰려면, 두 로딩
  방식을 런타임에 감지해 분기하는 최소 UMD 패턴이 적합하다.
- **Fail-closed(안전 측 실패) 설계**: 보안/안전 시스템에서 흔히 쓰이는
  원칙로, "확인할 수 없을 때는 안전하다고 간주하지 않고 위험하다고
  간주한다". 공유 데이터 로드가 실패해 알레르기 매칭이 불가능해진
  상태에서 `green`(안전)을 내보내는 것은 거짓 안심이므로, 이 상태를
  감지해 `red`로 처리하도록 했다.
- **멱등성(Idempotency)을 보장하는 순수 함수**: 마이그레이션 함수를
  "입력 → 출력"만 있는 순수 함수로 만들어, 몇 번을 다시 실행해도 같은
  결과가 나오게 했다 (운영 중인 서비스에서 마이그레이션 코드가 실수로
  두 번 실행돼도 안전해야 하기 때문).
- **Cross-realm 테스트의 함정**: Node `vm` 모듈로 실제 코드를 격리
  실행해 테스트하면, 그 결과 값들은 메인 프로세스와 "다른 JS realm"에
  속해 `Array`/`Object`의 prototype이 다르다. `assert.deepStrictEqual`은
  이 prototype까지 비교하므로 겉보기엔 똑같은 값인데도 실패한다
  (`Array.from()`으로 host realm으로 복사해 해결).

## 5. 검토한 해결 방법

| 방법 | 내용 | 선택 여부 |
|---|---|---|
| A. 서버 목록에 fish/sesame를 추가하고 끝 | 가장 빠르지만, "두 곳에 따로 유지"하는 구조는 그대로라 같은 문제가 재발할 수 있음 | 기각 |
| B. 빌드 도구(Webpack 등) 도입 후 ESM import로 통합 | 가장 "현대적"이지만, 요청사항에서 "새로운 빌드 도구를 불필요하게 도입하지 않는다"고 명시했고, 이 프로젝트는 지금 Vercel에 파일 그대로 올리는 구조라 과한 변경 | 기각 |
| C. 공유 JSON 파일을 두고 양쪽에서 fetch로 읽기 | 브라우저에서 `fetch('/shared/allergens.json')`은 비동기라, 이 데이터를 쓰는 수많은 동기 코드(`renderAllergiesGrid` 등)의 실행 순서를 전부 Promise 기반으로 바꿔야 해서 변경 범위가 너무 커짐(IMP-11 범위 초과) | 기각 |
| D. UMD 패턴의 공유 JS 모듈 + `<script>` 동기 로드 + Node `require` | 빌드 도구 없이, 기존 동기 코드 구조를 유지하면서, 한 파일을 양쪽이 공유 | **채택** |

## 6. 최종 해결 방법과 선택 이유

`shared/allergens.js`를 신설해 21개(기존 19개의 `pineneut`→`pinenut` 교정 +
`fish`, `sesame` 신규) 항목의 표준 알레르기 레지스트리를 정의했다. 각
항목은 `{ id, legacyIds, labels:{ko,en,ja,zh,vi,es}, icon }` 구조다.

- **브라우저(`index.html`)**: `<script src="shared/allergens.js">`를
  메인 로직 스크립트보다 먼저 로드해 전역 `ALLERGEN_REGISTRY`를 채운다.
  이미 이 프로젝트가 Tailwind/Leaflet을 똑같은 방식(동기 전역 `<script>`)
  으로 로드하고 있어서, 기존 아키텍처와 일치하는 선택이다. 기존
  `standardAllergens`는 이 레지스트리에서 "파생"된 배열로 바꿨는데, 모양을
  예전과 똑같은 평평한 구조(`{id, ko, en, ..., icon}`)로 맞춰서 수백 곳에
  퍼져 있는 기존 `allg.ko` / `allg.icon` 접근 코드를 전혀 바꾸지 않아도
  되게 했다(IMP-11의 범위를 "ID 체계 통일"로 좁게 유지하기 위한 선택).
- **서버(`api/analyze-menu.js`)**: `require('../shared/allergens.js')`로
  같은 파일을 불러와 `ALLOWED_ALLERGEN_IDS`를 그 자리에서 파생시킨다.
  Vercel의 서버리스 함수는 상대경로 `require`를 자동으로 추적해 함께
  배포하므로(File Tracing) `vercel.json` 등 추가 설정이 필요 없다.
- **`dev-server.js`**: 기존에는 `/`와 `/index.html`, `POST /api/analyze-menu`
  세 경로만 알고 있어서 `shared/allergens.js`에 대한 `GET` 요청이 전부
  404가 났다. Vercel은 프로젝트 루트의 모든 파일을 별도 설정 없이 정적
  파일로 서빙하지만, 이 수작업 로컬 서버는 그렇지 않으므로 범용 정적 파일
  서빙 분기(.js/.json/.css/.html, 경로 탈출 방지 포함)를 추가했다. 이
  수정이 없으면 로컬 개발 환경에서는 항상 "레지스트리 로드 실패" 경로만
  타게 되어, 실제 배포 환경과 다른 상태로 테스트하게 되는 문제가 있었다.

**LocalStorage 마이그레이션**은 `migrateLegacyAllergyIds(rawIds)`라는
순수 함수로 구현했다. `shared/allergens.js`의 `legacyIds` 필드로부터
역방향 매핑 테이블(`LEGACY_ALLERGEN_ID_MAP = { pineneut: 'pinenut' }`)을
만들고, 저장된 프로필을 복원할 때(`window.onload`) 이 매핑으로 변환한다.
변환 결과가 있으면(`changed === true`) 즉시 `saveProfileToStorage()`로
재저장해, 두 번째 접속부터는 변환이 필요 없게 한다. 변환에 실패해도
(`try/catch`로 감쌈) 원본 `state.selectedAllergies`는 그대로 유지되어
사용자 데이터가 손상되지 않는다. 표준 목록에도 없고 레거시 매핑에도 없는
완전히 미확인 id는 **삭제하지 않고 원본값 그대로 보존**한다.

## 7. 변경된 파일 및 함수

| 파일 | 변경 내용 |
|---|---|
| `shared/allergens.js` (신규) | 21종 알레르기 표준 레지스트리, UMD 패턴 |
| `index.html` | `<script src="shared/allergens.js">` 추가 / `standardAllergens`를 레지스트리 파생으로 변경 / `LEGACY_ALLERGEN_ID_MAP` 추가 / `DIETARY_VIOLATION_ALLERGENS`에 `fish` 추가 / `checkDishSafety()`에 fail-closed 가드 + unknown id 보존 추가 / `PROFILE_SCHEMA_VERSION` + `migrateLegacyAllergyIds()` 추가 / `saveProfileToStorage()`에 `schemaVersion` 필드 추가 / `window.onload`에 마이그레이션 호출 추가 / 테하우스 데모 데이터 `"pineneut"` → `"pinenut"` 교정 |
| `api/analyze-menu.js` | `ALLOWED_ALLERGEN_IDS`를 하드코딩 배열에서 `require('../shared/allergens.js')` 파생으로 변경 |
| `dev-server.js` | 범용 정적 파일 서빙 분기 추가 (`shared/allergens.js` 등, 경로 탈출 방지 포함) |
| `tests/harness.js` (신규) | index.html의 실제 `<script>` 로직을 Node vm으로 그대로 실행하는 재사용 테스트 하네스 |
| `tests/imp-11-repro-before.js` (신규) | 수정 전 결함 재현 테스트 (R1~R8) |
| `tests/imp-11-after.js` (신규) | 수정 후 전체 테스트 (TC-11-01~14) |

`fitbridge/`, `app/`, `jeonpo-guide-app.zip` 등 참고 보존 파일은 **전혀
수정하지 않았다** (Phase 0에서 합의한 "삭제/수정 금지" 원칙 유지).

## 8. 개선 전후 코드 비교

**`index.html` — `checkDishSafety()` 핵심 부분**

```diff
+ // Fail-closed 가드: 레지스트리가 비어있으면 무조건 red
+ if (!Array.isArray(standardAllergens) || standardAllergens.length === 0) {
+   return { safetyState: 'red', isCrossContact: false,
+            matchedDangers: ['DATA_UNAVAILABLE'], dataUnavailable: true,
+            unknownAllergenIds: [] };
+ }
  ...
  (dish.allergens || []).forEach(allg => {
    const standardItem = standardAllergens.find(x => x.id === allg);
-   if (standardItem && (state.selectedAllergies.has(allg) || ...)) {
-     safetyState = 'red';
-     matchedDangers.push(allg);
-   }
+   if (!standardItem) {
+     unknownAllergenIds.push(allg);   // 조용히 버리지 않고 보존
+     return;
+   }
+   if (state.selectedAllergies.has(allg) || ...) {
+     safetyState = 'red';
+     matchedDangers.push(allg);
+   }
  });
```

**`api/analyze-menu.js` — 허용 ID 목록**

```diff
- const ALLOWED_ALLERGEN_IDS = [
-   'peanut', 'walnut', 'pineneut', 'wheat', 'buckwheat', 'egg', 'milk',
-   'shrimp', 'crab', 'squid', 'mackerel', 'shellfish', 'soybean',
-   'pork', 'beef', 'chicken', 'peach', 'tomato', 'sulfites'
- ];
+ const ALLERGEN_REGISTRY = require('../shared/allergens.js');
+ const ALLOWED_ALLERGEN_IDS = ALLERGEN_REGISTRY.map((entry) => entry.id);
```

## 9. 테스트별 실제 결과

**수정 전 재현 테스트** (`node tests/imp-11-repro-before.js`): `PASS 6 / FAIL 0 / NOT RUN 2`
(위 2번 표와 동일)

**수정 후 테스트** (`node tests/imp-11-after.js`):

| TC | 내용 | 결과 |
|---|---|---|
| TC-11-01 | 프론트/서버 표준 ID 완전 일치 | **PASS** |
| TC-11-02 | `fish` 교차접촉 단독으로도 ORANGE | **PASS** |
| TC-11-03 | `sesame` 교차접촉(마라탕) ORANGE | **PASS** |
| TC-11-04 | 직접 포함 성분(`sesame`) RED | **PASS** |
| TC-11-05 | 교차접촉만 있으면 ORANGE(RED 아님) | **PASS** |
| TC-11-06 / 06b | fish↔shellfish 교차 오매칭 없음(양방향) | **PASS** |
| TC-11-07 | `pineneut` → `pinenut` 변환 | **PASS** |
| TC-11-08 | 마이그레이션 2회 실행 — 멱등성 | **PASS** |
| TC-11-09 / 09b | 미확인 id 보존(삭제 안 함) | **PASS** |
| TC-11-10 | 6개 언어 라벨 정상 | **PASS** |
| TC-11-11 | 프로필 저장/복원 정상 | **PASS** |
| TC-11-12 | TTS 문장 생성 정상 | **PASS** |
| TC-11-13 | 레지스트리 로드 실패 시 fail-closed(red) | **PASS** |
| TC-11-14a~f | 기존 기능 회귀 6건 | **PASS** (전부) |

**합계: PASS 21(세부 22항목) / FAIL 0 / NOT RUN 0.**

추가로 실제 `dev-server.js`를 구동해 HTTP 레벨에서도 확인했다:
`GET /` 응답 HTML에 `<script src="shared/allergens.js">` 포함 확인,
`GET /shared/allergens.js` 200 응답 + 21개 id 확인, 경로 탈출
시도(`/../../../etc/passwd`) 404 확인, 기존 `POST /api/analyze-menu`
에러 메시지 동일하게 유지됨을 확인.

## 10. 기존 기능에 미친 영향

- **영향 없음(회귀 테스트로 확인됨)**: 기존 알레르기 체크(19종), 식이
  제한(vegan/vegetarian/halal) 판정, 맵기 레벨 경고, TTS 문장 생성, 지도
  데모 데이터(14곳) 로딩, 프로필 저장/복원.
- **동작이 바뀐 부분(의도된 개선)**:
  - 마라탕/밀면의 참깨 교차오염 경고, 삼겹살의 생선 교차오염 경고가 이제
    실제로 뜬다(전에는 절대 뜨지 않았음).
  - 액젓(fish) 성분이 있는 음식이 비건 식이 위반으로도 잡힌다(전에는
    fish가 vegan 위반 목록에 없어서 안 잡혔음 — 이번에 함께 보완).
  - `shared/allergens.js`가 로드되지 않는 극단적 상황에서, 전에는
    (이론상) "아무 경고도 없이 전부 green"이 될 수 있었던 반면, 지금은
    모든 스캔이 red로 처리되고 콘솔에 에러가 남는다.
- **UI/디자인 변경 없음**: 알레르기 체크 그리드에 `fish`, `sesame` 2개
  항목이 추가로 보이는 것 외에는, 기존 레이아웃/색상/문구 그대로다.

## 11. 남아 있는 기술적 한계

- **커스텀 알레르기 매칭(IMP-12)은 아직 손대지 않았다.** `x.translated ===
  standardItem.ko` 완전 문자열 일치 로직 자체는 그대로이며, 이번에
  `sesame`가 레지스트리에 등록된 덕분에 "번역이 정확히 '참깨'로 나온
  경우"에는 매칭되지만, 공백/동의어/표기 차이가 있으면 여전히 실패한다.
- **불확실성(IMP-03)의 전용 UI 단계가 아직 없다.** `checkDishSafety`가
  반환하는 `unknownAllergenIds`와 `dataUnavailable` 필드는 지금 어떤
  화면에도 표시되지 않는다(콘솔 로그만 남음) — IMP-03에서 실제 UI로
  노출할 예정이다. 또한 레지스트리 로드 실패를 지금은 "red"로
  fail-closed 처리하는데, 이는 "확실히 위험함(RED)"과 "판단 불가(Gray)"를
  같은 색으로 보여준다는 뜻이라 완전한 해결은 아니다.
- **Vercel 실제 배포 환경에서의 `require('../shared/allergens.js')` 동작은
  검증하지 못했다.** 로컬 `dev-server.js`로는 end-to-end 확인했지만, 실제
  Vercel 서버리스 환경에 배포해 File Tracing이 기대대로 동작하는지는
  이 세션에서 실행하지 못한 테스트다(NOT RUN). Vercel 공식 문서에 따른
  설계이지만, 실측은 아니다.
- **`fitbridge/`, `app/` 등 참고 버전은 여전히 구 ID 체계(`pineneut`,
  fish/sesame 미등록)를 그대로 가지고 있다.** Phase 0 합의에 따라 의도적으로
  수정하지 않았으므로, 혹시 그 폴더의 코드를 복사해 쓰면 같은 문제가
  재발할 수 있다는 점을 기록해둔다.

## 12. 면접에서 설명할 수 있는 핵심 내용

> "해커톤 때 만든 알레르기 매칭 로직에서, 데모 데이터에만 등장하는
> `fish`/`sesame` id가 실제 표준 목록에는 등록되지 않아 위험 경고가
> 조용히 무시되는 버그를 발견했습니다. 원인을 추적해보니 같은 '알레르기
> ID 목록'이 프론트엔드 파일과 서버 파일에 각각 하드코딩되어 있어서,
> 한쪽만 갱신되고 다른 쪽은 안 갱신되는 구조적 문제였습니다. 새 빌드
> 도구를 들이는 대신, 브라우저의 `<script>` 전역 로딩과 Node의 `require`
> 양쪽에서 동일하게 동작하는 최소 UMD 모듈을 만들어 '하나의 데이터를
> 양쪽이 참조'하는 구조로 바꿨습니다. 또 이 공유 데이터가 로드되지
> 않는 최악의 경우에도 '확인 안 됨'을 '안전함'으로 착각하지 않도록
> fail-closed(판단 불가 시 가장 보수적으로 처리) 원칙을 적용했고, 기존
> 사용자의 LocalStorage에 남아있는 오타 id를 멱등성 있는 순수 함수로
> 마이그레이션했습니다. 수정 전/후 모두 실제 코드를 Node vm으로 그대로
> 실행하는 테스트 하네스로 검증했고, 22개 테스트 케이스가 전부
> 통과했습니다."

핵심 키워드: **Single Source of Truth, UMD 패턴, Fail-closed 설계,
멱등성(Idempotency), 데이터 마이그레이션, 회귀 테스트.**
