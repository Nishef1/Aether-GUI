import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { create } from "zustand"
import type { RuntimeTelemetry } from "@/types/connection"

const EMPTY_TELEMETRY: RuntimeTelemetry = {
  received_bytes: 0,
  sent_bytes: 0,
  public_ip: null,
  country_code: null,
  latency_ms: null,
  sampled_at_ms: 0,
  egress_probe_complete: false,
}

interface TelemetryStore {
  snapshot: RuntimeTelemetry
  refresh: () => Promise<void>
}

function applyTelemetry(snapshot: RuntimeTelemetry): void {
  useTelemetryStore.setState({ snapshot })
}

export const useTelemetryStore = create<TelemetryStore>(() => ({
  snapshot: EMPTY_TELEMETRY,
  refresh: async () => {
    try {
      applyTelemetry(await invoke<RuntimeTelemetry>("get_runtime_telemetry"))
    } catch {
      // Telemetry is supplementary and must never affect connectivity.
    }
  },
}))

let runtimeInit: Promise<void> | null = null
let disposeRuntime: (() => void) | null = null

async function initializeTelemetryRuntime(): Promise<void> {
  const [unlistenTelemetry, unlistenFocus] = await Promise.all([
    listen<RuntimeTelemetry>("aether://telemetry", (event) => {
      applyTelemetry(event.payload)
    }),
    listen<boolean>("app://focused", (event) => {
      if (event.payload) {
        // WebView timers and event dispatch can be throttled while minimized.
        // Pull the native snapshot immediately when the window returns.
        void useTelemetryStore.getState().refresh()
      }
    }),
  ])

  disposeRuntime = () => {
    unlistenTelemetry()
    unlistenFocus()
  }

  await useTelemetryStore.getState().refresh()
}

export async function initTelemetryListeners(): Promise<void> {
  runtimeInit ??= initializeTelemetryRuntime().catch(() => {
    runtimeInit = null
  })
  await runtimeInit
}

void initTelemetryListeners()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeRuntime?.()
    disposeRuntime = null
    runtimeInit = null
  })
}
