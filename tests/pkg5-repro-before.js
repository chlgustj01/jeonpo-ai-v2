// tests/pkg5-repro-before.js
// [Package 5] Reproduces the real "analyze-menu failed: 502" with a Mock,
// against the BASELINE handler (commit f00936f, read with `git show`).
//
// The Mock replays the exact shape of the real Gemini reply recorded in
// Package 5 §2: HTTP 200, finishReason MAX_TOKENS, usageMetadata
// thoughtsTokenCount 2044 + candidatesTokenCount 1013 (limit 3072), and a
// JSON text cut off mid-way. No real API call.
//
// Expected result on the baseline: the handler returns 502 with no error
// code, and the request it sent had maxOutputTokens 3072 and no
// thinkingConfig (the root cause). Run: node tests/pkg5-repro-before.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASELINE = 'f00936f';

function loadBaselineHandler() {
  const src = execFileSync('git', ['show', `${BASELINE}:api/analyze-menu.js`], { cwd: ROOT, encoding: 'utf8' });
  // Point the relative requires at the current shared/ modules (they were
  // unchanged by the fix except for the new gemini-client.js).
  const patched = src.replace(/require\('\.\.\/shared\//g, `require(${JSON.stringify(path.join(ROOT, 'shared') + path.sep)} + '`);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pkg5-')), 'analyze-menu-baseline.js');
  fs.writeFileSync(tmp, patched);
  return require(tmp);
}

const TRUNCATED_TEXT = '{\n  "dishes": [\n    {\n      "name_ko": "김치찌개",\n      "name_en": "Kimchi Jjigae",\n      "ingredients": "Kimchi, pork, tofu",\n      "allergens": ["soybean", "pork"],\n      "crossContactAllergens": [],\n      "spicy": 2,\n      "eatingMethod": [\n        "Serve hot';

function makeRes() { const r = {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.body = o; return r; }; return r; }

async function main() {
  const handler = loadBaselineHandler();
  let sentBody = null;
  let sentUrl = null;
  global.fetch = async (url, init) => {
    sentUrl = url;
    sentBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: TRUNCATED_TEXT }] } }],
        usageMetadata: { promptTokenCount: 1012, candidatesTokenCount: 1013, thoughtsTokenCount: 2044, totalTokenCount: 4069 },
      }),
    };
  };
  process.env.GEMINI_API_KEY = 'test-key-not-real';
  const origErr = console.error; console.error = () => {};
  const res = makeRes();
  await handler({ method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,MENU9' } }, res);
  console.error = origErr;

  const facts = {
    status: res.statusCode,
    error: res.body && res.body.error,
    code: res.body && res.body.code,
    maxOutputTokens: sentBody.generationConfig.maxOutputTokens,
    thinkingConfig: sentBody.generationConfig.thinkingConfig,
    keyInUrl: sentUrl.includes('key='),
  };
  console.log('[repro] baseline result:', JSON.stringify(facts));
  assert.strictEqual(facts.status, 502);
  assert.strictEqual(facts.code, undefined, 'baseline has no machine-readable error code');
  assert.strictEqual(facts.maxOutputTokens, 3072);
  assert.strictEqual(facts.thinkingConfig, undefined, 'baseline leaves default thinking on, sharing the 3072 budget');
  assert.strictEqual(facts.keyInUrl, true, 'baseline sends the API key in the URL query');
  console.log('[repro] REPRODUCED: truncated MAX_TOKENS reply -> 502 "not valid JSON" (the error the user saw)');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
