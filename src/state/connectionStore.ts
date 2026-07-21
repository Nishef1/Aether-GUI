import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useCoreStore } from "@/state/coreStore"
import type {
  ConnectionMode,
  ConnectionProfile,
  ConnectionStatus,
  LogLine,
  MasqueNoize,
  TrafficStats,
  WgNoize,
} from "@/types/connection"

const MAX_LOG_LINES = 200
const MAX_PENDING_LOG_LINES = 400
const LOG_FLUSH_INTERVAL_MS = 250

// Tauri commands are asynchronous, so rapid consecutive changes (for example
// selecting a protocol and then an IP version) must be written in order. Keep
// the last confirmed profile on disk instead of letting slower requests win.
let profileSaveQueue: Promise<void> = Promise.resolve()

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

interface ConnectionState {
  status: ConnectionStatus
  profile: ConnectionProfile
  traffic: TrafficStats
  trafficBaseline: TrafficStats | null
  trafficSessionStarted: boolean
  preparingCores: boolean
  logs: LogLine[]
  sidecarError: string | null
  scanBudgetSecs: number | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  setProtocol: (protocol: ConnectionProfile["protocol"]) => void
  setScanMode: (scan_mode: ConnectionProfile["scan_mode"]) => void
  setIpVersion: (ip_version: ConnectionProfile["ip_version"]) => void
  setConnectionMode: (connection_mode: ConnectionMode) => Promise<void>
  refreshTraffic: () => Promise<void>
  setQuickReconnect: (quick_reconnect: boolean) => void
  setMasqueHttp2: (masque_http2: boolean) => void
  setMasqueNoize: (masque_noize: MasqueNoize) => void
  setWgNoize: (wg_noize: WgNoize) => void
  setBindAddress: (bind_address: string) => void
  retryAfterSidecarError: () => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: { state: "Idle" },
  profile: {
    protocol: "auto",
    scan_mode: "balanced",
    ip_version: "v4",
    connection_mode: "proxy",
    quick_reconnect: true,
    masque_http2: false,
    masque_noize: "firewall",
    wg_noize: "balanced",
    bind_address: "127.0.0.1:1819",
  },
  logs: [],
  sidecarError: null,
  scanBudgetSecs: null,
  traffic: { received_bytes: 0, sent_bytes: 0 },
  trafficBaseline: null,
  trafficSessionStarted: false,
  preparingCores: false,

  connect: async () => {
    set({
      traffic: { received_bytes: 0, sent_bytes: 0 },
      trafficBaseline: null,
      trafficSessionStarted: true,
      preparingCores: true,
    })
    try {
      // Never let an older asynchronous settings write land after connect() has
      // stored its pending elevation profile. Waiting for the ordered save queue
      // keeps the UAC handoff deterministic even after rapid mode/option changes.
      await profileSaveQueue

      // Startup starts this local readiness check in parallel. If Connect wins
      // the race, share the same promise before launching a core.
      await useCoreStore.getState().loadAll()
      await invoke("connect", { profileOverride: get().profile })
    } catch (e) {
      const message = String(e)
      const lower = message.toLowerCase()

      if (lower.includes("administrator privileges are required")) {
        try {
          await invoke("elevate")
        } catch (elevationError) {
          set({
            status: {
              state: "Error",
              message: String(elevationError),
              phase: "elevation",
            },
          })
          syncTrayState("Error")
        }
        return
      }

      if (lower.includes("binary not found")) {
        set({ sidecarError: message })
      } else {
        set({ status: { state: "Error", message, phase: "launching" } })
        syncTrayState("Error")
      }
    } finally {
      set({ preparingCores: false })
    }
  },

  disconnect: async () => {
    try {
      await invoke("disconnect")
    } catch {
      // Nothing to do if the backend is already idle.
    }
  },

