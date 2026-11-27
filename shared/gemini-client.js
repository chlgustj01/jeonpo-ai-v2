// shared/gemini-client.js
//
// [PKG5-01] Server-only helper shared by api/analyze-menu.js and
// api/translate-dish.js. It exists because of a real production failure
// reproduced in Package 5 (docs/devlog/PACKAGE-05.md §2):
//
//   A 9-item Korean menu photo came back from Gemini as HTTP 200 with
//   finishReason=MAX_TOKENS. usageMetadata showed thoughtsTokenCount=2044 +
//   candidatesTokenCount=1013 against maxOutputTokens=3072. gemini-2.5-flash
//   "thinks" by default, and thinking tokens count against maxOutputTokens,
//   so the JSON answer was cut off after ~3 dishes. The handler then failed
//   JSON.parse and returned 502, which the UI showed as
//   "analyze-menu failed: 502". The API key and auth were fine.
//
// This module provides:
//  1. buildGenerationConfig(): an explicit thinking budget plus enough output
//     room for a 10-dish menu.
//  2. classifyUpstreamFailure(): maps Gemini HTTP errors / finishReason /
//     network failures to stable error codes the UI can localize. The raw
//     upstream body is never forwarded to the client and never logged in full.
//  3. The API key goes in the x-goog-api-key header instead of the ?key= URL
//     query, so it cannot leak through a logged request URL.

const DEFAULT_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

// GEMINI_MODEL may be overridden by an env var (e.g. to move off
// gemini-2.5-flash, which Google's deprecation page schedules to be routed
// to a newer model on 2026-12-01). Only plain model ids are accepted, so the
// env value can never inject a different path/host into the request URL.
function resolveGeminiModel(envValue) {
  if (typeof envValue === 'string' && /^gemini-[a-z0-9.-]{1,60}$/.test(envValue.trim())) {
    return envValue.trim();
  }
  return DEFAULT_MODEL;
}

// thinkingBudget is the Gemini 2.5 control (Gemini 3.x uses thinkingLevel),
// so it is only sent to 2.5 models. Other models keep their default thinking
// but still get the larger maxOutputTokens.
function buildGenerationConfig(model, opts) {
  const config = {
    responseMimeType: 'application/json',
    maxOutputTokens: opts.maxOutputTokens,
  };
  if (/^gemini-2\.5-/.test(model) && typeof opts.thinkingBudget === 'number') {
    config.thinkingConfig = { thinkingBudget: opts.thinkingBudget };
  }
  return config;
}

function buildGeminiRequest(model, apiKey, body, signal) {
  return {
    url: `${GEMINI_BASE_URL}${encodeURIComponent(model)}:generateContent`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    },
  };
}

// Stable error codes shared with web/src/services/api.ts (and listed in
// docs/ARCHITECTURE.md). `retryable` tells the UI whether a "try again"
// button makes sense.
const ERROR_CODES = {
  // 502 kept for upstream auth/config failures (contract pinned by tests/imp-13 TC-13-12).
  CONFIG: { code: 'AI_CONFIG', httpStatus: 502, retryable: false },
  QUOTA: { code: 'AI_QUOTA', httpStatus: 429, retryable: true },
  // [QUOTA] Split by the quota Google reports (error.details[].violations[].quotaId):
  // per-day request limit (retrying the same day cannot succeed), per-minute
  // request limit, per-minute token limit.
  QUOTA_DAILY: { code: 'AI_QUOTA_DAILY', httpStatus: 429, retryable: false },
  QUOTA_MINUTE: { code: 'AI_QUOTA_MINUTE', httpStatus: 429, retryable: true },
  QUOTA_TOKENS: { code: 'AI_QUOTA_TOKENS', httpStatus: 429, retryable: true },
  UNAVAILABLE: { code: 'AI_UNAVAILABLE', httpStatus: 503, retryable: true },
  TIMEOUT: { code: 'AI_TIMEOUT', httpStatus: 504, retryable: true },
  NETWORK: { code: 'AI_NETWORK', httpStatus: 502, retryable: true },
  IMAGE_INVALID: { code: 'IMAGE_INVALID', httpStatus: 400, retryable: false },
  IMAGE_TOO_LARGE: { code: 'IMAGE_TOO_LARGE', httpStatus: 413, retryable: false },
  RESPONSE_INVALID: { code: 'AI_RESPONSE_INVALID', httpStatus: 502, retryable: true },
  OUTPUT_TRUNCATED: { code: 'AI_OUTPUT_TRUNCATED', httpStatus: 502, retryable: false },
  BLOCKED: { code: 'AI_BLOCKED', httpStatus: 422, retryable: false },
};

