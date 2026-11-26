import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type { UserReview } from '../types';

// Reuses the exact key/shape IMP-14 introduced for the vanilla version —
// a returning user's saved reviews must survive the React rewrite too.
const USER_REVIEWS_STORAGE_KEY = 'fitbridge_user_reviews_v1';
const USER_REVIEW_SCHEMA_VERSION = 1;

// [bug found via Playwright — "Maximum update depth exceeded"] A selector
// like `(s) => s.userReviews[foodId] || []` allocates a brand-new empty
// array every call when there's no entry yet, which again breaks
// useSyncExternalStore's reference-equality check the same way an inline
// object literal would (see ScannerView.tsx's fix for the same symptom).
// Falling back to this single shared, stable array instead keeps the
// reference identical across renders whenever there are genuinely no
// reviews yet.
export const EMPTY_REVIEWS: UserReview[] = [];

export interface ReviewState {
  userReviews: Record<string, UserReview[]>;
  editingReviewId: string | null;
  corruptedDataWasReset: boolean;
  addReview: (foodId: string, review: Omit<UserReview, 'id' | 'isUserReview' | 'createdAt'>) => void;
  updateReview: (foodId: string, id: string, patch: Partial<UserReview>) => void;
  deleteReview: (foodId: string, id: string) => void;
  startEditing: (id: string) => void;
  cancelEditing: () => void;
  acknowledgeCorruptedReset: () => void;
}

function generateReviewId(): string {
  return `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// [IMP-14] Corrupted data handling: never let a parse failure or an
// unexpected shape crash the app or silently wipe reviews for foodIds that
// ARE still readable — only the unreadable parts are dropped.
function sanitizeReviews(raw: unknown): Record<string, UserReview[]> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const cleaned: Record<string, UserReview[]> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([foodId, list]) => {
    if (Array.isArray(list)) cleaned[foodId] = list as UserReview[];
  });
  return cleaned;
}

const storage: PersistStorage<ReviewState> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return { state: { userReviews: {}, corruptedDataWasReset: false } } as unknown as StorageValue<ReviewState>;
      const parsed = JSON.parse(raw);
      const reviews = sanitizeReviews(parsed?.reviews);
      if (reviews === null) throw new Error('unexpected shape');
      return { state: { userReviews: reviews, corruptedDataWasReset: false } } as unknown as StorageValue<ReviewState>;
    } catch (err) {
      console.error('[reviewStore] Saved reviews were corrupted — resetting:', err);
      return { state: { userReviews: {}, corruptedDataWasReset: true } } as unknown as StorageValue<ReviewState>;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(
        name,
        JSON.stringify({ schemaVersion: USER_REVIEW_SCHEMA_VERSION, reviews: value.state.userReviews })
      );
    } catch (err) {
      console.error('[reviewStore] Could not save reviews:', err);
    }
  },
  removeItem: (name) => localStorage.removeItem(name),
};

export const useReviewStore = create<ReviewState>()(
  persist(
    (set, get) => ({
      userReviews: {},
      editingReviewId: null,
      corruptedDataWasReset: false,

      addReview: (foodId, review) =>
        set((st) => ({
          userReviews: {
            ...st.userReviews,
            [foodId]: [
              ...(st.userReviews[foodId] || []),
              { ...review, id: generateReviewId(), isUserReview: true, createdAt: Date.now() },
            ],
          },
        })),

      updateReview: (foodId, id, patch) =>
        set((st) => ({
          userReviews: {
            ...st.userReviews,
            [foodId]: (st.userReviews[foodId] || []).map((r) =>
              r.id === id ? { ...r, ...patch, editedAt: Date.now() } : r
            ),
          },
          editingReviewId: null,
        })),

      deleteReview: (foodId, id) =>
        set((st) => ({
          userReviews: {
            ...st.userReviews,
            [foodId]: (st.userReviews[foodId] || []).filter((r) => r.id !== id),
          },
          editingReviewId: get().editingReviewId === id ? null : st.editingReviewId,
        })),

      startEditing: (id) => set({ editingReviewId: id }),
      cancelEditing: () => set({ editingReviewId: null }),
      acknowledgeCorruptedReset: () => set({ corruptedDataWasReset: false }),
    }),
    {
      name: USER_REVIEWS_STORAGE_KEY,
      storage,
      version: USER_REVIEW_SCHEMA_VERSION,
    }
  )
);
