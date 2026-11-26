// tests/pkg5-after.js
// [Package 5] Gemini call budget, error classification, coverage and
// ingredient-source fields, dev-server hardening. Mock only — no real
// Gemini calls (those are recorded separately in docs/TEST-REPORT.md §3).
const assert = require('assert');
const path = require('path');
const http = require('http');

const results = [];
let totalAssertions = 0;
const A = new Proxy(assert, {
  get(t, p) { const o = t[p]; if (typeof o !== 'function') return o; return (...a) => { totalAssertions++; return o.apply(t, a); }; },
});
async function tc(id, desc, fn) {
  try { await fn(); results.push({ id, status: 'PASS' }); console.log(`[PASS] ${id} ${desc}`); }
  catch (err) { results.push({ id, status: 'FAIL' }); process.stdout.write(`[FAIL] ${id} ${desc}\n       ${err.stack || err.message}\n`); }
}
function notRun(id, desc, reason) { results.push({ id, status: 'NOT RUN' }); console.log(`[NOT RUN] ${id} ${desc} — ${reason}`); }

function makeRes() { const r = {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.body = o; return r; }; return r; }
function errResponse(status, body, headers) {
  return { ok: false, status, headers: { get: (h) => (headers || {})[h.toLowerCase()] || null }, text: async () => JSON.stringify(body || {}), json: async () => body || {} };
}
function okGemini(payload, finishReason, extra) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ finishReason: finishReason || 'STOP', content: { parts: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] } }], ...(extra || {}) }) };
}
function dish(ko, en, extra) {
  return { name_ko: ko, name_en: en, ingredients: 'x', allergens: ['soybean'], crossContactAllergens: [], spicy: 1, eatingMethod: ['a'], description: 'd', culturalNote: '', ...(extra || {}) };
}
let imgSeq = 0;
function freshImage() { imgSeq += 1; return `data:image/jpeg;base64,PKG5IMG${imgSeq}`; }

function loadAnalyze() { delete require.cache[require.resolve('../api/analyze-menu.js')]; return require('../api/analyze-menu.js'); }
function loadTranslate() { delete require.cache[require.resolve('../api/translate-dish.js')]; return require('../api/translate-dish.js'); }

async function callAnalyze(fetchImpl, imageBase64) {
  const handler = loadAnalyze();
  const calls = [];
  global.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return fetchImpl(calls.length); };
  const res = makeRes();
  await handler({ method: 'POST', body: { imageBase64: imageBase64 || freshImage() } }, res);
  return { res, calls };
}

