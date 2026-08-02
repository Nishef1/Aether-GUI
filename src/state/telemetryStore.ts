import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
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

export async function initTelemetryListeners(): Promise<() => void> {
  const unlisten = await listen<RuntimeTelemetry>("aether://telemetry", (event) => {
    useTelemetryStore.setState({ snapshot: event.payload });
  });
  await useTelemetryStore.getState().refresh();
  return unlisten;
}
