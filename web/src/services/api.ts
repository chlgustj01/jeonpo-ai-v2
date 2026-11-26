// Thin fetch wrappers for the two serverless endpoints (§IMP-04). No
// client-side retry by design, same as the vanilla app (§IMP-13 devlog:
// the server already retries Gemini; doubling that client-side would just
// call *our* server twice without fixing the underlying Gemini flakiness,
// and complicates the abort/request-id logic below for no benefit).
import type { AnalyzeMenuResponse, Dish, Lang, TranslateDishResponse } from '../types';

export class AnalyzeMenuError extends Error {}
export class TranslateDishError extends Error {}

export async function analyzeMenu(imageBase64: string, signal: AbortSignal): Promise<AnalyzeMenuResponse> {
  const response = await fetch('/api/analyze-menu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64 }),
    signal,
  });
  if (!response.ok) throw new AnalyzeMenuError(`analyze-menu failed: ${response.status}`);
  const data = (await response.json()) as AnalyzeMenuResponse;
  if (!isValidDishResponseEnvelope(data)) throw new AnalyzeMenuError('invalid response envelope');
  if (data.validationStatus === 'empty' || data.validationStatus === 'invalid' || data.dishes.length === 0) {
    throw new AnalyzeMenuError(`validationStatus=${data.validationStatus}`);
  }
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
  const response = await fetch('/api/translate-dish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
    signal,
  });
  if (!response.ok) throw new TranslateDishError(`translate-dish failed: ${response.status}`);
  return (await response.json()) as TranslateDishResponse;
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
      eatingMethod: t.eatingMethod && t.eatingMethod.length > 0 ? t.eatingMethod : dish.eatingMethod,
      description: t.description || dish.description,
      culturalNote: t.culturalNote !== undefined && t.culturalNote !== null ? t.culturalNote : dish.culturalNote,
    };
  });
}
