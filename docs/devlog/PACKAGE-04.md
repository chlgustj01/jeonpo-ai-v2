# Package 4 — React·TypeScript 전환 및 UI/UX 고도화

> IMP-10. 기준 커밋 `b3a5751`(Package 3). 전체 작업은 `web/` 신규 서브
> 디렉터리에서 진행했고, 기존 `index.html`/`api/`/`shared/`/`tests/`는
> **한 글자도 수정하지 않았다** — 전환 검증 전까지 복구/비교가 가능해야
> 한다는 §2 지시 그대로, 바이트 단위로 그대로 보존된다(`git status`로 확인).

## 1. 적용 기술 스택

- **React 19 + TypeScript + Vite 8** (`web/` 하위 독립 프로젝트)
- **Zustand 5** — 상태 관리(profile/scan/review/ui 4개 스토어, persist 미들웨어)
- **Tailwind CSS v4**(`@tailwindcss/vite` 플러그인) — 기존 CDN Tailwind의
  vintage 색상 팔레트/폰트를 `@theme` CSS 변수로 1:1 이식
- **Leaflet**(npm 패키지로 전환, CDN 스크립트 태그 제거) — 지도는 React
  래퍼 없이 `useRef`+`useEffect`로 명령형 그대로 통합(불필요한
  `react-leaflet` 의존성 추가 안 함)
