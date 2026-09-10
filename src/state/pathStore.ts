import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  createObservedPath,
  MAX_PATHS,
  rankPaths,
  recordPathFailure,
  recordPathQuality,
  recordPathSuccess,
  type ObservedPath,
  type PathHealth,
  type PathTransport,
  type RuntimePathSelection,
} from "@/lib/pathIntelligence";
import { isAndroid } from "@/lib/platform";
import { automaticRuntimeProfileForAttempt } from "@/state/automaticRuntimeStore";
import { useConnectionStore } from "@/state/connectionStore";
import { useTelemetryStore } from "@/state/telemetryStore";
import type { ConnectionStatus, LogLine, RuntimeTelemetry } from "@/types/connection";

const STORAGE_PREFIX = "aether.path-intelligence.v2";
const LEGACY_STORAGE_KEY = "aether.path-intelligence.v1";
const PATH_MARKER_RE = /^\[gui\] path selected transport=(h2|h3|wg|gool) endpoint=(.+)$/;
const TRANSPORTS = new Set<PathTransport>(["h2", "h3", "wg", "gool", "unknown"]);
const HEALTH_STATES = new Set<PathHealth>(["healthy", "suspect", "failed"]);

let activeStorageKey: string | null = null;
let activeNetworkKey: string | null = null;
let scopeEpoch = 0;

interface PathStore {
  paths: ObservedPath[];
  clear: () => void;
}

interface AttemptPathSelection extends RuntimePathSelection {
  attemptId: number;
}

export type PathAcceptanceFailure = "upload-limited" | "identity-leak" | "dataplane-failed";

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedPercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : null;
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
    jitterMs: nullableNumber(path.jitterMs),
    qualityScore: boundedPercent(path.qualityScore),
    qualityConfidence: boundedPercent(path.qualityConfidence),
    uploadLimited: path.uploadLimited === true,
    countryCode: typeof path.countryCode === "string" ? path.countryCode.toUpperCase() : null,
    cooldownUntil: nullableNumber(path.cooldownUntil),
  };
}

function loadPersistedPaths(storageKey: string): ObservedPath[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
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
  if (activeStorageKey == null) return;
  try {
    localStorage.setItem(activeStorageKey, JSON.stringify(paths.slice(0, MAX_PATHS)));
  } catch {
    // Path history is an optional local optimization and must never block connectivity.
  }
}

