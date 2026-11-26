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
    return { status: typeof err.status === 'string' ? err.status : null, reason: reasonDetail ? reasonDetail.reason : null };
  } catch (e) {
    return { status: null, reason: null };
  }
}

// httpStatus: the Gemini HTTP status. bodyText: the raw error body (used only
// to read status/reason). imageRequest: true when the request contained an
// image, so a 400 INVALID_ARGUMENT can be attributed to the image.
function classifyHttpFailure(httpStatus, bodyText, imageRequest) {
  const { status, reason } = summarizeUpstreamErrorBody(bodyText);
  const authReasons = ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_SERVICE_BLOCKED', 'SERVICE_DISABLED', 'CONSUMER_INVALID'];
  let kind;
  if (httpStatus === 401 || httpStatus === 403 || authReasons.indexOf(reason) !== -1 || status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') {
    kind = ERROR_CODES.CONFIG;
  } else if (httpStatus === 404) {
    kind = ERROR_CODES.CONFIG; // model id not found / not available to this key
  } else if (httpStatus === 429 || status === 'RESOURCE_EXHAUSTED') {
    kind = ERROR_CODES.QUOTA;
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
  return { ...kind, upstreamStatus: httpStatus, upstreamErrorStatus: status, upstreamReason: reason };
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
    finishReason: failure.finishReason,
    usage,
  }));
}

function sendFailure(res, failure, message, extra) {
  res.status(failure.httpStatus).json({ error: message, code: failure.code, retryable: failure.retryable, ...(extra || {}) });
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
  logFailure,
  sendFailure,
};
