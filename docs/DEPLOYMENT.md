# 배포 가이드 (Vercel)

> 상태: **설정만 준비했고, 실제 Vercel 배포와 원격 저장소 연결은 하지 않았다.** 아래 §4 로컬 검증까지만 실행했다. Vercel 환경에서의 동작은 미검증이다.

## 1. 구성 (`vercel.json`)

| 항목 | 값 | 이유 |
|---|---|---|
| 설치 | `npm ci --prefix web` | 루트에는 `package.json`이 없고, 프론트 의존성은 `web/`에만 있다 |
| 빌드 | `npm run build --prefix web` | `tsc -b && vite build`. 빌드 중 `data/generated/*.json`을 `web/dist/data/generated/`로 복사한다 |
| 출력 | `web/dist` | React 프로덕션 번들 |
| 서버리스 | 루트 `api/analyze-menu.js`(maxDuration 60초), `api/translate-dish.js`(45초) | 서버 측 총 예산 55초/40초보다 약간 크게 |
| shared 모듈 | 별도 설정 없음 | `api/*.js`가 `require('../shared/...')`로 참조하면 Vercel 파일 추적이 함께 포함한다 |
| 데이터 | `/data/generated/*.json` | 빌드 산출물에 포함되어 정적으로 서빙된다 |
| SPA | `/api/`, `/data/`, `/assets/`를 제외한 경로는 `/index.html`로 rewrite | 현재 화면 전환은 상태 기반(URL 라우트 없음)이라 새로고침 대비용이다 |
| 헤더 | `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, `/assets/*` 1년 immutable 캐시 | CSP는 외부 의존(지도 타일, Unsplash, 환율, Google 번역)을 확인한 뒤 별도로 설정할 것 |

루트의 Vanilla `index.html`은 출력 디렉터리 밖에 있어 배포되지 않는다(저장소에는 비교 기준으로 남는다).

## 2. 환경변수 (Vercel → Settings → Environment Variables)

| 이름 | 필수 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | 필수 | 서버 함수에서만 읽는다. **`VITE_` 접두어를 붙이지 말 것**(붙이면 브라우저 번들에 포함된다) |
| `GEMINI_MODEL` | 선택 | 기본 `gemini-2.5-flash`. `gemini-` 형식만 허용한다. Google 공지상 2026-12-01부터 2.5 Flash는 `gemini-3.5-flash-lite`로 라우팅되므로, 모델을 바꿀 때는 실제 메뉴판으로 품질을 재검증할 것 |

## 3. 배포 순서 (사용자 승인 후)

1. 원격 저장소 생성/연결 및 push (현재 금지 — 승인 필요)
2. Vercel에서 저장소를 Import한다. Framework Preset은 "Other"(vercel.json이 명령을 지정)
3. 환경변수 `GEMINI_API_KEY`를 Production/Preview에 등록
4. 배포 후 확인
   - `/`가 200이고 온보딩이 보이는지
   - `/data/generated/knowledge-manifest.json`이 200인지
   - 메뉴판 1장 실제 분석과 언어 전환
   - Functions 로그에 `[analyze-menu] AI_*` 오류가 없는지

## 4. 로컬 프로덕션 검증 (실행함)

```bash
node dev-server.js                       # :3000 — api/ + data/generated (.env의 GEMINI_API_KEY)
cd web && npm run build && npx vite preview --port 4173   # 프로덕션 번들, /api·/data는 :3000으로 프록시
E2E_BASE_URL=http://localhost:4173 npx playwright test    # Mock 스위트
REAL_GEMINI=1 E2E_BASE_URL=http://localhost:4173 npx playwright test e2e/real-gemini.spec.ts  # 실제 API (호출 비용 발생)
```

결과는 docs/TEST-REPORT.md에 있다(34 passed / 2 skipped, 실제 API 2 passed). `vite preview`는 `vercel.json`의 헤더와 rewrite를 적용하지 않으므로, 그 부분은 Vercel 배포 후 확인해야 한다.

## 5. 공개 배포 전 필수 보호 장치 (미완료)

API Key를 숨기는 것과 공개 API의 무분별한 호출을 막는 것은 별개의 문제다. 현재 상태는 다음과 같다.

| 보호 장치 | 상태 |
|---|---|
| Key 서버 보관, 번들 미포함 | 완료 (검사 결과 0건) |
| 요청 크기 제한 (4MB / 4.5MB), MIME 제한 | 완료 |
| 같은 이미지 재분석 방지 (서버 캐시 30분) | 완료. 인스턴스 메모리 캐시라 인스턴스 간에는 공유되지 않는다 |
| **IP/사용자별 요청 제한 (rate limit)** | **미완료** — Vercel Firewall Rate Limiting 규칙(`/api/*`) 또는 외부 저장소 기반 limiter 필요 |
| **비용 상한** | **미완료** — Google Cloud 프로젝트 예산 알림 / Gemini 쿼터 상한 설정 필요 |
| 봇/남용 방지 (CAPTCHA, Origin 검사 등) | 미완료 |
| 개인정보 고지 | 미완료 — 사진은 Gemini로, 커스텀 알레르기 문자열은 Google 번역 엔드포인트로 전송된다. 무료 등급에서는 Google이 데이터를 모델 개선에 사용할 수 있다 |

위 미완료 항목을 해결하기 전에는 공개 URL을 널리 배포하지 않는 것을 권장한다.
