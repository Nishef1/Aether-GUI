import { create } from "zustand";
import type { ConnectionProfile } from "@/types/connection";

export interface AutomaticRuntimeAttempt {
  attemptId: number;
  profile: ConnectionProfile;
  label: string;
  index: number;
  total: number;
}

interface AutomaticRuntimeState {
  attempt: AutomaticRuntimeAttempt | null;
  beginAttempt: (attempt: AutomaticRuntimeAttempt) => void;
  clearAttempt: (attemptId?: number) => void;
}

export const useAutomaticRuntimeStore = create<AutomaticRuntimeState>((set, get) => ({
  attempt: null,
  beginAttempt: (attempt) => set({ attempt }),
  clearAttempt: (attemptId) => {
    const current = get().attempt;
    if (current == null || (attemptId != null && current.attemptId !== attemptId)) return;
    set({ attempt: null });
  },
}));

export function automaticRuntimeProfileForAttempt(
  attemptId: number,
): ConnectionProfile | null {
  const attempt = useAutomaticRuntimeStore.getState().attempt;
  return attempt?.attemptId === attemptId ? attempt.profile : null;
}
