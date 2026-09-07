import { create } from "zustand";
import {
  EXIT_RETRY_LIMIT,
  type ExitPreference,
  normalizeExitPreference,
} from "@/lib/exitPolicy";

const STORAGE_KEY = "aether.exit-preference.v1";

function readPreference(): ExitPreference {
  try {
    return normalizeExitPreference(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "low-latency";
  }
}

interface ExitPolicyState {
  preference: ExitPreference;
  retryCount: number;
  rerolling: boolean;
  exhausted: boolean;
  setPreference: (preference: ExitPreference) => void;
  beginManualAttempt: () => void;
  beginReroll: () => boolean;
  finishReroll: () => void;
  markAccepted: () => void;
  markExhausted: () => void;
}

export const useExitPolicyStore = create<ExitPolicyState>((set, get) => ({
  preference: readPreference(),
  retryCount: 0,
  rerolling: false,
  exhausted: false,

  setPreference: (preference) => {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Preference persistence is optional; never block connectivity.
    }
    set({ preference, retryCount: 0, rerolling: false, exhausted: false });
  },

  beginManualAttempt: () => set({ retryCount: 0, rerolling: false, exhausted: false }),

  beginReroll: () => {
    const state = get();
    if (
      state.preference !== "privacy" ||
      state.rerolling ||
      state.retryCount >= EXIT_RETRY_LIMIT
    ) {
      return false;
    }
    set({ retryCount: state.retryCount + 1, rerolling: true, exhausted: false });
    return true;
  },

  finishReroll: () => set({ rerolling: false }),
  markAccepted: () => set({ rerolling: false, exhausted: false }),
  markExhausted: () => set({ rerolling: false, exhausted: true }),
}));
