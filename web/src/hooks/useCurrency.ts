import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useExchangeStore, recommendCurrency } from '../store/exchangeStore';
import { useProfileStore } from '../store/profileStore';
import type { DisplayCurrency } from '../types';

// [PRICE] The single place screens read "which currency + which rates" from.
// The Exchange tab and the menu result use this same hook, so changing the
// currency in one is the currency in the other. Calling it never triggers a
// Gemini call; it only makes sure exchange rates are loaded once.
export function useCurrency(opts: { load?: boolean } = { load: true }) {
  const preferred = useProfileStore((s) => s.preferredCurrency);
  const nationality = useProfileStore((s) => s.nationality);
  const setPreferredCurrency = useProfileStore((s) => s.setPreferredCurrency);
  const fx = useExchangeStore(
    useShallow((s) => ({ krwPerUnit: s.krwPerUnit, status: s.status, sourceUpdatedAt: s.sourceUpdatedAt, ensureRates: s.ensureRates }))
  );
  const load = opts.load !== false;
  const ensureRates = fx.ensureRates;
  useEffect(() => {
    if (load) void ensureRates();
  }, [load, ensureRates]);

  const currency: DisplayCurrency = preferred ?? recommendCurrency(nationality);
  return {
    currency,
    isSuggested: preferred === null,
    setCurrency: setPreferredCurrency,
    krwPerUnit: fx.krwPerUnit,
    status: fx.status,
    sourceUpdatedAt: fx.sourceUpdatedAt,
  };
}
