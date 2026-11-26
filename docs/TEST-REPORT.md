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