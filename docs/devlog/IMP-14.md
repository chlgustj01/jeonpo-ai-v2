# IMP-14 — 리뷰 데이터 영속성

> Package 3 중 4/4. 다국어 UI 통합(§6)도 리뷰 작성 폼 범위에서 이 커밋에 포함.

## 핵심 문제

`submitReview()`는 데모 시드 데이터(`REVIEWS_DATABASE`)에 직접
`push()`했다 — 새로고침하면 사라졌고, 수정/삭제도 없었고, 실제 작성
리뷰와 데모 리뷰가 같은 배열에 섞여 구분이 안 됐다.

## 해결 방법

실제 사용자 리뷰는 별도 `state.userReviews`(foodId별 배열) + localStorage
키 `fitbridge_user_reviews_v1`(schemaVersion 포함)로 분리했다.
`REVIEWS_DATABASE`(데모)는 전혀 건드리지 않고, 렌더링 시점에만
`demoReviews.concat(userReviewsForFood)`로 합쳐 통계/필터링에 쓴다. 각
사용자 리뷰는 `id`/`isUserReview:true`/`createdAt`을 갖고, 카드에는
"📱 이 기기에 저장됨" 배지와 수정/삭제 버튼이 데모 리뷰엔 없이 사용자
리뷰에만 붙는다("다른 사용자와 공유되는 실제 온라인 리뷰처럼 보이지 않게"
§5 지시). `editReview()`/`cancelEditReview()`로 폼을 수정 모드로 전환하고,
`submitReview()`가 `state.editingReviewId` 유무로 추가/수정을 분기한다.
중복 저장 방지는 `state.isSubmittingReview` 플래그로 동기 재진입(이중
클릭)만 막는다 — 네트워크 호출이 없는 로컬 저장이라 이것만으로 충분하다.
손상된 저장 데이터(JSON 파싱 실패, `reviews`가 배열 등 예상과 다른
구조)는 전체를 날리지 않고 `foodId`별로 배열이 아닌 항목만 걸러내며,
완전히 파싱 불가능한 경우에만 빈 상태로 리셋하고 한 번 토스트로 알린다.

**리뷰 데이터와 알레르기 프로필을 분리**했다 — 저장되는 리뷰 객체에는
`country`/`spiceTolerance`/`dietary`(기존 데모 리뷰 스키마와 동일한
필드)만 있고 `selectedAllergies`/`customAllergies`는 전혀 복제되지 않는다.
리뷰 섹션에는 "리뷰는 개인 경험일 뿐 알레르기 안전성 근거가 아니다"는
고지를 추가했다(§5 "리뷰나 국적을 객관적 안전성 근거로 사용하지 않는다").

리뷰 텍스트는 사용자가 직접 입력하는 값인데, 기존 렌더링이
`escapeHtml()` 없이 `innerHTML`에 바로 꽂고 있었다 — IMP-02 §11 XSS 정책을
위반하는 실제 결함이었다(지금까지는 메모리 전용이라 새로고침하면 사라져
눈에 덜 띄었을 뿐). 이번에 영속화하면서 함께 고쳤다.

## 변경된 파일

`index.html`만 변경 — `USER_REVIEWS_STORAGE_KEY`/저장·로드 함수 신규,
`submitReview`/`renderReviewsList` 재작성, `editReview`/`deleteReview`/
`cancelEditReview`/`resetReviewFormToAddMode`/`generateReviewId` 신규,
리뷰 카드 렌더링에 `escapeHtml()` 적용, 폼에 취소 버튼 + 안전 고지 추가,
6개 언어에 `review*` 번역 키 추가(기존엔 전부 영어 하드코딩).

## 성과(실측)

- 저장 직후 `localStorage`에 즉시 반영, 새 앱 인스턴스("새로고침" 흉내)에서
  그대로 복원됨(TC-14-01, TC-14-02).
- 수정은 새 항목을 추가하지 않고 같은 id를 갱신(TC-14-03), 삭제는 해당
  항목만 제거(TC-14-04).
- 동기 재진입(이중 클릭)에도 중복 저장 0건(TC-14-05).
- 손상된 데이터 3가지 케이스(파싱 실패/구조 불일치/부분 손상) 모두 예외
  없이 처리(TC-14-06~08).
- `REVIEWS_DATABASE`(데모)는 어떤 테스트에서도 길이가 변하지 않음(TC-14-09,
  TC-14-10).
- `<img src=x onerror=...>` 리뷰 텍스트가 `&lt;img`로 무해화됨(TC-14-11).
- 저장된 리뷰 객체에 `selectedAllergies`/`customAllergies` 키 자체가
  없음(TC-14-12).

## 테스트

`tests/imp-14-after.js`: 명명 12건, **PASS 12 / FAIL 0 / NOT RUN 0** —
`submitReview()`가 실제 `<input>` 값을 읽는 함수라 기존엔 하네스로 의미
있게 테스트할 수 없었지만, §IMP-03 때 harness를 id-캐시 방식으로 바꿔둔
덕에 이번엔 폼 제출 자체를 끝까지 테스트할 수 있었다(그래서 NOT RUN이
없다).

## 한계

- 외부 DB 서버는 요청사항대로 도입하지 않았다 — localStorage 전용이라
  기기를 바꾸면 리뷰가 보이지 않는다(의도된 범위).
- 리뷰 통계 카드의 영어 하드코딩 문구(§[[IMP-08]] 한계와 동일)는 이번
  범위에선 작성 폼만 다국어화했고 전부 손보지 않았다.
