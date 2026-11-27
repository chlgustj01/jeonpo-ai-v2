// tests/quota-after.js
// [QUOTA] Gemini quota handling: per-day vs per-minute vs token quotas, no
// automatic retry on a daily quota, RetryInfo / Retry-After used, a local
// gate that stops spending requests once the daily quota is gone, and the
// cache still served. Mock only — no real Gemini call.
const assert = require('assert');
const gemini = require('../shared/gemini-client.js');
const { fetchWithRetry } = require('../shared/http-retry.js');

const results = [];
let totalAssertions = 0;
const A = new Proxy(assert, {
  get(t, p) { const o = t[p]; if (typeof o !== 'function') return o; return (...a) => { totalAssertions++; return o.apply(t, a); }; },
});
async function tc(id, desc, fn) {
  gemini._quotaGate.clear();
  try { await fn(); results.push({ id, status: 'PASS' }); console.log(`[PASS] ${id} ${desc}`); }
  catch (err) { results.push({ id, status: 'FAIL' }); process.stdout.write(`[FAIL] ${id} ${desc}\n       ${err.stack || err.message}\n`); }
}
function notRun(id, desc, reason) { results.push({ id, status: 'NOT RUN' }); console.log(`[NOT RUN] ${id} ${desc} — ${reason}`); }
function makeRes() { const r = { headers: {} }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.body = o; return r; }; r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; }; return r; }

// Exact shape of the real 429 seen on 2026-11-27 (values kept, key never involved).
function quotaBody(quotaId, retryDelay) {
  return {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota…',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId, quotaDimensions: { model: 'gemini-2.5-flash' }, quotaValue: '20' }] },
        ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
      ],
    },
  };
}
function resp429(body, headers) {
  const text = JSON.stringify(body);
  const make = () => ({ ok: false, status: 429, headers: { get: (h) => (headers || {})[h.toLowerCase()] || null }, text: async () => text, json: async () => body, clone: () => make() });
  return make();
}
const DAILY = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';
const MINUTE = 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier';
const TOKENS = 'GenerateContentInputTokensPerModelPerMinute-FreeTier';
const okGemini = () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ menuItemCount: 1, dishes: [{ name_ko: '김치', name_en: 'Kimchi', ingredients: 'x', allergens: [], crossContactAllergens: [], spicy: 1, eatingMethod: ['a'], description: 'd', culturalNote: '', price: { status: 'not_shown' } }] }) }] } }] }) });

function loadAnalyze() { delete require.cache[require.resolve('../api/analyze-menu.js')]; return require('../api/analyze-menu.js'); }
function loadTranslate() { delete require.cache[require.resolve('../api/translate-dish.js')]; return require('../api/translate-dish.js'); }
let imgSeq = 0;
async function analyze(handler, fetchImpl, image) {
  let calls = 0;
  global.fetch = async () => { calls++; return fetchImpl(calls); };
  const res = makeRes();
  await handler({ method: 'POST', body: { imageBase64: image || `data:image/jpeg;base64,QUOTA${++imgSeq}` } }, res);
  return { res, calls };
}

