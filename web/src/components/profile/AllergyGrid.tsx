import { useProfileStore } from '../../store/profileStore';
import { useT } from '../../hooks/useT';
import { standardAllergens } from '../../lib/allergens';

// Ports renderAllergiesGrid()/toggleAllergen() — a controlled checkbox
// grid bound straight to profileStore (no imperative DOM class toggling
// needed; React re-renders the checked state on its own).
export function AllergyGrid() {
  const { t, lang } = useT();
  const selectedAllergies = useProfileStore((s) => s.selectedAllergies);
  const toggleAllergen = useProfileStore((s) => s.toggleAllergen);

  return (
    <div
      className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto p-1 bg-vintage-beige/30 rounded-xl border border-vintage-dark/5"
      role="group"
      aria-label={t('checkAllergens')}
    >
      {standardAllergens.map((allg) => {
        const checked = selectedAllergies.has(allg.id);
        return (
          <label
            key={allg.id}
            className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer hover:bg-vintage-beige/50 transition min-h-[44px] ${
              checked ? 'bg-vintage-beige border-vintage-clay/50' : 'bg-white border-vintage-dark/10'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleAllergen(allg.id)}
              className="rounded text-vintage-clay focus:ring-vintage-clay accent-vintage-clay border-vintage-dark/20 h-4 w-4"
            />
            <span className="text-sm" aria-hidden="true">{allg.icon}</span>
            <span className="font-medium text-vintage-dark">{allg.labels[lang] || allg.labels.en}</span>
          </label>
        );
      })}
    </div>
  );
}
