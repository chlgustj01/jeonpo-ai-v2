// One-off extraction helper (Package 4 migration tool, not shipped).
// Pulls large literal data blocks (translations, locations, REVIEWS_DATABASE,
// etc.) verbatim out of the original index.html so they don't need to be
// hand-retyped (and risk transcription errors) into the new TS source tree.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

function extractBalanced(startMarker, openChar, closeChar) {
  const idx = html.indexOf(startMarker);
  if (idx === -1) throw new Error('marker not found: ' + startMarker);
  const openIdx = html.indexOf(openChar, idx);
  let depth = 0;
  let i = openIdx;
  let inString = null;
  let prevChar = '';
  for (; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === inString && prevChar !== '\\') inString = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inString = c;
    } else if (c === openChar) {
      depth++;
    } else if (c === closeChar) {
      depth--;
      if (depth === 0) { i++; break; }
    }
    prevChar = c;
  }
  return html.slice(openIdx, i);
}

const targets = [
  ['translations', 'const translations = {', '{', '}'],
  ['locations', 'const locations = [', '[', ']'],
  ['REVIEWS_DATABASE', 'const REVIEWS_DATABASE = {', '{', '}'],
  ['DIETARY_VIOLATION_ALLERGENS', 'const DIETARY_VIOLATION_ALLERGENS = {', '{', '}'],
  ['LANG_TO_COUNTRY', 'const LANG_TO_COUNTRY = {', '{', '}'],
  ['DIET_PHRASES_KO', 'const DIET_PHRASES_KO = {', '{', '}'],
  ['KNOWN_AMBIGUOUS_CUSTOM_TERMS', 'const KNOWN_AMBIGUOUS_CUSTOM_TERMS', '{', '}'],
];

const outDir = path.join(__dirname, 'extracted');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, marker, open, close] of targets) {
  const text = extractBalanced(marker, open, close);
  fs.writeFileSync(path.join(outDir, name + '.txt'), text, 'utf8');
  console.log(name, '->', text.length, 'chars');
}
