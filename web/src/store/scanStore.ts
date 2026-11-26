import { create } from 'zustand';
import { analyzeMenu, translateDish, buildTranslatedDishList, ApiError, type ApiErrorCode } from '../services/api';
import { hashStringForCache } from '../lib/speech';
import type { AnalysisCoverage, Dish, Lang } from '../types';

// Ports §IMP-04/05/06 (separate analysis/translation, caching, request
// cancellation + staleness guards) as a zustand store instead of the
// vanilla version's hand-rolled scanRequestSeq/translationRequestSeq
// counters. React's own "last call wins" via AbortController + this
// store's single in-flight-controller slots gives the same guarantee:
// a stale response can never overwrite a newer one, because by the time
// it would resolve, its own controller has already been aborted and the
// `isStale()`-equivalent check below bails out.
export type ScanKind = 'multi' | 'single' | null;
export type ScanStatus = 'idle' | 'analyzing' | 'translating' | 'ready' | 'error';

interface TranslationCacheEntry {
  dishes: Dish[];
  fetchedAt: number;
}

const MAX_CLIENT_TRANSLATION_CACHE_ENTRIES = 20;

interface ScanState {
  kind: ScanKind;
  status: ScanStatus;
  errorMessage: string | null; // developer diagnostic only (shown under "Technical details")
  errorCode: ApiErrorCode | null;
  errorRetryable: boolean;
  // [Package 5] the image of the failed request, so "Try Again" can resend it
  failedImage: string | null;
  coverage: AnalysisCoverage | null;
  displayedDishes: Dish[];
  lastAnalysis: { imageHash: string; analysisId: string; canonicalDishes: Dish[] } | null;
  translationCache: Map<string, TranslationCacheEntry>;
  isAnalyzing: boolean;
  inFlightImageHash: string | null;
  lastTranslationFailed: boolean;
  partialResults: boolean;

  analysisAbortController: AbortController | null;
  translationAbortController: AbortController | null;

  analyzePhoto: (imageBase64: string) => Promise<void>;
  retryAnalysis: () => Promise<void>;
  translateCurrent: (lang: Lang) => Promise<void>;
  showDemoDish: (dish: Dish) => void;
  reset: () => void;
}

