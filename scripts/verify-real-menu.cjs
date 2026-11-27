#!/usr/bin/env node
// scripts/verify-real-menu.cjs
//
// One-shot real check for a REAL menu photo, through the running backend
// (the same /api/analyze-menu the app uses). Sends exactly ONE analysis
// request (one Gemini call unless the server cache already has this photo)
// and one exchange-rate request. It never reads or prints the API key — the
// key stays inside the backend.
//
//   node scripts/verify-real-menu.cjs <photo.jpg|png|webp> [--backend http://localhost:3000] [--currency USD]
//
// Photo: keep it under ~3 MB (the server rejects > 4 MB base64). A phone
// photo can be shrunk first, or use the app itself (it resizes to 1024 px).
// Output: dishes, printed prices (status/amount/text), converted amounts,
// coverage, and a checklist to compare against the photo by eye.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const photo = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const backend = opt('backend', 'http://localhost:3000').replace(/\/$/, '');
const currency = opt('currency', 'USD').toUpperCase();
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

(async () => {
  if (!photo) {
    console.error('Usage: node scripts/verify-real-menu.cjs <photo> [--backend URL] [--currency USD|JPY|CNY|EUR|VND]');
    process.exit(2);
  }
  const mime = MIME[path.extname(photo).toLowerCase()];
  if (!mime) { console.error('Unsupported file type (use .jpg/.png/.webp).'); process.exit(2); }
  const b64 = fs.readFileSync(photo).toString('base64');
  if (b64.length > 4 * 1024 * 1024) { console.error(`Photo too large (${(b64.length / 1048576).toFixed(1)} MB base64). Shrink it below ~3 MB first.`); process.exit(2); }

  const t0 = Date.now();
  const res = await fetch(`${backend}/api/analyze-menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: `data:${mime};base64,${b64}` }),
  });
  const ms = Date.now() - t0;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const wait = body.retryAfterSeconds ? ` — retry in about ${Math.ceil(body.retryAfterSeconds / 60)} min` : '';
    console.log(`Analysis failed: HTTP ${res.status} ${body.code || ''}${wait}`);
    if (body.code === 'AI_QUOTA_DAILY') console.log('The free daily Gemini quota is still used up. Nothing else was sent.');
    process.exit(1);
  }

  let fx = null;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/KRW');
    const d = await r.json();
    if (d && d.rates && d.rates[currency] > 0) fx = { krwPer: 1 / d.rates[currency], asOf: d.time_last_update_utc };
  } catch (e) { /* conversion skipped */ }
  const conv = (krw) => (fx ? `≈ ${(krw / fx.krwPer).toFixed(currency === 'JPY' || currency === 'VND' ? 0 : 2)} ${currency}` : '(no rate)');

  console.log(`Analyzed in ${(ms / 1000).toFixed(1)} s · schema ${body.schemaVersion} · ${body.dishes.length} dishes · coverage ${JSON.stringify(body.coverage)}`);
  if (fx) console.log(`Exchange rate: 1 ${currency} = ${fx.krwPer.toFixed(2)} KRW (source update: ${fx.asOf})`);
  console.log('');
  body.dishes.forEach((d, i) => {
    const p = d.price || { status: 'unknown' };
    let priceText = p.status;
    if (p.status === 'exact') priceText = `${p.amount.toLocaleString()} ${p.currency} (${p.text}) ${p.currency === 'KRW' ? conv(p.amount) : ''}`;
    if (p.status === 'range') priceText = `${p.min.toLocaleString()}–${p.max.toLocaleString()} ${p.currency} (${p.text}) ${p.currency === 'KRW' ? `${conv(p.min)} – ${conv(p.max)}` : ''}`;
    if (p.status === 'ambiguous') priceText = `ambiguous: "${p.text}"`;
    console.log(`${String(i + 1).padStart(2)}. ${d.nameKo} / ${d.nameEn}`);
    console.log(`    price: ${priceText}`);
    console.log(`    allergens (AI estimate): ${(d.allergens || []).join(', ') || '-'} · source: ${d.ingredientSource}`);
  });
  console.log('\nCheck by eye against the photo:');
  console.log('  [ ] every dish name is on the menu (no invented items)');
  console.log('  [ ] each printed price belongs to the dish it is listed with');
  console.log('  [ ] dishes without a printed price are "not_shown" (never a guessed amount)');
  console.log('  [ ] ranges / sizes / "시가" are "range" or "ambiguous"');
  console.log('  [ ] coverage matches the number of items visible (max 10 per photo)');
})();
