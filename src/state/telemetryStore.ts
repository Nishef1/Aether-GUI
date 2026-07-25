import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { create } from "zustand"
import type { ConnectionStatus, RuntimeTelemetry } from "@/types/connection"

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
  reset: () => void
}

function freshEmptyTelemetry(): RuntimeTelemetry {
  return { ...EMPTY_TELEMETRY }
}

function applyTelemetry(snapshot: RuntimeTelemetry): void {
  useTelemetryStore.setState({ snapshot })
}

export const useTelemetryStore = create<TelemetryStore>(() => ({
  snapshot: freshEmptyTelemetry(),
  refresh: async () => {
    try {
      applyTelemetry(await invoke<RuntimeTelemetry>("get_runtime_telemetry"))
    } catch {
      // Telemetry is supplementary and must never affect connectivity.
    }
  },
  reset: () => applyTelemetry(freshEmptyTelemetry()),
}))

let runtimeInit: Promise<void> | null = null
let disposeRuntime: (() => void) | null = null

async function initializeTelemetryRuntime(): Promise<void> {
  const unlisteners: Array<() => void> = []
  try {
    unlisteners.push(
      await listen<RuntimeTelemetry>("aether://telemetry", (event) => {
        applyTelemetry(event.payload)
      })
    )
    unlisteners.push(
      await listen<ConnectionStatus>("aether://status", (event) => {
        if (
          event.payload.state !== "Connected" &&
          event.payload.state !== "Tunneling"
        ) {
          // The native watcher resets shortly after a new connection reaches its
          // ready state. Clearing earlier prevents the previous session's exit IP,
          // country, latency, or byte totals from flashing during reconnect/startup.
          useTelemetryStore.getState().reset()
        }
      })
    )
    unlisteners.push(
      await listen<boolean>("app://focused", (event) => {
        if (event.payload) {
          // WebView timers and event dispatch can be throttled while minimized.
          // Pull the native snapshot immediately when the window returns.
          void useTelemetryStore.getState().refresh()
        }
      })
    )
  } catch (error) {
    unlisteners.forEach((unlisten) => unlisten())
    throw error
  }

  disposeRuntime = () => {
    unlisteners.forEach((unlisten) => unlisten())
  }

  await useTelemetryStore.getState().refresh()
}

export async function initTelemetryListeners(): Promise<void> {
  runtimeInit ??= initializeTelemetryRuntime().catch((error) => {
    runtimeInit = null
    console.error("Failed to initialize telemetry runtime:", error)
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
