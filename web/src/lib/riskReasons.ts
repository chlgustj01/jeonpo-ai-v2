// [UX-IMPROVEMENT P0] Turns a per-dish SafetyResult (lib/safety.ts — the
// judgment itself is unchanged) into user-readable reasons, split by kind:
// allergy match / diet / cross-contact estimate / spice / uncertainty.
// Pure function: the same input always yields the same reasons, so the
// list row, the detail panel and the staff question all agree.
import { translate, formatTemplate } from '../i18n';
import { getAllergenDisplayLabel, getSpicyDisplayLabel } from './display';
import { checkDishSafety, SEVERITY_RANK, type Profile } from './safety';
import type { Dish, Lang, SafetyResult, SafetyState } from '../types';

export type ReasonKind = 'allergy' | 'dietary' | 'crossContact' | 'spicy' | 'uncertain' | 'none' | 'error';

export interface RiskReason {
  kind: ReasonKind;
  text: string;
}

const DIET_KEY: Record<string, string> = { vegan: 'dietVegan', halal: 'dietHalal', vegetarian: 'dietVegetarian' };
const DIET_IDS = new Set(['vegan', 'halal', 'vegetarian']);

export const BADGE_KEY: Record<SafetyState, string> = {
  red: 'badgeRed',
  orange: 'badgeOrange',
  unknown: 'badgeUnknown',
  green: 'badgeGreen',
  error: 'badgeError',
};

export function describeRisk(dish: Dish, result: SafetyResult, profile: Profile, lang: Lang): RiskReason[] {
  const t = (k: string) => translate(lang, k);
  const reasons: RiskReason[] = [];

  if (result.dataUnavailable) return [{ kind: 'error', text: t('reasonDataUnavailable') }];

  const dietMatches = result.matchedDangers.filter((d) => DIET_IDS.has(d));
  const allergenMatches = result.matchedDangers.filter((d) => !DIET_IDS.has(d));

  if (result.safetyState === 'red' && allergenMatches.length > 0) {
    reasons.push({ kind: 'allergy', text: formatTemplate(t('reasonAllergy'), { list: allergenMatches.map((id) => getAllergenDisplayLabel(lang, id)).join(', ') }) });
  }
  if (dietMatches.length > 0) {
    reasons.push({ kind: 'dietary', text: formatTemplate(t('reasonDietary'), { diet: dietMatches.map((d) => t(DIET_KEY[d])).join(', ') }) });
  }
  if (result.isCrossContact && allergenMatches.length > 0) {
    reasons.push({ kind: 'crossContact', text: formatTemplate(t('reasonCrossContact'), { list: allergenMatches.map((id) => getAllergenDisplayLabel(lang, id)).join(', ') }) });
  }
  // Spice is reported whenever the dish is spicier than the profile level,
  // even if a stronger reason (RED) already decided the badge.
  if (dish.spicy !== null && dish.spicy !== undefined && dish.spicy > profile.selectedSpicy) {
    reasons.push({
      kind: 'spicy',
      text: formatTemplate(t('reasonSpicy'), { dish: getSpicyDisplayLabel(lang, dish.spicy), mine: getSpicyDisplayLabel(lang, profile.selectedSpicy) }),
    });
  }
  if (result.hasUnknownSpicy) reasons.push({ kind: 'uncertain', text: t('reasonUnknownSpicy') });
  if (result.unknownAllergenIds.length > 0) reasons.push({ kind: 'uncertain', text: t('reasonUnknownAllergen') });
  result.uncertainMatches.forEach((m) =>
    reasons.push({ kind: 'uncertain', text: formatTemplate(t('reasonUncertainCustom'), { input: m.originalInput, candidate: getAllergenDisplayLabel(lang, m.candidateAllergenId) }) })
  );
  if (result.uncertaintyReasons.includes('degraded_allergen_field')) reasons.push({ kind: 'uncertain', text: t('reasonDegraded') });

  if (reasons.length === 0) reasons.push({ kind: 'none', text: t('reasonNoMatch') });
  return reasons;
}

export interface RankedDish {
  uid: string;
  dish: Dish;
  result: SafetyResult;
  originalIndex: number;
}

// Highest risk first (red > error > unknown > orange > green); ties keep
// the menu's own order so the list still reads like the menu board.
export function rankDishes(dishes: Dish[], profile: Profile): RankedDish[] {
  return dishes
    .map((dish, i) => ({ uid: dish.uid || `${dish.foodId}#${i}`, dish, result: checkDishSafety(dish, profile), originalIndex: i }))
    .sort((a, b) => SEVERITY_RANK[b.result.safetyState] - SEVERITY_RANK[a.result.safetyState] || a.originalIndex - b.originalIndex);
}
