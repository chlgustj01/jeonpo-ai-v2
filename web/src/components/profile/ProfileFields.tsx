import { useProfileStore } from '../../store/profileStore';
import { useT } from '../../hooks/useT';
import type { Dietary } from '../../types';

const SPICY_LABEL_KEY = ['spicyMild', 'spicyNormal', 'spicyHot', 'spicyExtreme'];
const DIET_OPTIONS: { value: Dietary; key: string }[] = [
  { value: 'none', key: 'dietNone' },
  { value: 'vegan', key: 'dietVegan' },
  { value: 'halal', key: 'dietHalal' },
  { value: 'vegetarian', key: 'dietVegetarian' },
];

// Ports setSpicy()/syncModalDiet()/syncOnboardingDiet()/syncModalNationality()
// etc. Because both the onboarding screen and the Profile modal render
// THIS SAME component bound directly to profileStore, the vanilla app's
// whole "keep two separate DOM copies in sync" mechanism (four sync*
// functions) simply isn't needed any more — there's only ever one source
// of truth on screen at a time, by construction.
export function SpicySelector() {
  const { t } = useT();
  const selectedSpicy = useProfileStore((s) => s.selectedSpicy);
  const setSpicy = useProfileStore((s) => s.setSpicy);

  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-vintage-olive font-bold mb-2">{t('spicy')}</label>
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t('spicy')}>
        {SPICY_LABEL_KEY.map((key, level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selectedSpicy === level}
            onClick={() => setSpicy(level)}
            className={`min-h-[44px] p-2 text-xs rounded-lg font-medium border transition ${
              selectedSpicy === level
                ? 'bg-vintage-clay text-white border-vintage-clay'
                : 'bg-white text-vintage-dark border-vintage-dark/10 hover:bg-vintage-beige'
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-vintage-olive mt-2">{t(`spicyDesc${selectedSpicy}`)}</p>
    </div>
  );
}

export function DietSelector() {
  const { t } = useT();
  const dietary = useProfileStore((s) => s.dietary);
  const setDietary = useProfileStore((s) => s.setDietary);

  return (
    <div>
      <label htmlFor="diet-select" className="block text-xs uppercase tracking-wider text-vintage-olive font-bold mb-2">
        {t('diet')}
      </label>
      <select
        id="diet-select"
        value={dietary}
        onChange={(e) => setDietary(e.target.value as Dietary)}
        className="w-full min-h-[44px] p-2.5 rounded-lg bg-white vintage-border text-sm"
      >
        {DIET_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(opt.key)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function NationalityInput() {
  const { t } = useT();
  const nationality = useProfileStore((s) => s.nationality);
  const setNationality = useProfileStore((s) => s.setNationality);

  return (
    <div>
      <label htmlFor="nationality-input" className="block text-xs uppercase tracking-wider text-vintage-olive font-bold mb-2">
        {t('nationalityLabel')}
      </label>
      <input
        id="nationality-input"
        type="text"
        value={nationality}
        onChange={(e) => setNationality(e.target.value)}
        placeholder={t('nationalityPlaceholder')}
        className="w-full min-h-[44px] p-2.5 rounded-lg bg-white vintage-border text-sm"
      />
    </div>
  );
}
