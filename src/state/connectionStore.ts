import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  ConnectionProfile,
  ConnectionStatus,
  LogLine,
  MasqueNoize,
  WgNoize,
} from "@/types/connection";

const MAX_LOG_LINES = 500;

interface ConnectionState {
  status: ConnectionStatus;
  profile: ConnectionProfile;
  logs: LogLine[];
  sidecarError: string | null;
  scanBudgetSecs: number | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setProtocol: (protocol: ConnectionProfile["protocol"]) => void;
  setScanMode: (scan_mode: ConnectionProfile["scan_mode"]) => void;
  setIpVersion: (ip_version: ConnectionProfile["ip_version"]) => void;
  setQuickReconnect: (quick_reconnect: boolean) => void;
  setMasqueHttp2: (masque_http2: boolean) => void;
  setMasqueNoize: (masque_noize: MasqueNoize) => void;
  setWgNoize: (wg_noize: WgNoize) => void;
  setBindAddress: (bind_address: string) => void;
  setTunEnabled: (tun_enabled: boolean) => void;
  retryAfterSidecarError: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: { state: "Idle" },
  profile: {
    protocol: "auto",
    scan_mode: "balanced",
    ip_version: "v4",
    quick_reconnect: true,
    masque_http2: false,
    masque_noize: "firewall",
    wg_noize: "balanced",
    bind_address: "127.0.0.1:1819",
    tun_enabled: false,
  },
  logs: [],
  sidecarError: null,
  scanBudgetSecs: null,

  connect: async () => {
    try {
      await invoke("connect", { profileOverride: get().profile });
    } catch (e) {
      const message = String(e);
      const lower = message.toLowerCase();

      if (lower.includes("administrator privileges are required")) {
        try {
          await invoke("elevate");
        } catch (elevationError) {
          set({
            status: {
              state: "Error",
              message: String(elevationError),
              phase: "elevation",
            },
          });
        }
        return;
      }

      if (lower.includes("binary not found")) {
        set({ sidecarError: message });
      } else {
        set({ status: { state: "Error", message, phase: "launching" } });
      }
    }
  },

  disconnect: async () => {
    try {
      await invoke("disconnect");
    } catch {
      // Nothing to do if the backend is already idle.
    }
  },

  setProtocol: (protocol) => set((s) => ({ profile: { ...s.profile, protocol } })),
  setScanMode: (scan_mode) => set((s) => ({ profile: { ...s.profile, scan_mode } })),
  setIpVersion: (ip_version) => set((s) => ({ profile: { ...s.profile, ip_version } })),
  setQuickReconnect: (quick_reconnect) =>
    set((s) => ({ profile: { ...s.profile, quick_reconnect } })),
  setMasqueHttp2: (masque_http2) =>
    set((s) => ({ profile: { ...s.profile, masque_http2 } })),
  setMasqueNoize: (masque_noize) =>
    set((s) => ({ profile: { ...s.profile, masque_noize } })),
  setWgNoize: (wg_noize) => set((s) => ({ profile: { ...s.profile, wg_noize } })),
  setBindAddress: (bind_address) =>
    set((s) => ({ profile: { ...s.profile, bind_address } })),
  setTunEnabled: (tun_enabled) => set((s) => ({ profile: { ...s.profile, tun_enabled } })),
  retryAfterSidecarError: () => set({ sidecarError: null }),
}));

if (import.meta.env.DEV) {
  (window as unknown as { __conn?: typeof useConnectionStore }).__conn = useConnectionStore;
}

const BUDGET_RE = /budget=(\d+)s/;

/** Call once from App's top-level effect; returns a cleanup function. */
export async function initConnectionListeners(): Promise<() => void> {
  let pendingLogs: LogLine[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushLogs = () => {
    flushTimer = null;
    const batch = pendingLogs;
    pendingLogs = [];
    let budget: number | null = null;
    for (const l of batch) {
      const m = BUDGET_RE.exec(l.line);
      if (m) budget = Number(m[1]);
    }
    useConnectionStore.setState((s) => ({
      logs: [...s.logs, ...batch].slice(-MAX_LOG_LINES),
      ...(budget !== null ? { scanBudgetSecs: budget } : {}),
    }));
  };

  const [unlistenStatus, unlistenLog] = await Promise.all([
    listen<ConnectionStatus>("aether://status", (e) => {
      useConnectionStore.setState({
        status: e.payload,
        ...(e.payload.state === "Launching" ? { scanBudgetSecs: null } : {}),
      });
    }),
    listen<LogLine>("aether://log", (e) => {
      pendingLogs.push(e.payload);
      flushTimer ??= setTimeout(flushLogs, 100);
    }),
  ]);

  try {
    const [status, profile, pendingElevationProfile] = await Promise.all([
      invoke<ConnectionStatus>("get_status"),
      invoke<ConnectionProfile>("get_default_profile"),
      invoke<ConnectionProfile | null>("take_pending_elevation_profile"),
    ]);
    const activeProfile = pendingElevationProfile ?? profile;
    useConnectionStore.setState({ status, profile: activeProfile });

    // The normal process saved this profile immediately before requesting UAC.
    // Only an elevated process can consume it, so resuming here cannot turn a
    // regular app launch into an unexpected auto-connect.
    if (pendingElevationProfile && status.state === "Idle") {
      queueMicrotask(() => void useConnectionStore.getState().connect());
    }
  } catch (e) {
    console.error("Failed to load initial connection state:", e);
  }

  return () => {
    unlistenStatus();
    unlistenLog();
    if (flushTimer !== null) clearTimeout(flushTimer);
  };
}
