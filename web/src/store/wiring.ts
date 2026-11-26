// Cross-store wiring, imported once from main.tsx. Keeps profileStore and
// scanStore independent of each other at the module-dependency level while
// still getting the one genuinely cross-cutting behavior right: when the
// UI language changes, re-translate the current analysis (never re-run
// the image analysis itself — §IMP-04's core guarantee, now expressed as
// "the only thing a language change can trigger is translateCurrent()").
import { useProfileStore } from './profileStore';
import { useScanStore, setCurrentLangGetter } from './scanStore';

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
}
