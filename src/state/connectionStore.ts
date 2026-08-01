import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { isAndroid } from "@/lib/platform"
import { useCoreStore } from "@/state/coreStore"
import type {
  ConnectionMode,
  ConnectionProfile,
  ConnectionStatus,
  LogLine,
  MasqueNoize,
  TrafficStats,
  TunEngine,
  WgNoize,
} from "@/types/connection"

const MAX_LOG_LINES = 400
const MAX_PENDING_LOG_LINES = 800
const LOG_FLUSH_INTERVAL_MS = 180
const LOGGING_PREFERENCE_KEY = "aether.live-logs.enabled"
const ANDROID_RUNTIME_POLL_CONNECTING_MS = 750
const ANDROID_RUNTIME_POLL_ACTIVE_MS = 1_500
const ANDROID_RUNTIME_POLL_IDLE_MS = 5_000
const ANDROID_RUNTIME_POLL_HIDDEN_MS = 15_000

let profileSaveQueue: Promise<void> = Promise.resolve()
let profileSaveRevision = 0
let connectionOperationRevision = 0
let awaitingAndroidFreshStatus = false

interface AndroidNativeLogEntry {
  id: number
  timestamp: number
  line: string
}

interface AndroidNativeLogBatch {
  entries: AndroidNativeLogEntry[]
  last_id: number
}

function readLoggingPreference(): boolean {
  try {
    return localStorage.getItem(LOGGING_PREFERENCE_KEY) === "true"
  } catch {
    return false
  }
}

function persistLoggingPreference(enabled: boolean): void {
  try {
    localStorage.setItem(LOGGING_PREFERENCE_KEY, String(enabled))
  } catch {
    // The preference is optional; private WebViews may reject local storage.
  }
}

async function syncAndroidLogging(enabled: boolean): Promise<void> {
  if (!isAndroid) return
  await invoke<boolean>("set_android_logging_enabled", { enabled })
}

function saveDefaultProfile(profile: ConnectionProfile): Promise<void> {
  const request = profileSaveQueue.then(() =>
    invoke<void>("set_default_profile", { profile })
  )
  profileSaveQueue = request.catch((error) => {
    console.error("Failed to save connection profile:", error)
  })
  return request
}

function syncTrayState(state: ConnectionStatus["state"]): void {
  void invoke("sync_tray_state", { state }).catch(() => {
    // Tray visuals are supplementary and must never affect connectivity.
  })
}

function sameStatus(left: ConnectionStatus, right: ConnectionStatus): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function androidAutoProfile(profile: ConnectionProfile): ConnectionProfile {
  if (!isAndroid || profile.protocol !== "auto") return profile
  return {
    ...profile,
    masque_http2: true,
  }
}