async function main() {
  process.env.GEMINI_API_KEY = 'quota-test-key';
  const origErr = console.error; const origWarn = console.warn;
  console.error = () => {}; console.warn = () => {};

  await tc('TC-Q-01', 'quota ids are classified: per-day / per-minute / tokens / unknown', async () => {
    A.strictEqual(gemini.classifyQuota([DAILY]).code, 'AI_QUOTA_DAILY');
    A.strictEqual(gemini.classifyQuota([MINUTE]).code, 'AI_QUOTA_MINUTE');
    A.strictEqual(gemini.classifyQuota([TOKENS]).code, 'AI_QUOTA_TOKENS');
    A.strictEqual(gemini.classifyQuota([]).code, 'AI_QUOTA');
    A.strictEqual(gemini.classifyQuota([DAILY]).retryable, false);
    A.strictEqual(gemini.classifyQuota([MINUTE]).retryable, true);
  });

  await tc('TC-Q-02', 'RetryInfo "20640s" -> 20640 seconds; summary keeps only ids and delay', async () => {
    A.strictEqual(gemini.parseRetryDelay('20640s'), 20640);
    A.strictEqual(gemini.parseRetryDelay('1.2s'), 2);
    A.strictEqual(gemini.parseRetryDelay('soon'), null);
    const s = gemini.summarizeUpstreamErrorBody(JSON.stringify(quotaBody(DAILY, '20640s')));
    A.deepStrictEqual(s.quotaIds, [DAILY]);
    A.strictEqual(s.retryAfterSeconds, 20640);
  });

  await tc('TC-Q-03', 'daily quota: exactly 1 Gemini request (no automatic retry), 429 AI_QUOTA_DAILY with retry time', async () => {
    const { res, calls } = await analyze(loadAnalyze(), () => resp429(quotaBody(DAILY, '20640s')));
    A.strictEqual(calls, 1);
    A.strictEqual(res.statusCode, 429);
    A.strictEqual(res.body.code, 'AI_QUOTA_DAILY');
    A.strictEqual(res.body.retryable, false);
    A.strictEqual(res.body.retryAfterSeconds, 20640);
    A.strictEqual(res.headers['retry-after'], '20640');
    A.ok(!JSON.stringify(res.body).includes('quota-test-key'));
    A.ok(!JSON.stringify(res.body).includes('exceeded your current quota'), 'upstream message is not forwarded');
  });

  await tc('TC-Q-04', 'after a daily quota hit, later requests are answered locally (0 Gemini calls) until the retry time', async () => {
    const handler = loadAnalyze();
    await analyze(handler, () => resp429(quotaBody(DAILY, '600s')));
    const second = await analyze(handler, () => { throw new Error('must not call Gemini'); });
    A.strictEqual(second.calls, 0);
    A.strictEqual(second.res.body.code, 'AI_QUOTA_DAILY');
    A.ok(second.res.body.retryAfterSeconds > 0 && second.res.body.retryAfterSeconds <= 600);
    // translate-dish uses the same model, so the same gate applies.
    const tr = loadTranslate();
    let trCalls = 0;
    global.fetch = async () => { trCalls++; return okGemini(); };
    const tres = makeRes();
    await tr({ method: 'POST', body: { analysisId: 'q-a', targetLanguage: 'ja', dishes: [{ foodId: 'kimchi', nameEn: 'Kimchi' }] } }, tres);
    A.strictEqual(trCalls, 0);
    A.strictEqual(tres.body.code, 'AI_QUOTA_DAILY');
  });

  await tc('TC-Q-05', 'the gate opens again after the retry time (one request re-checks)', async () => {
    const handler = loadAnalyze();
    await analyze(handler, () => resp429(quotaBody(DAILY, '600s')));
    for (const [, g] of gemini._quotaGate) g.until = Date.now() - 1; // time passes
    const again = await analyze(handler, () => okGemini());
    A.strictEqual(again.calls, 1);
    A.strictEqual(again.res.statusCode, 200);
  });

  await tc('TC-Q-06', 'cached results are still served while the daily quota is blocked', async () => {
    const handler = loadAnalyze();
    const img = 'data:image/jpeg;base64,CACHEDQ';
    const first = await analyze(handler, () => okGemini(), img);
    A.strictEqual(first.res.statusCode, 200);
    await analyze(handler, () => resp429(quotaBody(DAILY, '600s'))); // a different image hits the quota
    const cached = await analyze(handler, () => { throw new Error('must not call Gemini'); }, img);
    A.strictEqual(cached.calls, 0);
    A.strictEqual(cached.res.statusCode, 200);
  });

  await tc('TC-Q-07', 'per-minute quota with a short RetryInfo delay is retried after that delay, then succeeds', async () => {
    const t0 = Date.now();
    const { res, calls } = await analyze(loadAnalyze(), (n) => (n === 1 ? resp429(quotaBody(MINUTE, '1s')) : okGemini()));
    A.strictEqual(calls, 2);
    A.strictEqual(res.statusCode, 200);
    A.ok(Date.now() - t0 >= 900, 'waited for the server-provided delay');
  });

  await tc('TC-Q-08', 'per-minute quota with a delay longer than the retry budget: no retry, retry time passed to the client', async () => {
    const { res, calls } = await analyze(loadAnalyze(), () => resp429(quotaBody(MINUTE, '30s')));
    A.strictEqual(calls, 1);
    A.strictEqual(res.body.code, 'AI_QUOTA_MINUTE');
    A.strictEqual(res.body.retryable, true);
    A.strictEqual(res.body.retryAfterSeconds, 30);
    A.strictEqual(gemini._quotaGate.size, 0, 'minute quota does not block the whole day');
  });

  await tc('TC-Q-09', 'token quota is reported as AI_QUOTA_TOKENS', async () => {
    const { res } = await analyze(loadAnalyze(), () => resp429(quotaBody(TOKENS, '40s')));
    A.strictEqual(res.body.code, 'AI_QUOTA_TOKENS');
    A.strictEqual(res.body.retryAfterSeconds, 40);
  });

  await tc('TC-Q-10', 'a plain 429 (no details) keeps the old behavior: retried, then AI_QUOTA; HTTP Retry-After header honored', async () => {
    const { res, calls } = await analyze(loadAnalyze(), () => resp429({ error: { status: 'RESOURCE_EXHAUSTED' } }, { 'retry-after': '0' }));
    A.ok(calls >= 2);
    A.strictEqual(res.body.code, 'AI_QUOTA');
    const r2 = gemini.classifyHttpFailure(429, '{}', true, '120');
    A.strictEqual(r2.retryAfterSeconds, 120);
  });

  await tc('TC-Q-11', 'fetchWithRetry: inspectResponse { retry:false } stops immediately; long delay hint gives up', async () => {
    let n = 0;
    await fetchWithRetry(() => { n++; return Promise.resolve(resp429({})); }, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2, inspectResponse: async () => ({ retry: false }) });
    A.strictEqual(n, 1);
    n = 0;
    await fetchWithRetry(() => { n++; return Promise.resolve(resp429({})); }, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 8000, maxTotalMs: 20000, inspectResponse: async () => ({ retry: true, delayMs: 30000 }) });
    A.strictEqual(n, 1);
  });

  console.error = origErr; console.warn = origWarn;
  notRun('TC-Q-REAL', 'real Gemini quota response', 'real API calls stopped by request after the daily quota was exhausted; the mock body copies the real 429 observed on 2026-11-27');

  const summary = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log('\n=== 요약 ===');
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건 / 실행된 assertion 총 개수: ${totalAssertions}건`);
  if (summary.FAIL > 0) process.exitCode = 1;
}

main();
