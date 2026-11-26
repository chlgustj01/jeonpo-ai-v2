import { create } from 'zustand';
import type { DisplayCurrency } from '../types';

// [PRICE] One exchange-rate state for the whole app (Exchange tab + menu
// prices). Replaces the per-component fetch in the old useExchangeRates():
//   - one request at a time (concurrent callers share the in-flight promise)
//   - the source (open.er-api.com, KRW base) publishes once a day; the
//     response's time_next_update_utc is kept and a cached copy in
//     localStorage is reused until then, so reloads and tab switches do not
//     refetch
//   - 'live' (from the source, with its own update time) vs 'fallback'
//     (built-in reference values, shown as such) vs 'loading'
//
// Unit: krwPerUnit[c] = KRW for ONE unit of c. (The old hook stored
// "KRW per 10 JPY" for live JPY and "KRW per VND" in the VND fallback while
// the screen assumed other units, so 100 JPY showed as ~84 KRW. One unit
// for every currency removes that class of bug.)
export const FX_SOURCE_URL = 'https://open.er-api.com/v6/latest/KRW';
const FX_CACHE_KEY = 'fitbridge_fx_cache_v1';

export const FALLBACK_KRW_PER_UNIT: Record<DisplayCurrency, number> = {
  USD: 1350,
  JPY: 8.5,
  CNY: 185,
  EUR: 1450,
  VND: 0.053,
};
export const DISPLAY_CURRENCIES: DisplayCurrency[] = ['USD', 'JPY', 'CNY', 'EUR', 'VND'];

export type FxStatus = 'idle' | 'loading' | 'live' | 'fallback';

interface FxCache {
  krwPerUnit: Record<DisplayCurrency, number>;
  sourceUpdatedAt: number | null;
  nextUpdateAt: number | null;
  fetchedAt: number;
}

interface ExchangeState {
  krwPerUnit: Record<DisplayCurrency, number>;
  status: FxStatus;
  sourceUpdatedAt: number | null;
  nextUpdateAt: number | null;
  fetchedAt: number | null;
  networkRequests: number; // for diagnostics/tests
  ensureRates: () => Promise<void>;
}

let inFlight: Promise<void> | null = null;

function readCache(): FxCache | null {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as FxCache;
    if (!c || !c.krwPerUnit || DISPLAY_CURRENCIES.some((k) => !(c.krwPerUnit[k] > 0))) return null;
    return c;
  } catch {
    return null;
  }
}

function writeCache(c: FxCache) {
  try {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable — the in-memory state still works */
  }
}

function parseUtc(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export const useExchangeStore = create<ExchangeState>((set, get) => ({
  krwPerUnit: FALLBACK_KRW_PER_UNIT,
  status: 'idle',
  sourceUpdatedAt: null,
  nextUpdateAt: null,
  fetchedAt: null,
  networkRequests: 0,

  ensureRates() {
    const st = get();
    const now = Date.now();
    if (st.status === 'live' && (st.nextUpdateAt === null || now < st.nextUpdateAt)) return Promise.resolve();
    if (st.status === 'fallback' && st.fetchedAt && now - st.fetchedAt < 5 * 60 * 1000) return Promise.resolve(); // no retry storm
    if (inFlight) return inFlight;

    const cached = readCache();
    if (cached && cached.nextUpdateAt && now < cached.nextUpdateAt) {
      set({ krwPerUnit: cached.krwPerUnit, status: 'live', sourceUpdatedAt: cached.sourceUpdatedAt, nextUpdateAt: cached.nextUpdateAt, fetchedAt: cached.fetchedAt });
      return Promise.resolve();
    }

    if (st.status === 'idle') set({ status: 'loading' });
    inFlight = (async () => {
      set((s) => ({ networkRequests: s.networkRequests + 1 }));
      try {
        const response = await fetch(FX_SOURCE_URL);
        const data = await response.json();
        const rates = data && data.rates;
        const krwPerUnit = {} as Record<DisplayCurrency, number>;
        for (const c of DISPLAY_CURRENCIES) {
          const r = rates && rates[c];
          if (!(typeof r === 'number' && r > 0)) throw new Error(`missing rate ${c}`);
          krwPerUnit[c] = 1 / r;
        }
        const entry: FxCache = {
          krwPerUnit,
          sourceUpdatedAt: parseUtc(data.time_last_update_utc),
          nextUpdateAt: parseUtc(data.time_next_update_utc),
          fetchedAt: Date.now(),
        };
        writeCache(entry);
        set({ ...entry, status: 'live' });
      } catch (e) {
        console.warn('[exchangeStore] live rates unavailable, using reference rates:', e);
        set({ krwPerUnit: FALLBACK_KRW_PER_UNIT, status: 'fallback', sourceUpdatedAt: null, nextUpdateAt: null, fetchedAt: Date.now() });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },
}));

// Suggested display currency from the user's stated nationality only
// (language and currency stay independent). Unknown -> USD.
const NATIONALITY_TO_CURRENCY: Record<string, DisplayCurrency> = {
  usa: 'USD', us: 'USD', 'united states': 'USD', america: 'USD',
  japan: 'JPY', jp: 'JPY', '日本': 'JPY',
  china: 'CNY', cn: 'CNY', '中国': 'CNY',
  vietnam: 'VND', 'viet nam': 'VND', vn: 'VND', 'việt nam': 'VND',
  spain: 'EUR', españa: 'EUR', france: 'EUR', germany: 'EUR', italy: 'EUR', ireland: 'EUR', netherlands: 'EUR', portugal: 'EUR',
};

export function recommendCurrency(nationality: string): DisplayCurrency {
  return NATIONALITY_TO_CURRENCY[(nationality || '').trim().toLowerCase()] || 'USD';
}
