# IMP-03 — 위험도 및 불확실성 UI 개선

> 브랜치: `v2-dev` / 기준 커밋: `35c6d06`(IMP-18D-2 완료). 패키지 1(IMP-18D-2 +
> IMP-03 + IMP-15) 중 두 번째. `data/`, `scripts/`, `shared/allergens.js`,
> `shared/dish-schema.js`, `shared/food-knowledge.js`, `api/`, `dev-server.js`
> 무변경(`git diff` 빈 출력).
> 개발 속도 우선 방침에 따라 이번 devlog는 핵심 문제·해결·변경·테스트·한계만
> 간결히 적는다(기술 개념 설명은 생략 — 프로젝트 완성 후 별도 진행).

## 핵심 문제

`checkDishSafety()`는 IMP-11 이후로 UI가 3단계(red/orange/green)뿐이라
"판단 자체가 불가능함"(알레르겐 레지스트리 로드 실패)을 red로, "그냥
모름"(맵기 미확인, 모호한 커스텀 알레르기 일치)을 orange로 임시 대체하고
있었다 — 둘 다 코드 주석에 "IMP-03에서 고칠 예정"이라고 이미 예고돼 있었다.
그 결과 사용자는 "확정된 직접 위험"과 "안전 점검 시스템 자체 고장"을 같은
빨간 배너로, "확정된 교차오염"과 "그냥 모름"을 같은 주황 배너로 구분 없이
봤다. 추가로, AI가 등록되지 않은 알레르겐 id를 언급해도(`unknownAllergenIds`)
안전 판정에는 전혀 영향이 없었고, IMP-02가 노출해둔 `dish.fieldStatus`(AI
응답 필드가 깨진 타입으로 왔는지) 정보도 위험도 판정에 쓰이지 않았다.

## 해결 방법

`checkDishSafety()`에 `error`(시스템 고장)와 `unknown`(개별 신호 불확실)
두 상태를 추가했다. 우선순위는 `red(4) > error(3) > unknown(2) > orange(1)
> green(0)`: red는 절대 밀리지 않고, error(아무것도 확인 못 함)는 orange
(확정된 경미 위험)보다 더 심각하게 취급한다. `unknown`으로 전환되는 사유
(`uncertaintyReasons`)는 맵기 미확인, 미등록 알레르겐 id, 모호한 커스텀
일치, `fieldStatus.allergens/crossContactAllergens === 'invalid_type'`
네 가지를 전부 모아서 한 번에 green→unknown으로 바꾼다(이미 red/orange면
덮어쓰지 않음 — 기존 fail-closed 원칙 그대로).

두 렌더 함수(renderMultiDishScanResult/renderScanResultUI)가 각자
중복하던 배너 if/else 블록을 `renderSafetyBanner(result, sourceNoteKey)`
공통 함수로 합쳤다. `sourceNoteKey`는 IMP-15 몫(아래).

## IMP-15 — 출처 구분