// Reads only the structured status/reason fields of a Gemini error body.
// Never returns the message itself (it may echo request details).
function summarizeUpstreamErrorBody(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    const err = parsed && parsed.error;
    if (!err) return { status: null, reason: null };
    const details = Array.isArray(err.details) ? err.details : [];
    const reasonDetail = details.find((d) => d && typeof d.reason === 'string');
    // [QUOTA] Only structured fields: quota ids (no values echoed to clients) and RetryInfo.
    const quotaIds = [];
    details.forEach((d) => {
      if (d && Array.isArray(d.violations)) d.violations.forEach((v) => { if (v && typeof v.quotaId === 'string') quotaIds.push(v.quotaId); });
    });
    const retryDetail = details.find((d) => d && typeof d.retryDelay === 'string');
    return {
      status: typeof err.status === 'string' ? err.status : null,
      reason: reasonDetail ? reasonDetail.reason : null,
      quotaIds,
      retryAfterSeconds: retryDetail ? parseRetryDelay(retryDetail.retryDelay) : null,
    };
  } catch (e) {
    return { status: null, reason: null, quotaIds: [], retryAfterSeconds: null };
  }
}

// "20640s" / "1.5s" (google.rpc.RetryInfo duration) -> seconds, else null.
function parseRetryDelay(s) {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(s).trim());
  return m ? Math.ceil(Number(m[1])) : null;
}

// [QUOTA] Which 429 is this? Quota ids look like
// "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
// "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
// "GenerateContentInputTokensPerModelPerMinute-FreeTier".
function classifyQuota(quotaIds) {
  const ids = (quotaIds || []).join(' ');
  if (/PerDay/i.test(ids)) return ERROR_CODES.QUOTA_DAILY;
  if (/Token/i.test(ids)) return ERROR_CODES.QUOTA_TOKENS;
  if (/PerMinute/i.test(ids)) return ERROR_CODES.QUOTA_MINUTE;
  return ERROR_CODES.QUOTA;
}

// [QUOTA] Shared, per-process gate for the daily limit (the quota is per
// project per model, and both endpoints use the same model). Once Gemini says
// the daily quota is spent, further requests are answered locally until the
// retry time instead of spending another request on a guaranteed 429.
// Cached results are served before this gate is consulted (see the handlers).
const quotaGate = new Map(); // model -> { until: epoch ms, code }

function quotaBlock(model) {
  const g = quotaGate.get(model);
  if (!g) return null;
  if (Date.now() >= g.until) {
    quotaGate.delete(model);
    return null;
  }
  return { ...ERROR_CODES.QUOTA_DAILY, retryAfterSeconds: Math.ceil((g.until - Date.now()) / 1000), gated: true };
}

function noteQuotaFailure(model, failure) {
  if (failure && failure.code === 'AI_QUOTA_DAILY') {
    // Without a server hint, hold for 1 hour (then one request re-checks).
    const seconds = failure.retryAfterSeconds && failure.retryAfterSeconds > 0 ? failure.retryAfterSeconds : 3600;
    quotaGate.set(model, { until: Date.now() + seconds * 1000, code: failure.code });
  }
}

// [QUOTA] fetchWithRetry inspectResponse hook: never retry a daily quota;
// follow the server's RetryInfo delay for minute/token quotas.
async function inspectRetry(response) {
  if (response.status !== 429) return null;
  const text = await response.clone().text();
  const info = summarizeUpstreamErrorBody(text);
  const kind = classifyQuota(info.quotaIds);
  if (kind.code === 'AI_QUOTA_DAILY') return { retry: false };
  if (info.retryAfterSeconds !== null) return { retry: true, delayMs: info.retryAfterSeconds * 1000 };
  return null;
}

