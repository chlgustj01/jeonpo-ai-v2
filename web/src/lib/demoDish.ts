import { extractKoreanName } from './speech';
import type { Dish } from '../types';

// The map demo's `matchedFoodObj` (locations.generated.ts) predates the
// Dish type (§IMP-04) and is missing nameKo/nameEn/description as separate
// fields — this adapter derives them so the SAME DishResultList/SafetyBanner
// components used for real AI scans can render the demo dish too, instead
// of needing a second parallel set of render components (a real
// simplification over the vanilla version's renderScanResultUI/
// renderMultiDishScanResult split).
export interface DemoMatchObj {
  foodId: string;
  name: string;
  ingredients: string;
  allergens: string[];
  crossContactAllergens?: string[];
  dietaryFlags?: string[];
  spicy: number | null;
  elements?: { name: string; prob: string }[];
  eatingMethod: string[];
  culturalNote: string;
  image?: string;
}

export function demoMatchObjToDish(matchObj: DemoMatchObj): Dish {
  const nameKo = extractKoreanName(matchObj.name);
  const nameEn = matchObj.name.replace(/\s*\([^)]*\)\s*$/, '');
  return {
    foodId: matchObj.foodId,
    name: matchObj.name,
    nameKo,
    nameEn,
    ingredients: matchObj.ingredients,
    allergens: matchObj.allergens || [],
    crossContactAllergens: matchObj.crossContactAllergens || [],
    spicy: matchObj.spicy,
    eatingMethod: matchObj.eatingMethod || [],
    description: '',
    culturalNote: matchObj.culturalNote || '',
  };
}
