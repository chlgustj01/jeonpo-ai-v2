# IMP-09 — 맞춤형 직원 질문 및 TTS

> Package 3 중 3/4.

## 핵심 문제

기존에는 "직원에게 질문하기" 버튼 하나가 알레르기+식이 제한을 한 문장에
섞어 발화하는 게 전부였다 — 재료만 궁금한 경우, 교차 접촉이 궁금한 경우를
구분할 수 없었고, 지식 DB(§IMP-18D-2)가 찾아낸 "AI가 못 찾은 추가 확인
후보"(예: 참기름→참깨)는 위험도 배너 아래 설명용으로만 쓰였지 실제 질문
문장에는 들어가지 않았다.

## 해결 방법

규칙 기반(Gemini 호출 없음)으로 4가지 질문을 동시에 생성하는
`generateStaffQuestions()`를 추가했다:

- **A. 일반**: "이 음식에 어떤 재료와 양념이 들어가나요?" — 항상 유효.
- **B. 개인 맞춤형**: 표준+확정된 커스텀 알레르기 전부(AI가 이번 음식에서
  검출하지 못했어도 포함 — §4 예시대로 사용자가 등록한 건 전부 반영) +
  식이 제한 문구. 할랄은 돼지고기 미검출만으로 안전을 단정하지 않고
  "돼지고기/라드/술"을 명시적으로 추가 확인하도록 캐벗 문장을 덧붙인다.
- **C. 교차 접촉**: `buildKnowledgeReportForDish()`(이미 §IMP-18D-2에 있던
  순수 함수, 재사용)를 직접 호출해 `userAdvisories`를 뽑아, 후보가 있으면
  구체적 재료명(예: "Sesame oil")을 언급하고 없으면 일반 문구로 대체.
- **D. 종합**: 위 세 가지를 한 문장으로 통합.

의미가 확인되지 않은(ambiguous) 커스텀 알레르기는 한국어 발화에는 포함되지
않되(`getSpokenAllergyListKo()` — `getSpeechScript()`의 로직을 그대로
추출해 재사용), `hasAmbiguousCustomAllergyCaveat` 플래그로 사용자 자신에게
"일부는 확인 안 돼서 발화에 안 들어갔다"는 캐벗을 따로 보여준다.

각 질문 유형엔 사용자 UI 언어로 "무엇을 묻는 질문인지" 설명
(`describeStaffQuestionMeaning()`)이 함께 붙는다. 기존 `speakKorean()`에
반복 클릭 중복 발화 방지(`state.isSpeaking` 가드)와 `stopSpeakingKorean()`
(중지)를 추가했고, 복사 버튼은 `navigator.clipboard` 우선, 실패 시
`document.execCommand('copy')`로 대체한다. 화면엔 한국어 텍스트가 항상
떠 있으므로 TTS가 안 되는 환경에서도 그 화면을 직원에게 보여주는 대체
수단이 이미 확보되어 있다.

## 변경된 파일

`index.html`만 변경 — 기존 단일 "Ask Waiter" 버튼을
`<div id="staff-question-panel">`로 교체, `generateStaffQuestions`/
`describeStaffQuestionMeaning`/`updateStaffQuestionPanel`/
`setStaffQuestionType`/`speakCurrentStaffQuestion`/`copyCurrentStaffQuestion`/
`stopSpeakingKorean`/`getSpokenAllergyListKo` 신규, `speakKorean()`에
중복 발화 가드 추가, 6개 언어에 `staffQ*` 번역 키 추가.

## 성과(실측)

- 개인 맞춤형 질문에 AI가 이번 음식에서 검출 못 한 알레르기(땅콩)도 포함됨
  (TC-09-02).
- 할랄 식단은 돼지고기 미검출과 무관하게 항상 술/라드 확인 문구가
  붙음(TC-09-03).
- 지식 DB 후보(Sesame oil→sesame, §IMP-18D-2와 동일한 실제 관계 데이터로
  검증)가 있으면 교차 접촉 질문에 구체적으로 언급됨(TC-09-04), 없으면
  일반 문구로 안전하게 대체됨(TC-09-05).
- ambiguous 커스텀 알레르기는 발화 목록에서 제외되고 캐벗 플래그만
  켜짐(TC-09-07).

## 테스트

`tests/imp-09-after.js`: 명명 12건(TC 10 + NOT RUN 2), **PASS 10 / FAIL 0 /
NOT RUN 2**(실제 음성 재생/정지/복사 버튼, 텍스트 대체 수단의 실제 가독성
— Node VM엔 `speechSynthesis`/`clipboard`가 없어 브라우저 필요).

## 한계

- 교차 접촉 질문은 현재 화면에 표시된 모든 음식을 모아 "이 음식들"로
  합쳐 묻는다(§IMP-06의 `lastScannedDishNamesKo`와 같은 방식) — 메뉴에 음식이
  여러 개면 질문이 다소 길어질 수 있다.
- 질문 유형 선택(`state.staffQuestionType`)은 화면 전체에 하나뿐이다 —
  멀티 스캔에서 음식마다 다른 유형을 동시에 보고 싶다면 범위 밖.
