import { type ReactNode } from 'react';
import { useUIStore, type TabName } from '../../store/uiStore';
import { useT } from '../../hooks/useT';
import { Toast } from '../common/ui';
import { ProfileModal } from '../profile/ProfileModal';

const TABS: { key: TabName; labelKey: string; icon: string }[] = [
  { key: 'map', labelKey: 'navMapLabel', icon: '🗺️' },
  { key: 'scanner', labelKey: 'navScanLabel', icon: '📷' },
  { key: 'exchange', labelKey: 'navExchLabel', icon: '💱' },
];

// Mobile-first shell: header (brand + profile button) + the active tab's
// content + bottom nav (§6 "모바일 우선 반응형 디자인"). Only 3 tabs now —
// see store/uiStore.ts's comment on TabName for why the old 4th ("TTS")
// tab was folded elsewhere instead of carried over 1:1.
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const openProfileModal = useUIStore((s) => s.openProfileModal);
  const toast = useUIStore((s) => s.toast);

  return (
    <div className="min-h-screen flex justify-center bg-vintage-beige">
      <div className="w-full max-w-md bg-vintage-cream min-h-screen flex flex-col relative shadow-2xl border-x border-vintage-dark/10">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 bg-white px-3 py-2 rounded">
          {t('skipToContent')}
        </a>
        <header className="flex items-center justify-between px-4 py-3 border-b border-vintage-dark/10">
          <span className="font-serif text-xl font-bold text-vintage-terracotta">FitBridge</span>
          <button
            type="button"
            onClick={openProfileModal}
            aria-label={t('updateProfile')}
            className="min-h-[44px] min-w-[44px] px-3 flex items-center justify-center gap-1.5 rounded-full bg-vintage-beige text-vintage-dark"
          >
            <span className="text-lg" aria-hidden="true">👤</span>
            <span className="text-xs font-bold">{t('profileBtnLabel')}</span>
          </button>
        </header>

        <main id="main-content" className="flex-1 overflow-y-auto pb-20">
          {children}
        </main>

        <nav
          className="fixed bottom-0 inset-x-0 mx-auto max-w-md bg-white border-t border-vintage-dark/10 flex"
          aria-label="Primary"
        >
          {TABS.map((tabDef) => (
            <button
              key={tabDef.key}
              type="button"
              onClick={() => setActiveTab(tabDef.key)}
              aria-current={activeTab === tabDef.key ? 'page' : undefined}
              className={`flex-1 min-h-[56px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
                activeTab === tabDef.key ? 'text-vintage-clay' : 'text-vintage-olive'
              }`}
            >
              <span className="text-lg" aria-hidden="true">{tabDef.icon}</span>
              <span>{t(tabDef.labelKey)}</span>
            </button>
          ))}
        </nav>

        <ProfileModal />
        <Toast message={toast?.message ?? null} />
      </div>
    </div>
  );
}
