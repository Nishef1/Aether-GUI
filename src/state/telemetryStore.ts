import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { EXIT_RETRY_LIMIT, isPrivacyPreferredExit } from "@/lib/exitPolicy";
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
};

const REROLL_STOP_TIMEOUT_MS = 8_000;
const REROLL_STATUS_POLL_MS = 200;

interface TelemetryStore {
  snapshot: RuntimeTelemetry;
  refresh: () => Promise<void>;
  retryPrivacyExit: () => void;
}

function isConnected(): boolean {
  const state = useConnectionStore.getState().status.state;
  return state === "Connected" || state === "StartingTunnel" || state === "Tunneling";
}

function isStableConnected(): boolean {
  const state = useConnectionStore.getState().status.state;
  return state === "Connected" || state === "Tunneling";
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
      useConnectionStore.setState({ status });
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

    const profile = useConnectionStore.getState().profile;
    // A privacy reroll must perform fresh discovery. Reusing the previous quick
    // route can deterministically reproduce the same WARP egress.
    const rerollProfile = { ...profile, quick_reconnect: false };
    useTelemetryStore.setState({ snapshot: { ...EMPTY_TELEMETRY } });
    useConnectionStore.setState((state) => ({
      status: { state: "Launching" },
      logs: [],
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

export const useTelemetryStore = create<TelemetryStore>((set) => ({
  snapshot: { ...EMPTY_TELEMETRY },
  refresh: async () => {
    try {
      const snapshot = await invoke<RuntimeTelemetry>("get_runtime_telemetry");
      set({ snapshot });
      evaluateExitPolicy(snapshot);
    } catch {
      // Telemetry is supplementary and must never affect basic connectivity.
    }
  },
  retryPrivacyExit: () => {
    const policy = useExitPolicyStore.getState();
    if (policy.preference !== "privacy" || !isStableConnected()) return;
    policy.beginManualAttempt();
    const epoch = useExitPolicyStore.getState().beginReroll();
    if (epoch != null) void rerollPrivacyExit(epoch);
  },
}));

export async function initTelemetryListeners(): Promise<() => void> {
  const unlisten = await listen<RuntimeTelemetry>("aether://telemetry", (event) => {
    useTelemetryStore.setState({ snapshot: event.payload });
    evaluateExitPolicy(event.payload);
  });
  await useTelemetryStore.getState().refresh();

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (!isAndroid || disposed || document.visibilityState !== "visible" || !isConnected()) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      if (disposed || document.visibilityState !== "visible" || !isConnected()) return;
      await useTelemetryStore.getState().refresh();
      schedule();
    }, 2_000);
  };

  const visibilityChanged = () => {
    if (!isAndroid) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (document.visibilityState === "visible") {
      void useTelemetryStore.getState().refresh();
      schedule();
    }
  };

  const unsubscribeConnection = useConnectionStore.subscribe((state, previous) => {
    if (state.status.state !== previous.status.state) {
      if (isStableConnected()) evaluateExitPolicy(useTelemetryStore.getState().snapshot);
    }

    if (!isAndroid || state.status.state === previous.status.state) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (isConnected() && document.visibilityState === "visible") {
      void useTelemetryStore.getState().refresh();
      schedule();
    } else if (!isConnected()) {
      useTelemetryStore.setState({ snapshot: { ...EMPTY_TELEMETRY } });
    }
  });

  if (isAndroid) {
    document.addEventListener("visibilitychange", visibilityChanged);
    schedule();
  }

  return () => {
    disposed = true;
    unlisten();
    unsubscribeConnection();
    if (timer !== null) clearTimeout(timer);
    if (isAndroid) document.removeEventListener("visibilitychange", visibilityChanged);
  };
}
