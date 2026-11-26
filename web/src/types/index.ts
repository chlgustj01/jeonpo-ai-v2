// Core domain types for the React/TypeScript rewrite (Package 4).
// Shapes mirror what api/analyze-menu.js / api/translate-dish.js /
// shared/dish-schema.js actually produce (Package 2/3) — not invented
// fresh. `any` is avoided except at the two real boundaries where runtime
// data truly is untyped until validated (raw fetch responses).

export type Lang = 'en' | 'ja' | 'zh' | 'vi' | 'es' | 'ko';
export type Dietary = 'none' | 'vegan' | 'halal' | 'vegetarian';
export type SafetyState = 'green' | 'orange' | 'unknown' | 'error' | 'red';
export type FieldStatus = 'ok' | 'invalid_type' | 'missing';

export interface CustomAllergyEntry {
  original: string;
  translated: string | null;
  canonicalId?: string | null;
  mappingStatus:
    | 'exact_standard'
    | 'exact_alias'
    | 'candidate_db'
    | 'custom_unlisted'
    | 'translation_failed'
    | 'kb_unavailable'
    | 'ambiguous';
  mappingSource?: string;
  candidateIds?: string[];
  userConfirmed?: boolean;
  evidenceId?: string;
  evidenceScope?: string;
}

// A single menu item as returned by /api/analyze-menu (language-neutral,
// English-only canonical form — §IMP-04) or after /api/translate-dish has
// merged display text (§IMP-04/05). Allergy-relevant fields never change
// between the two: only name/ingredients/eatingMethod/description/
// culturalNote are translation targets.
export interface Dish {
  // [UX-IMPROVEMENT] Stable per-analysis id ("<analysisId>#<index>"). foodId is
  // a slug of the English name, so two menu entries with the same name share
  // it — selection must never rely on the name.
  uid?: string;
  foodId: string;
  name: string; // display name (combined "Translated (한국어)" once translated)
  nameKo: string;
  nameEn: string;
  ingredients: string;
  allergens: string[];
  crossContactAllergens: string[];
  spicy: number | null;
  eatingMethod: string[];
  description: string;
  culturalNote: string;
  fieldStatus?: Partial<Record<'allergens' | 'crossContactAllergens' | 'spicy', FieldStatus>>;
  // [Package 5] values corrected to what shared/dish-schema.js actually emits.
  dishValidationStatus?: 'valid' | 'degraded';
  // [Package 5] 'printed' = read from text in the photo; 'inferred' = the
  // model's guess from the dish name. Absent on demo data.
  ingredientSource?: 'printed' | 'inferred';
  // [PRICE] Printed menu price (shared/dish-schema.js normalizeMenuPrice).
  // Absent on demo data and on analyses made before schema 1.1.0.
  price?: DishPrice;
  // [Package 5] English ingredients from analysis, set when `ingredients`
  // holds a translation. Used only for the knowledge-DB lookup.
  canonicalIngredients?: string;
}

// [PRICE] See shared/dish-schema.js normalizeMenuPrice for the rules.
export type PriceCurrency = 'KRW' | 'USD' | 'JPY' | 'CNY' | 'EUR';
export interface DishPrice {
  status: 'exact' | 'range' | 'ambiguous' | 'not_shown' | 'unknown';
  amount: number | null;
  min: number | null;
  max: number | null;
  currency: PriceCurrency | null;
  text: string;
  source: 'menu_text' | null;
}

// [PRICE] Currencies the exchange feature supports (open.er-api.com, KRW base).
export type DisplayCurrency = 'USD' | 'JPY' | 'CNY' | 'EUR' | 'VND';

// [Package 5] How much of the photographed menu this result covers.
export interface AnalysisCoverage {
  returnedCount: number;
  visibleItemCount: number | null; // model's own count (estimate)
  maxDishes: number;
  isComplete: boolean | null; // null = cannot tell
}

export interface AnalyzeMenuResponse {
  dishes: Dish[];
  analysisId: string;
  validationStatus: 'valid' | 'partial' | 'empty' | 'invalid';
  validationIssues?: unknown[];
  coverage?: AnalysisCoverage;
}

export interface TranslationEntry {
  translatedName?: string;
  ingredients?: string;
  eatingMethod?: string[];
  description?: string;
  culturalNote?: string | null;
}

export interface TranslateDishResponse {
  translationSchemaVersion: string;
  targetLanguage: Lang;
  translationsByFoodId: Record<string, TranslationEntry>;
  validationIssues?: unknown[];
  skippedTranslationCall?: boolean;
}

export interface SafetyResult {
  safetyState: SafetyState;
  isCrossContact: boolean;
  matchedDangers: string[];
  unknownAllergenIds: string[];
  hasUncertainMatch: boolean;
  uncertainMatches: { originalInput: string; candidateAllergenId: string }[];
  hasUnknownSpicy: boolean;
  uncertaintyReasons: string[];
  dataUnavailable?: boolean;
}

export interface UserReview {
  id: string;
  isUserReview: true;
  user: string;
  country: string;
  spiceTolerance: number;
  dietary: Dietary | string;
  tasteTags: string[];
  rating: number;
  spiceFelt: number;
  text: string;
  wouldAgain: boolean;
  createdAt: number;
  editedAt?: number;
  // [UX-IMPROVEMENT] Optional links (older saved reviews simply lack them).
  source?: 'ai_scan' | 'demo_location' | 'map';
  locationId?: number;
  locationName?: string;
  dishNameKo?: string;
}

// Demo seed reviews (REVIEWS_DATABASE) share the same display shape but
// are never user-authored/editable.
export interface DemoReview {
  user: string;
  country: string;
  spiceTolerance: number;
  dietary: string;
  rating: number;
  spiceFelt: number;
  tasteTags?: string[];
  text: string;
  wouldAgain: boolean;
}

export type AnyReview = (UserReview | DemoReview) & { isUserReview?: boolean };

// [UX-IMPROVEMENT] The restaurant a scan belongs to (from the map), if any.
export interface LocationContext {
  id: number;
  name: string;
  nameKo: string;
}

export interface StaffQuestions {
  general: string;
  personal: string;
  crossContact: string;
  comprehensive: string;
  hasAmbiguousCustomAllergyCaveat: boolean;
  dishNameKo: string;
}

export type StaffQuestionType = 'general' | 'personal' | 'crossContact' | 'comprehensive';

export interface StandardAllergen {
  id: string;
  icon: string;
  labels: Record<Lang, string>;
}
