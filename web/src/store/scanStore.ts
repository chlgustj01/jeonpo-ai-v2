import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { analyzeMenu, translateDish, buildTranslatedDishList, ApiError, type ApiErrorCode } from '../services/api';
import { hashStringForCache } from '../lib/speech';
import type { AnalysisCoverage, Dish, Lang, LocationContext } from '../types';

// Ports §IMP-04/05/06 (separate analysis/translation, caching, request
// cancellation + staleness guards) as a zustand store instead of the
// vanilla version's hand-rolled scanRequestSeq/translationRequestSeq
// counters. React's own "last call wins" via AbortController + this
// store's single in-flight-controller slots gives the same guarantee:
// a stale response can never overwrite a newer one, because by the time
// it would resolve, its own controller has already been aborted and the
// `isStale()`-equivalent check below bails out.
//
// [UX-IMPROVEMENT] Adds the selected dish (by stable uid, never by name),
// the restaurant the scan belongs to, and a per-tab session restore
// (sessionStorage: survives reload/back, gone when the tab closes). Only
// the analysis RESULT is stored — never the photo, never the profile. The
// risk shown after a restore is recomputed from the current profile at
// render time (lib/safety.ts), so a profile change made later still applies.
export type ScanKind = 'multi' | 'single' | null;
export type ScanStatus = 'idle' | 'analyzing' | 'translating' | 'ready' | 'error';

interface TranslationCacheEntry {
  dishes: Dish[];
  fetchedAt: number;
}

const MAX_CLIENT_TRANSLATION_CACHE_ENTRIES = 20;
const SCAN_SESSION_KEY = 'fitbridge_scan_session_v1';

interface ScanState {
  kind: ScanKind;
  status: ScanStatus;
  errorMessage: string | null; // developer diagnostic only (shown under "Technical details")
  errorCode: ApiErrorCode | null;
  errorRetryable: boolean;
  // [QUOTA] When the provider allows another request (epoch ms), if known.
  errorRetryAt: number | null;
  // [Package 5] the image of the failed request, so "Try Again" can resend it (memory only)
  failedImage: string | null;
  coverage: AnalysisCoverage | null;
  displayedDishes: Dish[];
  displayedLang: Lang | null;
  lastAnalysis: { imageHash: string; analysisId: string; canonicalDishes: Dish[] } | null;
  translationCache: Map<string, TranslationCacheEntry>;
  isAnalyzing: boolean;
  inFlightImageHash: string | null;
  lastTranslationFailed: boolean;
  lastTranslationErrorCode: ApiErrorCode | null;
  partialResults: boolean;
  selectedDishUid: string | null;
  locationContext: LocationContext | null;
  // The restaurant the CURRENT result belongs to (fixed at analysis time).
  resultLocation: LocationContext | null;
  analyzedAt: number | null;
  restoredFromSession: boolean;

  analysisAbortController: AbortController | null;
  translationAbortController: AbortController | null;

