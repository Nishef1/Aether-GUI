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
  automationEpoch: number;
  setPreference: (preference: ExitPreference) => void;
  beginManualAttempt: () => void;
  cancelAutomation: () => void;
  beginReroll: () => number | null;
  finishReroll: () => void;
  markAccepted: () => void;
  markExhausted: () => void;
}

export const useExitPolicyStore = create<ExitPolicyState>((set, get) => ({
  preference: readPreference(),
  retryCount: 0,
  rerolling: false,
  exhausted: false,
  automationEpoch: 0,

  setPreference: (preference) => {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Preference persistence is optional; never block connectivity.
    }
    set((state) => ({
      preference,
      retryCount: 0,
      rerolling: false,
      exhausted: false,
      automationEpoch: state.automationEpoch + 1,
    }));
  },

  beginManualAttempt: () =>
    set((state) => ({
      retryCount: 0,
      rerolling: false,
      exhausted: false,
      automationEpoch: state.automationEpoch + 1,
    })),

  cancelAutomation: () =>
    set((state) => ({
      rerolling: false,
      automationEpoch: state.automationEpoch + 1,
    })),

  beginReroll: () => {
    const state = get();
    if (
      state.preference !== "privacy" ||
      state.rerolling ||
      state.retryCount >= EXIT_RETRY_LIMIT
    ) {
      return null;
    }
    set({ retryCount: state.retryCount + 1, rerolling: true, exhausted: false });
    return state.automationEpoch;
  },

  finishReroll: () => set({ rerolling: false }),
  markAccepted: () => set({ rerolling: false, exhausted: false }),
  markExhausted: () => set({ rerolling: false, exhausted: true }),
}));