`renderSafetyBanner()`가 배너 문구 끝에 출처 안내를 한 문장 덧붙인다:
AI 실시간 스캔 화면은 `sourceAiScanNote`("AI 추정, 매장 확인 아님"), 지도
"Scan Menu Here" 데모 화면은 `sourceDemoNote`("데모 데이터, 실제 매장
확인 아님"). IMP-18D-2가 이미 지식 DB 섹션 안에서 AI 추정/문헌 근거/데모
출처를 구분해 보여주고 있었으므로(`kbAiAllergensLabel`,
`kbTierLiterature`, `kbDemoIngredientLabel` 등), 이번엔 그 지식 DB
섹션 "바깥"의 주 배너에도 같은 구분을 추가해 전체 화면 어디서도 "이
정보가 어디서 왔는지"가 비어있지 않게 했다. 실제 매장 확인(F 분류) 데이터는
0건이므로(IMP-18D-2 §3-2) "매장 확인됨" 같은 문구는 만들지 않았다.

GREEN 배너 + 지식 DB 추가확인 안내가 동시에 뜨는 경우, 기존
`composeGreenBannerDesc()`가 배너 문구를 통째로 다시 조립해 출처 문구를
지워버리는 문제가 있어 `composeGreenBannerDesc(reports, baseDesc)`로
시그니처를 바꿔 출처 문구가 이미 붙은 문자열을 기반으로 이어 붙이게
했다(TC-15-03으로 검증).

추가로 IMP-02의 'partial'(일부 음식 인식 실패) 결과가 지금까지 콘솔
로그로만 남고 사용자에겐 "완료" 토스트만 보였던 것을, 전용
`toastPartialResults` 토스트로 바꿔 알린다.

## 변경된 파일

| 파일 | 변경 |
|---|---|
| `index.html` | `checkDishSafety()`에 error/unknown 상태·`uncertaintyReasons` 추가(dataUnavailable 분기 red→error). `SAFETY_BANNER_STYLES`/`renderSafetyBanner()` 신규(두 렌더 함수의 배너 중복 제거 + sourceNoteKey 지원). `renderMultiDishScanResult`/`renderScanResultUI`의 severityRank·호출부 갱신. `composeGreenBannerDesc`/`applyKnowledgeReports`에 `baseDesc`/`greenBaseDesc` 매개변수 추가. `analyzeMenuPhotoWithAI`에 partial 토스트 분기. 6개 언어 × 7개 신규 키(`unknownTitle/Desc`, `errorTitle/Desc`, `sourceAiScanNote`, `sourceDemoNote`, `toastPartialResults`) |
| `tests/harness.js` | `document.getElementById`를 id별로 캐시하도록 수정(이전엔 호출마다 새 더미를 반환해, 앱이 쓴 값을 테스트가 같은 id로 다시 읽을 방법이 없었음) |
| `tests/imp-11-after.js`, `tests/imp-01-after.js` | TC-11-13(red→error)·TC-11-09/TC-01-12(green/orange→unknown) — 의도된 상태 분리 반영, 사유를 주석으로 명시 |
| `tests/imp-03-repro-before.js` | **신규.** 35c6d06 원본 `checkDishSafety` 로직 복사 + 결함 3건 재현 |
| `tests/imp-03-after.js` | **신규.** TC-03-01~17 + TC-15-01~04 + NOT RUN 2 |
| `docs/devlog/IMP-03.md` | 본 문서 |

## 테스트 결과

**재현(`imp-03-repro-before.js`)**: 3/3 재현(error/red 혼동, 미등록
id 무시, unknown/orange 혼동).

**개선 후(`imp-03-after.js`)**: 명명 23건(TC 21 + NOT RUN 2),
**PASS 21 / FAIL 0 / NOT RUN 2**, assertion 317건.
NOT RUN: 실제 브라우저 시각 색상 구분(TC-03-UI-1), 실제 Gemini 응답의
partial 토스트 노출(TC-03-UI-2, 실제 API 호출 지양).

**전체 회귀**: `imp-11`(21/0) · `imp-12`(25/0/3) · `imp-01`(20/0/2, 127
assertions) · `imp-02`(39/0/2, 92 assertions) · `imp-18d2`(30/0/2, 346
assertions) · Python ETL/지식DB(31/31) · `validate_food_knowledge.py`
(Error 0 / Warning 0) — 전부 기존과 동일하거나(FAIL 0) 의도적으로 수정된
3개 어서션만 고쳐서 PASS.

## 기존 기능에 미친 영향

- RED/ORANGE/GREEN의 발생 조건(확정 위험 판정 로직 자체)은 무변경.
- **의도된 동작 변경 3건**(전부 테스트로 고정): (1) 레지스트리 로드 실패가
  red → error, (2) 미등록 알레르겐 id 단독으로도 green → unknown, (3) 맵기
  미확인/모호한 커스텀 일치 단독으로도 orange → unknown.
- 지식 DB 추가확인 섹션(IMP-18D-2)·위험도 판정 자체: 무변경.

## 남은 한계

- 실제 브라우저에서 4가지 배너 색상이 실제로 잘 구분되어 보이는지, 접근성
  (색맹 대비)까지는 검증하지 않았다.
- `uncertaintyReasons`는 데이터에 기록되지만 UI에 "왜 불확실한지" 세부
  사유까지는 아직 노출하지 않는다(배너 문구는 공통 안내 한 줄).
- 실제 매장 확인(F 분류) 데이터가 0건이라 그 경로의 출처 라벨은 만들어
  두지 않았다 — 데이터가 생기면 추가해야 한다.
