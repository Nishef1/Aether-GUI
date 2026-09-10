import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { EXIT_RETRY_LIMIT, isPrivacyPreferredExit } from "@/lib/exitPolicy";
import { canCollectTelemetry, shouldClearTelemetryOnDisconnect } from "@/lib/telemetryLifecycle";
import { nextTelemetryDelay } from "@/lib/telemetryScheduler";
import { isAndroid } from "@/lib/platform";
import { useConnectionStore } from "@/state/connectionStore";
import { useExitPolicyStore } from "@/state/exitPolicyStore";
import type { ConnectionStatus, RuntimeTelemetry } from "@/types/connection";

const EMPTY_TELEMETRY: RuntimeTelemetry = {
  received_bytes: 0,
  sent_bytes: 0,
  public_ip: null,
  country_code: null,
  latency_ms: null,
  sampled_at_ms: 0,
  egress_probe_complete: false,
  path_health: "unknown",
  tunnel_validation: "unknown",
  probe_failures: 0,
  smoothed_latency_ms: null,
  jitter_ms: null,
  quality_score: 0,
  quality_confidence: 0,
  capacity_probe_complete: false,
  download_kbps: null,
  upload_kbps: null,
  upload_limited: false,
};

const REROLL_STOP_TIMEOUT_MS = 8_000;
const REROLL_STATUS_POLL_MS = 200;

interface TelemetryStore {
  snapshot: RuntimeTelemetry;
  refresh: () => Promise<void>;
  retryPrivacyExit: () => void;
}

let refreshInFlight: Promise<void> | null = null;

function isConnected(): boolean {
  const state = useConnectionStore.getState().status.state;
  return state === "Connected" || state === "StartingTunnel" || state === "Tunneling";
}

function isStableConnected(): boolean {
  const state = useConnectionStore.getState().status.state;
  return state === "Connected" || state === "Tunneling";
}

function androidCapacity() {
  if (!isAndroid) return null;
  const connection = useConnectionStore.getState();
  return connection.runtimeCapacityAttemptId === connection.attemptId
    ? connection.runtimeCapacity
    : null;
}

function inferredPathHealth(snapshot: RuntimeTelemetry): NonNullable<RuntimeTelemetry["path_health"]> {
  if (snapshot.path_health != null) return snapshot.path_health;
  if (!snapshot.egress_probe_complete) return "unknown";
  return snapshot.public_ip != null ? "healthy" : "suspect";
}

function inferredTunnelValidation(
  snapshot: RuntimeTelemetry,
  pathHealth: NonNullable<RuntimeTelemetry["path_health"]>,
): NonNullable<RuntimeTelemetry["tunnel_validation"]> {
  if (snapshot.tunnel_validation != null) return snapshot.tunnel_validation;
  if (!isAndroid) return "unknown";

  const status = useConnectionStore.getState().status.state;
  if (status === "StartingTunnel") return "pending";
  if (status !== "Tunneling") return "unknown";
  if (pathHealth === "failed") return "failed";
  if (pathHealth === "suspect") return "suspect";
  if (pathHealth !== "healthy") return "pending";

  return snapshot.received_bytes > 0 || snapshot.sent_bytes > 0 ? "healthy" : "pending";
}

function inferredQualityScore(
  health: NonNullable<RuntimeTelemetry["path_health"]>,
  latencyMs: number | null,
  uploadLimited: boolean,
): number {
  const base = health === "healthy" ? 100 : health === "suspect" ? 45 : health === "failed" ? 0 : 25;
  const latencyPenalty = latencyMs == null ? (health === "unknown" ? 20 : 0) : Math.min(35, Math.floor(latencyMs / 10));
  const uploadPenalty = uploadLimited ? 18 : 0;
  return Math.max(0, base - latencyPenalty - uploadPenalty);
}

function inferredQualityConfidence(
  health: NonNullable<RuntimeTelemetry["path_health"]>,
  capacityComplete: boolean,
): number {
  const base = (() => {
    switch (health) {
      case "healthy":
        return 60;
      case "suspect":
        return 36;
      case "failed":
        return 0;
      default:
        return 10;
    }
  })();
  return capacityComplete ? Math.min(100, base + 5) : base;
}

