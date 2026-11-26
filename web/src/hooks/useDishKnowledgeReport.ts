import { useMemo } from 'react';
import { useProfileStore } from '../store/profileStore';
import { useKnowledgeBaseStatus } from './useKnowledgeBaseStatus';
import { buildKnowledgeReportForDish } from '../services/knowledgeBase';
import { userHasAllergyTo, getUncertainCustomAllergenIds } from '../lib/safety';
import type { Dish } from '../types';

// [IMP-18D-2] A pure, synchronous derivation of (dish, profile, KB) — no
// manual "render token"/async-staleness dance needed the way the vanilla
// DOM version required, because React's useMemo recomputes on its own
// whenever the dependencies actually change, and discards stale results
// automatically (there's no imperative "write to the DOM" step that could
// land out of order).
export function useDishKnowledgeReport(dish: Dish, analysisSource: 'ai_scan' | 'demo_location', dishKey: string) {
  const kbReady = useKnowledgeBaseStatus();
  const selectedAllergies = useProfileStore((s) => s.selectedAllergies);
  const customAllergies = useProfileStore((s) => s.customAllergies);

  return useMemo(() => {
    const profile = { selectedAllergies, customAllergies, dietary: 'none' as const, selectedSpicy: 0 };
    try {
      return buildKnowledgeReportForDish(
        dish,
        analysisSource,
        dishKey,
        (id: string) => userHasAllergyTo(id, profile),
        () => getUncertainCustomAllergenIds(customAllergies)
      );
    } catch {
      return null;
    }
    // kbReady is a dependency on purpose: once the JSON data finishes
    // loading, this recomputes with real data instead of the "loading" stub.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dish, analysisSource, dishKey, selectedAllergies, customAllergies, kbReady]);
}
