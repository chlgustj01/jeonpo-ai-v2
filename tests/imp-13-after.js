// tests/imp-13-after.js
// [IMP-13] API 재시도 및 오류 처리 — 수정 "후" 테스트.
const assert = require('assert');
const path = require('path');
const { fetchWithRetry } = require('../shared/http-retry.js');

const results = [];
let totalAssertions = 0;
const A = new Proxy(assert, {
  get(t, p) { const o = t[p]; if (typeof o !== 'function') return o; return (...a) => { totalAssertions++; return o.apply(t, a); }; },
});

async function tc(id, desc, fn) {
  try { await fn(); results.push({ id, status: 'PASS' }); console.log(`[PASS] ${id} ${desc}`); }
  catch (err) { results.push({ id, status: 'FAIL' }); console.error(`[FAIL] ${id} ${desc}\n       ${err.stack || err.message}`); }
}
function notRun(id, desc, reason) { results.push({ id, status: 'NOT RUN' }); console.log(`[NOT RUN] ${id} ${desc} — ${reason}`); }

function fakeResponse(status, headers) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (h) => (headers || {})[h.toLowerCase()] || null }, text: async () => 'err', json: async () => ({}) };
}

function makeRes() { const r = {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.body = o; return r; }; return r; }

async function main() {
  await tc('TC-13-01', '429/502/503/504는 재시도 대상, 다른 상태는 즉시 반환', async () => {
    [429, 502, 503, 504].forEach((s) => A.ok(require('../shared/http-retry.js').RETRYABLE_STATUSES.has(s)));
    [400, 401, 403, 404, 200].forEach((s) => A.ok(!require('../shared/http-retry.js').RETRYABLE_STATUSES.has(s)));
  });

  await tc('TC-13-02', '503 두 번 후 성공 → 3번째 시도에서 200, 총 3회 호출', async () => {
    let attempts = 0;
    const res = await fetchWithRetry(() => {
      attempts++;
      return Promise.resolve(attempts < 3 ? fakeResponse(503) : fakeResponse(200));
    }, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 });
    A.strictEqual(attempts, 3);
    A.strictEqual(res.ok, true);
  });

  await tc('TC-13-03', '401(영구 오류)은 재시도하지 않고 즉시 반환', async () => {
    let attempts = 0;
    const res = await fetchWithRetry(() => { attempts++; return Promise.resolve(fakeResponse(401)); }, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 });
    A.strictEqual(attempts, 1);
    A.strictEqual(res.status, 401);
  });

  await tc('TC-13-04', '403도 재시도하지 않음', async () => {
    let attempts = 0;
    await fetchWithRetry(() => { attempts++; return Promise.resolve(fakeResponse(403)); }, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 });
    A.strictEqual(attempts, 1);
  });

  await tc('TC-13-05', '최대 재시도 횟수 제한 — maxAttempts 도달하면 마지막 응답을 그대로 반환', async () => {
    let attempts = 0;
    const res = await fetchWithRetry(() => { attempts++; return Promise.resolve(fakeResponse(503)); }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 });
    A.strictEqual(attempts, 3);
    A.strictEqual(res.status, 503);
  });

  await tc('TC-13-06', '전체 시간 예산 초과 시 더 이상 재시도하지 않음', async () => {
    let attempts = 0;
    const res = await fetchWithRetry(() => { attempts++; return Promise.resolve(fakeResponse(503)); }, { maxAttempts: 10, baseDelayMs: 50, maxDelayMs: 50, maxTotalMs: 10 });
    A.ok(attempts < 10, '시간 예산 때문에 최대 횟수 전에 멈춰야 함');
    A.strictEqual(res.status, 503);
  });

  await tc('TC-13-07', 'Retry-After 헤더(초 단위)를 존중함', async () => {
    let attempts = 0;
    const start = Date.now();
    await fetchWithRetry(() => {
      attempts++;
      return Promise.resolve(attempts === 1 ? fakeResponse(429, { 'retry-after': '0.02' }) : fakeResponse(200));
    }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 });
    A.strictEqual(attempts, 2);
    A.ok(Date.now() - start >= 15, 'Retry-After 지정 시간만큼은 기다려야 함');
  });

  await tc('TC-13-08', '취소(AbortError)는 재시도하지 않고 즉시 던짐', async () => {
    let attempts = 0;
    let threw = null;
    try {
      await fetchWithRetry(() => {
        attempts++;
        const e = new Error('aborted');
        e.name = 'AbortError';
        return Promise.reject(e);
      }, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 });
    } catch (e) { threw = e; }
    A.strictEqual(attempts, 1);
    A.strictEqual(threw && threw.name, 'AbortError');
  });

  await tc('TC-13-09', '네트워크 예외(TypeError 등)는 재시도 대상', async () => {
    let attempts = 0;
    const res = await fetchWithRetry(() => {
      attempts++;
      if (attempts < 2) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(fakeResponse(200));
    }, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 });
    A.strictEqual(attempts, 2);
    A.strictEqual(res.ok, true);
  });

  await tc('TC-13-10', '진행 중 signal이 abort되면 대기 중이던 재시도도 즉시 중단', async () => {
    const controller = new AbortController();
    let attempts = 0;
    const p = fetchWithRetry(() => { attempts++; return Promise.resolve(fakeResponse(503)); }, { maxAttempts: 5, baseDelayMs: 50, maxDelayMs: 50, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    let threw = null;
    try { await p; } catch (e) { threw = e; }
    A.strictEqual(threw && threw.name, 'AbortError');
  });

  // ---------------- 서버 핸들러 통합 ----------------
  await tc('TC-13-11', 'api/analyze-menu.js: Gemini가 503 두 번 후 성공하면 클라이언트는 200만 받음(재시도는 서버 내부에서 소화)', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    let geminiCalls = 0;
    global.fetch = async () => {
      geminiCalls++;
      if (geminiCalls < 3) return fakeResponse(503);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ dishes: [{ name_ko: '김치', name_en: 'Kimchi', ingredients: 'cabbage', allergens: [], spicy: 1, eatingMethod: [], description: '', culturalNote: '' }] }) }] } }] }) };
    };
    process.env.GEMINI_API_KEY = 'test-key';
    const req = { method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,RETRY1' } };
    const res = makeRes();
    await handler(req, res);
    A.strictEqual(res.statusCode, 200);
    A.strictEqual(geminiCalls, 3);
  });

  await tc('TC-13-12', 'api/analyze-menu.js: Gemini가 401을 반환하면 재시도 없이 즉시 502로 응답', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    let geminiCalls = 0;
    global.fetch = async () => { geminiCalls++; return fakeResponse(401); };
    process.env.GEMINI_API_KEY = 'test-key';
    const req = { method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,RETRY2' } };
    const res = makeRes();
    await handler(req, res);
    A.strictEqual(res.statusCode, 502);
    A.strictEqual(geminiCalls, 1);
  });

  await tc('TC-13-13', 'API Key/민감한 Gemini 원본 오류 문자열이 클라이언트 응답 바디에 노출되지 않음', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    global.fetch = async () => ({ ok: false, status: 401, text: async () => 'secret-key-abc123 invalid', headers: { get: () => null } });
    process.env.GEMINI_API_KEY = 'test-key';
    const req = { method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,RETRY3' } };
    const res = makeRes();
    await handler(req, res);
    const bodyText = JSON.stringify(res.body);
    A.ok(!bodyText.includes('secret-key-abc123'), 'Gemini 원본 오류 텍스트가 그대로 노출되면 안 됨');
    A.ok(!bodyText.includes('test-key'), 'API Key 값이 노출되면 안 됨');
  });

  notRun('TC-13-UI-1', '실제 Gemini API 429 응답에 대한 실제 재시도 타이밍', '요청사항상 실제 API 호출 지양 — Mock으로 재시도 로직 자체는 TC-13-02~09에서 이미 검증');

  const summary = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log('\n=== 요약 ===');
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건 / 실행된 assertion 총 개수: ${totalAssertions}건`);
  if (summary.FAIL > 0) process.exitCode = 1;
}

main();
