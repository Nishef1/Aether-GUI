import { listen } from "@tauri-apps/api/event";
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
  type RuntimePathSelection,
} from "@/lib/pathIntelligence";
import { useConnectionStore } from "@/state/connectionStore";
import { useTelemetryStore } from "@/state/telemetryStore";
import type { ConnectionStatus, LogLine, RuntimeTelemetry } from "@/types/connection";

const STORAGE_KEY = "aether.path-intelligence.v1";
const PATH_MARKER_RE = /^\[gui\] path selected transport=(h2|h3|wg|gool) endpoint=(.+)$/;
const TRANSPORTS = new Set<PathTransport>(["h2", "h3", "wg", "gool", "unknown"]);
const HEALTH_STATES = new Set<PathHealth>(["healthy", "suspect", "failed"]);

interface PathStore {
  paths: ObservedPath[];
  clear: () => void;
}

interface AttemptPathSelection extends RuntimePathSelection {
  attemptId: number;
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

function updatePath(
  mutator: (path: ObservedPath) => ObservedPath,
  selection?: RuntimePathSelection | null,
): void {
  const profile = useConnectionStore.getState().profile;
  const template = createObservedPath(profile, Date.now(), selection);
  const state = usePathStore.getState();
  const existing = state.paths.find((path) => path.id === template.id) ?? template;
  const paths = replacePath(state.paths, mutator(existing));
  usePathStore.setState({ paths });
  persist(paths);
}

function stableSessionKey(status: ConnectionStatus, attemptId: number): string | null {
  switch (status.state) {
    case "Connected":
    case "Tunneling":
      return `${attemptId}:${status.connected_at_ms}`;
    default:
      return null;
  }
}

function telemetryProvesHealthy(snapshot: RuntimeTelemetry): boolean {
  if (!snapshot.egress_probe_complete) return false;
  if (snapshot.path_health != null) return snapshot.path_health === "healthy";
  return snapshot.public_ip != null;
}

function telemetryProvesFailure(snapshot: RuntimeTelemetry): boolean {
  if (!snapshot.egress_probe_complete) return false;
  if (snapshot.path_health != null) {
    return snapshot.path_health === "suspect" || snapshot.path_health === "failed";
  }
  return snapshot.public_ip == null;
}

export function initPathIntelligence(): () => void {
  let selectedPath: AttemptPathSelection | null = null;
  let lastSuccessSession: string | null = null;
  let lastProbeFailureCount = 0;
  let errorStateRecorded = false;
  let disposed = false;
  let unlistenPath: (() => void) | null = null;

  const selectionForAttempt = (attemptId: number): RuntimePathSelection | null =>
    selectedPath?.attemptId === attemptId
      ? { endpoint: selectedPath.endpoint, transport: selectedPath.transport }
      : null;

  const maybeRecordSuccess = () => {
    const connection = useConnectionStore.getState();
    const telemetry = useTelemetryStore.getState().snapshot;
    if (!telemetryProvesHealthy(telemetry)) return;

    // Native failures reset after a successful probe, so mirror that locally.
    lastProbeFailureCount = 0;
    const sessionKey = stableSessionKey(connection.status, connection.attemptId);
    if (
      sessionKey == null ||
      connection.attemptId <= 0 ||
      sessionKey === lastSuccessSession
    ) {
      return;
    }

    lastSuccessSession = sessionKey;
    updatePath(
      (path) =>
        recordPathSuccess(path, {
          latencyMs: telemetry.latency_ms,
          countryCode: telemetry.country_code,
        }),
      selectionForAttempt(connection.attemptId),
    );
  };

  const maybeRecordProbeFailure = () => {
    const connection = useConnectionStore.getState();
    const telemetry = useTelemetryStore.getState().snapshot;
    const probeFailures = telemetry.probe_failures ?? 0;
    if (
      connection.attemptId <= 0 ||
      stableSessionKey(connection.status, connection.attemptId) == null ||
      probeFailures <= lastProbeFailureCount ||
      !telemetryProvesFailure(telemetry)
    ) {
      return;
    }

    lastProbeFailureCount = probeFailures;
    updatePath(
      (path) => recordPathFailure(path),
      selectionForAttempt(connection.attemptId),
    );
  };

  const maybeRecordFailure = () => {
    const connection = useConnectionStore.getState();
    if (connection.status.state !== "Error" || connection.attemptId <= 0 || errorStateRecorded) {
      return;
    }

    errorStateRecorded = true;
    updatePath(
      (path) => recordPathFailure(path),
      selectionForAttempt(connection.attemptId),
    );
  };

  void listen<LogLine>("aether://log", (event) => {
    const match = PATH_MARKER_RE.exec(event.payload.line.trim());
    if (!match) return;

    const connection = useConnectionStore.getState();
    if (connection.attemptId <= 0) return;
    selectedPath = {
      attemptId: connection.attemptId,
      transport: match[1] as PathTransport,
      endpoint: match[2].trim(),
    };
  }).then((unlisten) => {
    if (disposed) unlisten();
    else unlistenPath = unlisten;
  });

  const unsubscribeConnection = useConnectionStore.subscribe((state, previous) => {
    if (state.attemptId !== previous.attemptId) {
      selectedPath = null;
      lastProbeFailureCount = 0;
      errorStateRecorded = false;
    }

    if (state.status.state !== previous.status.state) {
      if (state.status.state !== "Error") errorStateRecorded = false;
      maybeRecordSuccess();
      maybeRecordProbeFailure();
      maybeRecordFailure();
    }
  });

  const unsubscribeTelemetry = useTelemetryStore.subscribe((state, previous) => {
    if (
      state.snapshot.egress_probe_complete !== previous.snapshot.egress_probe_complete ||
      state.snapshot.path_health !== previous.snapshot.path_health ||
      state.snapshot.probe_failures !== previous.snapshot.probe_failures
    ) {
      maybeRecordSuccess();
      maybeRecordProbeFailure();
    }
  });

  maybeRecordSuccess();
  maybeRecordProbeFailure();
  maybeRecordFailure();

  return () => {
    disposed = true;
    unlistenPath?.();
    unsubscribeConnection();
    unsubscribeTelemetry();
  };
}
