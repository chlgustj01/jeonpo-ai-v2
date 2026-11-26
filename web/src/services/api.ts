// Thin fetch wrappers for the two serverless endpoints (§IMP-04). No
// client-side retry by design, same as the vanilla app (§IMP-13 devlog:
// the server already retries Gemini; doubling that client-side would just
// call *our* server twice without fixing the underlying Gemini flakiness,
// and complicates the abort/request-id logic below for no benefit). The
// user can retry by hand, and only for errors marked retryable.
import type { AnalyzeMenuResponse, Dish, Lang, TranslateDishResponse } from '../types';

// [Package 5] Error codes from shared/gemini-client.js, plus two that only
// the client can detect (NETWORK: our own server unreachable; NO_FOOD_FOUND:
// a valid but empty analysis).
export type ApiErrorCode =
  | 'AI_CONFIG'
  | 'AI_QUOTA'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_NETWORK'
  | 'IMAGE_INVALID'
  | 'IMAGE_TOO_LARGE'
  | 'AI_RESPONSE_INVALID'
  | 'AI_OUTPUT_TRUNCATED'
  | 'AI_BLOCKED'
  | 'NETWORK'
  | 'NO_FOOD_FOUND'
  | 'UNKNOWN';

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'AI_CONFIG', 'AI_QUOTA', 'AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_NETWORK', 'IMAGE_INVALID', 'IMAGE_TOO_LARGE',
  'AI_RESPONSE_INVALID', 'AI_OUTPUT_TRUNCATED', 'AI_BLOCKED', 'NETWORK', 'NO_FOOD_FOUND', 'UNKNOWN',
]);

// i18n key for each code (web/src/i18n/package5Extra.ts).
export const ERROR_MESSAGE_KEYS: Record<ApiErrorCode, string> = {
  AI_CONFIG: 'errAiConfig',
  AI_QUOTA: 'errAiQuota',
  AI_UNAVAILABLE: 'errAiUnavailable',
  AI_TIMEOUT: 'errAiTimeout',
  AI_NETWORK: 'errAiUnavailable',
  IMAGE_INVALID: 'errImageInvalid',
  IMAGE_TOO_LARGE: 'errImageTooLarge',
  AI_RESPONSE_INVALID: 'errAiResponseInvalid',
  AI_OUTPUT_TRUNCATED: 'errAiTruncated',
  AI_BLOCKED: 'errAiBlocked',
  NETWORK: 'errNetwork',
  NO_FOOD_FOUND: 'errNoFood',
  UNKNOWN: 'errUnknown',
};

// Used when an older server (or a proxy page) returns no `code`.
function codeFromHttpStatus(status: number): { code: ApiErrorCode; retryable: boolean } {
  if (status === 429) return { code: 'AI_QUOTA', retryable: true };
  if (status === 413) return { code: 'IMAGE_TOO_LARGE', retryable: false };
  if (status === 504) return { code: 'AI_TIMEOUT', retryable: true };
  if (status === 400 || status === 415) return { code: 'IMAGE_INVALID', retryable: false };
  if (status >= 500) return { code: 'AI_UNAVAILABLE', retryable: true };
  return { code: 'UNKNOWN', retryable: true };
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  constructor(code: ApiErrorCode, retryable: boolean, httpStatus: number | null, devMessage: string) {
    super(devMessage);
    this.name = 'ApiError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
  // Shown only inside the collapsed "Technical details" line.
  get diagnostic(): string {
    return `${this.code}${this.httpStatus !== null ? ` · HTTP ${this.httpStatus}` : ''}`;
  }
}
export class AnalyzeMenuError extends ApiError {}
export class TranslateDishError extends ApiError {}

async function postJson(url: string, body: unknown, signal: AbortSignal, ErrorClass: typeof ApiError): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ErrorClass('NETWORK', true, null, `${url} unreachable`);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { code?: unknown; retryable?: unknown } | null;
    const fallback = codeFromHttpStatus(response.status);
    const code = payload && typeof payload.code === 'string' && KNOWN_CODES.has(payload.code) ? (payload.code as ApiErrorCode) : fallback.code;
    const retryable = payload && typeof payload.retryable === 'boolean' ? payload.retryable : fallback.retryable;
    throw new ErrorClass(code, retryable, response.status, `${url} failed: ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new ErrorClass('AI_RESPONSE_INVALID', true, response.status, `${url} returned non-JSON`);
  }
}

export async function analyzeMenu(imageBase64: string, signal: AbortSignal): Promise<AnalyzeMenuResponse> {
  const data = await postJson('/api/analyze-menu', { imageBase64 }, signal, AnalyzeMenuError);
  if (!isValidDishResponseEnvelope(data)) throw new AnalyzeMenuError('AI_RESPONSE_INVALID', true, 200, 'invalid response envelope');
  if (data.validationStatus === 'empty' || data.dishes.length === 0) {
    throw new AnalyzeMenuError('NO_FOOD_FOUND', false, 200, `validationStatus=${data.validationStatus}`);
  }
  if (data.validationStatus === 'invalid') throw new AnalyzeMenuError('AI_RESPONSE_INVALID', true, 200, 'validationStatus=invalid');
  return data;
}

// Mirrors the vanilla app's isValidDishResponseEnvelope() client-side
// sanity check — a defense-in-depth layer on top of the server's own
// shared/dish-schema.js validation (never trust a network response blindly).
function isValidDishResponseEnvelope(data: unknown): data is AnalyzeMenuResponse {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.dishes) && typeof d.analysisId === 'string' && typeof d.validationStatus === 'string';
}

export async function translateDish(
  analysisId: string,
  targetLanguage: Lang,
  dishes: Dish[],
  signal: AbortSignal
): Promise<TranslateDishResponse> {
  const data = await postJson(
    '/api/translate-dish',
    {
      analysisId,
      targetLanguage,
      dishes: dishes.map((d) => ({
        foodId: d.foodId,
        nameEn: d.nameEn,
        nameKo: d.nameKo,
        ingredients: d.ingredients,
        eatingMethod: d.eatingMethod,
        description: d.description,
        culturalNote: d.culturalNote,
      })),
    },
    signal,
    TranslateDishError
  );
  return data as TranslateDishResponse;
}

// [§IMP-04] Merge translated display text onto the language-neutral
// canonical dish — allergens/crossContactAllergens/spicy/foodId/fieldStatus
// are never touched here; translation can only ever change the five
// display fields below, by construction.
export function buildTranslatedDishList(
  canonicalDishes: Dish[],
  translationsByFoodId: TranslateDishResponse['translationsByFoodId']
): Dish[] {
  return canonicalDishes.map((dish) => {
    const t = translationsByFoodId[dish.foodId];
    if (!t) return dish;
    const translatedName = t.translatedName || dish.nameEn || dish.name;
    return {
      ...dish,
      name: dish.nameKo && translatedName ? `${translatedName} (${dish.nameKo})` : translatedName || dish.name,
      ingredients: t.ingredients || dish.ingredients,
      // [Package 5] kept for the knowledge-DB lookup (English-keyed).
      canonicalIngredients: dish.canonicalIngredients ?? dish.ingredients,
      eatingMethod: t.eatingMethod && t.eatingMethod.length > 0 ? t.eatingMethod : dish.eatingMethod,
      description: t.description || dish.description,
      culturalNote: t.culturalNote !== undefined && t.culturalNote !== null ? t.culturalNote : dish.culturalNote,
    };
  });
}
