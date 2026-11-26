# IMP-08 — 상태 관리 및 화면 동기화

> Package 3 중 2/4. [[IMP-07]]의 재계산 경로를 전제로 한다.

## 핵심 문제

Vanilla JS `state` 객체 자체는 이미 단일 소스였지만, 그걸 바꾸는 함수들
(`toggleAllergen`/`clearAllAllergies`/`addCustomAllergy`/`setSpicy`/
`syncModalDiet` 등)이 각자 다른 하위 집합만 갱신했다 — 예를 들어
`setSpicy()`는 `saveProfileToStorage()`를 호출한 적이 없어서(완전히 누락된
핸들러) 맵기 설정은 새로고침하면 사라졌고, `CUSTOM_ALLERGY_STATUS_BADGES`의
툴팁은 화면 언어와 무관하게 항상 영어로 고정돼 있었다.

## 해결 방법

- **버그 수정 1**: `setSpicy()` 끝에 `saveProfileToStorage()` 호출 추가
  (`setLanguage()`와 같은 "온보딩 완료 전엔 저장 안 함" 가드 포함).
- **버그 수정 2**: `CUSTOM_ALLERGY_STATUS_BADGES`를 하드코딩 영어 문자열
  대신 번역 키(`titleKey`)로 바꾸고, `renderCustomAllergyBadges()`가
  `kbText()`로 현재 언어 문자열을 가져오게 함.
- **공통 디스패처**: `onProfileChanged()` 하나를 만들어 프로필을 바꾸는
  모든 지점(표준/커스텀 알레르기, 맵기, 식이, 국적)에서 호출한다 —
  `updateTtsDraft()` + `recalcCurrentScanSafety()`(§IMP-07) +
  `updateStaffQuestionPanel()`(§IMP-09) + (리뷰 섹션이 보이는 중이면)
  `renderReviewsList()`를 한 번에 묶어, 화면마다 빠뜨리는 실수를 한 곳에서
  막는다. React/Redux/Zustand는 도입하지 않았고, "상태 변경"과 "파생 계산"은
  이미 분리돼 있었다(`state.xxx = ...`와 `checkDishSafety()`/`getSpeechScript()`
  등이 처음부터 별개 함수) — 후속 React 전환 시 그대로 재사용 가능하다.

## 변경된 파일

`index.html`만 변경 — `setSpicy`, `CUSTOM_ALLERGY_STATUS_BADGES`,
`renderCustomAllergyBadges`, `toggleAllergen`/`clearAllAllergies`/
`addCustomAllergy`/`resolveAmbiguousCustomAllergy`/`removeCustomAllergy`/
`migrateCustomAllergiesToCanonicalForm`/`syncModalDiet`/`syncOnboardingDiet`/
`syncModalNationality`/`syncOnboardingNationality`(모두 `onProfileChanged()`
호출 추가), `setLanguage()`(`recalcCurrentScanSafety()` 호출 추가 — 데모
단일 스캔 화면도 언어 변경에 반응하도록 함, 기존엔 AI 경로만 반응했음).

## 성과(실측)

- `setSpicy()` 호출 후 `loadProfileFromStorage()`로 다시 읽으면 바뀐 값이
  그대로 복원됨(TC-08-01) — 기존엔 실패하던 케이스.
- 온보딩 완료 전 호출은 `onboardingComplete`를 조기 저장하지 않음(TC-08-02).
- 알레르기 하나를 바꾸면 TTS 초안과 직원 질문 패널이 같은 호출 안에서 함께
  갱신됨(TC-08-03, TC-08-04) — 화면 간 불일치 가능성 제거.
- 배지 툴팁이 `en`/`ko` 전환에 반응함(TC-08-05) — 기존엔 항상 같았음.

## 테스트

`tests/imp-08-after.js`: 명명 7건(TC 6 + NOT RUN 1), **PASS 6 / FAIL 0 /
NOT RUN 1**(여러 탭을 실제로 오가며 눈으로 확인 — 브라우저 필요).

## 한계

- 리뷰 화면의 통계 라벨("of travelers rated Strong+" 등)과 "Would eat
  again"/"No reviews yet" 같은 문구는 여전히 영어로 고정돼 있다(이번
  범위에서는 §6이 명시한 "리뷰 작성 및 관리" 폼만 다국어화했고, 기존부터
  있던 통계 카드 문구 전체를 다 손보진 않았다) — 다음 패키지 후보.