function normalizeTelemetry(snapshot: RuntimeTelemetry): RuntimeTelemetry {
  const pathHealth = inferredPathHealth(snapshot);
  const smoothedLatency = snapshot.smoothed_latency_ms ?? (isAndroid ? snapshot.latency_ms : null);
  const fallbackCapacity = androidCapacity();
  const capacityComplete = snapshot.capacity_probe_complete ?? (fallbackCapacity != null);
  const downloadKbps = snapshot.download_kbps ?? fallbackCapacity?.downloadKbps ?? null;
  const uploadKbps = snapshot.upload_kbps ?? fallbackCapacity?.uploadKbps ?? null;
  const uploadLimited = snapshot.upload_limited ?? fallbackCapacity?.uploadLimited ?? false;
  const qualityScore =
    snapshot.quality_score ??
    (isAndroid
      ? inferredQualityScore(pathHealth, smoothedLatency ?? snapshot.latency_ms, uploadLimited)
      : 0);
  const qualityConfidence =
    snapshot.quality_confidence ??
    (isAndroid ? inferredQualityConfidence(pathHealth, capacityComplete) : 0);

  return {
    ...snapshot,
    path_health: pathHealth,
    tunnel_validation: inferredTunnelValidation(snapshot, pathHealth),
    probe_failures:
      snapshot.probe_failures ??
      (isAndroid && (pathHealth === "suspect" || pathHealth === "failed") ? 1 : 0),
    smoothed_latency_ms: smoothedLatency,
    jitter_ms: snapshot.jitter_ms ?? null,
    quality_score: qualityScore,
    quality_confidence: qualityConfidence,
    capacity_probe_complete: capacityComplete,
    download_kbps: downloadKbps,
    upload_kbps: uploadKbps,
    upload_limited: uploadLimited,
  };
}

function telemetryEqual(left: RuntimeTelemetry, right: RuntimeTelemetry): boolean {
  return (
    left.received_bytes === right.received_bytes &&
    left.sent_bytes === right.sent_bytes &&
    left.public_ip === right.public_ip &&
    left.country_code === right.country_code &&
    left.latency_ms === right.latency_ms &&
    left.sampled_at_ms === right.sampled_at_ms &&
    left.egress_probe_complete === right.egress_probe_complete &&
    (left.path_health ?? "unknown") === (right.path_health ?? "unknown") &&
    (left.tunnel_validation ?? "unknown") === (right.tunnel_validation ?? "unknown") &&
    (left.probe_failures ?? 0) === (right.probe_failures ?? 0) &&
    (left.smoothed_latency_ms ?? null) === (right.smoothed_latency_ms ?? null) &&
    (left.jitter_ms ?? null) === (right.jitter_ms ?? null) &&
    (left.quality_score ?? 0) === (right.quality_score ?? 0) &&
    (left.quality_confidence ?? 0) === (right.quality_confidence ?? 0) &&
    (left.capacity_probe_complete ?? false) === (right.capacity_probe_complete ?? false) &&
    (left.download_kbps ?? null) === (right.download_kbps ?? null) &&
    (left.upload_kbps ?? null) === (right.upload_kbps ?? null) &&
    (left.upload_limited ?? false) === (right.upload_limited ?? false)
  );
}

function publishTelemetry(incoming: RuntimeTelemetry): void {
  const snapshot = normalizeTelemetry(incoming);
  const current = useTelemetryStore.getState().snapshot;
  if (!telemetryEqual(current, snapshot)) {
    useTelemetryStore.setState({ snapshot });
  }
  evaluateExitPolicy(snapshot);
}