function clearPersistedPathHistory(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${STORAGE_PREFIX}.`)) localStorage.removeItem(key);
    }
  } catch {
    // Ignore unavailable storage.
  }
}

function replacePath(paths: readonly ObservedPath[], next: ObservedPath): ObservedPath[] {
  return rankPaths([next, ...paths.filter((path) => path.id !== next.id)]);
}

export const usePathStore = create<PathStore>((set) => ({
  // Fail safe: no persisted winner is replayed until the native underlay
  // fingerprint has been resolved for this process/network.
  paths: [],
  clear: () => {
    clearPersistedPathHistory();
    set({ paths: [] });
  },
}));

export async function refreshPathNetworkContext(): Promise<boolean> {
  const epoch = ++scopeEpoch;
  let networkKey: string | null;
  try {
    networkKey = await invoke<string | null>("get_network_context");
  } catch {
    networkKey = null;
  }

  if (epoch !== scopeEpoch) return activeNetworkKey != null;
  if (networkKey === activeNetworkKey) return networkKey != null;

  activeNetworkKey = networkKey;
  activeStorageKey = networkKey == null ? null : `${STORAGE_PREFIX}.${networkKey}`;
  const paths = activeStorageKey == null ? [] : loadPersistedPaths(activeStorageKey);
  usePathStore.setState({ paths });
  return networkKey != null;
}

function updatePath(
  attemptId: number,
  mutator: (path: ObservedPath) => ObservedPath,
  selection?: RuntimePathSelection | null,
): void {
  const connection = useConnectionStore.getState();
  const profile = automaticRuntimeProfileForAttempt(attemptId) ?? connection.profile;
  const template = createObservedPath(profile, Date.now(), selection);
  const state = usePathStore.getState();
  const existing = state.paths.find((path) => path.id === template.id) ?? template;
  const paths = replacePath(state.paths, mutator(existing));
  usePathStore.setState({ paths });
  persist(paths);
}

export function recordPathAcceptanceFailure(
  attemptId: number,
  reason: PathAcceptanceFailure,
): void {
  if (attemptId <= 0) return;
  const connection = useConnectionStore.getState();
  const selection =
    connection.runtimePathAttemptId === attemptId ? connection.runtimePath : null;

  updatePath(
    attemptId,
    (path) => {
      const withEvidence =
        reason === "upload-limited"
          ? recordPathQuality(path, { uploadLimited: true })
          : path;
      return recordPathFailure(withEvidence);
    },
    selection,
  );
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
  let lastProbeFailureSampleAt = 0;
  let errorStateRecorded = false;
  let disposed = false;
  let unlistenPath: (() => void) | null = null;

  void refreshPathNetworkContext();

  const selectionForAttempt = (attemptId: number): RuntimePathSelection | null => {
    if (selectedPath?.attemptId === attemptId) {
      return { endpoint: selectedPath.endpoint, transport: selectedPath.transport };
    }
    const connection = useConnectionStore.getState();
    return connection.runtimePathAttemptId === attemptId ? connection.runtimePath : null;
  };

  const androidPathMetadataReady = (attemptId: number): boolean => {
    if (!isAndroid) return true;
    const connection = useConnectionStore.getState();
    return connection.runtimePathAttemptId === attemptId;
  };

  const maybeRecordSuccess = () => {
    const connection = useConnectionStore.getState();
    const telemetry = useTelemetryStore.getState().snapshot;
    if (!telemetryProvesHealthy(telemetry)) return;
    if (!androidPathMetadataReady(connection.attemptId)) return;

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
      connection.attemptId,
      (path) =>
        recordPathSuccess(path, {
          latencyMs: telemetry.smoothed_latency_ms ?? telemetry.latency_ms,
          jitterMs: telemetry.jitter_ms ?? null,
          qualityScore: telemetry.quality_score ?? null,
          qualityConfidence: telemetry.quality_confidence ?? null,
          uploadLimited: telemetry.upload_limited ?? false,
          countryCode: telemetry.country_code,
        }),
      selectionForAttempt(connection.attemptId),
    );
  };

  const maybeRefreshQuality = () => {
    const connection = useConnectionStore.getState();
    const telemetry = useTelemetryStore.getState().snapshot;
    const sessionKey = stableSessionKey(connection.status, connection.attemptId);
    if (
      sessionKey == null ||
      sessionKey !== lastSuccessSession ||
      !telemetryProvesHealthy(telemetry) ||
      !androidPathMetadataReady(connection.attemptId)
    ) {
      return;
    }

    updatePath(
      connection.attemptId,
      (path) =>
        recordPathQuality(path, {
          latencyMs: telemetry.smoothed_latency_ms ?? telemetry.latency_ms,
          jitterMs: telemetry.jitter_ms ?? null,
          qualityScore: telemetry.quality_score ?? null,
          qualityConfidence: telemetry.quality_confidence ?? null,
          uploadLimited: telemetry.upload_limited ?? false,
          countryCode: telemetry.country_code,
        }),
      selectionForAttempt(connection.attemptId),
    );
  };

  const maybeRecordProbeFailure = () => {
    const connection = useConnectionStore.getState();
    const telemetry = useTelemetryStore.getState().snapshot;
    const probeFailures = telemetry.probe_failures ?? 0;
    const sampleAt = telemetry.sampled_at_ms ?? 0;
    const nativeCounterAdvanced = probeFailures > lastProbeFailureCount;
    const androidProbeAdvanced =
      isAndroid && telemetryProvesFailure(telemetry) && sampleAt > lastProbeFailureSampleAt;

    if (
      connection.attemptId <= 0 ||
      stableSessionKey(connection.status, connection.attemptId) == null ||
      !telemetryProvesFailure(telemetry) ||
      (!nativeCounterAdvanced && !androidProbeAdvanced)
    ) {
      return;
    }

    lastProbeFailureCount = Math.max(lastProbeFailureCount, probeFailures);
    lastProbeFailureSampleAt = Math.max(lastProbeFailureSampleAt, sampleAt);
    updatePath(
      connection.attemptId,
      (path) =>
        recordPathFailure(path, {
          qualityScore: telemetry.quality_score ?? null,
          qualityConfidence: telemetry.quality_confidence ?? null,
        }),
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
      connection.attemptId,
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
      lastProbeFailureSampleAt = 0;
      lastSuccessSession = null;
      errorStateRecorded = false;
      void refreshPathNetworkContext();
    }

    if (
      state.status.state !== previous.status.state ||
      state.runtimePathAttemptId !== previous.runtimePathAttemptId ||
      state.runtimePath !== previous.runtimePath
    ) {
      if (state.status.state !== "Error") errorStateRecorded = false;
      maybeRecordSuccess();
      maybeRefreshQuality();
      maybeRecordProbeFailure();
      maybeRecordFailure();
    }
  });

  const unsubscribeTelemetry = useTelemetryStore.subscribe((state, previous) => {
    const healthChanged =
      state.snapshot.egress_probe_complete !== previous.snapshot.egress_probe_complete ||
      state.snapshot.path_health !== previous.snapshot.path_health ||
      state.snapshot.probe_failures !== previous.snapshot.probe_failures ||
      state.snapshot.sampled_at_ms !== previous.snapshot.sampled_at_ms;
    const qualityChanged =
      state.snapshot.smoothed_latency_ms !== previous.snapshot.smoothed_latency_ms ||
      state.snapshot.jitter_ms !== previous.snapshot.jitter_ms ||
      state.snapshot.quality_score !== previous.snapshot.quality_score ||
      state.snapshot.quality_confidence !== previous.snapshot.quality_confidence ||
      state.snapshot.capacity_probe_complete !== previous.snapshot.capacity_probe_complete ||
      state.snapshot.download_kbps !== previous.snapshot.download_kbps ||
      state.snapshot.upload_kbps !== previous.snapshot.upload_kbps ||
      state.snapshot.upload_limited !== previous.snapshot.upload_limited;

    if (healthChanged || qualityChanged) {
      maybeRecordSuccess();
      if (qualityChanged) maybeRefreshQuality();
      maybeRecordProbeFailure();
    }
  });

  maybeRecordSuccess();
  maybeRefreshQuality();
  maybeRecordProbeFailure();
  maybeRecordFailure();

  return () => {
    disposed = true;
    scopeEpoch += 1;
    unlistenPath?.();
    unsubscribeConnection();
    unsubscribeTelemetry();
  };
}
