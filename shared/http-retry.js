// shared/http-retry.js
//
// [IMP-13] 서버 전용 재시도 헬퍼. 브라우저에서는 쓰지 않는다(클라이언트는
// 이미 자체 네트워크 오류 처리를 갖고 있고, 여기서 다시 우리 서버를 재시도
// 하는 건 "진짜로 불안정한 쪽"인 Gemini 호출을 고치는 것과 무관하게 우리
// 서버만 두 번 호출하게 만들 뿐이라 추가하지 않았다 — docs/devlog/IMP-04~13.md
// §범위 제외 참고). api/analyze-menu.js와 api/translate-dish.js가 Gemini를
// 부르는 fetch 호출 하나를 이 헬퍼로 감싼다.
//
// 재시도 대상: 429(rate limit)/502/503/504(일시적 서버/게이트웨이 오류) 와
// 네트워크 계층 오류(fetch 자체가 던지는 예외, 타임아웃 등). 재시도 금지:
// 400/401/403 같은 "영구적인 요청 오류"(재시도해도 똑같이 실패하고 API
// 비용만 늘어남), 그리고 취소(AbortError, 호출자가 더 이상 응답을 원치
// 않는다는 뜻이므로 재시도 자체가 의미 없음).
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function isRetryableNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  return true; // fetch가 던지는 그 외 에러(DNS/타임아웃/연결 끊김 등)는 전부 일시적이라고 간주
}

// Retry-After 헤더는 초 단위 숫자("120") 또는 HTTP-date 둘 다 가능(RFC 7231).
function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds * 1000;
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) {
    const diff = asDate - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

// Exponential Backoff + Full Jitter: 매 시도마다 "이론상 최대 대기시간" 자체를
// 매번 랜덤화한다(0~exp 사이 균등분포) — 여러 요청이 동시에 실패했을 때 전부
// 똑같은 시각에 다시 몰려드는 thundering herd를 피하기 위함.
function computeBackoffMs(attempt, baseDelayMs, maxDelayMs) {
  const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  return Math.random() * exp;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        const err = new Error('Retry wait aborted');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        const err = new Error('Retry wait aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    }
  });
}

// fetchFn: () => Promise<Response> — 매 시도마다 새로 호출되어야 하는 fetch 실행 함수.
// options.maxAttempts: 첫 시도 포함 총 횟수(기본 3)
// options.maxTotalMs: 재시도 전체를 포함한 허용 총 시간(기본 20000ms)
// options.baseDelayMs/maxDelayMs: 백오프 범위(기본 500ms~8000ms)
// options.signal: AbortSignal — 취소되면 대기 중이든 다음 시도 전이든 즉시 중단
// options.onRetry(attemptNumber, delayMs, reason): 재시도가 실제로 일어날 때 호출(로그/테스트용)
async function fetchWithRetry(fetchFn, options = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const maxTotalMs = options.maxTotalMs || 20000;
  const baseDelayMs = options.baseDelayMs || 500;
  const maxDelayMs = options.maxDelayMs || 8000;
  const signal = options.signal;
  const startedAt = Date.now();

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal && signal.aborted) {
      const err = new Error('Request was aborted before attempt');
      err.name = 'AbortError';
      throw err;
    }

    try {
      const response = await fetchFn();
      if (response.ok || !RETRYABLE_STATUSES.has(response.status)) {
        return response; // 성공, 또는 재시도 대상이 아닌 실패(400/401/403 등) — 그대로 호출자에게 전달
      }
      lastResponse = response;
      if (attempt === maxAttempts - 1) return response; // 마지막 시도 — 포기하고 마지막 응답 그대로 반환

      const retryAfterHeader = response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('retry-after')
        : null;
      const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
      const delayMs = retryAfterMs != null ? Math.min(retryAfterMs, maxDelayMs) : computeBackoffMs(attempt, baseDelayMs, maxDelayMs);

      if (Date.now() - startedAt + delayMs > maxTotalMs) return response; // 시간 예산 초과 — 포기

      if (options.onRetry) options.onRetry(attempt + 1, delayMs, 'status:' + response.status);
      await sleep(delayMs, signal);
    } catch (err) {
      lastError = err;
      if (!isRetryableNetworkError(err) || attempt === maxAttempts - 1) throw err;

      const delayMs = computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
      if (Date.now() - startedAt + delayMs > maxTotalMs) throw err;

      if (options.onRetry) options.onRetry(attempt + 1, delayMs, 'network:' + err.message);
      await sleep(delayMs, signal);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError;
}

module.exports = {
  fetchWithRetry,
  isRetryableNetworkError,
  parseRetryAfterMs,
  computeBackoffMs,
  RETRYABLE_STATUSES,
};