function clearTelemetry(): void {
  const current = useTelemetryStore.getState().snapshot;
  if (!telemetryEqual(current, EMPTY_TELEMETRY)) {
    useTelemetryStore.setState({ snapshot: { ...EMPTY_TELEMETRY } });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTransportStop(epoch: number): Promise<boolean> {
  const deadline = Date.now() + REROLL_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const policy = useExitPolicyStore.getState();
    if (policy.automationEpoch !== epoch || policy.preference !== "privacy") return false;

    try {
      const status = await invoke<ConnectionStatus>("get_status");
      const currentStatus = useConnectionStore.getState().status;
      if (currentStatus.state !== status.state) {
        useConnectionStore.setState({ status });
      }
      if (status.state === "Idle" || status.state === "Error") return true;
    } catch {
      // Native disconnect can briefly cross a lifecycle boundary. Retry until timeout.
    }
    await sleep(REROLL_STATUS_POLL_MS);
  }
  return false;
}

async function rerollPrivacyExit(epoch: number): Promise<void> {
  try {
    await invoke("disconnect").catch(() => undefined);
    if (!(await waitForTransportStop(epoch))) return;

    const policy = useExitPolicyStore.getState();
    if (policy.automationEpoch !== epoch || policy.preference !== "privacy") return;

    const connection = useConnectionStore.getState();
    const rerollProfile = { ...connection.profile, quick_reconnect: false };
    connection.clearLogs();
    clearTelemetry();

    // Load after the stores have completed module initialization. autoConnect
    // depends on pathStore, which in turn consumes telemetryStore; a static
    // import here would create a fragile initialization cycle.
    const { connectWithAutomaticPolicy } = await import("@/lib/autoConnect");
    await connectWithAutomaticPolicy(rerollProfile);
  } catch (error) {
    const policy = useExitPolicyStore.getState();
    if (policy.automationEpoch === epoch && policy.preference === "privacy") {
      useConnectionStore.setState({
        status: {
          state: "Error",
          message: `Privacy reroute failed: ${String(error)}`,
          phase: "privacy-reroute",
        },
      });
    }
  } finally {
    const policy = useExitPolicyStore.getState();
    if (policy.automationEpoch === epoch) policy.finishReroll();
  }
}

function evaluateExitPolicy(snapshot: RuntimeTelemetry): void {
  const policy = useExitPolicyStore.getState();
  if (
    policy.preference !== "privacy" ||
    !snapshot.egress_probe_complete ||
    snapshot.path_health === "suspect" ||
    snapshot.path_health === "failed" ||
    !isStableConnected()
  ) {
    return;
  }

  const country = snapshot.country_code?.toUpperCase() ?? null;
  if (!country) return;

  if (isPrivacyPreferredExit(country)) {
    policy.markAccepted();
    return;
  }

  if (policy.retryCount >= EXIT_RETRY_LIMIT) {
    policy.markExhausted();
    return;
  }

  const epoch = policy.beginReroll();
  if (epoch != null) void rerollPrivacyExit(epoch);
}

async function refreshTelemetry(): Promise<void> {
  if (
    isAndroid &&
    !canCollectTelemetry({
      visible: document.visibilityState === "visible",
      connected: isConnected(),
    })
  ) {
    return;
  }

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const snapshot = await invoke<RuntimeTelemetry>("get_runtime_telemetry");
      publishTelemetry(snapshot);
    } catch {
      // Telemetry is supplementary and must never affect basic connectivity.
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export const useTelemetryStore = create<TelemetryStore>(() => ({
  snapshot: { ...EMPTY_TELEMETRY },
  refresh: refreshTelemetry,
  retryPrivacyExit: () => {
    const policy = useExitPolicyStore.getState();
    if (policy.preference !== "privacy" || !isStableConnected()) return;
    policy.beginManualAttempt();
    const epoch = useExitPolicyStore.getState().beginReroll();
    if (epoch != null) void rerollPrivacyExit(epoch);
  },
}));

export async function initTelemetryListeners(): Promise<() => void> {
  let lastEventAt = 0;
  const unlisten = await listen<RuntimeTelemetry>("aether://telemetry", (event) => {
    lastEventAt = Date.now();
    publishTelemetry(event.payload);
  });

  if (!isAndroid || document.visibilityState === "visible") {
    await useTelemetryStore.getState().refresh();
  }

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    if (!isAndroid || disposed || timer !== null) return;

    const delay = nextTelemetryDelay({
      visible: document.visibilityState === "visible",
      connected: isConnected(),
      probeComplete: useTelemetryStore.getState().snapshot.egress_probe_complete,
    });
    if (delay == null) return;

    timer = setTimeout(async () => {
      timer = null;
      if (disposed) return;

      const collect = canCollectTelemetry({
        visible: document.visibilityState === "visible",
        connected: isConnected(),
      });
      if (!collect) return;

      const eventIsFresh =
        lastEventAt > 0 && Date.now() - lastEventAt < Math.max(1_000, delay * 0.75);
      if (!eventIsFresh) {
        await useTelemetryStore.getState().refresh();
      }
      schedule();
    }, delay);
  };

  const restartSchedule = (refreshNow: boolean) => {
    cancelTimer();
    if (!isAndroid || disposed) return;

    const collect = canCollectTelemetry({
      visible: document.visibilityState === "visible",
      connected: isConnected(),
    });
    if (!collect) return;

    if (refreshNow) void useTelemetryStore.getState().refresh();
    schedule();
  };

  const visibilityChanged = () => {
    if (!isAndroid) return;
    restartSchedule(document.visibilityState === "visible");
  };

  const unsubscribeConnection = useConnectionStore.subscribe((state, previous) => {
    const statusChanged = state.status.state !== previous.status.state;
    const capacityChanged =
      state.runtimeCapacityAttemptId !== previous.runtimeCapacityAttemptId ||
      state.runtimeCapacity !== previous.runtimeCapacity;
    if (!statusChanged && !capacityChanged) return;

    if (statusChanged && isStableConnected()) {
      evaluateExitPolicy(useTelemetryStore.getState().snapshot);
    }

    if (!isAndroid) return;

    if (statusChanged && shouldClearTelemetryOnDisconnect(isConnected())) {
      clearTelemetry();
    }
    if (capacityChanged && document.visibilityState === "visible" && isConnected()) {
      void useTelemetryStore.getState().refresh();
    }
    if (statusChanged) {
      restartSchedule(isConnected() && document.visibilityState === "visible");
    }
  });

  if (isAndroid) {
    document.addEventListener("visibilitychange", visibilityChanged);
    schedule();
  }

  return () => {
    disposed = true;
    cancelTimer();
    unlisten();
    unsubscribeConnection();
    if (isAndroid) document.removeEventListener("visibilitychange", visibilityChanged);
  };
}
