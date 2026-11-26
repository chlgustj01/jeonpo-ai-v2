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
  // [Package 5] English ingredients from analysis, set when `ingredients`
  // holds a translation. Used only for the knowledge-DB lookup.
  canonicalIngredients?: string;
}

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
