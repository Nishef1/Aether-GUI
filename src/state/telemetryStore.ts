import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { create } from "zustand"
import { isAndroid } from "@/lib/platform"
import type { ConnectionStatus, RuntimeTelemetry } from "@/types/connection"

const ANDROID_TELEMETRY_POLL_MS = 1000

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

function refreshAfterFocus(focused: boolean): void {
  if (focused) void useTelemetryStore.getState().refresh()
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
  let androidTimer: ReturnType<typeof setInterval> | null = null
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
          useTelemetryStore.getState().reset()
        } else if (isAndroid) {
          void useTelemetryStore.getState().refresh()
        }
      })
    )
    unlisteners.push(
      await listen<boolean>("app://focused", (event) => {
        refreshAfterFocus(event.payload)
      })
    )
    unlisteners.push(
      await getCurrentWindow().onFocusChanged(({ payload }) => {
        refreshAfterFocus(payload)
      })
    )
  } catch (error) {
    unlisteners.forEach((unlisten) => unlisten())
    throw error
  }

  if (isAndroid) {
    androidTimer = setInterval(
      () => void useTelemetryStore.getState().refresh(),
      ANDROID_TELEMETRY_POLL_MS
    )
  }

  disposeRuntime = () => {
    unlisteners.forEach((unlisten) => unlisten())
    if (androidTimer !== null) clearInterval(androidTimer)
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
