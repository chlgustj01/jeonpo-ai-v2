import { useProfileStore } from '../../store/profileStore';
import { useUIStore } from '../../store/uiStore';
import { useT } from '../../hooks/useT';
import { Button } from '../common/ui';
import { LanguageSelector } from '../profile/LanguageSelector';
import { DietSelector, NationalityInput, SpicySelector } from '../profile/ProfileFields';

// Ports the landing/onboarding screen. Allergy selection itself isn't part
// of onboarding in the vanilla version either (it lived in the TTS tab) —
// kept that way here too; a first-time user can set it up via the Profile
// modal right after, or while using the scanner. Diet/spice/nationality
// are the "quick profile" captured up front, same as before.
export function OnboardingScreen() {
  const { t } = useT();
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  const showToast = useUIStore((s) => s.showToast);

  const onBegin = () => {
    completeOnboarding();
    showToast(t('toastOnboardingComplete'));
  };

  return (
    <main className="min-h-screen flex flex-col justify-center p-6 space-y-6 max-w-md mx-auto">
      <div className="text-center">
        <span className="text-xs uppercase tracking-[0.2em] text-vintage-olive font-semibold">Welcome to Busan</span>
        <h1 className="font-serif text-5xl font-bold text-vintage-terracotta mt-2 tracking-wide">FitBridge</h1>
        <p className="font-serif italic text-vintage-olive text-sm mt-1">{t('tagline')}</p>
        <div className="w-16 h-[2px] bg-vintage-clay mx-auto mt-6" />
      </div>

      <div className="bg-vintage-beige/60 rounded-2xl p-5 vintage-border vintage-shadow space-y-6">
        <p className="text-xs uppercase tracking-wider text-vintage-olive font-bold">{t('quickProfile')}</p>
        <LanguageSelector />
        <NationalityInput />
        <SpicySelector />
        <DietSelector />
      </div>

      <Button variant="primary" className="w-full py-4 text-base vintage-glow" onClick={onBegin}>
        {t('beginBtn')}
      </Button>
      <p className="text-center text-[11px] text-vintage-olive">{t('footerTagline')}</p>
    </main>
  );
}
