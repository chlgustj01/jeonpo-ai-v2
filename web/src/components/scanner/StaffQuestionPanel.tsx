import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../../hooks/useT';
import { useProfileStore } from '../../store/profileStore';
import { useUIStore } from '../../store/uiStore';
import { useSpeech } from '../../hooks/useSpeech';
import { generateStaffQuestions } from '../../lib/speech';
import { getAllergenDisplayLabel } from '../../lib/display';
import { Button } from '../common/ui';
import type { Dish, StaffQuestionType } from '../../types';

const TYPES: StaffQuestionType[] = ['general', 'personal', 'crossContact', 'comprehensive'];
const TAB_LABEL_KEY: Record<StaffQuestionType, string> = {
  general: 'staffQTypeGeneral',
  personal: 'staffQTypePersonal',
  crossContact: 'staffQTypeCrossContact',
  comprehensive: 'staffQTypeComprehensive',
};
const MEANING_KEY: Record<StaffQuestionType, string> = {
  general: 'staffQMeaningGeneral',
  personal: 'staffQMeaningPersonal',
  crossContact: 'staffQMeaningCrossContact',
  comprehensive: 'staffQMeaningComprehensive',
};

// Ports updateStaffQuestionPanel()/generateStaffQuestions() (§IMP-09) — the
// 4-type rule-based staff question panel. No Gemini call here at all.
export function StaffQuestionPanel({ dishes }: { dishes: Dish[] }) {
  const { t, lang } = useT();
  const profile = useProfileStore(
    useShallow((s) => ({
      selectedAllergies: s.selectedAllergies,
      customAllergies: s.customAllergies,
      dietary: s.dietary,
      selectedSpicy: s.selectedSpicy,
    }))
  );
  const activeType = useUIStore((s) => s.staffQuestionType);
  const setActiveType = useUIStore((s) => s.setStaffQuestionType);
  const showToast = useUIStore((s) => s.showToast);
  const { speak, stop, supported } = useSpeech(() => showToast(t('toastTtsFail')));

  const questions = useMemo(() => generateStaffQuestions(dishes, profile), [dishes, profile]);
  const currentText = questions[activeType];

  const allergenLabels = useMemo(
    () =>
      Array.from(profile.selectedAllergies)
        .map((id) => getAllergenDisplayLabel(lang, id))
        .concat(profile.customAllergies.filter((c) => c.mappingStatus !== 'ambiguous').map((c) => c.original)),
    [profile.selectedAllergies, profile.customAllergies, lang]
  );
  const dietLabelKey: Record<string, string> = { vegan: 'dietVegan', halal: 'dietHalal', vegetarian: 'dietVegetarian' };
  const profileBits = [profile.dietary !== 'none' ? t(dietLabelKey[profile.dietary]) : '', ...allergenLabels].filter(Boolean).join(', ');
  const meaning = activeType === 'personal' && profileBits ? `${t(MEANING_KEY.personal)} (${profileBits})` : t(MEANING_KEY[activeType]);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(currentText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = currentText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast(t('staffQCopiedToast'));
    } catch (err) {
      console.error('[StaffQuestionPanel] copy failed:', err);
    }
  };

  if (dishes.length === 0) return null;

  return (
    <div className="bg-vintage-beige/30 p-3 rounded-xl space-y-2.5 vintage-border">
      <span className="text-[10px] font-bold text-vintage-olive uppercase">{t('staffQTitle')}</span>
      <div className="flex gap-1" role="tablist" aria-label={t('staffQTitle')}>
        {TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={type === activeType}
            onClick={() => setActiveType(type)}
            className={`flex-1 min-h-[36px] text-[10px] font-bold rounded-lg transition ${
              type === activeType ? 'bg-vintage-terracotta text-white' : 'bg-white text-vintage-olive hover:bg-vintage-beige/60'
            }`}
          >
            {t(TAB_LABEL_KEY[type])}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-vintage-olive">{meaning}</p>
      <div className="p-3 bg-white rounded-lg text-sm font-semibold text-vintage-dark leading-relaxed">{currentText}</div>
      {questions.hasAmbiguousCustomAllergyCaveat && (
        <p className="text-[10px] text-amber-700">{t('staffQAmbiguousCaveat')}</p>
      )}
      <p className="text-[9px] text-vintage-olive italic">{t('staffQShowScreenNote')}</p>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" onClick={() => speak(currentText)} disabled={!supported}>
          {t('staffQSpeakBtn')}
        </Button>
        <Button variant="secondary" onClick={stop}>
          {t('staffQStopBtn')}
        </Button>
        <Button variant="secondary" onClick={copy}>
          {t('staffQCopyBtn')}
        </Button>
      </div>
    </div>
  );
}
