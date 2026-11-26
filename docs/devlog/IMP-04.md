# IMP-04 — 이미지 분석과 번역 분리

> Package 2(IMP-04+05+06+13) 중 1/4. 기준 커밋: `3bb5d8e`. 간결한 패키지 devlog.

## 핵심 문제

`api/analyze-menu.js`의 Gemini 프롬프트는 "사진 속 음식 식별"과 "그 결과를
`targetLanguage`로 번역"을 한 번의 호출로 동시에 했다(`translated_name`/
`ingredients`/`eatingMethod`/`description`/`culturalNote`가 전부
`${targetLangName}`로 작성되도록 요청). `index.html`의 `setLanguage()`는
언어를 바꿀 때마다 `analyzeMenuPhotoWithAI(state.uploadedImageDataUrl)`를
무조건 다시 호출했다(`git show 3bb5d8e:index.html:2877-2880`) — 알레르겐/
식재료/위험도는 전혀 바뀌지 않는데도 무거운 비전 분석 전체를 또 실행했다.

## 해결 방법

`api/analyze-menu.js`는 이제 **항상 영어로만** 분석한다(`name_ko`/`name_en`은
원래부터 언어 중립이라 그대로 유지, `translated_name` 필드는 완전히 제거).
새 엔드포인트 `api/translate-dish.js`가 번역만 전담한다 — 입력은 분석
결과의 "정준 영어 텍스트"(`foodId`/`nameEn`/`nameKo`/`ingredients`/
`eatingMethod`/`description`/`culturalNote`)뿐이고, `allergens`/
`crossContactAllergens`/`spicy` 등 위험도 판정 값이나 사용자 알레르기
프로필은 이 호출에 전혀 포함되지 않는다(TC-04-06으로 확인). 목표 언어가
`en`이면 Gemini를 호출하지 않고 즉시 에코한다.

클라이언트의 `analyzeMenuPhotoWithAI()`는 분석만 하고, 새 함수
`translateAndRenderDishes()`가 번역+렌더를 맡는다. `state.lastAnalysis`에
언어 중립 결과를 저장해두므로, `setLanguage()`가 재트리거해도
`/api/analyze-menu`는 다시 불리지 않고 `translateAndRenderDishes()`만
실행된다. 번역이 실패하면(502/네트워크 오류) 영어 원본을 그대로 렌더링하고
`toastTranslationFailed` 토스트만 띄운다 — 결과 자체가 사라지지 않는다.

## 변경된 파일

| 파일 | 변경 |
|---|---|
| `api/analyze-menu.js` | 프롬프트를 영어 전용으로 변경, `targetLanguage` 요청 바디 제거, 응답에 `analysisId` 추가(§IMP-05 캐시 키 재사용) |
| `api/translate-dish.js` | **신규.** 번역 전담 엔드포인트, `en` 에코 단축, Gemini 텍스트 전용 호출 |
| `shared/dish-schema.js` | `nameEn`(순수 영어 이름) 필드 추가, `validateAndNormalizeTranslationResponse()` 신규(기존 `normalizeStringField` 등 재사용) |
| `index.html` | `analyzeMenuPhotoWithAI()` 분석 전용으로 축소, `translateAndRenderDishes()`/`buildTranslatedDishList()` 신규, `toastTranslationFailed` 6개 언어 추가 |
| `dev-server.js` | POST `/api/<name>` 일반화(analyze-menu 하드코딩 제거, translate-dish도 자동 라우팅) |

## 성과(실측, Mock 기준)

- 분석↔번역 완전 분리: 번역 요청에 `allerg`라는 문자열이 Gemini 프롬프트나
  응답 어디에도 등장하지 않음(TC-04-06).
- 언어 전환 시 `/api/analyze-menu` 호출 0회(§IMP-05/06 테스트로 교차 검증).
- 번역 실패 시에도 `state.hasScannedResult === true` 유지(원본 보존, TC-04-08).

## 테스트

`tests/imp-04-after.js`: 명명 9건(TC 8 + NOT RUN 1), **PASS 8 / FAIL 0 /
NOT RUN 1**(실제 Gemini 다국어 번역 품질 — 실 API 호출 지양), assertion 17건.

## 한계

- 번역 프롬프트는 한 번에 최대 10개 dish를 한 Gemini 텍스트 호출로 묶는다 —
  매우 긴 ingredients/eatingMethod가 여러 개 겹치면 토큰 한도에 걸릴 수
  있음(사전 길이 제한은 `shared/dish-schema.js`의 기존 `LIMITS`로만 방어).
- 실제 번역 품질(자연스러움)은 검증하지 않았다.