  setProtocol: (protocol) => {
    const profile = { ...get().profile, protocol }
    set({ profile })
    void saveDefaultProfile(profile)
  },
  setScanMode: (scan_mode) => {
    const profile = { ...get().profile, scan_mode }
    set({ profile })
    void saveDefaultProfile(profile)
  },
  setIpVersion: (ip_version) => {
    const profile = { ...get().profile, ip_version }
    set({ profile })
    void saveDefaultProfile(profile)
  },
  setConnectionMode: async (connection_mode) => {
    if (get().profile.connection_mode === connection_mode) return

    const profile = { ...get().profile, connection_mode }
    set({ profile })

    try {
      // Selecting a mode is a pure settings operation. Privilege elevation has
      // exactly one owner: connect(). This keeps dev and production behavior the
      // same and guarantees that UAC always has an exact pending connect profile.
      await saveDefaultProfile(profile)
    } catch (e) {
      set({
        status: {
          state: "Error",
          message: String(e),
          phase: "saving-profile",
        },
      })
      syncTrayState("Error")
    }
  },

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
  setQuickReconnect: (quick_reconnect) => {
    const profile = { ...get().profile, quick_reconnect }
    set({ profile })
    void saveDefaultProfile(profile)
  },
  setMasqueHttp2: (masque_http2) => {
    const profile = { ...get().profile, masque_http2 }
    set({ profile })
    void saveDefaultProfile(profile)
  },
  setMasqueNoize: (masque_noize) => {
    const profile = { ...get().profile, masque_noize }
    set({ profile })
    void saveDefaultProfile(profile)
  },
  setWgNoize: (wg_noize) => {
    const profile = { ...get().profile, wg_noize }
    set({ profile })
    void saveDefaultProfile(profile)
  },
  setBindAddress: (bind_address) => {
    const profile = { ...get().profile, bind_address }
    set({ profile })
    void saveDefaultProfile(profile)
  },
  retryAfterSidecarError: () => set({ sidecarError: null }),
}))

if (import.meta.env.DEV) {
  ;(window as unknown as { __conn?: typeof useConnectionStore }).__conn =
    useConnectionStore
}

const BUDGET_RE = /budget=(\d+)s/

/** Call once from App's top-level effect; returns a cleanup function. */
export async function initConnectionListeners(): Promise<() => void> {
  let pendingLogs: LogLine[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  const flushLogs = () => {
    flushTimer = null
    if (pendingLogs.length === 0) return

    const batch = pendingLogs.slice(-MAX_PENDING_LOG_LINES)
    pendingLogs = []
    let budget: number | null = null
    for (const l of batch) {
      const m = BUDGET_RE.exec(l.line)
      if (m) budget = Number(m[1])
    }
    useConnectionStore.setState((s) => ({
      logs: [...s.logs, ...batch].slice(-MAX_LOG_LINES),
      ...(budget !== null ? { scanBudgetSecs: budget } : {}),
    }))
  }

  const [unlistenStatus, unlistenLog] = await Promise.all([
    listen<ConnectionStatus>("aether://status", (e) => {
      useConnectionStore.setState({
        status: e.payload,
        ...(e.payload.state === "Launching" ? { scanBudgetSecs: null } : {}),
      })
      syncTrayState(e.payload.state)
    }),
    listen<LogLine>("aether://log", (e) => {
      pendingLogs.push(e.payload)
      if (pendingLogs.length > MAX_PENDING_LOG_LINES * 2) {
        pendingLogs = pendingLogs.slice(-MAX_PENDING_LOG_LINES)
      }
      flushTimer ??= setTimeout(flushLogs, LOG_FLUSH_INTERVAL_MS)
    }),
  ])

  try {
    const [status, profile, pendingElevationProfile] = await Promise.all([
      invoke<ConnectionStatus>("get_status"),
      invoke<ConnectionProfile>("get_default_profile"),
      invoke<ConnectionProfile | null>("take_pending_elevation_profile"),
    ])
    const activeProfile = pendingElevationProfile ?? profile
    useConnectionStore.setState({ status, profile: activeProfile })
    syncTrayState(status.state)

    // A pending profile is a one-shot handoff created immediately before UAC.
    // Only the elevated process can consume it, so resuming here cannot turn a
    // normal app launch into an unexpected auto-connect.
    if (pendingElevationProfile && status.state === "Idle") {
      queueMicrotask(() => void useConnectionStore.getState().connect())
    }
  } catch (e) {
    console.error("Failed to load initial connection state:", e)
  }

  return () => {
    unlistenStatus()
    unlistenLog()
    if (flushTimer !== null) clearTimeout(flushTimer)
    pendingLogs = []
  }
}
