# 최종 테스트 보고서 (Package 5 + UX 통합 개선)

> **최신 결과는 §7(UX 통합 개선 후 재검증)** 이다. §1~6은 Package 5 시점 기록으로 보존한다.

- 대상: `v2-dev` Package 5 작업본 (기준 `f00936f`)
- 환경: Windows 11, Node v24.19.0 (WSL 경로를 `Z:`로 매핑), Python `py` 런처, Chromium (Playwright 1.65)
- 실행일: 2026-11-27
- **Mock 테스트와 실제 Gemini 테스트를 구분해 기록한다.** 자동 테스트 스위트는 모두 Mock이다.

## 1. 요약

| 구분 | 명령 | 결과 |
|---|---|---|
| 타입 검사 | `cd web && npx tsc -b` | 0 errors |
| 프로덕션 빌드 | `cd web && npm run build` | 성공 (청크 6개, 초기 JS 351.80 KB / gzip 115.34 KB) |
| Playwright 전체 (Mock) | `E2E_BASE_URL=http://localhost:4173 npx playwright test` | **34 passed, 2 skipped** (skipped = 실제 Gemini 스펙) |
| Playwright 실제 Gemini | `REAL_GEMINI=1 E2E_BASE_URL=http://localhost:4173 npx playwright test e2e/real-gemini.spec.ts` | **2 passed** (mobile, desktop) |
| JS 회귀 (Node, Mock) | `node tests/<file>.js` × 21개 | 19개 파일 exit 0. 기존에 알려진 2건 — §4 |
| Package 5 신규 (Mock) | `node tests/pkg5-after.js` | PASS 19 / FAIL 0 / NOT RUN 1 (89 assertions) |
| 수정 전 재현 (Mock) | `node tests/pkg5-repro-before.js` | REPRODUCED (기준 커밋 핸들러 → 502) |
| Python ETL | `py -m unittest tests.test_food_knowledge` | 31/31 OK |
| Master DB 검증 | `py scripts/validate_food_knowledge.py` | PASS (Error 0, Warning 0) |
| 프로덕션 스모크 | `vite preview`(4173) + `dev-server.js`(3000) | `/`, `/data/generated/*.json` 200, `/api/*` 프록시 정상, 민감 경로 404 (§5) |
| 의존성 | `npm audit` | 0 vulnerabilities |

Playwright는 개발 서버(5173)가 아닌 **프로덕션 번들(`vite preview`)**을 대상으로 실행했다. 이 환경에서는 5173 개발 서버를 재시작할 수 없었다(사용자 프로세스, PACKAGE-05 §8).

## 2. Playwright 시나리오 (Mock API, mobile = Pixel 7, desktop = 1280×900)

| 영역 | 테스트 | mobile | desktop |
|---|---|---|---|
| 랜딩/온보딩 | onboarding completes and reaches the main app | PASS | PASS |
| 표준 알레르기 등록 / 프로필 저장·복원 | allergy selection persists across reload | PASS | PASS |
| 사진 분석 / RED / 프로필 변경 즉시 반영 (재호출 없음) | photo analysis … profile change updates it without a new analyze-menu call | PASS | PASS |
| 직원 질문 4유형 + 한국어 문구 | staff question panel offers 4 types | PASS | PASS |
| 리뷰 저장 / 새로고침 후 유지 | review can be added and survives reload | PASS | PASS |
| 지도 + 환율 | exchange view loads and calculates KRW conversion | PASS | PASS |
| API 오류 (구 서버 형식, code 없음) | analyze-menu failure shows an error state | PASS | PASS |
| 콘솔 오류 없음 | no unexpected console errors … | PASS | PASS |
| **P5** 429 → 사용자 문구 + 다시 시도 → 복구 | quota error (429) … recovers | PASS | PASS |
| **P5** 재시도 불가 오류 → 버튼 없음, 기술 정보 접힘 | non-retryable error (output truncated) | PASS | PASS |
| **P5** 서버 연결 실패 | network failure (server unreachable) | PASS | PASS |
| **P5** 새 분석 실패 시 이전 결과 미표시 | a failed new analysis never shows the previous photo result | PASS | PASS |
| **P5** 메뉴 일부 분석 안내 + AI 추정 칩 | menu coverage notice + ingredient-source label | PASS | PASS |
| **P5** GREEN = "일치 없음", 안전 보장 문구 없음 | GREEN result is worded as "no match" | PASS | PASS |
| **P5** 언어 변경 → 번역 1회, 재전환 시 캐시 | language switch translates once and reuses the cached translation | PASS | PASS |
| **P5** 가로 스크롤 없음(지도/메뉴/환율), 미리보기 `object-fit: contain` | no horizontal page scroll … | PASS | PASS |
| **P5** 키보드: 건너뛰기 링크 첫 Tab, 스캐너 컨트롤 도달 | keyboard: skip link … | PASS | PASS |
| 실제 Gemini (기본 skip) | real Gemini: 9-item Korean menu board | skipped | skipped |

