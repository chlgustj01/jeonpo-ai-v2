import { lazy, Suspense } from 'react';
import { useProfileStore, useProfileHydration } from './store/profileStore';
import { useUIStore } from './store/uiStore';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/common/ui';

// [Package 5 §7] Each screen is its own chunk. Leaflet (map tab only) and
// the onboarding screen were in the single 580KB bundle every visitor
// downloaded; now the first load fetches only the shell + the screen shown.
// Sizes before/after: docs/devlog/PACKAGE-05.md §7.
const OnboardingScreen = lazy(() => import('./components/onboarding/OnboardingScreen').then((m) => ({ default: m.OnboardingScreen })));
const MapView = lazy(() => import('./components/map/MapView').then((m) => ({ default: m.MapView })));
const ScannerView = lazy(() => import('./components/scanner/ScannerView').then((m) => ({ default: m.ScannerView })));
const ExchangeView = lazy(() => import('./components/exchange/ExchangeView').then((m) => ({ default: m.ExchangeView })));

function App() {
  const hasHydrated = useProfileHydration((s) => s.hasHydrated);
  const onboardingComplete = useProfileStore((s) => s.onboardingComplete);
  const activeTab = useUIStore((s) => s.activeTab);

  // Wait for the persisted profile to load before deciding whether to show
  // onboarding — otherwise a returning user would briefly flash the
  // onboarding screen (see store/profileStore.ts's hydration comment).
  if (!hasHydrated) return null;

  if (!onboardingComplete) {
    return (
      <Suspense fallback={<Spinner />}>
        <OnboardingScreen />
      </Suspense>
    );
  }

  return (
    <AppShell>
      <Suspense fallback={<Spinner />}>
        {activeTab === 'map' && <MapView />}
        {activeTab === 'scanner' && <ScannerView />}
        {activeTab === 'exchange' && <ExchangeView />}
      </Suspense>
    </AppShell>
  );
}

export default App;
