import { useCallback, useState } from 'react';
import { useProfileStore } from '../store/profileStore';
import { useUIStore } from '../store/uiStore';
import { useT } from './useT';
import { allergenKnowledgeBaseReady, resolveCustomAllergyInput } from '../services/knowledgeBase';
import type { CustomAllergyEntry } from '../types';

function findDuplicateCanonicalAllergy(
  canonicalId: string | null | undefined,
  selectedAllergies: Set<string>,
  customAllergies: CustomAllergyEntry[]
): { kind: 'standard' | 'custom' } | null {
  if (!canonicalId) return null;
  if (selectedAllergies.has(canonicalId)) return { kind: 'standard' };
  const dup = customAllergies.find((x) => x.canonicalId === canonicalId);
  return dup ? { kind: 'custom' } : null;
}

// Ports addCustomAllergy()/resolveAmbiguousCustomAllergy() (§IMP-12) — the
// human-in-the-loop entity-resolution flow for free-text allergy input.
export function useCustomAllergy() {
  const { t } = useT();
  const [isResolving, setIsResolving] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  const addCustomAllergy = useCallback(
    async (rawText: string) => {
      const val = rawText.trim();
      if (!val) return;
      const { selectedAllergies, customAllergies, addCustomAllergy: pushEntry } = useProfileStore.getState();

      const alreadyExists = customAllergies.some((x) => x.original.toLowerCase() === val.toLowerCase());
      if (alreadyExists) return;

      setIsResolving(true);
      try {
        await allergenKnowledgeBaseReady;
        const resolved = await resolveCustomAllergyInput(val);

        if (resolved.mappingStatus !== 'ambiguous') {
          const duplicate = findDuplicateCanonicalAllergy(resolved.canonicalId, selectedAllergies, customAllergies);
          if (duplicate) {
            showToast(duplicate.kind === 'standard' ? t('toastCustomAlreadyStandard') : t('toastCustomAlreadyAdded'));
            return;
          }
        }

        pushEntry(resolved);
        if (resolved.mappingStatus === 'ambiguous') {
          showToast(t('toastCustomAmbiguous'));
        } else {
          showToast(t('toastCustomAdd') + `${val} (${resolved.translated})`);
        }
      } finally {
        setIsResolving(false);
      }
    },
    [showToast, t]
  );

  const resolveAmbiguous = useCallback(
    (originalText: string, chosenCanonicalId: string) => {
      const { selectedAllergies, customAllergies, updateCustomAllergy, removeCustomAllergy } = useProfileStore.getState();
      const duplicate = findDuplicateCanonicalAllergy(chosenCanonicalId, selectedAllergies, customAllergies);
      if (duplicate) {
        showToast(t('toastCustomAlreadyAdded'));
        removeCustomAllergy(originalText);
        return;
      }
      updateCustomAllergy(originalText, {
        canonicalId: chosenCanonicalId,
        mappingStatus: 'exact_standard',
        mappingSource: 'user_confirmed_disambiguation',
        userConfirmed: true,
        candidateIds: [],
      });
      showToast(t('toastCustomResolved'));
    },
    [showToast, t]
  );

  const removeCustomAllergy = useCallback(
    (originalText: string) => {
      useProfileStore.getState().removeCustomAllergy(originalText);
      showToast(t('toastCustomRemove') + originalText);
    },
    [showToast, t]
  );

  return { addCustomAllergy, resolveAmbiguous, removeCustomAllergy, isResolving };
}
