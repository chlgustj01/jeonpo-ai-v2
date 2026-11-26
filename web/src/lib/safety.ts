// Ports checkDishSafety() and its helpers from the vanilla app verbatim in
// behavior (§IMP-01/02/03/11/12) — rewritten as pure functions that take
// the user's profile explicitly instead of reading a global `state`. This
// is the single most safety-critical piece of logic in the whole app:
// fail-closed on missing data, never silently downgrade a confirmed risk.
import { standardAllergens } from './allergens';
import { DIETARY_VIOLATION_ALLERGENS } from './constants.generated';
import { normalizeAllergyText } from '../services/knowledgeBase';
import type { CustomAllergyEntry, Dietary, Dish, SafetyState, SafetyResult } from '../types';

export interface Profile {
  selectedAllergies: Set<string>;
  customAllergies: CustomAllergyEntry[];
  dietary: Dietary;
  selectedSpicy: number;
}

export function userHasAllergyTo(allergenId: string, profile: Profile): boolean {
  if (profile.selectedAllergies.has(allergenId)) return true;
  return profile.customAllergies.some((c) => c.canonicalId === allergenId && c.userConfirmed);
}

export function violatesDietary(dish: Pick<Dish, 'allergens'>, dietary: Dietary): boolean {
  if (!dietary || dietary === 'none') return false;
  const violatingIds = DIETARY_VIOLATION_ALLERGENS[dietary] || [];
  return (dish.allergens || []).some((allg) => violatingIds.includes(allg));
}

// [IMP-12] Uncertain match: an unconfirmed ambiguous custom allergy (e.g.
// "shellfish") whose candidate ids overlap with this dish's ingredients —
// a signal that we don't know enough, not a confirmed risk.
export function findUncertainCustomAllergyMatches(
  dish: Pick<Dish, 'allergens' | 'crossContactAllergens'>,
  customAllergies: CustomAllergyEntry[]
): { originalInput: string; candidateAllergenId: string }[] {
  const dishAllergenIds = new Set([...(dish.allergens || []), ...(dish.crossContactAllergens || [])]);
  const matches: { originalInput: string; candidateAllergenId: string }[] = [];
  customAllergies.forEach((c) => {
    if (c.mappingStatus !== 'ambiguous' || c.userConfirmed) return;
    (c.candidateIds || []).forEach((candidateId) => {
      if (dishAllergenIds.has(candidateId)) {
        matches.push({ originalInput: c.original, candidateAllergenId: candidateId });
      }
    });
  });
  return matches;
}

// Unconfirmed custom allergy id set — used by the knowledge-DB report
// builder to mark "uncertain" advisories distinctly from confirmed ones.
export function getUncertainCustomAllergenIds(customAllergies: CustomAllergyEntry[]): Set<string> {
  const ids = new Set<string>();
  customAllergies.forEach((c) => {
    if (c.mappingStatus === 'ambiguous' && !c.userConfirmed) {
      (c.candidateIds || []).forEach((id) => ids.add(id));
    }
  });
  return ids;
}

export function checkDishSafety(
  dish: Pick<Dish, 'allergens' | 'crossContactAllergens' | 'spicy' | 'fieldStatus'>,
  profile: Profile
): SafetyResult {
  // [IMP-11 fail-closed] If the allergen registry itself failed to load,
  // "no match found" must never be read as "safe" — the single most
  // dangerous failure mode for an allergy-safety feature.
  if (!Array.isArray(standardAllergens) || standardAllergens.length === 0) {
    return {
      safetyState: 'error',
      isCrossContact: false,
      matchedDangers: ['DATA_UNAVAILABLE'],
      dataUnavailable: true,
      unknownAllergenIds: [],
      hasUncertainMatch: false,
      uncertainMatches: [],
      hasUnknownSpicy: false,
      uncertaintyReasons: ['registry_unavailable'],
    };
  }

  let safetyState: SafetyState = 'green';
  let isCrossContact = false;
  const matchedDangers: string[] = [];
  const unknownAllergenIds: string[] = [];

  // Plain for-loops (not .forEach callbacks) so TypeScript's control-flow
  // narrowing of `safetyState` stays accurate across the reassignments
  // below — narrowing a `let` through a closure boundary isn't tracked
  // the same way and would otherwise make the `!== 'red'` checks below
  // look like dead code to the type checker.
  for (const allg of dish.allergens || []) {
    const standardItem = standardAllergens.find((x) => x.id === allg);
    if (!standardItem) {
      unknownAllergenIds.push(allg);
      continue;
    }
    if (userHasAllergyTo(allg, profile)) {
      safetyState = 'red';
      matchedDangers.push(allg);
    }
  }

  if (safetyState !== 'red' && violatesDietary(dish, profile.dietary)) {
    safetyState = 'red';
    matchedDangers.push(profile.dietary);
  }

  if (safetyState !== 'red' && dish.crossContactAllergens) {
    for (const allg of dish.crossContactAllergens) {
      const standardItem = standardAllergens.find((x) => x.id === allg);
      if (!standardItem) {
        unknownAllergenIds.push(allg);
        continue;
      }
      if (userHasAllergyTo(allg, profile)) {
        safetyState = 'orange';
        isCrossContact = true;
        matchedDangers.push(allg);
      }
    }
  }

  // [IMP-01] dish.spicy can be null (unknown) — must be checked explicitly
  // before comparison (`null > n` coerces null to 0, which would silently
  // treat "unknown" as "not spicy at all").
  const spicyIsUnknown = dish.spicy === null || dish.spicy === undefined;
  if (!spicyIsUnknown && safetyState === 'green' && (dish.spicy as number) > profile.selectedSpicy) {
    safetyState = 'orange';
  }

  const uncertainMatches = findUncertainCustomAllergyMatches(dish, profile.customAllergies);

  const uncertaintyReasons: string[] = [];
  if (spicyIsUnknown) uncertaintyReasons.push('unknown_spicy');
  if (unknownAllergenIds.length > 0) uncertaintyReasons.push('unknown_allergen_id');
  if (uncertainMatches.length > 0) uncertaintyReasons.push('uncertain_custom_allergy');
  if (dish.fieldStatus) {
    const brokenAllergenField =
      dish.fieldStatus.allergens === 'invalid_type' || dish.fieldStatus.crossContactAllergens === 'invalid_type';
    if (brokenAllergenField) uncertaintyReasons.push('degraded_allergen_field');
  }
  if (uncertaintyReasons.length > 0 && safetyState === 'green') {
    safetyState = 'unknown';
  }

  return {
    safetyState,
    isCrossContact,
    matchedDangers,
    unknownAllergenIds,
    hasUncertainMatch: uncertainMatches.length > 0,
    uncertainMatches,
    hasUnknownSpicy: spicyIsUnknown,
    uncertaintyReasons,
  };
}

export const SEVERITY_RANK: Record<SafetyState, number> = { green: 0, orange: 1, unknown: 2, error: 3, red: 4 };

// Worst-case safety across several dishes in one scan (§IMP-03) — fail-
// closed ranking: red > error > unknown > orange > green.
export function worstSafety(results: SafetyResult[]): SafetyResult {
  let overall: SafetyResult = {
    safetyState: 'green',
    isCrossContact: false,
    matchedDangers: [],
    unknownAllergenIds: [],
    hasUncertainMatch: false,
    uncertainMatches: [],
    hasUnknownSpicy: false,
    uncertaintyReasons: [],
  };
  results.forEach((r) => {
    if (SEVERITY_RANK[r.safetyState] > SEVERITY_RANK[overall.safetyState]) overall = r;
  });
  return overall;
}

export { normalizeAllergyText };
