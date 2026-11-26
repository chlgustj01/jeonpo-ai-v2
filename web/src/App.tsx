import { useProfileStore, useProfileHydration } from './store/profileStore';
import { useUIStore } from './store/uiStore';
import { AppShell } from './components/layout/AppShell';
import { OnboardingScreen } from './components/onboarding/OnboardingScreen';
import { MapView } from './components/map/MapView';
import { ScannerView } from './components/scanner/ScannerView';
import { ExchangeView } from './components/exchange/ExchangeView';

function App() {
  const hasHydrated = useProfileHydration((s) => s.hasHydrated);
  const onboardingComplete = useProfileStore((s) => s.onboardingComplete);
  const activeTab = useUIStore((s) => s.activeTab);

  // Wait for the persisted profile to load before deciding whether to show
  // onboarding — otherwise a returning user would briefly flash the
  // onboarding screen (see store/profileStore.ts's hydration comment).
  if (!hasHydrated) return null;

  if (!onboardingComplete) return <OnboardingScreen />;

  return (
    <AppShell>
      {activeTab === 'map' && <MapView />}
      {activeTab === 'scanner' && <ScannerView />}
      {activeTab === 'exchange' && <ExchangeView />}
    </AppShell>
  );
}

export default App;
