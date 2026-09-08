import { create } from "zustand";
import {
  createObservedPath,
  MAX_PATHS,
  rankPaths,
  recordPathFailure,
  recordPathSuccess,
  type ObservedPath,
  type PathHealth,
  type PathTransport,
} from "@/lib/pathIntelligence";
import { useConnectionStore } from "@/state/connectionStore";
import { useTelemetryStore } from "@/state/telemetryStore";

const STORAGE_KEY = "aether.path-intelligence.v1";
const TRANSPORTS = new Set<PathTransport>(["h2", "h3", "wg", "gool", "unknown"]);
const HEALTH_STATES = new Set<PathHealth>(["healthy", "suspect", "failed"]);

interface PathStore {
  paths: ObservedPath[];
  clear: () => void;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePersistedPath(item: unknown): ObservedPath | null {
  if (item == null || typeof item !== "object") return null;
  const path = item as Partial<ObservedPath>;
  if (typeof path.id !== "string" || typeof path.endpoint !== "string") return null;
  if (typeof path.transport !== "string" || !TRANSPORTS.has(path.transport as PathTransport)) {
    return null;
  }

  const successes = Math.max(0, Math.floor(finiteOr(path.successes, 0)));
  const failures = Math.max(0, Math.floor(finiteOr(path.failures, 0)));
  const observations = successes + failures;
  const health =
    typeof path.health === "string" && HEALTH_STATES.has(path.health as PathHealth)
      ? (path.health as PathHealth)
      : observations > 0 && successes >= failures
        ? "healthy"
        : "suspect";

  return {
    id: path.id,
    endpoint: path.endpoint,
    transport: path.transport as PathTransport,
    health,
    successes,
    failures,
    consecutiveFailures: Math.max(0, Math.floor(finiteOr(path.consecutiveFailures, 0))),
    lastSuccessAt: nullableNumber(path.lastSuccessAt),
    lastFailureAt: nullableNumber(path.lastFailureAt),
    lastSeenAt: finiteOr(path.lastSeenAt, Date.now()),
    confidence:
      typeof path.confidence === "number" && Number.isFinite(path.confidence)
        ? Math.min(1, Math.max(0, path.confidence))
        : Math.min(1, observations / 8),
    latencyMs: nullableNumber(path.latencyMs),
    countryCode: typeof path.countryCode === "string" ? path.countryCode.toUpperCase() : null,
    cooldownUntil: nullableNumber(path.cooldownUntil),
  };
}

function loadPersistedPaths(): ObservedPath[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return rankPaths(
      parsed
        .map(normalizePersistedPath)
        .filter((path): path is ObservedPath => path !== null),
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
      connection.attemptId === lastFailureAttempt
    ) {
      return;
    }

    lastFailureAttempt = connection.attemptId;
    updatePath((path) => recordPathFailure(path));
  };

  const unsubscribeConnection = useConnectionStore.subscribe((state, previous) => {
    if (state.attemptId !== previous.attemptId) {
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
