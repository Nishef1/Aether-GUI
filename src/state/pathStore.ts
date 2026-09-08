import { create } from "zustand";
import {
  createObservedPath,
  MAX_PATHS,
  rankPaths,
  recordPathFailure,
  recordPathSuccess,
  type ObservedPath,
} from "@/lib/pathIntelligence";
import { useConnectionStore } from "@/state/connectionStore";
import { useTelemetryStore } from "@/state/telemetryStore";

const STORAGE_KEY = "aether.path-intelligence.v1";

interface PathStore {
  paths: ObservedPath[];
  clear: () => void;
}

function loadPersistedPaths(): ObservedPath[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];

    return rankPaths(
      parsed.filter((item): item is ObservedPath => {
        if (item == null || typeof item !== "object") return false;
        const path = item as Partial<ObservedPath>;
        return (
          typeof path.id === "string" &&
          typeof path.endpoint === "string" &&
          typeof path.transport === "string" &&
          typeof path.successes === "number" &&
          typeof path.failures === "number" &&
          typeof path.lastSeenAt === "number"
        );
      }),
    ).slice(0, MAX_PATHS);
  } catch {
    return [];
  }
}

function persist(paths: readonly ObservedPath[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paths.slice(0, MAX_PATHS)));
  } catch {
    // Path history is an optional local optimization and must never block connectivity.
  }
}

function replacePath(paths: readonly ObservedPath[], next: ObservedPath): ObservedPath[] {
  return rankPaths([next, ...paths.filter((path) => path.id !== next.id)]);
}

export const usePathStore = create<PathStore>((set) => ({
  paths: loadPersistedPaths(),
  clear: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore unavailable storage.
    }
    set({ paths: [] });
  },
}));

function updatePath(mutator: (path: ObservedPath) => ObservedPath): void {
  const profile = useConnectionStore.getState().profile;
  const template = createObservedPath(profile);
  const state = usePathStore.getState();
  const existing = state.paths.find((path) => path.id === template.id) ?? template;
  const paths = replacePath(state.paths, mutator(existing));
  usePathStore.setState({ paths });
  persist(paths);
}

export function initPathIntelligence(): () => void {
  let lastSuccessAttempt = -1;
  let lastFailureAttempt = -1;

  const maybeRecordSuccess = () => {
    const connection = useConnectionStore.getState();
    const telemetry = useTelemetryStore.getState().snapshot;
    const stable = connection.status.state === "Connected" || connection.status.state === "Tunneling";

    if (
      !stable ||
      connection.attemptId <= 0 ||
      connection.attemptId === lastSuccessAttempt ||
      !telemetry.egress_probe_complete
    ) {
      return;
    }

    lastSuccessAttempt = connection.attemptId;
    updatePath((path) =>
      recordPathSuccess(path, {
        latencyMs: telemetry.latency_ms,
        countryCode: telemetry.country_code,
      }),
    );
  };

  const maybeRecordFailure = () => {
    const connection = useConnectionStore.getState();
    if (
      connection.status.state !== "Error" ||
      connection.attemptId <= 0 ||
      connection.attemptId === lastFailureAttempt ||
      connection.attemptId === lastSuccessAttempt
    ) {
      return;
    }

    lastFailureAttempt = connection.attemptId;
    updatePath((path) => recordPathFailure(path));
  };

  const unsubscribeConnection = useConnectionStore.subscribe((state, previous) => {
    if (state.attemptId !== previous.attemptId) {
      // A new attempt may legitimately use the same profile; dedupe is per attempt, not per path.
      maybeRecordSuccess();
      maybeRecordFailure();
      return;
    }
    if (state.status.state !== previous.status.state) {
      maybeRecordSuccess();
      maybeRecordFailure();
    }
  });

  const unsubscribeTelemetry = useTelemetryStore.subscribe((state, previous) => {
    if (
      state.snapshot.egress_probe_complete !== previous.snapshot.egress_probe_complete ||
      state.snapshot.sampled_at_ms !== previous.snapshot.sampled_at_ms
    ) {
      maybeRecordSuccess();
    }
  });

  maybeRecordSuccess();
  maybeRecordFailure();

  return () => {
    unsubscribeConnection();
    unsubscribeTelemetry();
  };
}
