# 아키텍처 (전포 AI / FitBridge V2)

## 1. 구성

```
브라우저 (React 19 + TS, web/)                 서버리스 (루트 api/, Node)            외부
┌───────────────────────────────┐   POST    ┌──────────────────────────────┐  HTTPS  ┌──────────────┐
│ ScannerView ─ scanStore ──────┼──────────▶│ api/analyze-menu.js          │────────▶│ Gemini API   │
│   (zustand: 분석/번역/캐시/취소)│ /api/...  │   이미지 → 언어 중립 영어 분석 │ x-goog- │ 2.5 Flash    │
│ DishResultList                │◀──────────┤ api/translate-dish.js        │ api-key │ (기본값)     │
│   safety.ts (RED/ORANGE/...)  │  JSON     │   분석 텍스트 → 화면 언어      │         └──────────────┘
│   knowledgeBase.ts ◀── GET /data/generated/*.json (식품 지식 DB, 정적)    │
│ MapView(Leaflet, lazy)        │           │ shared/ (서버·브라우저 공용)   │
│ ExchangeView ── open.er-api   │           │   allergens.js  dish-schema.js│
│ profileStore (localStorage)   │           │   food-knowledge.js           │
└───────────────────────────────┘           │   gemini-client.js (서버 전용) │
                                            │   http-retry.js server-cache.js│
                                            └──────────────────────────────┘
```

- **두 프론트엔드가 같은 서버를 쓴다.** 루트 `index.html`(Vanilla V2, B 버전)과 `web/`(React V2, C 버전)이 동일한 `api/`와 `shared/`를 사용한다. 프로덕션 배포 대상은 React 빌드(`web/dist`)다.
- **분석과 번역을 분리했다(IMP-04).** 언어를 바꾸면 번역 API만 호출한다. 알레르겐, 맵기, foodId는 번역 요청에 아예 포함되지 않으므로 번역 과정에서 바뀔 수 없다.
- **판정은 클라이언트에서 한다.** 프로필은 서버로 보내지 않는다. RED/ORANGE/GREEN/UNKNOWN/ERROR는 `web/src/lib/safety.ts`가 (AI 알레르겐 배열, 사용자 프로필)로 계산한다. 그래서 프로필을 바꾸면 재호출 없이 즉시 반영된다(IMP-07).
- **식품 지식 DB(IMP-18D-2)**는 Excel 마스터를 Python ETL로 만든 `data/generated/*.json`이다. AI 판정을 바꾸지 않고 "추가 확인 정보"만 덧붙인다. 조회 키는 영어 원문 재료다(Package 5: 번역문이 아닌 `canonicalIngredients`로 조회).

## 2. 요청 흐름 — 메뉴판 분석

1. 브라우저가 사진을 1024px JPEG로 리사이즈해 data URL로 `POST /api/analyze-menu`에 보낸다.
2. 서버는 다음 순서로 처리한다.
   - 입력 검사(크기 4MB, MIME 허용 목록)
   - 캐시 조회(이미지 SHA-256 + 모델 + 프롬프트 버전 + 스키마 버전)
   - Gemini 호출: `maxOutputTokens 8192`, `thinkingBudget 1024`, 시도당 45초, 총 55초, 429/5xx/네트워크 오류는 재시도
3. 응답 처리:
   - `finishReason` 검사 → `JSON.parse` → `shared/dish-schema.js` 정규화(유효 / 부분 / 빈 결과 / 무효)
   - 10개 상한 적용, `coverage`와 `ingredientSource` 부착
   - 성공한 결과만 캐시
4. 브라우저는 결과를 받아 다음을 수행한다.
   - 봉투(envelope)를 재검증하고, 빈 결과는 `NO_FOOD_FOUND`로 처리
   - 화면 언어가 영어가 아니면 `/api/translate-dish` 호출(클라이언트 LRU 캐시 20개, 서버 TTL 캐시)
   - 프로필로 위험도를 계산하고, 지식 DB 결과를 덧붙여 렌더링

## 3. 오류 모델

서버 오류 응답은 `{ error: 개발자 메시지, code, retryable }` 형식이다. 코드 목록과 HTTP 상태는 `shared/gemini-client.js`의 `ERROR_CODES`와 docs/devlog/PACKAGE-05.md §4.2에 있다. 프론트(`web/src/services/api.ts`)는 code를 6개 언어 문구로 바꾸고, `retryable`일 때만 "다시 시도"를 보여 준다. `code`가 없는 구버전 응답은 HTTP 상태로 추정한다.

사용량 한도(429)는 오류 상세의 `quotaId`로 `AI_QUOTA_DAILY` / `AI_QUOTA_MINUTE` / `AI_QUOTA_TOKENS`로 나눈다. 재시도 가능 시간(`RetryInfo` 또는 `Retry-After`)은 `retryAfterSeconds`로 전달한다. 일일 한도가 확인되면 서버(`shared/gemini-client.js`의 `quotaGate`)가 그 시각까지 Gemini를 호출하지 않고 바로 응답한다. 캐시 조회는 이 차단보다 먼저 이루어진다.

위험도 상태와 분석 실패는 서로 다른 축이다. 분석이 실패하면 결과 자체를 표시하지 않는다(ERROR 배너가 아니라 오류 안내). 결과가 있을 때의 UNKNOWN/ERROR는 개별 필드 불확실성을 뜻하며, 기존 RED/ORANGE 경고를 덮지 않는다(IMP-03/15).

## 4. 정보 출처 구분

| 출처 | 화면 표시 |
|---|---|
| AI 추정 (이름만 보고) | 요리별 "AI 추정" 칩 + 목록 상단 안내, 배너 끝 "(사진 기반 AI 추정 — 식당 확인 아님)" |
| AI가 사진 속 글자에서 읽음 | "사진 글자에서 읽음" 칩 + 인식 오류 가능 안내 |
| 문헌 기반 지식 DB | "식품 지식 DB 확인" 섹션 + "문헌 기반, 전문가 검토 전" 문구 |
| 데모 데이터 (지도 마커) | "demo" 출처 문구 (`sourceDemoNote`) |
| 실제 음식점 확인 정보 | 없음 — 앱은 어떤 정보도 "식당 확인"으로 표시하지 않는다 |

## 5. 주요 디렉터리

| 경로 | 내용 |
|---|---|
| `api/` | Vercel 서버리스 함수 2개 |
| `shared/` | 서버·브라우저 공용 UMD 모듈 + 서버 전용 헬퍼 |
| `web/` | React 앱 (Vite, Zustand, Tailwind v4, Leaflet, Playwright) |
| `index.html` | Vanilla V2 (비교 기준으로 보존) |
| `data/master/` → `scripts/food_knowledge/` → `data/generated/` | 지식 DB ETL (Excel → 검증 → JSON) |
| `dev-server.js` | 로컬 전용 서버 (`.env` 로드, `/api` 라우팅, 정적 허용 목록) |
| `tests/` | Node VM 하네스 기반 회귀 테스트 + Python ETL 테스트 |