async function main() {
  process.env.GEMINI_API_KEY = 'pkg5-test-key-XYZ';
  delete process.env.GEMINI_MODEL;
  const origErr = console.error; const origWarn = console.warn;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  console.warn = () => {};

  await tc('TC-P5-01', 'analyze request: maxOutputTokens 8192 + thinkingBudget 1024 (root-cause fix)', async () => {
    const { res, calls } = await callAnalyze(() => okGemini({ menuItemCount: 1, dishes: [dish('김치', 'Kimchi')] }));
    A.strictEqual(res.statusCode, 200);
    A.strictEqual(calls[0].body.generationConfig.maxOutputTokens, 8192);
    A.deepStrictEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingBudget: 1024 });
  });

  await tc('TC-P5-02', 'API key goes in x-goog-api-key header, never in the URL', async () => {
    const { calls } = await callAnalyze(() => okGemini({ dishes: [dish('김치', 'Kimchi')] }));
    A.ok(!calls[0].url.includes('key='), 'no ?key= in URL');
    A.ok(!calls[0].url.includes('pkg5-test-key-XYZ'));
    A.strictEqual(calls[0].init.headers['x-goog-api-key'], 'pkg5-test-key-XYZ');
  });

  await tc('TC-P5-03', 'finishReason MAX_TOKENS -> 502 AI_OUTPUT_TRUNCATED, not retryable, not cached', async () => {
    const img = freshImage();
    const truncated = '{"dishes":[{"name_ko":"김치찌개","name_en":"Kim';
    const first = await callAnalyze(() => okGemini(truncated, 'MAX_TOKENS', { usageMetadata: { thoughtsTokenCount: 2044, candidatesTokenCount: 1013 } }), img);
    A.strictEqual(first.res.statusCode, 502);
    A.strictEqual(first.res.body.code, 'AI_OUTPUT_TRUNCATED');
    A.strictEqual(first.res.body.retryable, false);
    // Not cached: a second request for the same image calls Gemini again (module cache survives because we do not reload here).
    const handler = require('../api/analyze-menu.js');
    let calls = 0;
    global.fetch = async () => { calls++; return okGemini({ dishes: [dish('김치찌개', 'Kimchi Jjigae')] }); };
    const res2 = makeRes();
    await handler({ method: 'POST', body: { imageBase64: img } }, res2);
    A.strictEqual(calls, 1);
    A.strictEqual(res2.statusCode, 200);
  });

  await tc('TC-P5-04', 'failure log has code + token usage, never the key or the model text', async () => {
    logged.length = 0;
    await callAnalyze(() => okGemini('{"dishes":[{"name_ko":"SECRET_MENU_TEXT', 'MAX_TOKENS', { usageMetadata: { thoughtsTokenCount: 2044, candidatesTokenCount: 1013 } }));
    const all = logged.join('\n');
    A.ok(all.includes('AI_OUTPUT_TRUNCATED'));
    A.ok(all.includes('2044'));
    A.ok(!all.includes('pkg5-test-key-XYZ'));
    A.ok(!all.includes('SECRET_MENU_TEXT'));
  });

  await tc('TC-P5-05', 'HTTP error classification (status / retryable / code)', async () => {
    const cases = [
      [errResponse(400, { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }), 502, 'AI_CONFIG', false],
      [errResponse(403, { error: { status: 'PERMISSION_DENIED' } }), 502, 'AI_CONFIG', false],
      [errResponse(404, { error: { status: 'NOT_FOUND' } }), 502, 'AI_CONFIG', false],
      [errResponse(400, { error: { status: 'FAILED_PRECONDITION' } }), 502, 'AI_CONFIG', false],
      [errResponse(400, { error: { status: 'INVALID_ARGUMENT', message: 'Unable to process input image' } }), 400, 'IMAGE_INVALID', false],
      [errResponse(500, { error: { status: 'INTERNAL' } }), 503, 'AI_UNAVAILABLE', true],
    ];
    for (const [resp, status, code, retryable] of cases) {
      const { res } = await callAnalyze(() => resp);
      A.strictEqual(res.statusCode, status, code);
      A.strictEqual(res.body.code, code);
      A.strictEqual(res.body.retryable, retryable);
    }
  });

  await tc('TC-P5-06', '429 is retried by the server, then surfaces as 429 AI_QUOTA (retryable)', async () => {
    const { res, calls } = await callAnalyze(() => errResponse(429, { error: { status: 'RESOURCE_EXHAUSTED' } }, { 'retry-after': '0' }));
    A.ok(calls.length >= 2, 'server retried');
    A.strictEqual(res.statusCode, 429);
    A.strictEqual(res.body.code, 'AI_QUOTA');
    A.strictEqual(res.body.retryable, true);
  });

  await tc('TC-P5-07', 'network error / timeout -> AI_NETWORK / AI_TIMEOUT', async () => {
    const net = await callAnalyze(() => { throw new TypeError('fetch failed'); });
    A.strictEqual(net.res.body.code, 'AI_NETWORK');
    A.strictEqual(net.res.statusCode, 502);
    const to = await callAnalyze(() => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; });
    A.strictEqual(to.res.body.code, 'AI_TIMEOUT');
    A.strictEqual(to.res.statusCode, 504);
    // A per-attempt TimeoutError is retried inside the total budget (each later attempt's timeout is capped by the remaining budget).
    A.ok(to.calls.length >= 1 && to.calls.length <= 3);
  });

  await tc('TC-P5-08', 'SAFETY finish / prompt block -> 422 AI_BLOCKED', async () => {
    const a = await callAnalyze(() => okGemini('', 'SAFETY'));
    A.strictEqual(a.res.statusCode, 422);
    A.strictEqual(a.res.body.code, 'AI_BLOCKED');
    const b = await callAnalyze(() => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'OTHER' } }) }));
    A.strictEqual(b.res.body.code, 'AI_BLOCKED');
  });

  await tc('TC-P5-09', 'image size / type checks happen before any Gemini call', async () => {
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(4 * 1024 * 1024 + 10);
    const a = await callAnalyze(() => { throw new Error('must not call'); }, big);
    A.strictEqual(a.res.statusCode, 413);
    A.strictEqual(a.res.body.code, 'IMAGE_TOO_LARGE');
    A.strictEqual(a.calls.length, 0);
    const b = await callAnalyze(() => { throw new Error('must not call'); }, 'data:image/svg+xml;base64,PHN2Zz4=');
    A.strictEqual(b.res.statusCode, 400);
    A.strictEqual(b.res.body.code, 'IMAGE_INVALID');
    A.strictEqual(b.calls.length, 0);
  });

  await tc('TC-P5-10', 'more than 10 dishes: capped to 10, coverage.isComplete false', async () => {
    const many = Array.from({ length: 12 }, (_, i) => dish(`메뉴${i}`, `Menu ${i}`));
    const { res } = await callAnalyze(() => okGemini({ menuItemCount: 12, dishes: many }));
    A.strictEqual(res.statusCode, 200);
    A.strictEqual(res.body.dishes.length, 10);
    A.deepStrictEqual(res.body.coverage, { returnedCount: 10, visibleItemCount: 12, maxDishes: 10, isComplete: false });
  });

  await tc('TC-P5-11', 'menuItemCount > returned -> incomplete; equal -> complete; missing -> unknown (null)', async () => {
    const a = await callAnalyze(() => okGemini({ menuItemCount: 15, dishes: [dish('김치', 'Kimchi')] }));
    A.strictEqual(a.res.body.coverage.isComplete, false);
    A.strictEqual(a.res.body.coverage.visibleItemCount, 15);
    const b = await callAnalyze(() => okGemini({ menuItemCount: 1, dishes: [dish('김치', 'Kimchi')] }));
    A.strictEqual(b.res.body.coverage.isComplete, true);
    const c = await callAnalyze(() => okGemini({ dishes: [dish('김치', 'Kimchi')] }));
    A.strictEqual(c.res.body.coverage.isComplete, null);
    const d = await callAnalyze(() => okGemini({ menuItemCount: 'many', dishes: [dish('김치', 'Kimchi')] }));
    A.strictEqual(d.res.body.coverage.visibleItemCount, null);
  });

  await tc('TC-P5-12', 'ingredientSource: only an explicit "printed" stays printed; anything else -> inferred', async () => {
    const { res } = await callAnalyze(() => okGemini({ dishes: [
      dish('라면', 'Ramyeon', { ingredientSource: 'printed' }),
      dish('김치', 'Kimchi', { ingredientSource: 'confirmed' }),
      dish('비빔밥', 'Bibimbap'),
    ] }));
    A.deepStrictEqual(res.body.dishes.map((d) => d.ingredientSource), ['printed', 'inferred', 'inferred']);
  });

  await tc('TC-P5-13', 'allergens / RED-relevant fields are untouched by the new fields', async () => {
    const { res } = await callAnalyze(() => okGemini({ menuItemCount: 1, dishes: [dish('땅콩죽', 'Peanut porridge', { allergens: ['peanut'], crossContactAllergens: ['milk'] })] }));
    A.deepStrictEqual(res.body.dishes[0].allergens, ['peanut']);
    A.deepStrictEqual(res.body.dishes[0].crossContactAllergens, ['milk']);
  });

  await tc('TC-P5-14', 'GEMINI_MODEL env override is validated (no path/host injection)', async () => {
    const { resolveGeminiModel, buildGeminiRequest, buildGenerationConfig } = require('../shared/gemini-client.js');
    A.strictEqual(resolveGeminiModel(undefined), 'gemini-2.5-flash');
    A.strictEqual(resolveGeminiModel('gemini-3.5-flash'), 'gemini-3.5-flash');
    A.strictEqual(resolveGeminiModel('gemini-x/../../evil?'), 'gemini-2.5-flash');
    A.strictEqual(resolveGeminiModel('https://evil.example'), 'gemini-2.5-flash');
    A.ok(buildGeminiRequest('gemini-3.5-flash', 'k', {}, undefined).url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:'));
    A.strictEqual(buildGenerationConfig('gemini-3.5-flash', { maxOutputTokens: 10, thinkingBudget: 5 }).thinkingConfig, undefined, 'thinkingBudget only for 2.5 models');
  });

  await tc('TC-P5-15', 'translate request: thinking off (budget 0), maxOutputTokens 8192, key in header', async () => {
    const handler = loadTranslate();
    let sent = null;
    global.fetch = async (url, init) => { sent = { url, init, body: JSON.parse(init.body) }; return okGemini({ translations: [{ foodId: 'kimchi', translatedName: 'キムチ', ingredients: 'a', eatingMethod: ['b'], description: 'c', culturalNote: '' }] }); };
    const res = makeRes();
    await handler({ method: 'POST', body: { analysisId: 'pkg5-a1', targetLanguage: 'ja', dishes: [{ foodId: 'kimchi', nameEn: 'Kimchi' }] } }, res);
    A.strictEqual(res.statusCode, 200);
    A.deepStrictEqual(sent.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
    A.strictEqual(sent.body.generationConfig.maxOutputTokens, 8192);
    A.ok(!sent.url.includes('key='));
  });

  await tc('TC-P5-16', 'translate MAX_TOKENS / 429 -> coded errors', async () => {
    let handler = loadTranslate();
    global.fetch = async () => okGemini('{"translations":[{"foodId":"kim', 'MAX_TOKENS');
    let res = makeRes();
    await handler({ method: 'POST', body: { analysisId: 'pkg5-t2', targetLanguage: 'ko', dishes: [{ foodId: 'kimchi' }] } }, res);
    A.strictEqual(res.body.code, 'AI_OUTPUT_TRUNCATED');
    handler = loadTranslate();
    global.fetch = async () => errResponse(429, {}, { 'retry-after': '0' });
    res = makeRes();
    await handler({ method: 'POST', body: { analysisId: 'pkg5-t3', targetLanguage: 'ko', dishes: [{ foodId: 'kimchi' }] } }, res);
    A.strictEqual(res.statusCode, 429);
    A.strictEqual(res.body.code, 'AI_QUOTA');
  });

  await tc('TC-P5-17', 'missing key -> AI_CONFIG code on both endpoints', async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const r1 = makeRes();
    await loadAnalyze()({ method: 'POST', body: { imageBase64: freshImage() } }, r1);
    const r2 = makeRes();
    await loadTranslate()({ method: 'POST', body: { analysisId: 'x', targetLanguage: 'ja', dishes: [{ foodId: 'a' }] } }, r2);
    process.env.GEMINI_API_KEY = saved;
    A.strictEqual(r1.body.code, 'AI_CONFIG');
    A.strictEqual(r2.body.code, 'AI_CONFIG');
  });

  console.error = origErr; console.warn = origWarn;

  // ---------------- dev-server hardening (real HTTP on a random port) ----------------
  await tc('TC-P5-18', 'dev-server: .env, .git, dotfiles, node_modules and tests are not served; app files are', async () => {
    const { server, port } = await startDevServer();
    try {
      const get = (p) => httpGet(port, p);
      for (const p of ['/.env', '/.git/config', '/.gitignore', '/%2e%2e/%2e%2e/etc/passwd.json', '/web/node_modules/react/package.json', '/tests/harness.js', '/data/raw/x.json', '/web/.oxlintrc.json']) {
        const r = await get(p);
        A.strictEqual(r.status, 404, p);
      }
      A.strictEqual((await get('/')).status, 200);
      A.strictEqual((await get('/shared/allergens.js')).status, 200);
      A.strictEqual((await get('/data/generated/knowledge-manifest.json')).status, 200);
    } finally { server.close(); }
  });

  await tc('TC-P5-19', 'dev-server: request body over the limit is rejected with 413', async () => {
    const { server, port } = await startDevServer();
    try {
      const big = JSON.stringify({ imageBase64: 'data:image/jpeg;base64,' + 'A'.repeat(6 * 1024 * 1024) });
      const r = await httpPost(port, '/api/analyze-menu', big);
      A.strictEqual(r.status, 413);
    } finally { server.close(); }
  });

  notRun('TC-P5-REAL', 'real Gemini menu analysis', 'covered by the recorded real-API checks in docs/TEST-REPORT.md §3, not part of the automated suite');

  const summary = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log('\n=== 요약 ===');
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건 / 실행된 assertion 총 개수: ${totalAssertions}건`);
  if (summary.FAIL > 0) process.exitCode = 1;
}

function startDevServer() {
  process.env.PORT = '0';
  delete require.cache[require.resolve('../dev-server.js')];
  const origLog = console.log; console.log = () => {};
  const server = require('../dev-server.js');
  console.log = origLog;
  return new Promise((resolve) => {
    const ready = () => resolve({ server, port: server.address().port });
    if (server.listening) ready(); else server.once('listening', ready);
  });
}
function httpGet(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); }).on('error', reject);
  });
}
function httpPost(port, p, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
    req.on('error', () => resolve({ status: 'reset' }));
    req.end(body);
  });
}

main();
