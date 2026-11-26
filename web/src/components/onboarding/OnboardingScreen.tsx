import { useProfileStore } from '../../store/profileStore';
import { useUIStore } from '../../store/uiStore';
import { useT } from '../../hooks/useT';
import { Button } from '../common/ui';
import { LanguageSelector } from '../profile/LanguageSelector';
import { AllergyGrid } from '../profile/AllergyGrid';
import { CustomAllergyInput } from '../profile/CustomAllergyInput';
import { NoAllergiesToggle } from '../profile/NoAllergiesToggle';
import { DietSelector, NationalityInput, SpicySelector } from '../profile/ProfileFields';

// [UX-IMPROVEMENT P0] The allergy step now lives in onboarding (it was only
// reachable through the 👤 icon before — docs/UX-AUDIT.md U3). Same
// components as the profile modal, same store, same localStorage schema.
// Order follows what matters for safety: language → what to avoid →
// spice/diet/country. "I have no food allergies" is recorded separately
// from "not answered yet", so results can tell the two apart.
export function OnboardingScreen() {
  const { t } = useT();
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  const showToast = useUIStore((s) => s.showToast);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  const onBegin = () => {
    completeOnboarding();
    setActiveTab('scanner'); // the core task: scan a menu
    showToast(t('toastOnboardingComplete'));
  };

  return (
    <main className="min-h-screen flex flex-col justify-center p-6 space-y-6 max-w-md mx-auto">
      <div className="text-center">
        <span className="text-xs uppercase tracking-[0.2em] text-vintage-olive font-semibold">{t('welcomeKicker')}</span>
        <h1 className="font-serif text-5xl font-bold text-vintage-terracotta mt-2 tracking-wide">FitBridge</h1>
        <p className="font-serif italic text-vintage-olive text-sm mt-1">{t('tagline')}</p>
        <div className="w-16 h-[2px] bg-vintage-clay mx-auto mt-4" />
        <p className="text-sm text-vintage-dark mt-4 leading-relaxed">{t('onboardPurpose')}</p>
      </div>

      <div className="bg-vintage-beige/60 rounded-2xl p-5 vintage-border vintage-shadow space-y-6">
        <LanguageSelector />

        <section aria-labelledby="onboard-allergy-title" className="space-y-2">
          <h2 id="onboard-allergy-title" className="text-xs uppercase tracking-wider text-vintage-olive font-bold">
            {t('onboardAllergyTitle')}
          </h2>
          <p className="text-xs text-vintage-olive">{t('onboardAllergyHint')}</p>
          <AllergyGrid />
          <CustomAllergyInput />
          <NoAllergiesToggle />
        </section>

        {/* Spice and diet change the risk result (ORANGE/RED), so they stay visible. */}
        <section aria-labelledby="onboard-more-title" className="space-y-6">
          <h2 id="onboard-more-title" className="text-xs uppercase tracking-wider text-vintage-olive font-bold">
            {t('moreProfileTitle')}
          </h2>
          <SpicySelector />
          <DietSelector />
          <NationalityInput />
        </section>
      </div>

      <Button variant="primary" className="w-full py-4 text-base vintage-glow" onClick={onBegin}>
        {t('beginBtn')}
      </Button>
      <p className="text-center text-[11px] text-vintage-olive">{t('footerTagline')}</p>
    </main>
  );
}
