// Assembles the extracted literal blocks into final TS source files, so the
// huge translations/locations/REVIEWS_DATABASE objects never need to be
// retyped by hand (and never pass through the agent's own context either).
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, 'extracted');
const SRC = path.join(__dirname, '..', 'src');

function read(name) {
  return fs.readFileSync(path.join(EXT, name + '.txt'), 'utf8');
}

// --- i18n/translations.ts ---------------------------------------------
const translationsLiteral = read('translations');
fs.writeFileSync(
  path.join(SRC, 'i18n', 'translations.generated.ts'),
  `// AUTO-EXTRACTED from the original index.html's \`translations\` object by
// web/scripts/assemble-data.cjs (Package 4 migration). Do not hand-edit —
// edit index.html's data if the vanilla version still needs it, or edit
// this file directly going forward once the vanilla version is retired.
/* eslint-disable */
export const translations = ${translationsLiteral} as const;

export type Lang = keyof typeof translations;
export type TranslationKey = keyof typeof translations.en;
`,
  'utf8'
);

// --- data/locations.generated.ts ---------------------------------------
const locationsLiteral = read('locations');
fs.writeFileSync(
  path.join(SRC, 'data', 'locations.generated.ts'),
  `// AUTO-EXTRACTED from index.html's \`locations\` demo map data.
/* eslint-disable */
export const locations = ${locationsLiteral};
`,
  'utf8'
);

// --- data/demoReviews.generated.ts --------------------------------------
const reviewsLiteral = read('REVIEWS_DATABASE');
fs.writeFileSync(
  path.join(SRC, 'data', 'demoReviews.generated.ts'),
  `// AUTO-EXTRACTED from index.html's \`REVIEWS_DATABASE\` demo seed data.
// This is READ-ONLY demo content — real user reviews are a separate store
// (see src/store/reviewStore.ts) kept deliberately apart (§IMP-14).
/* eslint-disable */
export const demoReviews = ${reviewsLiteral} as Record<string, any[]>;
`,
  'utf8'
);

// --- lib/constants.generated.ts -----------------------------------------
const dietaryViolation = read('DIETARY_VIOLATION_ALLERGENS');
const langToCountry = read('LANG_TO_COUNTRY');
const dietPhrasesKo = read('DIET_PHRASES_KO');
const ambiguousTerms = read('KNOWN_AMBIGUOUS_CUSTOM_TERMS').replace(/^\s*=\s*/, '');
fs.writeFileSync(
  path.join(SRC, 'lib', 'constants.generated.ts'),
  `// AUTO-EXTRACTED small constant tables from index.html.
/* eslint-disable */
export const DIETARY_VIOLATION_ALLERGENS = ${dietaryViolation} as Record<string, string[]>;
export const LANG_TO_COUNTRY = ${langToCountry} as Record<string, string>;
export const DIET_PHRASES_KO = ${dietPhrasesKo} as Record<string, string>;
export const KNOWN_AMBIGUOUS_CUSTOM_TERMS = ${ambiguousTerms} as Record<string, { candidateIds: string[] }>;
`,
  'utf8'
);

console.log('assembled OK');