interface ConnectionState {
  status: ConnectionStatus
  profile: ConnectionProfile
  profileSaveError: string | null
  traffic: TrafficStats
  trafficBaseline: TrafficStats | null
  trafficSessionStarted: boolean
  preparingCores: boolean
  logs: LogLine[]
  loggingEnabled: boolean
  sidecarError: string | null
  scanBudgetSecs: number | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  setProtocol: (protocol: ConnectionProfile["protocol"]) => void
  setScanMode: (scan_mode: ConnectionProfile["scan_mode"]) => void
  setIpVersion: (ip_version: ConnectionProfile["ip_version"]) => void
  setConnectionMode: (connection_mode: ConnectionMode) => Promise<void>
  setTunEngine: (tun_engine: TunEngine) => void
  refreshTraffic: () => Promise<void>
  setQuickReconnect: (quick_reconnect: boolean) => void
  setMasqueHttp2: (masque_http2: boolean) => void
  setMasqueNoize: (masque_noize: MasqueNoize) => void
  setWgNoize: (wg_noize: WgNoize) => void
  setDnsServer: (dns_server: string) => void
  setBindAddress: (bind_address: string) => void
  setWebrtcLeakProtection: (enabled: boolean) => void
  setLoggingEnabled: (enabled: boolean) => Promise<void>
  retryAfterSidecarError: () => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => {
  const updateProfile = (
    patch: Partial<ConnectionProfile>
  ): Promise<void> => {
    const revision = ++profileSaveRevision
    const profile = androidAutoProfile({ ...get().profile, ...patch })
    set({ profile, profileSaveError: null })

    return saveDefaultProfile(profile)
      .then(() => {
        if (revision === profileSaveRevision) {
          set({ profileSaveError: null })
        }
      })
      .catch((error) => {
        const message = String(error)
        if (revision === profileSaveRevision) {
          set({ profileSaveError: message })
        }
        appendRuntimeLog(`[error:saving-profile] ${message}`)
        throw error
      })
  }

  const updateProfileQuietly = (patch: Partial<ConnectionProfile>): void => {
    void updateProfile(patch).catch(() => {
      // updateProfile records the error for inline Settings feedback and logs.
    })
  }

  return {
    status: { state: "Idle" },
    profile: {
      protocol: "auto",
      scan_mode: "balanced",
      ip_version: "v4",
      connection_mode: "proxy",
      tun_engine: "xray",
      quick_reconnect: false,
      masque_http2: true,
      masque_noize: "firewall",
      wg_noize: "balanced",
      dns_server: "1.1.1.1",
      bind_address: "127.0.0.1:1819",
      webrtc_leak_protection: false,
    },
    profileSaveError: null,
    logs: [],
    loggingEnabled: readLoggingPreference(),
    sidecarError: null,
    scanBudgetSecs: null,
    traffic: { received_bytes: 0, sent_bytes: 0 },
    trafficBaseline: null,
    trafficSessionStarted: false,
    preparingCores: false,

    connect: async () => {
      const operation = ++connectionOperationRevision
      awaitingAndroidFreshStatus = isAndroid
      set({
        traffic: { received_bytes: 0, sent_bytes: 0 },
        trafficBaseline: null,
        trafficSessionStarted: true,
        preparingCores: !isAndroid,
        status: { state: "Launching" },
      })
      try {
        await profileSaveQueue
        if (!isAndroid) {
          await useCoreStore.getState().loadAll()
        } else {
          await syncAndroidLogging(get().loggingEnabled)
        }
        if (operation !== connectionOperationRevision) return

        set({ preparingCores: false })
        await invoke("connect", { profileOverride: androidAutoProfile(get().profile) })
      } catch (e) {
        if (operation !== connectionOperationRevision) return
        awaitingAndroidFreshStatus = false
        const message = String(e)
        const lower = message.toLowerCase()

        if (lower.includes("administrator privileges are required")) {
          try {
            await invoke("elevate")
          } catch (elevationError) {
            const elevationMessage = String(elevationError)
            set({
              status: {
                state: "Error",
                message: elevationMessage,
                phase: "elevation",
              },
            })
            appendRuntimeLog(`[error:elevation] ${elevationMessage}`)
            syncTrayState("Error")
          }
          return
        }

        if (lower.includes("binary not found")) {
          set({ sidecarError: message })
          appendRuntimeLog(`[error:core] ${message}`)
        } else {
          set({ status: { state: "Error", message, phase: "launching" } })
          appendRuntimeLog(`[error:launching] ${message}`)
          syncTrayState("Error")
        }
      } finally {
        if (operation === connectionOperationRevision) {
          set({ preparingCores: false })
        }
      }
    },

    disconnect: async () => {
      ++connectionOperationRevision
      awaitingAndroidFreshStatus = false
      set({ preparingCores: false, status: { state: "Disconnecting" } })
      try {
        await invoke("disconnect")
      } catch (error) {
        const message = String(error)
        if (!message.toLowerCase().includes("no active connection")) {
          appendRuntimeLog(`[error:disconnecting] ${message}`)
        }
      }
    },

    setProtocol: (protocol) => updateProfileQuietly({ protocol }),
    setScanMode: (scan_mode) => updateProfileQuietly({ scan_mode }),
    setIpVersion: (ip_version) => updateProfileQuietly({ ip_version }),
    setConnectionMode: async (connection_mode) => {
      if (get().profile.connection_mode === connection_mode) return
      try {
        await updateProfile({ connection_mode })
      } catch {
        // Inline profile error already recorded.
      }
    },
    setTunEngine: (tun_engine) => updateProfileQuietly({ tun_engine }),

    refreshTraffic: async () => {
      try {
        const current = await invoke<TrafficStats>("get_traffic")
        useConnectionStore.setState((state) => {
          const baseline = state.trafficBaseline ?? current
          return {
            trafficBaseline: baseline,
            traffic: {
              received_bytes: Math.max(
                0,
                current.received_bytes - baseline.received_bytes
              ),
              sent_bytes: Math.max(0, current.sent_bytes - baseline.sent_bytes),
            },
          }
        })
      } catch {
        // Traffic counters are supplementary and must not affect connectivity.
      }
    },
    setQuickReconnect: (quick_reconnect) =>
      updateProfileQuietly({ quick_reconnect }),
    setMasqueHttp2: (masque_http2) => updateProfileQuietly({ masque_http2 }),
    setMasqueNoize: (masque_noize) => updateProfileQuietly({ masque_noize }),
    setWgNoize: (wg_noize) => updateProfileQuietly({ wg_noize }),
    setDnsServer: (dns_server) => updateProfileQuietly({ dns_server }),
    setBindAddress: (bind_address) => updateProfileQuietly({ bind_address }),
    setWebrtcLeakProtection: (webrtc_leak_protection) =>
      updateProfileQuietly({ webrtc_leak_protection }),
    setLoggingEnabled: async (enabled) => {
      const previous = get().loggingEnabled
      set({ loggingEnabled: enabled, ...(enabled ? {} : { logs: [] }) })
      persistLoggingPreference(enabled)
      try {
        await syncAndroidLogging(enabled)
      } catch (error) {
        set({ loggingEnabled: previous })
        persistLoggingPreference(previous)
        throw error
      }
    },
    retryAfterSidecarError: () => set({ sidecarError: null }),
  }
})

