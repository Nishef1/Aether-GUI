import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { create } from "zustand"
import { isAndroid } from "@/lib/platform"
import { useConnectionStore } from "@/state/connectionStore"
import type { ConnectionStatus, RuntimeTelemetry } from "@/types/connection"

const ANDROID_TELEMETRY_VISIBLE_MS = 2_500

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

function isConnected(status: ConnectionStatus): boolean {
  return status.state === "Connected" || status.state === "Tunneling"
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
  let androidTimer: ReturnType<typeof setTimeout> | null = null
  let androidConnected = isConnected(useConnectionStore.getState().status)
  let pageVisible = typeof document === "undefined" || !document.hidden

  const clearAndroidTimer = () => {
    if (androidTimer !== null) clearTimeout(androidTimer)
    androidTimer = null
  }

  const scheduleAndroidRefresh = (immediate = false) => {
    clearAndroidTimer()
    if (!isAndroid || !androidConnected || !pageVisible) return

    androidTimer = setTimeout(
      async () => {
        androidTimer = null
        await useTelemetryStore.getState().refresh()
        scheduleAndroidRefresh()
      },
      immediate ? 0 : ANDROID_TELEMETRY_VISIBLE_MS
    )
  }

  const applyConnectionState = (status: ConnectionStatus) => {
    const nextConnected = isConnected(status)
    if (nextConnected === androidConnected) return

    androidConnected = nextConnected
    if (!androidConnected) {
      useTelemetryStore.getState().reset()
      clearAndroidTimer()
    } else if (isAndroid) {
      // Android service state is reconciled by connectionStore polling. Native
      // status changes after Launching are not emitted as aether://status events,
      // so telemetry must follow that authoritative reconciled store instead.
      scheduleAndroidRefresh(true)
    }
  }

  const refreshAfterFocus = (focused: boolean) => {
    if (!focused) return
    pageVisible = true
    if (!isAndroid || androidConnected) {
      void useTelemetryStore.getState().refresh()
    }
    scheduleAndroidRefresh()
  }

  try {
    unlisteners.push(
      await listen<RuntimeTelemetry>("aether://telemetry", (event) => {
        applyTelemetry(event.payload)
      })
    )

    if (isAndroid) {
      unlisteners.push(
        useConnectionStore.subscribe((state) => {
          applyConnectionState(state.status)
        })
      )
    } else {
      unlisteners.push(
        await listen<ConnectionStatus>("aether://status", (event) => {
          applyConnectionState(event.payload)
        })
      )
    }

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

    if (typeof document !== "undefined") {
      const handleVisibility = () => {
        pageVisible = !document.hidden
        if (!pageVisible) {
          clearAndroidTimer()
        } else {
          scheduleAndroidRefresh(true)
        }
      }
      document.addEventListener("visibilitychange", handleVisibility)
      unlisteners.push(() =>
        document.removeEventListener("visibilitychange", handleVisibility)
      )
    }
  } catch (error) {
    unlisteners.forEach((unlisten) => unlisten())
    clearAndroidTimer()
    throw error
  }

  if (isAndroid) {
    const nativeStatus = await invoke<ConnectionStatus>("get_status").catch(() => null)
    androidConnected =
      isConnected(useConnectionStore.getState().status) ||
      (nativeStatus !== null && isConnected(nativeStatus))
  }

  await useTelemetryStore.getState().refresh()
  scheduleAndroidRefresh()

  disposeRuntime = () => {
    unlisteners.forEach((unlisten) => unlisten())
    clearAndroidTimer()
  }
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