- **Playwright** — 실제 브라우저 검증(§10)
- shared/*.js(`allergens.js`, `food-knowledge.js`)는 그대로 import해서
  재사용 — 로직을 TypeScript로 다시 작성하지 않았다

## 2. 최종 폴더 구조

```
web/
  src/
    types/        - 도메인 타입(Dish, Profile, SafetyResult, StaffQuestions...)
    i18n/          - translations.generated.ts(원본에서 자동 추출) + 신규 보강 키
    lib/           - 순수 함수(checkDishSafety, generateStaffQuestions, 환율 계산 등)
    services/      - api.ts(analyze-menu/translate-dish 호출), knowledgeBase.ts(IMP-12/18D-2 로더)
    store/         - profileStore/scanStore/reviewStore/uiStore(zustand) + wiring.ts
    hooks/         - useT, useSpeech, useCustomAllergy, useDishKnowledgeReport, useExchangeRates...
    components/    - common/ onboarding/ profile/ scanner/ map/ reviews/ exchange/ layout/
    data/          - locations/demoReviews(원본 데모 데이터 자동 추출본)
  e2e/             - Playwright 스펙 + 1x1 PNG 픽스처
  scripts/         - 원본 index.html에서 대용량 리터럴을 추출하는 1회성 도구
  vite.config.ts   - /api, /data를 기존 dev-server.js(3000)로 프록시 + shared/*.js dev 모듈 보간
```

데이터(번역 900여 줄, locations 580줄, 데모 리뷰 99줄)는 손으로 재입력하지
않고 `scripts/extract-data.cjs`/`assemble-data.cjs`로 원본 `index.html`에서
그대로 뽑아냈다 — 전사 오류 위험 제거 + 기존 번역 전부 보존.

## 3. 주요 컴포넌트와 상태 구조

- **profileStore**(persist, 키 `fitbridge_profile_v1`, 기존과 완전히 동일) —
  lang/dietary/nationality/selectedSpicy/selectedAllergies/customAllergies.
  `Set`↔배열 직렬화, 레거시 알레르기 id 마이그레이션(§IMP-11)을 저장소
  어댑터 안에서 그대로 수행.
- **scanStore**(비영속) — lastAnalysis/translationCache/displayedDishes/
  요청별 AbortController. §IMP-04/05/06을 그대로 포팅하되, 언어 변경 시
  재번역은 `store/wiring.ts`가 profileStore 구독으로 처리 — 기존의
  "setLanguage가 분석 함수를 다시 부르고 그 안에서 단락 처리" 우회로가
  없어지고 "언어가 바뀌면 번역만 다시 부른다"가 되었다.
- **reviewStore**(persist, 키 `fitbridge_user_reviews_v1`, 기존과 동일) —
  데모 리뷰(`demoReviews.generated.ts`)와 분리 유지, 손상 데이터 복구 포함.
- **uiStore**(비영속) — activeTab/모달/토스트/필터 등 순수 UI 상태.
- **DishResultList**가 실제 AI 멀티스캔과 지도 데모 단일 스캔을
  **하나의 컴포넌트**로 통합(§7 정보 계층 순서 그대로: 이름/출처 →
  SafetyBanner → KnowledgeSection → StaffQuestionPanel → 펼쳐보기 세부
  정보) — 기존엔 `renderMultiDishScanResult`/`renderScanResultUI` 두 렌더
  경로가 따로 있었다.
- **checkDishSafety/generateStaffQuestions/getSpeechScript** 등은 전부
  `state`를 읽는 함수에서 `(dish, profile)`을 받는 순수 함수로 다시 썼다
  — 로직 자체는 한 줄도 바뀌지 않았고(§IMP-01~12 그대로), React의
  `useMemo`/selector가 "프로필이 바뀌면 다시 계산"을 구조적으로
  보장하므로 §IMP-07의 `recalcCurrentScanSafety()`/`onProfileChanged()`
  같은 수동 디스패처 자체가 통째로 불필요해졌다.

## 4. 기존 기능 유지 여부

| 기능 | 상태 |
|---|---|
| 온보딩/프로필 저장(localStorage 키 동일) | ✅ 유지, 레거시 마이그레이션 포함 |
| 알레르기 선택/커스텀 알레르기(IMP-12 엔티티 해소 전부) | ✅ 유지 |
| 이미지 분석↔번역 분리(IMP-04), 캐싱(IMP-05) | ✅ 유지, 서버 계약 변경 없음 |
| 요청 취소/응답 순서 제어(IMP-06) | ✅ AbortController 그대로, React가 구조적으로 보강 |
| 위험도 RED/ORANGE/UNKNOWN/ERROR(IMP-01/03/11) | ✅ 색상+아이콘+텍스트 동시 표시 |
| 지식 DB 추가 확인(IMP-18D-2), autoApplyToRiskJudgment:false | ✅ 유지, 참기름→참깨를 "추가 확인 후보"로만 표시 |
| 직원 질문 4유형 + TTS(IMP-09) | ✅ 유지, 중복 발화 가드 포함 |
| 리뷰 CRUD + 데모 분리(IMP-14) | ✅ 유지 |
| 환율 계산기, 지도 | ✅ 유지(지도는 Leaflet 그대로, npm 패키지로 전환) |
| API 재시도(IMP-13) | ✅ 서버 쪽 변경 없음(React는 클라이언트일 뿐) |
| XSS 방어(IMP-02 §11) | ✅ JSX 자동 이스케이프로 구조적으로 보강(수동 escapeHtml 불필요해짐) |

**탭 구조는 4개(지도/스캐너/TTS/환율)에서 3개(지도/스캐너/환율)로
정리했다** — 요청사항 §6 "기존 탭은... 사용자 흐름을 기준으로 정리한다"
그대로. TTS 탭의 역할(알레르기 확인+발화)은 프로필 모달(편집)과 스캔
결과에 붙은 StaffQuestionPanel(발화)로 흡수됐다 — 지도/스캔/직원질문/
환율 네 기능 자체는 전부 그대로 있다(§6 "누락하지 않는다" 충족), 다만
항상 보이는 탭 슬롯 하나를 차지하진 않는다.

## 5. UI 개선 전후

- 위험도 배너: 색상만이 아니라 "RED/ORANGE/UNKNOWN/ERROR" 텍스트 배지 +
  아이콘을 항상 함께 표시(§7 접근성 지시).
- 리뷰 통계 카드의 영어 하드코딩 문구(Package 3 §IMP-08 한계로 남겨둔
  부분)를 이번에 번역 키로 승격해 6개 언어 전부 적용했다(§8).
- 모바일 우선: 터치 영역 44px 이상, 하단 고정 네비게이션 3탭, 포커스
  표시(`:focus-visible` 브랜드 색), 스킵 링크, 모달 `role="dialog"`.
- 장식성 애니메이션(스캔 레이저 스윕 등)은 제거 — §6 "과도한 장식과
  애니메이션 지양".

## 6. 실제 화면 스크린샷

`web/screenshots/`(모바일 뷰포트, Pixel 7 기준):
`01-onboarding-complete.png`, `02-profile-modal.png`,
`03-scan-result-red.png`(RED 배너+지식DB+직원질문 전부 한 화면),
`04-staff-questions.png`, `05-review-added.png`(데모+사용자 리뷰 공존,
"Saved on this device" 배지), `06-exchange.png`, `07-analysis-error.png`.

## 7. 타입 검사 및 빌드 결과

```
npx tsc --noEmit -p tsconfig.app.json   → 에러 0건
npm run build (tsc -b && vite build)    → 성공, 68 modules, 2.7s
  dist/assets/index-*.js  563 KB (gzip 180 KB) — 청크 분할 경고 있음(§11 한계 참고)
```
`vite.config.ts`의 빌드 플러그인이 `data/generated/*.json`을
`dist/data/generated/`로 복사해 production 번들이 자급자족한다(Package 5
실제 배포를 염두에 둔 구조, 이번엔 배포 자체는 하지 않음).

## 8. 실제 브라우저 테스트(Playwright)

`web/e2e/critical-flows.spec.ts` — Mock API(analyze-menu/translate-dish,
실제 Gemini 호출 없음) 기준 8개 시나리오 × 데스크톱/모바일(Pixel 7) 2개
프로젝트 = **16/16 PASS**:

1. 온보딩 → 메인 진입
2. 알레르기 선택 → 새로고침 후 복원(localStorage)
3. 사진 분석(Mock) → RED 배너 → **무관한 알레르기 변경 → analyze-menu/
   translate-dish 재호출 0회 확인하며 배너 즉시 갱신**
4. 직원 질문 4탭 전환 + 한국어 문장 노출
5. 리뷰 추가 → 새로고침 후 복원, 데모 리뷰와 공존
6. 환율 계산기 정상 동작
7. analyze-menu 500 실패 → 에러 상태 표시(이전 결과 잔류 없음)
8. 핵심 플로우 전체에서 콘솔 에러 0건

개발 중 Playwright로 실제 발견·수정한 결함 2건(코드 자체의 버그,
테스트 스크립트 오류 아님):
- `onRehydrateStorage` 콜백이 아직 선언되지 않은 `useProfileHydration`을
  참조해 TDZ로 조용히 실패 → 화면이 영원히 빈 화면(hasHydrated가 절대
  true가 안 됨). 선언 순서를 바꿔 해결.
- Zustand 선택자가 `(s) => ({...})`/`(s) => s.x[key] || []` 형태로 매
  렌더마다 새 객체/배열을 반환 → `useSyncExternalStore`가 무한 루프로
  판단(`Maximum update depth exceeded`), 해당 화면 전체가 백지로 깨짐.
  `useShallow` 또는 안정적인 공유 상수로 교체해 3곳 모두 해결.

음성 출력(`speechSynthesis`) 자체의 실제 발화 품질은 자동화 한계로
검증하지 않았다(§10 명시된 구분 그대로) — 코드 경로(지원 여부 분기,
중복 방지 가드)만 확인했다.

## 9. 남은 한계

- **번들 크기**: 563KB(gzip 180KB), 코드 스플리팅 미적용 — 포트폴리오
  규모에서는 허용 범위로 판단했으나 다음 단계 후보.
- **Vite dev 서버의 파일 감시**: 이 작업 환경(네트워크 드라이브로 매핑된
  WSL 경로)에서 Vite의 파일 watcher가 동작하지 않아(`EISDIR`), 소스를
  고칠 때마다 dev 서버를 수동 재시작해야 했다 — 실제 사용자의 VS Code+WSL
  환경(네이티브 경로)에서는 재현되지 않을 환경 특이 현상으로 보이지만,
  확인하지 못했으므로 한계로 기록한다.
- **접근성**: 키보드 탐색/포커스/레이블/대비를 기본적으로 갖췄지만,
  스크린리더 전수 점검(NVDA/VoiceOver 등 실기 테스트)은 하지 않았다.
- **리뷰 통계 카드의 일부 서수 로직**(예: "Based on" 기준 문구)은 번역은
  했지만 매우 긴 언어에서 레이아웃이 줄바꿈될 수 있다 — 치명적이진 않음.
- 실제 Vercel 배포/원격 저장소 연결은 범위 밖(Package 5).

## 10. 실행 방법

```bash
# 1) 백엔드(API + 정적 data/ 파일) — 기존 그대로
GEMINI_API_KEY=xxx node dev-server.js          # http://localhost:3000

# 2) React 프론트엔드(새 터미널)
cd web
npm install
npm run dev                                     # http://localhost:5173 (proxy: /api, /data -> :3000)

# Playwright(두 서버가 떠 있는 상태에서)
cd web && npx playwright test

# Production build
cd web && npm run build && npm run preview
```

## 11. 최종 커밋 / Working tree 상태

이 devlog 작성 시점 기준 변경분은 전부 `web/`(신규) 하나뿐이며,
`index.html`/`api/`/`shared/`/`tests/`/`data/`/`scripts/`는 바이트 단위로
그대로다(`git status`/`git diff` 확인 완료). 커밋은 이 파일과 함께 한
번에 기록한다 — 정확한 해시는 완료 보고에 포함.