function appendRuntimeLog(line: string, timestamp = Date.now()): void {
  if (!useConnectionStore.getState().loggingEnabled) return

  useConnectionStore.setState((state) => {
    if (state.logs.at(-1)?.line === line) return state
    return {
      logs: [...state.logs, { line, timestamp }].slice(-MAX_LOG_LINES),
    }
  })
}

if (import.meta.env.DEV) {
  ;(window as unknown as { __conn?: typeof useConnectionStore }).__conn =
    useConnectionStore
}

const BUDGET_RE = /budget=(\d+)s/
let connectionRuntimeInit: Promise<void> | null = null
let disposeConnectionRuntime: (() => void) | null = null

async function initializeConnectionRuntime(): Promise<void> {
  let pendingLogs: LogLine[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let androidPollTimer: ReturnType<typeof setTimeout> | null = null
  let androidPollInFlight = false
  let androidPollingStopped = false
  let lastAndroidLogId = 0
  let statusEventReceived = false
  const unlisteners: Array<() => void> = []

  const flushLogs = () => {
    flushTimer = null
    if (!useConnectionStore.getState().loggingEnabled) {
      pendingLogs = []
      return
    }
    if (pendingLogs.length === 0) return

    const batch = pendingLogs.slice(-MAX_PENDING_LOG_LINES)
    pendingLogs = []
    let budget: number | null = null
    for (const log of batch) {
      const match = BUDGET_RE.exec(log.line)
      if (match) budget = Number(match[1])
    }
    useConnectionStore.setState((state) => ({
      logs: [...state.logs, ...batch].slice(-MAX_LOG_LINES),
      ...(budget !== null ? { scanBudgetSecs: budget } : {}),
    }))
  }

  const queueLogs = (logs: LogLine[]) => {
    if (!useConnectionStore.getState().loggingEnabled || logs.length === 0) return
    pendingLogs.push(...logs)
    if (pendingLogs.length > MAX_PENDING_LOG_LINES * 2) {
      pendingLogs = pendingLogs.slice(-MAX_PENDING_LOG_LINES)
    }
    flushTimer ??= setTimeout(flushLogs, LOG_FLUSH_INTERVAL_MS)
  }

  const applyStatus = (
    status: ConnectionStatus,
    source: "event" | "android-poll" = "event"
  ) => {
    // A pending Android poll can return the preceding session's Connected
    // snapshot after the user has tapped Connect again. Wait until the native
    // service itself reports a new startup phase before accepting a terminal
    // snapshot, avoiding a one-frame Disconnect/Connected button flicker.
    if (isAndroid && awaitingAndroidFreshStatus && source === "android-poll") {
      if (
        status.state === "Launching" ||
        status.state === "Connecting" ||
        status.state === "StartingTunnel" ||
        status.state === "Reconnecting" ||
        status.state === "Error"
      ) {
        awaitingAndroidFreshStatus = false
      } else {
        return
      }
    }

    const current = useConnectionStore.getState().status
    if (!sameStatus(current, status)) {
      useConnectionStore.setState({
        status,
        ...(status.state === "Launching" ? { scanBudgetSecs: null } : {}),
      })
      if (status.state === "Error") {
        appendRuntimeLog(`[error:${status.phase}] ${status.message}`)
      }
      syncTrayState(status.state)
    }
  }

  const pollAndroidRuntime = async () => {
    if (!isAndroid || androidPollInFlight || androidPollingStopped) return
    androidPollInFlight = true
    try {
      const loggingEnabled = useConnectionStore.getState().loggingEnabled
      const statusPromise = invoke<ConnectionStatus>("get_status")
      const logsPromise = loggingEnabled
        ? invoke<AndroidNativeLogBatch>("get_android_logs", {
            afterId: lastAndroidLogId,
          })
        : Promise.resolve<AndroidNativeLogBatch | null>(null)
      const [status, nativeLogs] = await Promise.all([statusPromise, logsPromise])

      applyStatus(status, "android-poll")
      if (nativeLogs?.entries.length) {
        lastAndroidLogId = Math.max(lastAndroidLogId, nativeLogs.last_id)
        queueLogs(
          nativeLogs.entries.map((entry) => ({
            line: `[native] ${entry.line}`,
            timestamp: entry.timestamp,
          }))
        )
      }
    } catch (error) {
      appendRuntimeLog(`[error:android-runtime-poll] ${String(error)}`)
    } finally {
      androidPollInFlight = false
    }
  }

  const androidPollDelay = (): number => {
    if (typeof document !== "undefined" && document.hidden) {
      return ANDROID_RUNTIME_POLL_HIDDEN_MS
    }
    switch (useConnectionStore.getState().status.state) {
      case "Launching":
      case "Connecting":
      case "StartingTunnel":
      case "Reconnecting":
      case "Disconnecting":
        return ANDROID_RUNTIME_POLL_CONNECTING_MS
      case "Connected":
      case "Tunneling":
        return ANDROID_RUNTIME_POLL_ACTIVE_MS
      default:
        return ANDROID_RUNTIME_POLL_IDLE_MS
    }
  }

  const scheduleAndroidPoll = (delay = androidPollDelay()) => {
    if (!isAndroid || androidPollingStopped) return
    if (androidPollTimer !== null) clearTimeout(androidPollTimer)
    androidPollTimer = setTimeout(async () => {
      androidPollTimer = null
      await pollAndroidRuntime()
      scheduleAndroidPoll()
    }, delay)
  }

  try {
    unlisteners.push(
      await listen<ConnectionStatus>("aether://status", (event) => {
        statusEventReceived = true
        applyStatus(event.payload)
      })
    )
    unlisteners.push(
      await listen<LogLine>("aether://log", (event) => {
        queueLogs([event.payload])
      })
    )

    if (isAndroid && typeof document !== "undefined") {
      const handleVisibility = () => {
        if (!document.hidden) scheduleAndroidPoll(0)
      }
      document.addEventListener("visibilitychange", handleVisibility)
      unlisteners.push(() =>
        document.removeEventListener("visibilitychange", handleVisibility)
      )
    }
  } catch (error) {
    unlisteners.forEach((unlisten) => unlisten())
    if (flushTimer !== null) clearTimeout(flushTimer)
    pendingLogs = []
    throw error
  }

  if (isAndroid) {
    await syncAndroidLogging(useConnectionStore.getState().loggingEnabled).catch(
      (error) => {
        console.error("Failed to apply Android logging preference:", error)
      }
    )
    await pollAndroidRuntime()
    scheduleAndroidPoll()
  }

  disposeConnectionRuntime = () => {
    androidPollingStopped = true
    unlisteners.forEach((unlisten) => unlisten())
    if (flushTimer !== null) clearTimeout(flushTimer)
    if (androidPollTimer !== null) clearTimeout(androidPollTimer)
    pendingLogs = []
  }

  const initialProfileRevision = profileSaveRevision
  const [status, profile, pendingElevationProfile] = await Promise.all([
    invoke<ConnectionStatus>("get_status").catch((error) => {
      appendRuntimeLog(`[error:reading-status] ${String(error)}`)
      return useConnectionStore.getState().status
    }),
    invoke<ConnectionProfile>("get_default_profile").catch((error) => {
      appendRuntimeLog(`[error:reading-profile] ${String(error)}`)
      return useConnectionStore.getState().profile
    }),
    invoke<ConnectionProfile | null>("take_pending_elevation_profile").catch(
      (error) => {
        appendRuntimeLog(`[error:reading-elevation-profile] ${String(error)}`)
        return null
      }
    ),
  ])

  const loadedProfile = {
    ...useConnectionStore.getState().profile,
    ...(pendingElevationProfile ?? profile),
  }
  const activeProfile = androidAutoProfile(loadedProfile)
  useConnectionStore.setState({
    ...(!statusEventReceived ? { status } : {}),
    ...(pendingElevationProfile || initialProfileRevision === profileSaveRevision
      ? { profile: activeProfile }
      : {}),
  })

  if (
    isAndroid &&
    loadedProfile.protocol === "auto" &&
    loadedProfile.masque_http2 !== activeProfile.masque_http2
  ) {
    void saveDefaultProfile(activeProfile).catch((error) => {
      appendRuntimeLog(`[error:migrating-android-auto-profile] ${String(error)}`)
    })
  }

  if (!statusEventReceived && status.state === "Error") {
    appendRuntimeLog(`[error:${status.phase}] ${status.message}`)
  }
  if (!statusEventReceived) syncTrayState(status.state)

  if (
    pendingElevationProfile &&
    useConnectionStore.getState().status.state === "Idle"
  ) {
    queueMicrotask(() => void useConnectionStore.getState().connect())
  }
}

export async function initConnectionListeners(): Promise<() => void> {
  connectionRuntimeInit ??= initializeConnectionRuntime().catch((error) => {
    connectionRuntimeInit = null
    console.error("Failed to initialize connection runtime:", error)
    appendRuntimeLog(`[error:runtime-init] ${String(error)}`)
  })
  await connectionRuntimeInit
  return () => {}
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeConnectionRuntime?.()
    disposeConnectionRuntime = null
    connectionRuntimeInit = null
  })
}