  analyzePhoto: (imageBase64: string) => Promise<void>;
  retryAnalysis: () => Promise<void>;
  translateCurrent: (lang: Lang) => Promise<void>;
  showDemoDish: (dish: Dish, location?: LocationContext | null) => void;
  startLocationScan: (location: LocationContext) => void;
  clearLocationContext: () => void;
  selectDish: (uid: string | null) => void;
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

// uid = "<analysisId>#<index in the analysis>" — unique even when two menu
// lines have the same dish name (and therefore the same foodId).
function withUids(dishes: Dish[], analysisId: string): Dish[] {
  return dishes.map((d, i) => ({ ...d, uid: `${analysisId}#${i}` }));
}

const CLEARED_ERROR = { errorMessage: null, errorCode: null, errorRetryable: false, errorRetryAt: null, failedImage: null } as const;
const CLEARED_RESULT = {
  kind: null,
  displayedDishes: [] as Dish[],
  displayedLang: null,
  lastAnalysis: null,
  coverage: null,
  partialResults: false,
  lastTranslationFailed: false,
  lastTranslationErrorCode: null,
  selectedDishUid: null,
  resultLocation: null,
  analyzedAt: null,
  restoredFromSession: false,
} as const;

export const useScanStore = create<ScanState>()(
  persist(
    (set, get) => ({
      kind: null,
      status: 'idle',
      ...CLEARED_ERROR,
      coverage: null,
      displayedDishes: [],
      displayedLang: null,
      lastAnalysis: null,
      translationCache: new Map(),
      isAnalyzing: false,
      inFlightImageHash: null,
      lastTranslationFailed: false,
      lastTranslationErrorCode: null,
      partialResults: false,
      selectedDishUid: null,
      locationContext: null,
      resultLocation: null,
      analyzedAt: null,
      restoredFromSession: false,
      analysisAbortController: null,
      translationAbortController: null,

      async analyzePhoto(imageBase64) {
        const imageHash = hashStringForCache(imageBase64);
        const st = get();

        // [IMP-06] Duplicate-click guard — scoped to "the analysis network
        // call itself is in flight", not the whole function.
        if (st.isAnalyzing && st.inFlightImageHash === imageHash) return;

        // [IMP-05] Same image already analyzed — reuse the cached canonical result.
        if (st.lastAnalysis && st.lastAnalysis.imageHash === imageHash) {
          await get().translateCurrent(currentLang());
          return;
        }

        st.analysisAbortController?.abort();
        st.translationAbortController?.abort();
        const controller = new AbortController();
        // [Package 5] Clear the previous photo's result as soon as a new
        // analysis starts, so an old result can never read as this photo's.
        set({
          analysisAbortController: controller,
          isAnalyzing: true,
          inFlightImageHash: imageHash,
          status: 'analyzing',
          ...CLEARED_ERROR,
          ...CLEARED_RESULT,
        });

        try {
          const data = await analyzeMenu(imageBase64, controller.signal);
          if (get().analysisAbortController !== controller) return; // superseded

          set({
            lastAnalysis: { imageHash, analysisId: data.analysisId, canonicalDishes: withUids(data.dishes, data.analysisId) },
            kind: 'multi',
            partialResults: data.validationStatus === 'partial',
            coverage: data.coverage ?? null,
            isAnalyzing: false,
            inFlightImageHash: null,
            resultLocation: get().locationContext,
            analyzedAt: Date.now(),
            selectedDishUid: null,
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
            errorRetryAt: apiErr && apiErr.retryAfterSeconds ? Date.now() + apiErr.retryAfterSeconds * 1000 : null,
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
          set({ displayedDishes: cached.dishes, displayedLang: lang, status: 'ready', lastTranslationFailed: false });
          return;
        }

        if (lang === 'en') {
          cacheTranslatedDishes(st.translationCache, cacheKey, analysis.canonicalDishes);
          set({ displayedDishes: analysis.canonicalDishes, displayedLang: 'en', status: 'ready', lastTranslationFailed: false });
          return;
        }

        st.translationAbortController?.abort();
        const controller = new AbortController();
        // Keep showing the current (previous-language) result while translating;
        // the screen shows a "Translating…" line for this status.
        if (st.displayedDishes.length === 0) set({ displayedDishes: analysis.canonicalDishes, displayedLang: 'en' });
        set({ translationAbortController: controller, status: 'translating' });

        try {
          const data = await translateDish(analysis.analysisId, lang, analysis.canonicalDishes, controller.signal);
          if (get().translationAbortController !== controller) return; // superseded by a newer language switch
          const translated = buildTranslatedDishList(analysis.canonicalDishes, data.translationsByFoodId || {});
          cacheTranslatedDishes(get().translationCache, cacheKey, translated);
          set({ displayedDishes: translated, displayedLang: lang, status: 'ready', lastTranslationFailed: false });
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
          if (get().translationAbortController !== controller) return;
          // Translation failure keeps the English original on screen (§IMP-04)
          // and is not cached, so the next language switch tries again.
          set({
            displayedDishes: analysis.canonicalDishes,
            displayedLang: 'en',
            status: 'ready',
            lastTranslationFailed: true,
            lastTranslationErrorCode: err instanceof ApiError ? err.code : null,
          });
        }
      },

      showDemoDish(dish, location) {
        get().analysisAbortController?.abort();
        get().translationAbortController?.abort();
        const loc = location ?? get().locationContext;
        set({
          ...CLEARED_ERROR,
          ...CLEARED_RESULT,
          kind: 'single',
          displayedDishes: [{ ...dish, uid: `demo:${dish.foodId}` }],
          displayedLang: null,
          status: 'ready',
          isAnalyzing: false,
          inFlightImageHash: null,
          locationContext: loc,
          resultLocation: loc,
          selectedDishUid: `demo:${dish.foodId}`,
        });
      },

      startLocationScan(location) {
        get().analysisAbortController?.abort();
        get().translationAbortController?.abort();
        set({ ...CLEARED_ERROR, ...CLEARED_RESULT, status: 'idle', isAnalyzing: false, inFlightImageHash: null, locationContext: location });
      },

      clearLocationContext() {
        set({ locationContext: null });
      },

      selectDish(uid) {
        set({ selectedDishUid: uid });
      },

      // "Add a Menu Photo" from a result: start over, but stay at the same
      // restaurant (a traveler usually photographs the next menu page there).
      reset() {
        get().analysisAbortController?.abort();
        get().translationAbortController?.abort();
        set({
          status: 'idle',
          ...CLEARED_ERROR,
          ...CLEARED_RESULT,
          isAnalyzing: false,
          inFlightImageHash: null,
          analysisAbortController: null,
          translationAbortController: null,
        });
      },
    }),
    {
      name: SCAN_SESSION_KEY,
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
      partialize: (s) => ({
        kind: s.kind,
        lastAnalysis: s.lastAnalysis,
        displayedDishes: s.displayedDishes,
        displayedLang: s.displayedLang,
        coverage: s.coverage,
        partialResults: s.partialResults,
        selectedDishUid: s.selectedDishUid,
        locationContext: s.locationContext,
        resultLocation: s.resultLocation,
        analyzedAt: s.analyzedAt,
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<ScanState>;
        const hasResult = !!p.kind && Array.isArray(p.displayedDishes) && p.displayedDishes.length > 0;
        return {
          ...current,
          ...p,
          // An interrupted analysis/translation is never resumed as "in progress".
          status: hasResult ? 'ready' : 'idle',
          restoredFromSession: hasResult,
        };
      },
    }
  )
);

// The store needs the active UI language without importing profileStore
// at module scope (would create a circular import). Wired from
// store/wiring.ts at app startup.
let currentLangGetter: () => Lang = () => 'en';
export function setCurrentLangGetter(fn: () => Lang) {
  currentLangGetter = fn;
}
function currentLang(): Lang {
  return currentLangGetter();
}
