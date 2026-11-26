# PACKAGE-05 — 최종 검증, 실제 Gemini 502 해결, 배포 준비

- 브랜치: `v2-dev` / 기준 커밋: `f00936f` (Package 4)
- main(`a91f46c`) 변경 없음, 원격 저장소 연결/push 없음
- 실제 Gemini 호출: 사용자 승인 하에 원인 확인·통합 검증용으로만 사용 (§3 호출 기록)

## 1. 문제

사용자가 React V2에서 실제 한식 메뉴판 사진(김치찌개, 된장찌개, 부대찌개, 순두부찌개, 청국장, 낙지볶음, 오징어볶음, 제육볶음, 돌솥비빔밥)을 분석하자 화면에 다음이 표시됐다.

```
안전 점검 불가
analyze-menu failed: 502
```

이미지 업로드와 미리보기는 정상이었다.

## 2. 원인 조사 (요청된 10단계 순서)

| # | 확인 항목 | 방법 | 결과 |
|---|---|---|---|
| 1 | `.env` / 서버 환경변수 | 백엔드 로그 `GEMINI_API_KEY is set`, Key 미입력 시 500 → 입력 후 400 프로브 | 정상 로드 |
| 2 | 인증 / 접근 가능한 모델 | `GET /v1beta/models` (생성 호출 아님) | **HTTP 200** — 인증 정상. `gemini-2.5-flash` 포함 다수 모델 접근 가능 |
| 3 | 사용 모델 / 엔드포인트 | 코드 확인 | `gemini-2.5-flash`, `v1beta/models/{model}:generateContent` |
| 4 | Gemini HTTP 응답 / 오류 유형 | 사용자 실패 당시 백엔드 로그 + 동일 유형 메뉴판으로 재현 | Gemini는 **HTTP 200**을 반환. 오류는 우리 서버가 만든 502 |
| 5 | 인증 방식 / API 호환성 | 코드 + 응답 | `?key=` 쿼리 방식도 동작(200). 다만 URL에 Key가 실리므로 헤더 방식으로 변경 |
| 6 | 이미지 형식 / MIME | 프론트 리사이즈 결과 | `image/jpeg` 1024px — 문제 없음 (이미지 토큰 258) |
| 7 | 응답 스키마 / JSON 파싱 | 백엔드 로그 `Failed to parse AI JSON response` | **JSON이 중간에서 끊겨 `JSON.parse` 실패 → 502** |
| 8 | 다품목 응답 길이 | 재현 호출의 `finishReason` / `usageMetadata` | **`MAX_TOKENS`** — 아래 표 |
| 9 | 재현 / 수정 | `tests/pkg5-repro-before.js`, §4 | 재현 후 수정 |
| 10 | 실제 분석 성공 | §3 | 성공 |

사용자 실패 당시 서버 로그에는 `Failed to parse AI JSON response`가 2회 남아 있었다. 첫 번째는 계란찜/제육볶음/김자반/김치 4개 항목에서, 두 번째는 김치찌개 1개 항목 중간에서 텍스트가 끊겼다(약 2,441자 / 342자). Key 형식(53자, 마침표 포함)은 원인이 아니었다. 같은 Key로 모델 목록과 생성 호출 모두 200을 받았다.

### 재현 (실제 호출 1회, 수정 전 코드 그대로)

9개 품목 합성 메뉴판(`web/e2e/fixtures/menu-sample.jpg`, 실제 음식점 메뉴 아님)을 기존 핸들러로 분석:

| 항목 | 값 |
|---|---|
| HTTP | 200 |
| finishReason | **MAX_TOKENS** |
| thoughtsTokenCount (사고 토큰) | **2,044** |
| candidatesTokenCount (실제 답변) | 1,013 |
| 합계 / 한도 | 3,057 / `maxOutputTokens: 3072` |
| 결과 | 답변 텍스트 3,605자에서 끊김 → `JSON.parse` 실패 → **502 "The AI response was not valid JSON."** |

### 근본 원인

`gemini-2.5-flash`는 기본적으로 사고(thinking)를 켜고 동작하고, 사고 토큰은 `maxOutputTokens` 한도 안에서 함께 소비된다(Google 문서 thinking 페이지 "Token limits … includes thought tokens", generateContent 레퍼런스의 `usageMetadata.thoughtsTokenCount`, 그리고 위 실측값으로 확인). 기존 설정 `maxOutputTokens: 3072`에서 사고가 약 2/3를 쓰고 남은 약 1,000토큰으로는 메뉴 3개 정도만 출력할 수 있었다. 단일 음식 사진에서는 문제가 드러나지 않았고, 여러 품목이 있는 메뉴판에서만 발생했다.

