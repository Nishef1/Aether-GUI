import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import { createObservedPath, rankPaths, type ObservedPath } from "@/lib/pathIntelligence";
import { useConnectionStore, type RuntimePathSelection } from "@/state/connectionStore";
import type { RuntimeTelemetry } from "@/state/telemetryStore";

const STORAGE_PREFIX = "aether.path-intelligence.v2";
const MAX_PATHS = 12;
const MIN_UPDATE_INTERVAL_MS = 1_000;

interface PathStore {
  paths: ObservedPath[];
  clear: () => void;
}

let activeNetworkKey: string | null = null;
let activeStorageKey: string | null = null;
let scopeEpoch = 0;
let lastOutcomeAttemptId = -1;
let lastQualityAttemptId = -1;
let lastFailureObservation = "";
let lastUpdateAt = 0;

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validPath(value: unknown): value is ObservedPath {
  if (value == null || typeof value !== "object") return false;
  const path = value as Partial<ObservedPath>;
  return (
    typeof path.id === "string" &&
    typeof path.protocol === "string" &&
    typeof path.endpoint === "string" &&
    typeof path.successes === "number" &&
    typeof path.failures === "number" &&
    typeof path.consecutiveFailures === "number" &&
    typeof path.confidence === "number" &&
    typeof path.updatedAt === "number"
  );
}

function normalizePath(path: ObservedPath): ObservedPath {
  const migrated = path as ObservedPath & {
    jitterMs?: number | null;
    qualityScore?: number | null;
    qualityConfidence?: number | null;
  };
  return {
    ...path,
    jitterMs: safeNumber(migrated.jitterMs),
    qualityScore: safeNumber(migrated.qualityScore),
    qualityConfidence: safeNumber(migrated.qualityConfidence),
  };
}

function loadPersistedPaths(storageKey: string): ObservedPath[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return rankPaths(parsed.filter(validPath).map(normalizePath)).slice(0, MAX_PATHS);
  } catch {
    return [];
  }
}

function persistPaths(paths: readonly ObservedPath[]): void {
  if (activeStorageKey == null) return;
  try {
    localStorage.setItem(activeStorageKey, JSON.stringify(paths.slice(0, MAX_PATHS)));
  } catch {
    // Ignore unavailable storage.
  }
}

function clearPersistedPathHistory(): void {
  if (activeStorageKey == null) return;
  try {
    localStorage.removeItem(activeStorageKey);
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
  mutator: (path: ObservedPath) => ObservedPath,
  selection?: RuntimePathSelection | null,
): void {
  const profile = useConnectionStore.getState().profile;
  const template = createObservedPath(profile, Date.now(), selection);
  const state = usePathStore.getState();
  const current = state.paths.find((path) => path.id === template.id) ?? template;
  const paths = replacePath(state.paths, mutator(current)).slice(0, MAX_PATHS);
  usePathStore.setState({ paths });
  persistPaths(paths);
}

export function observePathSuccess(
  telemetry: RuntimeTelemetry,
  selection?: RuntimePathSelection | null,
): void {
  if (activeStorageKey == null) return;
  const now = Date.now();
  if (now - lastUpdateAt < MIN_UPDATE_INTERVAL_MS) return;
  lastUpdateAt = now;
  const attemptId = useConnectionStore.getState().attemptId;
  if (attemptId !== lastOutcomeAttemptId) {
    lastOutcomeAttemptId = attemptId;
    lastFailureObservation = "";
    updatePath(
      (path) => ({
        ...path,
        successes: path.successes + 1,
        consecutiveFailures: 0,
        confidence: Math.min(100, path.confidence + 20),
        cooldownUntil: null,
        latencyMs: telemetry.latency_ms ?? path.latencyMs,
        jitterMs: telemetry.jitter_ms ?? path.jitterMs,
        qualityScore: telemetry.quality_score ?? path.qualityScore,
        qualityConfidence: telemetry.quality_confidence ?? path.qualityConfidence,
        updatedAt: now,
      }),
      selection,
    );
    lastQualityAttemptId = attemptId;
    return;
  }

  const hasQualityEvidence =
    telemetry.latency_ms != null ||
    telemetry.jitter_ms != null ||
    telemetry.quality_score != null ||
    telemetry.quality_confidence != null ||
    telemetry.download_kbps != null ||
    telemetry.upload_kbps != null ||
    telemetry.upload_limited === true;
  if (!hasQualityEvidence || attemptId === lastQualityAttemptId) return;

  lastQualityAttemptId = attemptId;
  updatePath(
    (path) => ({
      ...path,
      latencyMs: telemetry.latency_ms ?? path.latencyMs,
      jitterMs: telemetry.jitter_ms ?? path.jitterMs,
      qualityScore: telemetry.quality_score ?? path.qualityScore,
      qualityConfidence: telemetry.quality_confidence ?? path.qualityConfidence,
      updatedAt: now,
    }),
    selection,
  );
}

export function observePathFailure(
  message: string,
  selection?: RuntimePathSelection | null,
): void {
  if (activeStorageKey == null) return;
  const attemptId = useConnectionStore.getState().attemptId;
  const observation = `${attemptId}:${message}`;
  if (observation === lastFailureObservation) return;
  lastFailureObservation = observation;
  lastOutcomeAttemptId = attemptId;
  lastQualityAttemptId = -1;

  const now = Date.now();
  updatePath(
    (path) => {
      const failures = path.failures + 1;
      const consecutiveFailures = path.consecutiveFailures + 1;
      const cooldownMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(4, consecutiveFailures - 1));
      return {
        ...path,
        failures,
        consecutiveFailures,
        confidence: Math.max(0, path.confidence - 18),
        cooldownUntil: now + cooldownMs,
        updatedAt: now,
      };
    },
    selection,
  );
}
