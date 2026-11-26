import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type { Dietary, Lang, CustomAllergyEntry } from '../types';
import { migrateLegacyAllergyIds } from '../lib/allergens';

// Reuses the EXACT same localStorage key + schema the vanilla app used
// (index.html PROFILE_STORAGE_KEY/PROFILE_SCHEMA_VERSION, §IMP-11) so a
// returning user's saved profile survives the React rewrite untouched —
// no re-onboarding, no silent reset (§5 of the Package 4 request).
const PROFILE_STORAGE_KEY = 'fitbridge_profile_v1';
const PROFILE_SCHEMA_VERSION = 2;

// Declared before useProfileStore (not after) — zustand's persist
// middleware can invoke onRehydrateStorage synchronously while
// useProfileStore itself is still being constructed below, and a
// forward reference to a later `const` would hit the temporal dead zone
// at exactly that moment (this was a real bug caught via Playwright: the
// app rendered nothing at all, because the TDZ error was swallowed
// somewhere inside persist's rehydrate path instead of surfacing loudly).
export const useProfileHydration = create<{ hasHydrated: boolean }>(() => ({
  hasHydrated: false,
}));

interface PersistedShape {
  schemaVersion: number;
  lang: Lang;
  dietary: Dietary;
  nationality: string;
  selectedSpicy: number;
  selectedAllergies: string[];
  customAllergies: CustomAllergyEntry[];
  onboardingComplete: boolean;
  // [UX-IMPROVEMENT] Optional; absent in older/vanilla-saved profiles (= not stated).
  noAllergiesConfirmed?: boolean;
}

// [UX-IMPROVEMENT] 'set' = at least one allergy registered, 'none' = the user
// explicitly said they have none, 'unset' = never answered (old profiles too).
export type AllergyProfileStatus = 'set' | 'none' | 'unset';
export function getAllergyProfileStatus(s: Pick<ProfileState, 'selectedAllergies' | 'customAllergies' | 'noAllergiesConfirmed'>): AllergyProfileStatus {
  if (s.selectedAllergies.size > 0 || s.customAllergies.length > 0) return 'set';
  return s.noAllergiesConfirmed ? 'none' : 'unset';
}

export interface ProfileState {
  lang: Lang;
  dietary: Dietary;
  nationality: string;
  selectedSpicy: number;
  selectedAllergies: Set<string>;
  customAllergies: CustomAllergyEntry[];
  onboardingComplete: boolean;
  noAllergiesConfirmed: boolean;

  setLang: (lang: Lang) => void;
  setDietary: (d: Dietary) => void;
  setNationality: (n: string) => void;
  setSpicy: (level: number) => void;
  toggleAllergen: (id: string) => void;
  clearAllAllergies: () => void;
  addCustomAllergy: (entry: CustomAllergyEntry) => void;
  updateCustomAllergy: (original: string, patch: Partial<CustomAllergyEntry>) => void;
  removeCustomAllergy: (original: string) => void;
  completeOnboarding: () => void;
  setNoAllergiesConfirmed: (v: boolean) => void;
  resetProfile: () => void;
}

// Set<string> isn't JSON-serializable by default — convert at the storage
// boundary only, exactly like the vanilla saveProfileToStorage()/
// loadProfileFromStorage() did with Array.from(state.selectedAllergies).
const storage: PersistStorage<ProfileState> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedShape & { state?: PersistedShape };
      const data = (parsed as any).state ?? parsed;

      // [IMP-11] Legacy allergen id migration, ported verbatim in spirit —
      // unrecognized ids are preserved, never silently dropped.
      const migration = migrateLegacyAllergyIds(data.selectedAllergies || []);

      const state: ProfileState = {
        lang: data.lang || 'en',
        dietary: data.dietary || 'none',
        nationality: data.nationality || '',
        selectedSpicy: typeof data.selectedSpicy === 'number' ? data.selectedSpicy : 1,
        selectedAllergies: new Set(migration.ids),
        customAllergies: data.customAllergies || [],
        onboardingComplete: !!data.onboardingComplete,
        noAllergiesConfirmed: !!data.noAllergiesConfirmed,
      } as ProfileState;
      return { state, version: PROFILE_SCHEMA_VERSION } as unknown as StorageValue<ProfileState>;
    } catch (err) {
      console.error('[profileStore] Could not load saved profile:', err);
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const s = value.state;
      const payload: PersistedShape = {
        schemaVersion: PROFILE_SCHEMA_VERSION,
        lang: s.lang,
        dietary: s.dietary,
        nationality: s.nationality,
        selectedSpicy: s.selectedSpicy,
        selectedAllergies: Array.from(s.selectedAllergies),
        customAllergies: s.customAllergies,
        onboardingComplete: s.onboardingComplete,
        noAllergiesConfirmed: s.noAllergiesConfirmed,
      };
      localStorage.setItem(name, JSON.stringify(payload));
    } catch (err) {
      // localStorage may be unavailable (private browsing, sandboxed
      // preview) — fail silently exactly like the vanilla version did;
      // the app still works, it just won't remember settings.
      console.error('[profileStore] Could not save profile:', err);
    }
  },
  removeItem: (name) => localStorage.removeItem(name),
};

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      lang: 'en',
      dietary: 'none',
      nationality: '',
      selectedSpicy: 1,
      selectedAllergies: new Set<string>(),
      customAllergies: [],
      onboardingComplete: false,
      noAllergiesConfirmed: false,

      setLang: (lang) => set({ lang }),
      setDietary: (dietary) => set({ dietary }),
      setNationality: (nationality) => set({ nationality }),
      // [IMP-08 bug fix, kept] the vanilla setSpicy() originally never
      // persisted at all — here persistence is automatic via the `persist`
      // middleware on every set(), so that whole class of bug can't recur.
      setSpicy: (selectedSpicy) => set({ selectedSpicy }),
      toggleAllergen: (id) =>
        set((st) => {
          const next = new Set(st.selectedAllergies);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          // Registering an allergy overrides an earlier "I have none".
          return { selectedAllergies: next, noAllergiesConfirmed: next.size > 0 ? false : st.noAllergiesConfirmed };
        }),
      clearAllAllergies: () => set({ selectedAllergies: new Set(), customAllergies: [] }),
      addCustomAllergy: (entry) =>
        set((st) => ({ customAllergies: [...st.customAllergies, entry], noAllergiesConfirmed: false })),
      updateCustomAllergy: (original, patch) =>
        set((st) => ({
          customAllergies: st.customAllergies.map((c) =>
            c.original === original ? { ...c, ...patch } : c
          ),
        })),
      removeCustomAllergy: (original) =>
        set((st) => ({ customAllergies: st.customAllergies.filter((c) => c.original !== original) })),
      completeOnboarding: () => set({ onboardingComplete: true }),
      setNoAllergiesConfirmed: (v) => set(v ? { noAllergiesConfirmed: true, selectedAllergies: new Set(), customAllergies: [] } : { noAllergiesConfirmed: false }),
      resetProfile: () =>
        set({
          dietary: 'none',
          nationality: '',
          selectedSpicy: 1,
          selectedAllergies: new Set(),
          customAllergies: [],
          onboardingComplete: false,
          noAllergiesConfirmed: false,
        }),
    }),
    {
      name: PROFILE_STORAGE_KEY,
      storage,
      version: PROFILE_SCHEMA_VERSION,
      onRehydrateStorage: () => () => {
        useProfileHydration.setState({ hasHydrated: true });
      },
    }
  )
);
