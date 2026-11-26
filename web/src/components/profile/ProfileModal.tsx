import { useUIStore } from '../../store/uiStore';
import { useT } from '../../hooks/useT';
import { Modal } from '../common/ui';
import { DietSelector, NationalityInput, SpicySelector } from './ProfileFields';
import { AllergyGrid } from './AllergyGrid';
import { CustomAllergyInput } from './CustomAllergyInput';
import { LanguageSelector } from './LanguageSelector';
import { NoAllergiesToggle } from './NoAllergiesToggle';

// Ports openProfileModal()/closeProfileModal(). §4 of this package's
// request groups "사용자 프로필" and "알레르기 선택 및 커스텀 알레르기
// 등록" as one area — the vanilla version split allergy editing into a
// separate TTS tab; here it's one modal reachable from anywhere, which is
// also why the old standalone TTS tab no longer needs to exist (§6).
// Every field here reads/writes profileStore directly, so changing it
// here is instantly reflected everywhere else that reads the same store —
// §IMP-07/08's whole "recalc on profile change" plumbing is now just
// "the store changed, so everything subscribed to it re-renders".
export function ProfileModal() {
  const { t } = useT();
  const open = useUIStore((s) => s.profileModalOpen);
  const close = useUIStore((s) => s.closeProfileModal);

  return (
    <Modal open={open} onClose={close} title={t('updateProfile')}>
      <div className="space-y-5">
        <LanguageSelector />
        <NationalityInput />
        <SpicySelector />
        <DietSelector />
        <div>
          <label className="block text-xs uppercase tracking-wider text-vintage-olive font-bold mb-2">{t('checkAllergens')}</label>
          <AllergyGrid />
        </div>
        <CustomAllergyInput />
        <NoAllergiesToggle />
      </div>
    </Modal>
  );
}
