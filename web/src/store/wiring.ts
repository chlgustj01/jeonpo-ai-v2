// Cross-store wiring, imported once from main.tsx. Keeps profileStore and
// scanStore independent of each other at the module-dependency level while
// still getting the one genuinely cross-cutting behavior right: when the
// UI language changes, re-translate the current analysis (never re-run
// the image analysis itself — §IMP-04's core guarantee, now expressed as
// "the only thing a language change can trigger is translateCurrent()").
import { useProfileStore } from './profileStore';
import { useScanStore, setCurrentLangGetter } from './scanStore';
import { useUIStore, tabFromHash, hashForTab } from './uiStore';

export function wireStores() {
  setCurrentLangGetter(() => useProfileStore.getState().lang);

  let prevLang = useProfileStore.getState().lang;
  useProfileStore.subscribe((state) => {
    if (state.lang !== prevLang) {
      prevLang = state.lang;
      const scan = useScanStore.getState();
      if (scan.lastAnalysis) {
        void scan.translateCurrent(state.lang);
      }
    }
  });

  // [UX-IMPROVEMENT] A result restored from this session may have been
  // shown in another language; bring it to the current one (server-cached
  // translation, never a new image analysis).
  const scan = useScanStore.getState();
  const lang = useProfileStore.getState().lang;
  if (scan.lastAnalysis && scan.displayedLang !== lang) void scan.translateCurrent(lang);

  // [UX-IMPROVEMENT] Tabs <-> URL hash, so the browser Back button moves
  // between tabs instead of leaving the app, and a reload keeps the tab.
  const fromHash = tabFromHash(window.location.hash);
  if (fromHash) useUIStore.setState({ activeTab: fromHash });
  else window.history.replaceState(null, '', hashForTab(useUIStore.getState().activeTab));

  let prevTab = useUIStore.getState().activeTab;
  useUIStore.subscribe((s) => {
    if (s.activeTab !== prevTab) {
      prevTab = s.activeTab;
      if (tabFromHash(window.location.hash) !== s.activeTab) window.history.pushState(null, '', hashForTab(s.activeTab));
    }
  });
  window.addEventListener('popstate', () => {
    const tab = tabFromHash(window.location.hash);
    if (tab && tab !== useUIStore.getState().activeTab) {
      prevTab = tab;
      useUIStore.setState({ activeTab: tab });
    }
  });
}
