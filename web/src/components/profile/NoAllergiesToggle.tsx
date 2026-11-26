import { useProfileStore, getAllergyProfileStatus } from '../../store/profileStore';
import { useT } from '../../hooks/useT';

// [UX-IMPROVEMENT] "I have no food allergies" — an explicit answer, kept
// distinct from "not answered yet". Disabled while any allergy is selected.
export function NoAllergiesToggle() {
  const { t } = useT();
  const noAllergiesConfirmed = useProfileStore((s) => s.noAllergiesConfirmed);
  const setNoAllergiesConfirmed = useProfileStore((s) => s.setNoAllergiesConfirmed);
  const status = useProfileStore((s) => getAllergyProfileStatus(s));
  return (
    <button
      type="button"
      onClick={() => setNoAllergiesConfirmed(!noAllergiesConfirmed)}
      aria-pressed={status === 'none'}
      disabled={status === 'set'}
      className={`w-full min-h-[44px] px-3 rounded-lg border text-sm font-semibold transition disabled:opacity-40 ${
        status === 'none' ? 'bg-vintage-terracotta text-white border-vintage-terracotta' : 'bg-white text-vintage-dark border-vintage-dark/10'
      }`}
    >
      {status === 'none' ? `✓ ${t('noAllergiesChosen')}` : t('noAllergiesBtn')}
    </button>
  );
}