function cacheTranslatedDishes(cache: Map<string, TranslationCacheEntry>, key: string, dishes: Dish[]) {
  cache.delete(key); // refresh recency order
  cache.set(key, { dishes, fetchedAt: Date.now() });
  while (cache.size > MAX_CLIENT_TRANSLATION_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

const CLEARED_ERROR = { errorMessage: null, errorCode: null, errorRetryable: false, failedImage: null } as const;

export const useScanStore = create<ScanState>()((set, get) => ({
  kind: null,
  status: 'idle',
  ...CLEARED_ERROR,
  coverage: null,
  displayedDishes: [],
  lastAnalysis: null,
  translationCache: new Map(),
  isAnalyzing: false,
  inFlightImageHash: null,
  lastTranslationFailed: false,
  partialResults: false,
  analysisAbortController: null,
  translationAbortController: null,

  async analyzePhoto(imageBase64) {
    const imageHash = hashStringForCache(imageBase64);
    const st = get();

    // [IMP-06] Duplicate-click guard — scoped to "the analysis network
    // call itself is in flight", not the whole function (translation has
    // its own independent guard below) — this exact distinction is what
    // the vanilla version got wrong at first and had to fix (§IMP-06 §5).
    if (st.isAnalyzing && st.inFlightImageHash === imageHash) return;

    // [IMP-05] Same image already analyzed — reuse the cached canonical
    // result, no re-call.
    if (st.lastAnalysis && st.lastAnalysis.imageHash === imageHash) {
      await get().translateCurrent(currentLang());
      return;
    }

    st.analysisAbortController?.abort();
    st.translationAbortController?.abort();
    const controller = new AbortController();
    // [Package 5] Clear the previous photo's result as soon as a new
    // analysis starts. Before, the old dishes stayed in displayedDishes and
    // were rendered next to the error if the new analysis failed, so a
    // previous menu could read as the current one.
    set({
      analysisAbortController: controller,
      isAnalyzing: true,
      inFlightImageHash: imageHash,
      status: 'analyzing',
      ...CLEARED_ERROR,
      kind: null,
      displayedDishes: [],
      lastAnalysis: null,
      coverage: null,
      partialResults: false,
      lastTranslationFailed: false,
    });

    try {
      const data = await analyzeMenu(imageBase64, controller.signal);
      if (get().analysisAbortController !== controller) return; // superseded

      set({
        lastAnalysis: { imageHash, analysisId: data.analysisId, canonicalDishes: data.dishes },
        kind: 'multi',
        partialResults: data.validationStatus === 'partial',
        coverage: data.coverage ?? null,
        isAnalyzing: false,
        inFlightImageHash: null,
      });
      await get().translateCurrent(currentLang());
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      if (get().analysisAbortController !== controller) return; // superseded
      const apiErr = err instanceof ApiError ? err : null;
      set({
        status: 'error',
        isAnalyzing: false,
        inFlightImageHash: null,
        kind: null,
        displayedDishes: [],
        errorCode: apiErr ? apiErr.code : 'UNKNOWN',
        errorRetryable: apiErr ? apiErr.retryable : true,
        errorMessage: apiErr ? apiErr.diagnostic : 'UNKNOWN',
        failedImage: imageBase64,
      });
    }
  },

  async retryAnalysis() {
    const { failedImage, errorRetryable } = get();
    if (!failedImage || !errorRetryable) return;
    await get().analyzePhoto(failedImage);
  },

  async translateCurrent(lang) {
    const st = get();
    const analysis = st.lastAnalysis;
    if (!analysis) return;
    const cacheKey = `${analysis.imageHash}:${lang}`;

    const cached = st.translationCache.get(cacheKey);
    if (cached) {
      set({ displayedDishes: cached.dishes, status: 'ready', lastTranslationFailed: false });
      return;
    }

    if (lang === 'en') {
      cacheTranslatedDishes(st.translationCache, cacheKey, analysis.canonicalDishes);
      set({ displayedDishes: analysis.canonicalDishes, status: 'ready', lastTranslationFailed: false });
      return;
    }

    st.translationAbortController?.abort();
    const controller = new AbortController();
    set({ translationAbortController: controller, status: 'translating' });

    try {
      const data = await translateDish(analysis.analysisId, lang, analysis.canonicalDishes, controller.signal);
      if (get().translationAbortController !== controller) return; // superseded by a newer language switch
      const translated = buildTranslatedDishList(analysis.canonicalDishes, data.translationsByFoodId || {});
      cacheTranslatedDishes(get().translationCache, cacheKey, translated);
      set({ displayedDishes: translated, status: 'ready', lastTranslationFailed: false });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      if (get().translationAbortController !== controller) return;
      // Translation failure keeps the English original on screen rather
      // than losing the result entirely (§IMP-04). Not cached, so the next
      // language switch tries again.
      set({ displayedDishes: analysis.canonicalDishes, status: 'ready', lastTranslationFailed: true });
    }
  },

  showDemoDish(dish) {
    get().analysisAbortController?.abort();
    get().translationAbortController?.abort();
    set({
      kind: 'single',
      displayedDishes: [dish],
      status: 'ready',
      lastAnalysis: null,
      lastTranslationFailed: false,
      partialResults: false,
      coverage: null,
      isAnalyzing: false,
      inFlightImageHash: null,
      ...CLEARED_ERROR,
    });
  },

  reset() {
    get().analysisAbortController?.abort();
    get().translationAbortController?.abort();
    set({
      kind: null,
      status: 'idle',
      ...CLEARED_ERROR,
      coverage: null,
      displayedDishes: [],
      lastAnalysis: null,
      isAnalyzing: false,
      inFlightImageHash: null,
      lastTranslationFailed: false,
      partialResults: false,
      analysisAbortController: null,
      translationAbortController: null,
    });
  },
}));

// The store needs the active UI language without importing profileStore
// at module scope (would create a circular import: profileStore doesn't
// need scanStore, but this keeps the dependency direction explicit and
// one-way). Wired from store/wiring.ts at app startup.
let currentLangGetter: () => Lang = () => 'en';
export function setCurrentLangGetter(fn: () => Lang) {
  currentLangGetter = fn;
}
function currentLang(): Lang {
  return currentLangGetter();
}
