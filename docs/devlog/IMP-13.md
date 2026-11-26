# IMP-13 — API 재시도 및 오류 처리

> Package 2 중 4/4.

## 핵심 문제

`api/analyze-menu.js`는 Gemini 호출이 429(rate limit)/502/503/504 같은
일시적 오류를 반환해도 즉시 포기하고 502를 돌려줬다 — 한 번의 순간적인
장애로 전체 스캔이 실패했다.

## 해결 방법

`shared/http-retry.js`(신규, 서버 전용) — `fetchWithRetry(fetchFn, options)`:
- 재시도 대상: 429/502/503/504, 네트워크 예외(fetch 자체가 던지는 오류).
- 재시도 금지: 400/401/403 같은 영구적 오류(재시도해도 똑같이 실패하고
  비용만 늘어남), `AbortError`(호출자가 더 이상 응답을 원치 않음).
- Exponential Backoff + Full Jitter(매 시도 0~상한 사이 랜덤 대기) — 여러
  요청이 동시에 똑같은 시각에 재시도를 몰아치는 thundering herd를 피함.
- `Retry-After` 헤더(초 단위/HTTP-date 둘 다)가 있으면 그 값을 존중.
- `maxAttempts`(기본 3)와 `maxTotalMs`(기본 20000ms) 둘 다로 상한을 둠.
- `signal`(AbortSignal)을 받아, 대기 중이라도 취소되면 즉시 중단.

`api/analyze-menu.js`/`api/translate-dish.js`의 Gemini 호출 하나를 이
헬퍼로 감쌌다. 오류 응답 바디는 항상 일반화된 문구로만 클라이언트에
전달한다(`'The AI provider request failed...'`) — Gemini 원본 오류 텍스트나
API Key 값은 로그(`console.error`, 서버 콘솔에만 남음)에만 남고 클라이언트
응답에는 절대 포함되지 않는다(TC-13-13으로 확인).

**클라이언트 쪽 재시도는 의도적으로 추가하지 않았다.** 실제로 불안정한
대상은 Gemini이고, 그건 이미 서버가 재시도한다. 서버가 재시도를 다 쓰고도
실패한 응답을 클라이언트가 또 재시도하면 우리 서버만 두 번 호출될 뿐
근본 문제(Gemini 장애)는 해결되지 않고, IMP-06의 취소/식별자 로직과
상호작용도 복잡해진다 — 과도한 서버/클라이언트 구조 변경을 피하라는
요청사항에 따라 범위를 좁혔다.

## 변경된 파일

| 파일 | 변경 |
|---|---|
| `shared/http-retry.js` | **신규.** `fetchWithRetry`/`RETRYABLE_STATUSES`/`parseRetryAfterMs` |
| `api/analyze-menu.js` | Gemini 호출을 `fetchWithRetry`로 감쌈(3회/20초) |
| `api/translate-dish.js` | 동일(3회/15초, 텍스트 전용 호출이라 더 짧게) |

## 성과(실측, Mock 기준)

- 503 두 번 후 성공 → 최종적으로 사용자는 200만 받음, 서버 내부에서
  3번 시도(TC-13-02, TC-13-11).
- 401 → 재시도 0회, 즉시 502(TC-13-03, TC-13-12) — 영구 오류에 비용 낭비 없음.
- `Retry-After` 헤더 준수 확인(TC-13-07).
- 전체 시간 예산(`maxTotalMs`) 초과 시 더 못 기다리고 포기(TC-13-06).
- 민감 정보(API Key, Gemini 원본 오류 문자열) 클라이언트 노출 0건(TC-13-13).

## 테스트

`tests/imp-13-after.js`: 명명 14건(TC 13 + NOT RUN 1), **PASS 13 / FAIL 0 /
NOT RUN 1**(실제 Gemini 429 응답 타이밍 — 실 API 호출 지양), assertion 31건.

## 한계

- 재시도 중 Gemini에 실제로 몇 번 과금되는지는 측정하지 않았다(Mock 기준
  횟수만 확인).
- Circuit Breaker(연속 실패 시 일정 시간 호출 자체를 차단)는 범위 밖이다.