환율 테스트는 실제 외부 API(`open.er-api.com`)를 호출한다(Package 4부터 동일). TTS(음성 재생)는 브라우저 음성 엔진에 의존해 자동 테스트에서 소리 출력을 검증하지 않았다. 직원 질문 패널의 "Speak/Stop/Copy" 버튼이 렌더링되는 것은 실제 E2E 스크린샷에서 확인했다.

## 3. 실제 Gemini 검증 (사용자 승인, 최소 호출)

생성 호출 7회와 모델 목록 1회. 각 호출의 상세는 docs/devlog/PACKAGE-05.md §3에 있다.

| 입력 유형 | 결과 | 비고 |
|---|---|---|
| 여러 음식이 있는 한글 메뉴판 (9품목, 설명 없음) | 수정 전: MAX_TOKENS → 502 / **수정 후: 10개 항목(공기밥 포함), 200, STOP** | 모든 항목 `ingredientSource: inferred` |
| 위 결과 10개 → 일본어 번역 | 10/10, 1,714 출력 토큰 | 기존 2,048 한도에서는 사고 토큰과 합쳐 초과할 수 있던 규모 |
| 음식과 무관한 이미지 | `dishes: []` → "음식을 찾지 못함" | |
| 흐리고 일부 잘린 메뉴판 | 7개 인식(절반 잘린 항목 포함) | 프레임 밖 항목은 알 수 없음 → coverage는 보이는 범위 기준 |
| 브라우저 E2E (프로덕션 빌드, 실제 API) | 9개 메뉴명 모두 표시, 대두 프로필 → RED, 일본어 전환 성공 | `web/screenshots/final-real-*.png` |
| 단일 음식 사진 / 성분표 / 설명이 있는 메뉴판 | **실제 API 미검증** | 실제 사진이 없어 Mock + 데모 데이터로만 확인 |

실제 API 응답에서 확인한 내용:
- 메뉴판에 이름만 있으면 재료와 알레르겐은 모두 추정이다. 화면에는 "AI 추정" 칩과 상단 안내 1회로 표시한다.
- 낙지(octopus)는 `squid`로 매핑됐다. 알레르겐 ID 목록에 문어 항목이 없기 때문이며, 이번 범위에서 바꾸지 않았다.

## 4. 기존에 알려진 실패 (이번 변경과 무관)

| 테스트 | 현상 | 기준 커밋 `f00936f`에서 |
|---|---|---|
| `tests/imp-11-repro-before.js` | exit 1 (PASS 1 / FAIL 5) | 동일 — 과거 재현용 |
| `tests/imp-13-after.js` TC-13-07 | Retry-After 최소 대기 단언 실패 (간헐적 PASS) | **8회 중 8회 FAIL** — `fetchWithRetry`가 Retry-After를 `maxDelayMs`(테스트값 1ms)로 자르는 설계와 테스트의 기대가 다름 |

## 5. 프로덕션 스모크 / 보안 확인 (실행 결과)

