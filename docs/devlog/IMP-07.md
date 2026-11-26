# IMP-07 — 파생 상태 및 위험도 즉시 재계산

> Package 3(IMP-07+08+09+14) 중 1/4.

## 핵심 문제

알레르기/맵기/식이 제한을 바꿔도, 이미 화면에 떠 있는 스캔 결과의 위험도
배너는 다음 스캔 전까지 그대로였다(화면에 보이는 판정이 사용자의 "지금"
프로필과 다를 수 있었음).

## 해결 방법

`state.lastRenderedDishes`(멀티 AI 스캔)/`state.lastRenderedMatchObj`(지도
데모 단일 스캔) + `state.lastScanRenderKind`에 "마지막으로 성공한 렌더
결과"를 기록해두고, `recalcCurrentScanSafety()`가 그 값을 그대로
`renderMultiDishScanResult()`/`renderScanResultUI()`에 `{silent:true}`로
다시 넘겨 위험도만 재계산한다. `checkDishSafety()`는 원래부터 호출 시점의
`state` 프로필을 그대로 읽으므로, 입력 dish가 같아도 프로필이 바뀌면
자동으로 다른 결과를 낸다 — 새로 만든 건 "언제 다시 그릴지"뿐이다.
`{silent:true}`는 "스캔 완료" 토스트만 억제한다(새 스캔이 아니라 재계산이므로).

## 변경된 파일

`index.html`만 변경 — `renderMultiDishScanResult`/`renderScanResultUI`
시그니처에 `options` 추가, `recalcCurrentScanSafety()`/`onProfileChanged()`
신규(§[[IMP-08]]에서 모든 프로필 변경 지점이 호출), `resetScanner()`/
`clearStaleScanResult()`/`resetToOnboarding()`에 캐시 초기화 추가.

## 성과(실측, Mock 기준)

- 알레르기 토글 → 이미 표시 중인 결과가 즉시 RED로 바뀌고, 그 호출 전후로
  `fetch` 호출 횟수는 그대로(0건 증가) — TC-07-01.
- 맵기/식이 변경도 동일하게 API 재호출 없이 즉시 반영(TC-07-03, TC-07-04).
- 이미 확정된 RED는 무관한 프로필 변경으로 하향되지 않음(TC-07-05) —
  §IMP-03의 fail-closed 원칙이 재계산 경로에서도 그대로 유지됨.
- 프로필 변경이 `state.lastAnalysis`(§IMP-04/05 캐시)를 전혀 건드리지
  않음(TC-07-06) — 캐시 훼손 없음.
- 데모 단일 스캔 경로도 동일한 재계산 함수를 공유(TC-07-07).

## 테스트

`tests/imp-07-after.js`: 명명 8건(TC 7 + NOT RUN 1), **PASS 7 / FAIL 0 /
NOT RUN 1**(실제 체크박스 클릭 시 리페인트 체감 타이밍 — 브라우저 필요).

## 한계

- "순수 함수"라고 부르지만 `checkDishSafety()`는 `state`를 직접 읽는다(새로
  순수하게 다시 쓰지 않고 기존 구조를 그대로 재사용) — 테스트는 호출 전후
  `state`를 직접 바꿔 검증했다.
- 다중 탭에서 같은 세션을 동시에 쓰는 경우는 다루지 않음(§IMP-06과 동일한
  한계).
