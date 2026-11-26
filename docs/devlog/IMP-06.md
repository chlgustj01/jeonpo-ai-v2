# IMP-06 — 비동기 요청 및 상태 관리

> Package 2 중 3/4.

## 핵심 문제

분석과 번역이 분리되고 둘 다 캐시를 갖게 되면서, 비동기 요청 두 개(분석,
번역)가 독립적으로 겹칠 수 있는 새로운 경우가 생겼다: 이미지를 바꾸는 중
이전 분석이 아직 안 끝남, 언어를 빠르게 두 번 바꿔 번역 요청이 겹침, 같은
사진에 중복 클릭 등. IMP-18D-2가 분석 자체의 응답 순서 역전(늦게 온 이전
응답 무시)은 이미 `state.scanRequestSeq`로 막아뒀지만, 번역에는 그런 장치가
없었고, 실제 요청 취소(AbortController)도 전혀 쓰이지 않았다.

## 해결 방법

- `state.analysisAbortController`/`state.translationAbortController`: 새
  분석/번역을 시작하기 전에 이전 것을 `abort()`한다.
- `state.translationRequestSeq`(분석의 `scanRequestSeq`와 별도 식별자):
  번역 응답이 늦게 와도 최신 요청의 것만 반영.
- `state.isAnalyzing`/`state.inFlightImageHash`: 같은 이미지에 대한 분석이
  "네트워크 호출 중"일 때만 중복 트리거를 막는다 — 분석이 끝나고 번역
  단계로 넘어가면 바로 풀어준다(그렇지 않으면 번역이 끝나기 전에 같은
  이미지로 다시 트리거된 호출, 예를 들어 언어를 또 바꾼 경우가 "분석
  중"으로 오인되어 막혀버리는 실제 버그를 개발 중 발견하고 고쳤다 — TC-06-04).
- `resetScanner()`/`clearStaleScanResult()`: 진행 중인 컨트롤러를
  `abort()`하고 요청 식별자를 올려, 화면이 지워진 뒤 도착하는 응답을 무시.
- `AbortError`는 실패가 아니라 "취소됨"으로 별도 처리(에러 토스트를
  띄우지 않고 조용히 종료).

**명시한 한계**: 클라이언트의 `AbortController.abort()`는 우리 서버로의
`fetch`만 중단한다. 서버가 Gemini 쪽 호출을 실제로 중단하는지, 그래서
비용이 절감되는지는 이 구현이 보장하지 않는다(요청사항에 이미 명시된
구분 — `fetch`가 클라이언트 연결 종료를 감지해 서버 프로세스까지 취소를
전파하는 장치는 만들지 않았다).

## 변경된 파일

`index.html`만 변경 — `analyzeMenuPhotoWithAI()`/`translateAndRenderDishes()`
(§[[IMP-04]]에서 이미 나열), `resetScanner()`, `clearStaleScanResult()`.
`tests/harness.js`에 `AbortController`/`AbortSignal`을 사실상 전역으로 노출.

## 테스트

`tests/imp-06-after.js`: 명명 8건(TC 6 + NOT RUN 2), **PASS 6 / FAIL 0 /
NOT RUN 2**(실제 브라우저 렌더링 확인, Gemini 측 취소 보장 여부 — 둘 다
위 한계 문단 그대로), assertion 10건. 핵심 사례: 중복 클릭 무시(TC-06-01),
이미지 교체 시 이전 요청 취소(TC-06-02), 응답 순서 역전(TC-06-03), 언어
연속 전환(TC-06-04), 리셋 시 무효화(TC-06-05), 가드 과잉 차단 아님(TC-06-06).

## 한계

- 위 "서버/Gemini 취소 비보장" 외에, 다중 탭에서 같은 세션을 동시에 쓰는
  경우는 다루지 않았다(단일 탭/단일 `state` 가정).