| 요청 | 결과 |
|---|---|
| `GET :3000/`, `/index.html`, `/shared/{allergens,dish-schema,food-knowledge}.js`, `/data/generated/knowledge-manifest.json` | 200 |
| `GET :3000/.env`, `/.git/config`, `/tests/harness.js`, `/api/analyze-menu.js`, `/shared/gemini-client.js`, `/web/package.json`, `/..%2f..%2fetc%2fpasswd.json` | 404 |
| `POST :4173/api/analyze-menu` (svg data URL, preview 프록시 경유) | 400 `IMAGE_INVALID`, `retryable: false` |
| 6MB 본문 POST (TC-P5-19) | 413 |
| Git 전체 기록 / `web/dist` 내 실제 Key 문자열 | 0건 / 0건 |

## 6. 스크린샷 (`web/screenshots/`)

| 파일 | 내용 |
|---|---|
| `final-real-menu-mobile.png`, `final-real-menu-desktop.png` | **실제 Gemini** 9품목 메뉴판 분석 결과 (RED, AI 추정 안내, 지식 DB, 직원 질문) |
| `final-real-menu-ja-mobile.png`, `final-real-menu-ja-desktop.png` | **실제 Gemini** 일본어 전환 결과 |
| `p5-01-error-quota-retry.png` | Mock 429 → 사용자용 오류 + 다시 시도 |
| `p5-02-menu-coverage.png` | Mock 일부 분석 안내 |
| `p5-03-menu-preview.png` | 세로 메뉴판 미리보기 (잘림 없음) |
| `01`~`07-*.png` | Package 4 시나리오 (이번 실행에서 다시 생성) |

## 7. UX 통합 개선 후 재검증 (2026-11-27)

상세는 [docs/UX-IMPROVEMENT.md](UX-IMPROVEMENT.md)에 있다.

- 환경 변경: `web/node_modules`가 WSL(Linux)에서 다시 설치되었다. 그래서 타입 검사, 빌드, 개발 서버, 미리보기 서버는 WSL(Node v26.13.1)에서 실행했다. Playwright는 같은 `node_modules`의 JS CLI(`node node_modules/@playwright/test/cli.js`)를 Windows Node v24로 실행했다.
- 서버: React 개발 `:5174`(WSL), 프로덕션 미리보기 `:4175`(WSL `vite preview`). 둘 다 WSL `dev-server.js :3000`으로 프록시한다.

| 구분 | 명령 / 대상 | 결과 |
|---|---|---|
| 타입 검사 | WSL `npx tsc -b` | 0 errors |
| 프로덕션 빌드 | WSL `npm run build` | 성공 |
| Lint | WSL `npx oxlint src` | 0 errors, 경고 3건(기존 파일) |
| Playwright 전체 (Mock) | `E2E_BASE_URL=http://localhost:4175` (프로덕션 번들) | **60 passed, 2 skipped**(실제 Gemini 스펙) |
| └ 신규 `e2e/ux-improvement.spec.ts` | 음식별 위험도, 선택 음식 → 질문/TTS/복사, 같은 이름 음식 독립 선택, 고정 직원 질문, 지도 → 실제 업로드 + 식당 유지 + 리뷰 연결, 데모 분리, 새로고침 복원과 뒤로 가기, 복원 시 현재 프로필로 재계산, 번역 중 표시, 일본어 Matched/DB 재료, 환율 참고값 표기, 리뷰 번역과 예시 배지, 알레르기 없음/미입력 구분 | 13 × 2 = 26 passed |
| JS 회귀 (Mock) | `node tests/*.js` 21개 | 전부 PASS. `imp-11-repro-before`만 exit 1(기존 동일) |
| Python ETL / Master DB | `py -m unittest …` / `py scripts/validate_food_knowledge.py` | 31/31 OK / PASS |
| 6개 언어 UI 미번역 탐지 | 앱 i18n 소스의 영어 UI 문자열을 화면에서 탐지(온보딩, 결과+펼침, 지도/리뷰, 환율, 프로필) | en/ja/zh/vi/es/ko 모두 0건, 콘솔 오류 0 |
| UX 지표 재측정 (Mock 재생) | 감사와 같은 스크립트 조건, 390px | UX-IMPROVEMENT §4 |
| 실제 Gemini | 개선 후 여정 1회(분석 1 + 번역 1) | 14.2초, 9개 항목, 번역 중 표시 확인, 콘솔 오류 0 |
| NOT RUN | 실제 TTS 음성 품질, iOS/Android 실기기, 스크린 리더, Vanilla 재감사 | — |