이 실패를 서버가 일률적으로 502로 바꿨고, 프론트는 `analyze-menu failed: 502`라는 개발자 문자열을 그대로 표시했다. 그래서 원인을 화면에서 구분할 수 없었다.

번역 API(`api/translate-dish.js`)도 같은 구조(`maxOutputTokens: 2048` + 기본 사고)였다. 실측 결과 10개 요리 일본어 번역의 답변만 1,714토큰이었으므로, 메뉴판 결과를 번역하면 같은 방식으로 실패할 수 있는 상태였다.

## 3. 실제 Gemini 호출 기록 (총 생성 호출 7회 + 모델 목록 1회)

| # | 목적 | 입력 | 결과 |
|---|---|---|---|
| 0 | 인증/모델 확인 | `GET models` | 200 |
| 1 | 재현 (수정 전) | 9품목 메뉴판 | 200 / MAX_TOKENS / 핸들러 502 |
| 2 | 수정 확인 | 9품목 메뉴판 | 200 / STOP / 사고 986 · 답변 2,103 토큰 / 14.5초 / **10개 항목**(하단 "공기밥" 포함), `coverage.isComplete: true` |
| 3 | 번역 확인 | #2 결과 10개 → 일본어 | 200 / STOP / 답변 1,714 토큰 / 8.7초 / 10/10 번역 |
| 4 | 음식 무관 이미지 | 회의 메모 + 막대그래프 | 200 / `dishes: []` → `validationStatus: empty` → 화면 "음식을 찾지 못함" |
| 5 | 흐림 + 잘림 | 메뉴판 blur 2.5px, 우측 35%·하단 1/3 잘림 | 200 / 7개 인식(절반 잘린 오징어볶음 포함) |
| 6 | 브라우저 E2E (프로덕션 빌드) | 9품목 메뉴판 → 분석 → 일본어 전환 | desktop/mobile PASS. 2번째 프로젝트는 서버 캐시 적중(설계상; 호출 수를 별도 계측하지는 않음) |
| 7 | (#6 번역) | | 위와 동일 |

로그와 출력에는 Key 값을 남기지 않았다(진단 스크립트가 출력 전에 Key 문자열을 `[REDACTED]`로 치환).

## 4. 수정 내용

### 4.1 Gemini 호출 (`shared/gemini-client.js` 신규, 두 API가 공유)

| 항목 | 이전 | 이후 |
|---|---|---|
| 분석 출력 한도 | `maxOutputTokens: 3072`, 사고 기본값 | `maxOutputTokens: 8192`, `thinkingConfig.thinkingBudget: 1024` (2.5 모델에만 전송) |
| 번역 출력 한도 | `2048`, 사고 기본값 | `8192`, `thinkingBudget: 0` (번역에는 사고 불필요) |
| Key 전달 | URL `?key=` | `x-goog-api-key` 헤더 (요청 URL 로그에 Key가 남지 않음) |
| 시도별 타임아웃 | 없음(무기한 대기 가능) | 분석 45초 / 번역 30초, 남은 전체 예산(55초 / 40초) 이내로 제한 |
| 모델 | 하드코딩 | 기본 `gemini-2.5-flash`, `GEMINI_MODEL` 환경변수로 변경 가능(`gemini-…` 형식만 허용 — 경로/호스트 주입 차단) |
| 응답 텍스트 추출 | `parts[0].text` | 사고 part 제외 후 텍스트 part 결합, `finishReason` 검사 |

`gemini-2.5-flash` 관련 주의: Google deprecations 페이지에 2026-12-01부터 `gemini-2.5-flash` 요청이 `gemini-3.5-flash-lite`로 자동 라우팅된다고 공지되어 있다(오늘 2026-11-27 기준 4일 후, "earliest possible date"). 모델 변경은 결과 품질 재검증이 필요한 별도 결정이라 기본값은 바꾸지 않고, `GEMINI_MODEL`로 교체할 수 있게만 해두었다. `thinkingBudget`은 2.5 전용 파라미터라 3.x 모델에는 보내지 않는다.

### 4.2 오류 분류 (서버 → 코드, 프론트 → 6개 언어 문구)

| code | 상황 | HTTP | 재시도 버튼 |
|---|---|---|---|
| `AI_CONFIG` | Key 없음(500) / Key 무효·권한·모델 없음·결제/지역 조건(502) | 500/502 | 없음 |
| `AI_QUOTA` | 429 / RESOURCE_EXHAUSTED (서버 재시도 후) | 429 | 있음 |
| `AI_UNAVAILABLE` | Gemini 5xx | 503 | 있음 |
| `AI_TIMEOUT` | 시도별 타임아웃 | 504 | 있음 |
| `AI_NETWORK` | 서버 → Gemini 연결 실패 | 502 | 있음 |
| `IMAGE_INVALID` | data URL 아님 / 미지원 MIME / Gemini가 이미지 거부(400) | 400 | 없음 |
| `IMAGE_TOO_LARGE` | base64 4MB 초과 / dev-server 본문 4.5MB 초과 | 413 | 없음 |
| `AI_RESPONSE_INVALID` | JSON 파싱 실패 / 스키마 불일치 / 빈 응답 | 502 | 있음 |
| `AI_OUTPUT_TRUNCATED` | finishReason MAX_TOKENS | 502 | 없음 ("메뉴 일부만 찍어 다시") |
| `AI_BLOCKED` | SAFETY 등 차단 | 422 | 없음 |
| `NETWORK` (클라이언트) | 우리 서버에 연결 불가 | — | 있음 |
| `NO_FOOD_FOUND` (클라이언트) | `validationStatus: empty` | — | 없음 |

- 응답 바디는 `{ error, code, retryable }`이다. 기존 `error` 필드를 유지해 Vanilla 앱도 그대로 동작한다.
- 업스트림 원문 오류 메시지는 클라이언트로 보내지 않는다. 로그에는 code, 상태, reason, 토큰 사용량만 남긴다(모델 텍스트와 Key는 남기지 않음).
- 화면에는 사용자용 문구를 표시한다. `code · HTTP xxx`는 접힌 "기술 정보"에만 표시한다.
- 401/403 계열은 기존 계약(TC-13-12: 401 → 502)을 유지한다.

### 4.3 메뉴판 분석 범위 표시

- 프롬프트 버전을 2.1.0으로 올렸다(분석 캐시 키에 포함되어 이전 캐시를 재사용하지 않음). 다음을 요청한다.
  - `menuItemCount`: 사진에 보이는 전체 항목 수
  - `ingredientSource`: `"printed"`(사진에 인쇄된 성분표나 설명) 또는 `"inferred"`(이름만 보고 추정)
  - 짧은 텍스트
- 서버는 10개 상한을 실제로 적용한다. `LIMITS.MAX_DISHES`는 선언만 되어 있고 쓰이지 않아서, 11개 이상이 오면 번역 API가 400으로 거부하는 상태였다.
- 서버는 `coverage`(`{returnedCount, visibleItemCount, maxDishes, isComplete}`)를 응답에 추가한다. 일부만 분석된 경우 화면에 "약 N개 중 M개 표시, 사진 1장당 최대 10개" 안내를 표시한다.
- `ingredientSource`는 명시적으로 `"printed"`인 경우만 그대로 두고, 나머지는 모두 `"inferred"`로 처리한다(안전한 쪽). 화면에는 요리마다 "AI 추정" 칩을 붙이고, 목록 상단에 "메뉴판에 적힌 정보가 아닌 AI 추정이니 직원에게 확인" 안내를 한 번만 표시한다.
- 알레르겐 배열과 RED/ORANGE 판정 로직은 변경하지 않았다(TC-P5-13).

### 4.4 화면 상태

- 이전 결과가 현재 결과처럼 보이던 문제를 수정했다. 새 분석이 실패하면 직전 결과가 오류와 함께 그대로 렌더링되고 있었다(`hasResult`가 `status === 'error'`에서도 참). 이제 분석을 시작하는 시점에 이전 결과를 지우고, 결과는 `ready/translating`일 때만 표시한다.
- 오류 안내를 사진 카드 위로 옮겨 모바일에서 스크롤 없이 보이게 했다. "다시 시도"는 재시도 가능한 오류에만 표시하고, 실패한 이미지를 그대로 다시 보낸다. 오류 영역에 있던 중복 "사진 추가" 버튼은 제거했다(카드에 같은 버튼이 있음).
- 메뉴판 미리보기를 `object-cover`에서 `object-contain`으로 바꿨다. 세로로 긴 메뉴판의 좌우가 잘려 보이던 문제가 해결됐다.
- GREEN 문구를 변경했다. 기존 "All identified ingredients align perfectly with your safety profile"(완벽히 일치)는 안전 보장으로 읽힐 수 있었다. 6개 언어 모두 "프로필과 일치하는 성분 없음 — 안전 보장이 아니며 숨은 재료·교차 오염 가능, 직원 확인"으로 바꿨다. React에서만 덮어쓴다(Vanilla 원문은 유지).
- 번역 후 식품 지식 DB 조회 결과가 달라지던 문제를 수정했다. 번역된 `ingredients`(예: "豆腐")로 영어 키 기반 DB를 조회해 언어마다 결과가 달라졌다. 이제 원문 영어 `canonicalIngredients`로 조회한다(React만 해당. Vanilla B 버전은 비교 기준으로 보존 — §9).
- 작은 안내문(`text-[10px]`, amber-700)을 `text-xs`, amber-900으로 바꿔 가독성과 대비를 개선했다.

### 4.5 성능 (§7 실측)

같은 환경(Windows Node 24, Vite 8.3.8)에서 빌드해 측정했다. 기준값은 `f00936f`를 그대로 빌드한 결과다(요청문의 "568KB"는 보고 기준값이고, 실측은 563.34KB).

| 빌드 | 초기 로딩 JS | gzip | 전체 JS 합계 |
|---|---|---|---|
| `f00936f` (Package 4) | 563.34 KB (단일 청크) | 179.79 KB | 563.34 KB |
| Package 5 코드 분할 전 | 580.65 KB | 186.06 KB | 580.65 KB |
| **Package 5 최종** | **351.80 KB** | **115.34 KB** | 583.3 KB (index 351.80 + MapView 206.77 + ScannerView 18.9 + ExchangeView 4.5 + Onboarding 1.4) |

- 방식: `React.lazy`로 화면 4개를 분리했다. Leaflet은 지도 탭에서만 로드된다.
- 첫 화면(온보딩) JS는 563.34 KB에서 약 353 KB로 줄었다(-37%, gzip -36%).
- 지도 탭으로 바로 가는 재방문자는 index와 MapView를 합쳐 약 558 KB를 받으므로 전체 양은 거의 같다. 분할의 이점은 첫 화면과 메뉴/환율 탭에 한정된다.
- 전체 합계는 문구와 오류 처리가 추가되어 약 20 KB 늘었다.
- 실제 로딩 시간은 측정하지 않았으므로 시간 개선율은 기재하지 않는다.

### 4.6 보안

| 항목 | 결과 |
|---|---|
| API Key 서버 측 관리 | Key는 서버리스 함수에서만 사용. 이번에 URL 쿼리에서 헤더로 이동 |
| `.env` Git 제외 | `.gitignore:2`. `git log --all`에서 `.env`가 커밋된 적 없음 |
| Git 기록 내 Key 노출 | 전체 기록에서 실제 Key 문자열 0회, `AIza…` 패턴 0회 |
| 빌드 결과물 내 Key | `web/dist` 17개 파일에서 Key 0회, `GEMINI`/`VITE_` 참조 0회 |
| 정적 서버 민감 파일 | **수정함.** 기존 dev-server는 루트 아래 모든 `.js/.json/.css/.html`을 서빙했다(`tests/`, `web/node_modules/`, `web/package.json` 등). 루트 검사 `startsWith(__dirname)`도 형제 폴더(`jeonpo-ai-v2-x`)를 통과시켰다. 이제 허용 목록(`index.html`, `shared/` 3개 브라우저 모듈, `data/generated/*.json`)만 서빙한다. `.env`/`.git`은 원래도 확장자 조건 때문에 서빙되지 않았고, 지금도 404 |
| 동적 API 라우팅 | 기존 `^[a-zA-Z0-9-]+$` + `api/` 내 존재 파일만 허용(변경 없음) |
| 경로 탐색 | `..` 포함 요청 거부 + `__dirname + sep` 접두 검사, 잘못된 `%` 인코딩 예외 처리(TC-P5-18) |
| 업로드 크기 | 클라이언트 1024px JPEG 리사이즈, 서버 base64 4MB 제한(413), dev-server 본문 4.5MB 제한(413), MIME 허용 목록(jpeg/png/webp/heic/heif) |
| XSS | React 기본 이스케이프. `dangerouslySetInnerHTML` 0건 |
| 외부 근거 URL | `isSafeHttpUrl`(http/https만)로 검증 후 링크 — Vanilla/React 모두 기존 구현 확인 |
| 개인정보 외부 전송 | 분석 API에는 이미지만, 번역 API에는 요리 텍스트만 전송(프로필 미전송 — 기존 설계 유지). **커스텀 알레르기 문자열은 브라우저에서 `translate.googleapis.com`(비공식 무료 엔드포인트)으로 전송된다** — 건강 정보이므로 공개 배포 전 고지가 필요 |
| 의존성 | `npm audit` 0 vulnerabilities(prod/전체) |
| **API 남용 / 비용 제한** | **미완료.** 서버 캐시(30분, 이미지 해시)와 Gemini 측 쿼터 외에는 IP별 요청 제한이 없다. Key가 숨겨져 있어도 공개 URL의 `/api/analyze-menu`는 누구나 호출할 수 있다. 공개 배포 전 Vercel Firewall rate limit 등 필요(docs/DEPLOYMENT.md §5) |

### 4.7 배포 설정 (`vercel.json` 신규)

설치 `npm ci --prefix web`, 빌드 `npm run build --prefix web`, 출력 `web/dist`, 루트 `api/*.js` 함수(`maxDuration` 60/45초), SPA rewrite(`/api/`, `/data/`, `/assets/` 제외), 보안 헤더. 자세한 내용은 docs/DEPLOYMENT.md에 있다. 실제 Vercel 배포는 하지 않았으므로, Vercel 환경에서의 동작은 **미검증**이다.

## 5. 테스트

자세한 내용은 docs/TEST-REPORT.md에 있다.

- `tests/pkg5-repro-before.js`: 기준 커밋의 핸들러를 `git show`로 불러와, 실측과 같은 MAX_TOKENS 응답 Mock으로 502를 재현한다(**REPRODUCED**).
- `tests/pkg5-after.js`: **PASS 19 / FAIL 0 / NOT RUN 1**(89 assertions).
- `web/e2e/package5.spec.ts`: 9개 테스트 × mobile/desktop = **18/18 PASS**.
- 전체 Playwright: **34 PASS, 2 skipped**(실제 Gemini 스펙, `REAL_GEMINI=1`일 때만 실행). 프로덕션 빌드(`vite preview`) 대상으로 실행했다.
- 실제 Gemini 브라우저 E2E(`REAL_GEMINI=1`): **2/2 PASS**.
- 기존 JS 회귀: 전부 PASS. 예외는 기존부터 알려진 2건(§9).
- Python ETL 31/31 OK. Master DB 검증 PASS(Error 0, Warning 0).
- `tsc` 0 errors, production build 성공.

## 6. 변경 파일

| 파일 | 변경 |
|---|---|
| `shared/gemini-client.js` | 신규 — 생성 설정, 요청, 오류 분류, 응답 추출, 안전 로그 |
| `api/analyze-menu.js` | 출력 예산, 헤더 Key, 타임아웃, 오류 코드, 크기/MIME 검사, 10개 상한, coverage, ingredientSource, 프롬프트 2.1.0 |
| `api/translate-dish.js` | 출력 예산(사고 0), 헤더 Key, 타임아웃, 오류 코드 |
| `dev-server.js` | 정적 허용 목록, 본문 4.5MB 제한, 테스트용 `module.exports = server` |
| `vercel.json` | 신규 — 배포 설정 |
| `web/src/services/api.ts` | `ApiError`(code/retryable/diagnostic), 네트워크·빈 결과 구분, `canonicalIngredients` 보존 |
| `web/src/store/scanStore.ts` | 오류 코드/재시도/coverage 상태, 분석 시작 시 이전 결과 제거 |
| `web/src/components/scanner/ScannerView.tsx` | 사용자용 오류 문구, 재시도, 기술 정보, coverage 안내, 미리보기 contain, 오류 위치 |
| `web/src/components/scanner/DishResultList.tsx` | 재료 출처 안내/칩, 안내문 가독성 |
| `web/src/services/knowledgeBase.ts` | 지식 DB 조회에 영어 원문 사용 |
| `web/src/i18n/package5Extra.ts`, `web/src/i18n/index.ts` | 신규 문구 6개 언어 + GREEN 문구 덮어쓰기, `formatTemplate` |
| `web/src/types/index.ts` | `AnalysisCoverage`, `ingredientSource`, `canonicalIngredients`, 상태값을 실제 값(`valid/degraded`)으로 정정 |
| `web/src/App.tsx` | `React.lazy` 코드 분할 |
| `web/vite.config.ts`, `web/playwright.config.ts` | preview 프록시, `E2E_BASE_URL` |
| `web/e2e/package5.spec.ts`, `web/e2e/real-gemini.spec.ts`, `web/e2e/fixtures/menu-sample.jpg` | 신규 E2E / 실제 API E2E / 합성 메뉴판 |
| `tests/pkg5-repro-before.js`, `tests/pkg5-after.js` | 신규 |
| `README.md`, `docs/*.md`, `web/screenshots/*` | 문서와 대표 스크린샷 |

## 7. 개념 정리

| 개념 | 이 패키지에서의 의미 |
|---|---|
| Thinking token | 2.5 Flash가 답변 전에 내부적으로 쓰는 토큰. `maxOutputTokens`를 함께 소비한다 |
| finishReason | `STOP`이면 정상 종료, `MAX_TOKENS`이면 한도 도달로 잘림. HTTP 200이어도 결과가 불완전할 수 있다 |
| 오류 코드 vs HTTP 상태 | 같은 502라도 원인이 다르다. 화면 문구와 재시도 여부는 code로 정한다 |
| Coverage | "모두 분석했다"와 "일부만 분석했다"를 구분하는 메타데이터. 모델 자체 집계이므로 추정치다 |
| Code splitting | 첫 화면에 필요 없는 코드(Leaflet 등)를 나중에 받는다 |

## 8. 사용자 조치가 필요한 항목

- **5173 Vite 개발 서버 재시작:** 기존 프로세스(PID 3304)는 사용자가 띄운 프로세스라 이번 세션에서 종료 권한이 거부됐다. 네트워크 경로에서는 Vite 파일 감시가 동작하지 않으므로(PACKAGE-04 §9), 변경된 React 코드를 5173에서 보려면 직접 재시작해야 한다(`cd web && npm run dev`). 3000번 백엔드는 이 세션에서 재시작해 새 코드가 반영되어 있다.
- 공개 배포 전에 요청 제한(rate limit)과 개인정보 고지가 필요하다.
- `gemini-2.5-flash` 라우팅 변경(2026-12-01)이 결과 품질에 주는 영향을 재검증해야 한다.

## 9. 한계와 기존 이슈

- `tests/imp-11-repro-before.js` exit 1: 기준 커밋에서도 동일. 과거 재현용 테스트다(기존에 알려진 이슈).
- `tests/imp-13-after.js` TC-13-07 (Retry-After): **기준 커밋 `f00936f`에서도 8/8 FAIL**. `fetchWithRetry`가 Retry-After를 `maxDelayMs`(테스트에서 1ms)로 자르는데, 테스트는 15ms 이상 대기를 기대한다. 그래서 Windows 타이머 해상도에 따라 가끔만 통과한다. 이번 변경으로 생긴 회귀가 아니라 테스트와 구현의 기대가 어긋난 것이다. 범위 밖이라 수정하지 않았다.
- coverage는 사진 프레임 안에서 보이는 항목만 센다. 잘린 사진(#5)에서는 프레임 밖 항목을 알 수 없어 `isComplete: true`가 나왔다.
- "공기밥"처럼 하단 안내문 속 항목도 메뉴로 인식한다(실측 #2).
- 실제 단일 음식 사진, 인쇄된 성분표, 설명이 있는 메뉴판 사진으로는 실제 API 검증을 하지 않았다(보유한 실제 사진이 없고, 합성 이미지로는 의미가 적다). 단일 요리 경로는 Mock과 기존 데모 데이터로만 확인했다.
- Vanilla(B)는 비교 기준이라 이번 UI 수정(GREEN 문구, 지식 DB 영어 조회, 오류 문구)을 반영하지 않았다. 서버 응답 변경은 추가 필드만 있어 하위 호환이며, 기존 하네스 테스트가 통과한다.
- 스크린 리더 실사용 검사, 전체 색 대비 측정은 하지 않았다. 키보드 탐색은 Playwright로 건너뛰기 링크와 스캐너 컨트롤 도달만 확인했다.
- oxlint 경고 3건은 이번에 수정하지 않은 파일(ReviewSection/ReviewForm/MapView)에 있던 기존 경고다.
