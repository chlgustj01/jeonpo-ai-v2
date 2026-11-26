// tests/price-after.js
// [PRICE] Menu price extraction: normalization rules (shared/dish-schema.js)
// and the analyze-menu handler path. Mock only — no real Gemini call.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const schema = require('../shared/dish-schema.js');

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
function dish(ko, en, price) {
  const d = { name_ko: ko, name_en: en, ingredients: 'x', allergens: [], crossContactAllergens: [], spicy: 1, eatingMethod: ['a'], description: 'd', culturalNote: '' };
  if (price !== undefined) d.price = price;
  return d;
}
const N = schema.normalizeMenuPrice;

async function main() {
  await tc('TC-PR-01', 'exact KRW price is kept with source menu_text', async () => {
    const p = N({ status: 'exact', text: '9,000원', amount: 9000, currency: 'KRW' });
    A.deepStrictEqual(p, { status: 'exact', amount: 9000, min: null, max: null, currency: 'KRW', text: '9,000원', source: 'menu_text' });
  });

  await tc('TC-PR-02', 'not shown / null / garbage -> not_shown, never 0', async () => {
    for (const raw of [{ status: 'not_shown' }, null, 'cheap', 42, []]) {
      const p = N(raw);
      A.strictEqual(p.status, 'not_shown');
      A.strictEqual(p.amount, null);
    }
  });

  await tc('TC-PR-03', 'missing field (older prompt / cached 1.0.0 result) -> unknown', async () => {
    A.strictEqual(N(undefined).status, 'unknown');
  });

  await tc('TC-PR-04', 'range needs min < max, both valid', async () => {
    A.deepStrictEqual(N({ status: 'range', text: '소 9,000 / 대 12,000', min: 9000, max: 12000, currency: 'KRW' }).status, 'range');
    const bad = N({ status: 'range', text: '9,000~9,000', min: 9000, max: 9000, currency: 'KRW' });
    A.strictEqual(bad.status, 'ambiguous'); // printed text kept, no amount invented
    A.strictEqual(bad.min, null);
  });

  await tc('TC-PR-05', 'ambiguous keeps the printed text only (e.g. 시가)', async () => {
    const p = N({ status: 'ambiguous', text: '시가', currency: 'KRW' });
    A.strictEqual(p.status, 'ambiguous');
    A.strictEqual(p.text, '시가');
    A.strictEqual(p.amount, null);
  });

  await tc('TC-PR-06', 'invalid amounts degrade (0, negative, NaN, string, > 10,000,000)', async () => {
    for (const amount of [0, -100, NaN, '9000', 20000000]) {
      const p = N({ status: 'exact', text: '9,000원', amount, currency: 'KRW' });
      A.strictEqual(p.status, 'ambiguous', String(amount));
      A.strictEqual(p.amount, null);
    }
    A.strictEqual(N({ status: 'exact', amount: 0, currency: 'KRW' }).status, 'not_shown'); // no text -> nothing to show
  });

  await tc('TC-PR-07', 'unsupported / missing currency is not guessed for exact prices', async () => {
    A.strictEqual(N({ status: 'exact', text: '9 GBP', amount: 9, currency: 'GBP' }).status, 'ambiguous');
    A.strictEqual(N({ status: 'exact', text: '9000', amount: 9000 }).status, 'ambiguous');
    A.strictEqual(N({ status: 'exact', text: '$9', amount: 9, currency: 'usd' }).currency, 'USD');
  });

  await tc('TC-PR-08', 'text is trimmed and capped at 40 chars', async () => {
    const p = N({ status: 'ambiguous', text: '  ' + 'x'.repeat(100) + '  ' });
    A.strictEqual(p.text.length, 40);
  });

  await tc('TC-PR-09', 'price does not change the safety-relevant validation status', async () => {
    const r = schema.validateAndNormalizeDishesResponse({ dishes: [dish('김치', 'Kimchi', { status: 'exact', amount: -1, text: '?', currency: 'KRW' })] }, ['soybean']);
    A.strictEqual(r.validationStatus, 'valid');
    A.strictEqual(r.dishes[0].dishValidationStatus, 'valid');
  });

  await tc('TC-PR-10', 'envelope accepts both 1.0.0 (no price) and 1.1.0', async () => {
    const base = { dishes: [{ foodId: 'a', name: 'A', allergens: [], crossContactAllergens: [], eatingMethod: [], ingredients: '', description: '', culturalNote: '', spicy: null }], validationStatus: 'valid' };
    A.strictEqual(schema.isValidDishResponseEnvelope({ ...base, schemaVersion: '1.0.0' }), true);
    A.strictEqual(schema.isValidDishResponseEnvelope({ ...base, schemaVersion: '1.1.0' }), true);
    A.strictEqual(schema.isValidDishResponseEnvelope({ ...base, schemaVersion: '9.9.9' }), false);
    const withBadPrice = { ...base, schemaVersion: '1.1.0', dishes: [{ ...base.dishes[0], price: null }] };
    A.strictEqual(schema.isValidDishResponseEnvelope(withBadPrice), false);
  });

  // ---------------- handler path ----------------
  process.env.GEMINI_API_KEY = 'price-test-key';
  const origErr = console.error; const origWarn = console.warn;
  console.error = () => {}; console.warn = () => {};
  const loadAnalyze = () => { delete require.cache[require.resolve('../api/analyze-menu.js')]; return require('../api/analyze-menu.js'); };
  let img = 0;
  const callAnalyze = async (payload) => {
    const handler = loadAnalyze();
    let sentBody = null;
    global.fetch = async (url, init) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(payload) }] } }] }) };
    };
    const res = makeRes();
    img += 1;
    await handler({ method: 'POST', body: { imageBase64: `data:image/jpeg;base64,PRICE${img}` } }, res);
    return { res, sentBody };
  };

  await tc('TC-PR-11', 'several dishes keep their OWN prices (no cross-matching by the server)', async () => {
    const { res } = await callAnalyze({ menuItemCount: 3, dishes: [
      dish('김치찌개', 'Kimchi Jjigae', { status: 'exact', text: '9,000원', amount: 9000, currency: 'KRW' }),
      dish('부대찌개', 'Budae Jjigae', { status: 'range', text: '2인 22,000 / 3인 33,000', min: 22000, max: 33000, currency: 'KRW' }),
      dish('공기밥', 'Steamed Rice', { status: 'not_shown' }),
    ] });
    A.strictEqual(res.statusCode, 200);
    const byKo = Object.fromEntries(res.body.dishes.map((d) => [d.nameKo, d.price]));
    A.strictEqual(byKo['김치찌개'].amount, 9000);
    A.strictEqual(byKo['부대찌개'].min, 22000);
    A.strictEqual(byKo['부대찌개'].max, 33000);
    A.strictEqual(byKo['공기밥'].status, 'not_shown');
    A.strictEqual(res.body.schemaVersion, '1.1.0');
  });

  await tc('TC-PR-12', 'a response without price fields (dish photo, older prompt) still works', async () => {
    const { res } = await callAnalyze({ menuItemCount: 1, dishes: [dish('비빔밥', 'Bibimbap')] });
    A.strictEqual(res.statusCode, 200);
    A.strictEqual(res.body.dishes[0].price.status, 'unknown');
  });

  await tc('TC-PR-13', 'prompt asks for printed prices only and forbids estimates; version 2.2.0 in cache key', async () => {
    const { sentBody } = await callAnalyze({ dishes: [dish('김치', 'Kimchi')] });
    const prompt = sentBody.contents[0].parts[0].text;
    A.ok(/Never estimate or guess a typical price/.test(prompt));
    A.ok(/Never give one item another item's price/.test(prompt));
    A.ok(/"price": \{ "status"/.test(prompt));
    const key = loadAnalyze()._buildAnalysisCacheKey('h');
    A.ok(key.includes('2.2.0') && key.includes('1.1.0'), key);
  });

  await tc('TC-PR-14', 'translate-dish request never carries prices (prices are not translated)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'services', 'api.ts'), 'utf8');
    const block = src.slice(src.indexOf("'/api/translate-dish'"), src.indexOf('TranslateDishError\n  );'));
    A.ok(!/price/.test(block));
  });

  console.error = origErr; console.warn = origWarn;
  notRun('TC-PR-REAL', 'real Gemini price extraction', 'recorded separately in docs/UX-IMPROVEMENT.md §9 (2 real calls)');

  const summary = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log('\n=== 요약 ===');
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건 / 실행된 assertion 총 개수: ${totalAssertions}건`);
  if (summary.FAIL > 0) process.exitCode = 1;
}

main();
