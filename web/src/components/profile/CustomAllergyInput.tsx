import { useState } from 'react';
import { useProfileStore } from '../../store/profileStore';
import { useT } from '../../hooks/useT';
import { useCustomAllergy } from '../../hooks/useCustomAllergy';
import { standardAllergens } from '../../lib/allergens';
import { Button } from '../common/ui';

const BADGE_ICON: Record<string, string> = {
  exact_standard: '✓',
  exact_alias: '✓',
  candidate_db: 'ℹ️',
  custom_unlisted: '⚠️',
  translation_failed: '❗',
  kb_unavailable: '❔',
  ambiguous: '❓',
};
const BADGE_TITLE_KEY: Record<string, string> = {
  exact_standard: 'badgeExactStandard',
  exact_alias: 'badgeExactAlias',
  candidate_db: 'badgeCandidateDb',
  custom_unlisted: 'badgeCustomUnlisted',
  translation_failed: 'badgeTranslationFailed',
  kb_unavailable: 'badgeKbUnavailable',
  ambiguous: 'badgeAmbiguous',
};

// Ports addCustomAllergy()/renderCustomAllergyBadges() (§IMP-12). React's
// JSX escapes `item.original` by default, so the vanilla version's manual
// "use textContent/createTextNode instead of innerHTML" XSS defense is
// handled structurally here — no special-casing needed.
export function CustomAllergyInput() {
  const { t, lang } = useT();
  const [value, setValue] = useState('');
  const customAllergies = useProfileStore((s) => s.customAllergies);
  const { addCustomAllergy, resolveAmbiguous, removeCustomAllergy, isResolving } = useCustomAllergy();

  const onAdd = async () => {
    if (!value.trim()) return;
    const v = value;
    setValue('');
    await addCustomAllergy(v);
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor="custom-allergy-input" className="block text-xs font-bold text-vintage-olive uppercase">
        {t('customAllergy')}
      </label>
      <div className="flex gap-2">
        <input
          id="custom-allergy-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void onAdd();
            }
          }}
          placeholder={t('customPlaceholder')}
          className="flex-1 min-h-[44px] p-2.5 rounded-lg bg-vintage-beige/30 border border-vintage-dark/10 text-xs focus:outline-none focus:border-vintage-clay"
        />
        <Button variant="secondary" onClick={onAdd}>
          {t('addBtn')}
        </Button>
      </div>
      {isResolving && <div className="text-[10px] text-vintage-olive italic">{t('translatingFeedback')}</div>}

      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {customAllergies.map((item) => (
          <span
            key={item.original}
            className="inline-flex flex-col gap-1 text-[11px] bg-vintage-clay/20 text-vintage-terracotta px-2.5 py-1.5 rounded-xl font-bold vintage-border"
            title={t(BADGE_TITLE_KEY[item.mappingStatus] || 'badgeCustomUnlisted')}
          >
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true">{BADGE_ICON[item.mappingStatus] || '⚠️'}</span>
              <span>
                {item.original}
                {item.translated && <span className="text-vintage-dark/60 font-normal"> → {item.translated}</span>}
              </span>
              <button
                type="button"
                onClick={() => removeCustomAllergy(item.original)}
                aria-label={`${t('reviewDeleteBtn')}: ${item.original}`}
                className="hover:text-vintage-dark focus:outline-none ml-1 font-extrabold text-xs min-h-[20px] min-w-[20px]"
              >
                ×
              </button>
            </span>
            {item.mappingStatus === 'ambiguous' && item.candidateIds && item.candidateIds.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1">
                {item.candidateIds.map((candidateId) => {
                  const standardEntry = standardAllergens.find((a) => a.id === candidateId);
                  return (
                    <button
                      key={candidateId}
                      type="button"
                      onClick={() => resolveAmbiguous(item.original, candidateId)}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-white/70 border border-vintage-terracotta/40 hover:bg-white min-h-[28px]"
                    >
                      {standardEntry ? `${standardEntry.icon} ${standardEntry.labels[lang] || standardEntry.labels.en}` : candidateId}
                    </button>
                  );
                })}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
