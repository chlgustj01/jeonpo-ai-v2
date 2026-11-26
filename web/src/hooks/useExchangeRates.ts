import { useEffect, useState } from 'react';

export type Currency = 'USD' | 'JPY' | 'CNY' | 'EUR' | 'VND';

const FALLBACK_INDEX: Record<Currency, number> = {
  USD: 1350,
  JPY: 8.5,
  CNY: 185,
  EUR: 1450,
  VND: 0.053,
};

// Ports fetchLiveExchangeRates() (§Exchange tab) — same fallback-first
// design (hardcoded approximate rates shown immediately, replaced once the
// live fetch resolves) so the screen is never empty while waiting on a
// third-party API that might be slow or blocked.
export function useExchangeRates() {
  const [index, setIndex] = useState<Record<Currency, number>>(FALLBACK_INDEX);
  const [rateAsOfDate, setRateAsOfDate] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const response = await fetch('https://open.er-api.com/v6/latest/KRW');
        const data = await response.json();
        if (!mounted || !data?.rates) return;
        setIndex({
          USD: Math.round(1 / data.rates.USD),
          JPY: (1 / data.rates.JPY) / 10, // per 100 JPY
          CNY: Math.round(1 / data.rates.CNY),
          EUR: Math.round(1 / data.rates.EUR),
          VND: (1 / data.rates.VND) * 1000, // per 1,000 VND
        });
        setRateAsOfDate(data.time_last_update_utc ? new Date(data.time_last_update_utc) : new Date());
      } catch (e) {
        console.error('Live exchange rates fetch error, fallback active.', e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return { index, rateAsOfDate };
}