// httpStatus: the Gemini HTTP status. bodyText: the raw error body (used only
// to read status/reason). imageRequest: true when the request contained an
// image, so a 400 INVALID_ARGUMENT can be attributed to the image.
function classifyHttpFailure(httpStatus, bodyText, imageRequest, retryAfterHeader) {
  const { status, reason, quotaIds, retryAfterSeconds } = summarizeUpstreamErrorBody(bodyText);
  const authReasons = ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_SERVICE_BLOCKED', 'SERVICE_DISABLED', 'CONSUMER_INVALID'];
  let kind;
  if (httpStatus === 401 || httpStatus === 403 || authReasons.indexOf(reason) !== -1 || status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') {
    kind = ERROR_CODES.CONFIG;
  } else if (httpStatus === 404) {
    kind = ERROR_CODES.CONFIG; // model id not found / not available to this key
  } else if (httpStatus === 429 || status === 'RESOURCE_EXHAUSTED') {
    kind = classifyQuota(quotaIds);
  } else if (httpStatus === 400 && status === 'FAILED_PRECONDITION') {
    kind = ERROR_CODES.CONFIG; // e.g. free tier not available in region / billing required
  } else if (httpStatus === 400 && imageRequest) {
    kind = ERROR_CODES.IMAGE_INVALID;
  } else if (httpStatus === 413) {
    kind = ERROR_CODES.IMAGE_TOO_LARGE;
  } else if (httpStatus === 504) {
    kind = ERROR_CODES.TIMEOUT;
  } else if (httpStatus >= 500) {
    kind = ERROR_CODES.UNAVAILABLE;
  } else {
    kind = ERROR_CODES.RESPONSE_INVALID;
  }
  // Retry time: Gemini's RetryInfo, else the HTTP Retry-After header (seconds).
  const headerSeconds = retryAfterHeader && /^\d+$/.test(String(retryAfterHeader).trim()) ? Number(retryAfterHeader) : null;
  const retryAfter = retryAfterSeconds !== null && retryAfterSeconds !== undefined ? retryAfterSeconds : headerSeconds;
  return { ...kind, upstreamStatus: httpStatus, upstreamErrorStatus: status, upstreamReason: reason, quotaIds: quotaIds || [], retryAfterSeconds: retryAfter };
}

function classifyThrownError(err) {
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return { ...ERROR_CODES.TIMEOUT };
  return { ...ERROR_CODES.NETWORK };
}

// Inspects a 200 response body. Returns { text } on success or
// { failure } when the model stopped for a reason that makes the text
// unusable (MAX_TOKENS, SAFETY, prompt blocked, empty).
function extractCandidateText(data) {
  const promptBlock = data && data.promptFeedback && data.promptFeedback.blockReason;
  if (promptBlock) return { failure: { ...ERROR_CODES.BLOCKED, finishReason: 'PROMPT_BLOCKED:' + promptBlock } };
  const cand = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const finishReason = cand && cand.finishReason ? cand.finishReason : null;
  const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  // Thought parts (thought: true) are not part of the answer.
  const text = parts.filter((p) => p && !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (finishReason === 'MAX_TOKENS') return { failure: { ...ERROR_CODES.OUTPUT_TRUNCATED, finishReason }, text };
  if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT' || finishReason === 'BLOCKLIST' || finishReason === 'SPII' || finishReason === 'RECITATION') {
    return { failure: { ...ERROR_CODES.BLOCKED, finishReason }, text };
  }
  if (!text) return { failure: { ...ERROR_CODES.RESPONSE_INVALID, finishReason } };
  return { text, finishReason };
}

// One log line per failure: code + upstream status/reason + token usage.
// Never logs the API key, the image, or the model's full text.
function logFailure(tag, failure, usageMetadata) {
  const usage = usageMetadata
    ? { prompt: usageMetadata.promptTokenCount, output: usageMetadata.candidatesTokenCount, thoughts: usageMetadata.thoughtsTokenCount }
    : undefined;
  console.error(`[${tag}] ${failure.code}`, JSON.stringify({
    upstreamStatus: failure.upstreamStatus,
    upstreamErrorStatus: failure.upstreamErrorStatus,
    upstreamReason: failure.upstreamReason,
    quotaIds: failure.quotaIds && failure.quotaIds.length ? failure.quotaIds : undefined,
    retryAfterSeconds: failure.retryAfterSeconds || undefined,
    finishReason: failure.finishReason,
    usage,
  }));
}

function sendFailure(res, failure, message, extra) {
  // [QUOTA] Pass the retry time on (body + standard Retry-After header).
  const retryAfterSeconds = failure.retryAfterSeconds && failure.retryAfterSeconds > 0 ? failure.retryAfterSeconds : undefined;
  if (retryAfterSeconds && typeof res.setHeader === 'function') res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(failure.httpStatus).json({ error: message, code: failure.code, retryable: failure.retryable, ...(retryAfterSeconds ? { retryAfterSeconds } : {}), ...(extra || {}) });
}

module.exports = {
  DEFAULT_MODEL,
  ERROR_CODES,
  resolveGeminiModel,
  buildGenerationConfig,
  buildGeminiRequest,
  classifyHttpFailure,
  classifyThrownError,
  extractCandidateText,
  summarizeUpstreamErrorBody,
  parseRetryDelay,
  classifyQuota,
  quotaBlock,
  noteQuotaFailure,
  inspectRetry,
  _quotaGate: quotaGate,
  logFailure,
  sendFailure,
};