스크린샷: 개선 전 `web/screenshots/ux-audit/`, 개선 후 `web/screenshots/ux-improvement/`. Playwright 기본 스크린샷(`01`~`07`, `p5-*`)은 새 UI로 다시 생성했다.

## 8. 메뉴판 가격·환율 통합 후 재검증 (2026-11-27)

상세는 [docs/UX-IMPROVEMENT.md §9](UX-IMPROVEMENT.md#9-추가-개선--메뉴판-가격과-환율-통합-27bfa50-이후)에 있다. 환경은 §7과 같다(WSL에서 빌드, Windows Node로 Playwright 실행, 대상은 `:4175` 프로덕션 미리보기).

| 구분 | 결과 |
|---|---|
| 타입 검사 / 빌드 / lint (WSL) | 0 errors / 성공 / 경고 3건(기존) |
| Playwright 전체 (Mock) | **86 passed, 2 skipped**(실제 Gemini 스펙) |
| └ 신규 `e2e/price.spec.ts` | 13 × 2 = 26 passed(반복 2회 실행에서도 통과) |
| `tests/price-after.js` | PASS 14 / NOT RUN 1 |
| JS 회귀 21개 + `pkg5-after` | 전부 PASS(`imp-11-repro-before`만 기존과 동일하게 exit 1) |
| Python ETL / Master DB | 31/31 OK / PASS |
| 실제 Gemini | 2회: 가격이 인쇄된 메뉴판 10/10 일치, 가격 열이 잘린 메뉴판 7/7 `not_shown` |
| API 호출 측정 | 통화 5회 변경, 음식 3개 선택, 탭 4회 이동 중 분석·번역·환율 추가 호출 0회. 세션 전체 환율 요청 1회 |

테스트 수정 2건(앱 동작 변경 아님):
- `ux-improvement.spec.ts`: 번역 지연 Mock을 1.5초에서 4초로 늘렸다. 느린 모바일 실행에서 "번역 중" 표시가 사라진 뒤에 확인하던 타이밍 문제다.
- `package5.spec.ts`: 키보드 테스트의 시작 포커스를 명시했다. 모바일 에뮬레이션에서 탭이 포커스를 옮기지 않는 경우가 있었다.

## 9. Gemini 사용량 한도 처리 보완 + 최종 실제 검증 준비 (2026-11-27)

### 9.1 확인된 원인

백엔드를 재시작한 뒤 실제 메뉴판으로 확인하려 했으나 Gemini가 `429 RESOURCE_EXHAUSTED`를 반환했다. 응답의 오류 상세에서는 다음을 확인했다(Key는 출력하지 않음).
- 한도: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`(무료 등급 `gemini-2.5-flash` 일일 요청 20회)
- 재시도 가능 시간: `retryDelay: "20640s"`

오늘 진단과 검증 과정에서 일일 한도를 모두 사용했다. 이후 실제 Gemini API는 호출하지 않았다. 모델 변경이나 유료 결제 설정은 하지 않았다.

### 9.2 보완 내용

| 항목 | 구현 |
|---|---|
| 한도 종류 구분 | 429 오류 상세의 `quotaId`로 구분: 일일(`PerDay`) → `AI_QUOTA_DAILY`, 분당 요청(`PerMinute`) → `AI_QUOTA_MINUTE`, 토큰(`Token`) → `AI_QUOTA_TOKENS`, 상세 없음 → 기존 `AI_QUOTA` |
| 일일 한도 자동 재시도 중단 | `fetchWithRetry`에 `inspectResponse` 훅을 추가하고, 일일 한도면 즉시 중단(요청 1회). 서버에 프로세스 단위 차단을 두어, 일일 한도 이후 요청은 Gemini를 호출하지 않고 바로 429로 응답한다(재시도 가능 시각까지, 분석·번역 공통, 시각이 지나면 1회로 다시 확인) |
| 재시도 가능 시간 활용 | `RetryInfo.retryDelay`(없으면 HTTP `Retry-After`)를 분당·토큰 한도의 대기 시간으로 사용한다. 재시도 예산보다 길면 재시도하지 않는다. 클라이언트에는 `retryAfterSeconds`와 `Retry-After` 헤더로 전달 |
| 사용자 메시지 | 6개 언어 문구, 재시도 가능 시점을 `Intl.RelativeTimeFormat`으로 표시("6시간 후", "in 6 hours"). 일일 한도는 재시도 버튼 없음. 분당·토큰 한도는 시간이 될 때까지 버튼 비활성화 후 활성화. 번역 일일 한도는 영어 원문 유지와 전용 안내 |
| 독립 기능 | 분석이 실패해도 지도, 식당 카드, 리뷰 작성, 환율 계산, 프로필 변경이 정상 동작(E2E 확인) |
| 캐시 정책 | 서버 분석·번역 캐시는 차단 확인보다 먼저 조회한다(같은 사진은 한도와 관계없이 캐시 응답). 세션 복원 결과도 유지 |

### 9.3 테스트 (모두 Mock, 실제 Gemini 호출 0회)

| 구분 | 결과 |
|---|---|
| `tests/quota-after.js` | PASS 11 / NOT RUN 1. 실제 429 본문 구조를 그대로 사용: 분류, 일일 한도 요청 1회, 이후 Gemini 호출 0회(분석·번역 공통), 시간 경과 후 재개, 차단 중 캐시 응답, 짧은 RetryInfo 대기 후 성공, 긴 대기는 포기하고 시간 전달, 토큰 한도, 기존 429 동작 유지 |
| `e2e/quota.spec.ts` | 10 시나리오 × 2 = 20 passed: 일일 한도 문구와 시간, 버튼 없음, 지도·리뷰·환율·프로필 정상, 분당 한도 버튼 대기 후 재시도 성공, 토큰 한도 문구, 번역 한도 시 원문 유지와 가격 환산 유지, 세션 복원 결과와 통화 변경(호출 0), 5개 언어 상대 시간 |
| `e2e/price.spec.ts` | 26 passed. 통화 변경과 환율 갱신(새로고침 후 새 환율) 시 분석 0회, 번역 0회 확인 추가 |
| Playwright 전체 (`:4175` 프로덕션 번들) | **106 passed, 2 skipped**(실제 Gemini 스펙) |
| JS 회귀 / `price-after` / `pkg5-after` | 통과. `imp-11-repro-before`(기존 동일), `imp-13` TC-13-07(기존 간헐 실패, 기준 커밋에서도 8/8 FAIL, 이번 변경 경로와 무관)만 실패 |
| Python / Master DB / tsc / build | 31/31 / PASS / 0 errors / 성공 |
| **NOT RUN** | 실제 메뉴판 사진의 가격 추출 검증, 실제 메뉴판과 환율 통합 검증(브라우저), 실제 429 재현(한도 소진 상태라 의도적으로 생략) |

### 9.4 한도 초기화 후 최종 검증 절차 (실제 메뉴판 사진 1장)

1. 한도 초기화를 기다린다. 429 응답의 `retryDelay`는 확인 시점부터 약 5시간 44분이었다. 서버가 그 시각까지 요청을 막고 있으므로, 그 전에 시도하면 Gemini 호출 없이 같은 안내가 나온다.
2. 백엔드는 이미 최신 코드로 재시작되어 있다(WSL `dev-server.js :3000`, 로그 `/tmp/fitbridge-backend.log`). 이후 다시 재시작하면 서버의 일일 한도 차단도 초기화된다.
3. 둘 중 하나를 실행한다(각 Gemini 1회).
   - **앱에서:** `http://localhost:5174` → 메뉴 탭 → 사진 추가 → 분석. 음식 목록의 가격(₩)과 ≈ 환산, 통화 변경, 환율 탭 동기화를 확인한다.
   - **스크립트로:** `node scripts/verify-real-menu.cjs <사진.jpg> --currency USD`. 분석 1회와 환율 1회를 요청하고, 음식명·가격 상태·금액·환산·범위를 출력한 뒤 사진과 비교할 체크리스트를 보여 준다. Key를 읽지 않는다. Mock 서버로 정상 응답과 일일 한도 응답 출력을 확인했다.
4. 결과를 이 문서 §9.3의 NOT RUN 항목에 기록한다.