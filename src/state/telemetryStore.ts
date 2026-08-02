import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { isAndroid } from "@/lib/platform";
import { useConnectionStore } from "@/state/connectionStore";
import type { RuntimeTelemetry } from "@/types/connection";

const EMPTY_TELEMETRY: RuntimeTelemetry = {
  received_bytes: 0,
  sent_bytes: 0,
  public_ip: null,
  country_code: null,
  latency_ms: null,
  sampled_at_ms: 0,
  egress_probe_complete: false,
};

interface TelemetryStore {
  snapshot: RuntimeTelemetry;
  refresh: () => Promise<void>;
}

export const useTelemetryStore = create<TelemetryStore>((set) => ({
  snapshot: { ...EMPTY_TELEMETRY },
  refresh: async () => {
    try {
      set({ snapshot: await invoke<RuntimeTelemetry>("get_runtime_telemetry") });
    } catch {
      // Telemetry is supplementary and must never affect connectivity.
    }
  },
}));

function isConnected(): boolean {
  const state = useConnectionStore.getState().status.state;
  return state === "Connected" || state === "StartingTunnel" || state === "Tunneling";
}

export async function initTelemetryListeners(): Promise<() => void> {
  const unlisten = await listen<RuntimeTelemetry>("aether://telemetry", (event) => {
    useTelemetryStore.setState({ snapshot: event.payload });
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
