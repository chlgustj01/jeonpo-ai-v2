import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { StaffQuestionType } from '../types';

// [Package 4 §6] Only 3 tabs now — the old standalone "TTS" tab's job
// (checking allergies + speaking Korean) is covered by the Profile modal
// (editing) and the StaffQuestionPanel attached to scan results (speaking),
// per the request's explicit user flow: 프로필 설정 → 음식 스캔 → 분석
// 결과 확인 → 직원 질문 → 리뷰. Map/Scan/Exchange are still all present,
// just no longer each pinned to their own always-visible tab slot when
// they're really sub-steps of one flow.
export type TabName = 'map' | 'scanner' | 'exchange';

// [UX-IMPROVEMENT] URL hash per tab (Back button + reload keep the tab).
const TAB_HASH: Record<TabName, string> = { map: '#/map', scanner: '#/menu', exchange: '#/exchange' };
export function hashForTab(tab: TabName): string {
  return TAB_HASH[tab];
}
export function tabFromHash(hash: string): TabName | null {
  const hit = (Object.keys(TAB_HASH) as TabName[]).find((k) => TAB_HASH[k] === hash);
  return hit || null;
}

interface ToastState {
  message: string;
  id: number;
}

interface UIState {
  activeTab: TabName;
  profileModalOpen: boolean;
  toast: ToastState | null;
  staffQuestionType: StaffQuestionType;
  selectedLocationId: number | null;
  reviewsFilterMode: 'similar' | 'country' | 'all';
  currentMapFilter: 'all' | 'restaurant' | 'cafe';

  setActiveTab: (tab: TabName) => void;
  openProfileModal: () => void;
  closeProfileModal: () => void;
  showToast: (message: string) => void;
  setStaffQuestionType: (type: StaffQuestionType) => void;
  selectLocation: (id: number | null) => void;
  setReviewsFilterMode: (mode: 'similar' | 'country' | 'all') => void;
  setMapFilter: (f: 'all' | 'restaurant' | 'cafe') => void;
}

let toastCounter = 0;

// [UX-IMPROVEMENT] activeTab + selectedLocationId survive a reload for this
// browser tab only (sessionStorage) — nothing personal is stored here.
export const useUIStore = create<UIState>()(persist((set) => ({
  activeTab: 'map',
  profileModalOpen: false,
  toast: null,
  staffQuestionType: 'comprehensive',
  selectedLocationId: null,
  reviewsFilterMode: 'similar',
  currentMapFilter: 'all',

  setActiveTab: (tab) => set({ activeTab: tab }),
  openProfileModal: () => set({ profileModalOpen: true }),
  closeProfileModal: () => set({ profileModalOpen: false }),
  showToast: (message) => {
    const id = ++toastCounter;
    set({ toast: { message, id } });
    setTimeout(() => {
      set((st) => (st.toast?.id === id ? { toast: null } : {}));
    }, 2500);
  },
  setStaffQuestionType: (staffQuestionType) => set({ staffQuestionType }),
  selectLocation: (id) => set({ selectedLocationId: id, reviewsFilterMode: 'similar' }),
  setReviewsFilterMode: (mode) => set({ reviewsFilterMode: mode }),
  setMapFilter: (f) => set({ currentMapFilter: f }),
}), {
  name: 'fitbridge_ui_session_v1',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (s) => ({ activeTab: s.activeTab, selectedLocationId: s.selectedLocationId, currentMapFilter: s.currentMapFilter }),
}));
