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

function normalizeTelemetry(snapshot: RuntimeTelemetry): RuntimeTelemetry {
  return {
    ...snapshot,
    path_health: snapshot.path_health ?? "unknown",
    tunnel_validation: snapshot.tunnel_validation ?? "unknown",
    probe_failures: snapshot.probe_failures ?? 0,
    smoothed_latency_ms: snapshot.smoothed_latency_ms ?? null,
    jitter_ms: snapshot.jitter_ms ?? null,
    quality_score: snapshot.quality_score ?? 0,
    quality_confidence: snapshot.quality_confidence ?? 0,
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
    (left.quality_confidence ?? 0) === (right.quality_confidence ?? 0)
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
    useConnectionStore.setState((state) => ({
      status: { state: "Launching" },
      accessCodeRequired: false,
      attemptId: state.attemptId + 1,
    }));
    await invoke("connect", { profileOverride: rerollProfile });
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
    if (state.status.state === previous.status.state) return;

    if (isStableConnected()) {
      evaluateExitPolicy(useTelemetryStore.getState().snapshot);
    }

    if (!isAndroid) return;

    if (shouldClearTelemetryOnDisconnect(isConnected())) {
      clearTelemetry();
    }
    restartSchedule(isConnected() && document.visibilityState === "visible");
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
