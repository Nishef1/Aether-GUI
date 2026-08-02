import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isAndroid } from "@/lib/platform";
import type {
  ConnectionProfile,
  ConnectionStatus,
  LogLine,
  MasqueNoize,
  ScanMode,
  WgNoize,
  ZeroTrustAuth,
} from "@/types/connection";

export type LogLineLimit = 100 | 250 | 500;

const DEFAULT_LOG_LINE_LIMIT: LogLineLimit = 250;
const BUDGET_RE = /budget=(\d+)s/;
const ANDROID_SCAN_BUDGETS: Record<ScanMode, number> = {
  turbo: 75,
  balanced: 150,
  thorough: 330,
  stealth: 210,
  ironclad: 240,
};

const DEFAULT_PROFILE: ConnectionProfile = {
  protocol: "auto",
  scan_mode: "balanced",
  ip_version: "v4",
  quick_reconnect: false,
  masque_http2: false,
  masque_noize: "firewall",
  wg_noize: "balanced",
  bind_address: "127.0.0.1:1819",
  dns: "",
  mtu: 1280,
  peer: "",
  wg_peer: "",
  h2_peer: "",
  ech: "",
  no_data_check: false,
  validate_secs: 10,
  reconnect_secs: 2,
  fragment: false,
  fragment_size: "16-32",
  fragment_delay: "2-10",
  keepalive: 5,
  no_profile_retry: false,
  tls_groups: "",
  perf_profile: "auto",
  zero_trust_team: "",
  zero_trust_auth: "email",
  access_email: "",
  access_client_id: "",
  access_client_secret: "",
  access_token: "",
  zero_trust_gateway: false,
  route_block: "",
  route_direct: "",
  routes_file: "",
};

interface ConnectionState {
  status: ConnectionStatus;
  profile: ConnectionProfile;
  logs: LogLine[];
  loggingEnabled: boolean;
  logLineLimit: LogLineLimit;
  sidecarError: string | null;
  scanBudgetSecs: number | null;
  attemptId: number;
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
  setDns: (dns: string) => void;
  setMtu: (mtu: number) => void;
  setProfileField: <K extends keyof ConnectionProfile>(
    field: K,
    value: ConnectionProfile[K],
  ) => void;
  setZeroTrustTeam: (zero_trust_team: string) => void;
  setZeroTrustAuth: (zero_trust_auth: ZeroTrustAuth) => void;
  setAccessEmail: (access_email: string) => void;
  setAccessClientId: (access_client_id: string) => void;
  setAccessClientSecret: (access_client_secret: string) => void;
  setAccessToken: (access_token: string) => void;
  setZeroTrustGateway: (zero_trust_gateway: boolean) => void;
  setRouteBlock: (route_block: string) => void;
  setRouteDirect: (route_direct: string) => void;
  setRoutesFile: (routes_file: string) => void;
  setLoggingEnabled: (enabled: boolean) => Promise<void>;
  setLogLineLimit: (limit: LogLineLimit) => void;
  clearLogs: () => void;
  retryAfterSidecarError: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: { state: "Idle" },
  profile: { ...DEFAULT_PROFILE },
  logs: [],
  loggingEnabled: false,
  logLineLimit: DEFAULT_LOG_LINE_LIMIT,
  sidecarError: null,
  scanBudgetSecs: null,
  attemptId: 0,

  connect: async () => {
    const profile = get().profile;
    set((state) => ({
      logs: [],
      scanBudgetSecs: isAndroid ? ANDROID_SCAN_BUDGETS[profile.scan_mode] : null,
      attemptId: state.attemptId + 1,
    }));
    try {
      await invoke("connect", { profileOverride: profile });
    } catch (error) {
      const message = String(error);
      if (
        message.toLowerCase().includes("binary not found") ||
        message.toLowerCase().includes("bundled arm64 aether core was not found")
      ) {
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
      // Native reconciliation handles an already-stopped backend.
    }
  },

  setProtocol: (protocol) => set((state) => ({ profile: { ...state.profile, protocol } })),
  setScanMode: (scan_mode) =>
    set((state) => ({ profile: { ...state.profile, scan_mode } })),
  setIpVersion: (ip_version) =>
    set((state) => ({ profile: { ...state.profile, ip_version } })),
  setQuickReconnect: (quick_reconnect) =>
    set((state) => ({ profile: { ...state.profile, quick_reconnect } })),
  setMasqueHttp2: (masque_http2) =>
    set((state) => ({ profile: { ...state.profile, masque_http2 } })),
  setMasqueNoize: (masque_noize) =>
    set((state) => ({ profile: { ...state.profile, masque_noize } })),
  setWgNoize: (wg_noize) =>
    set((state) => ({ profile: { ...state.profile, wg_noize } })),
  setBindAddress: (bind_address) =>
    set((state) => ({ profile: { ...state.profile, bind_address } })),
  setDns: (dns) => set((state) => ({ profile: { ...state.profile, dns } })),
  setMtu: (mtu) =>
    set((state) => ({
      profile: { ...state.profile, mtu: Math.min(1500, Math.max(1280, Math.round(mtu))) },
    })),
  setProfileField: (field, value) =>
    set((state) => ({ profile: { ...state.profile, [field]: value } })),
  setZeroTrustTeam: (zero_trust_team) =>
    set((state) => ({ profile: { ...state.profile, zero_trust_team } })),
  setZeroTrustAuth: (zero_trust_auth) =>
    set((state) => ({
      profile: {
        ...state.profile,
        zero_trust_auth,
        access_email: "",
        access_client_id: "",
        access_client_secret: "",
        access_token: "",
      },
    })),
  setAccessEmail: (access_email) =>
    set((state) => ({ profile: { ...state.profile, access_email } })),
  setAccessClientId: (access_client_id) =>
    set((state) => ({ profile: { ...state.profile, access_client_id } })),
  setAccessClientSecret: (access_client_secret) =>
    set((state) => ({ profile: { ...state.profile, access_client_secret } })),
  setAccessToken: (access_token) =>
    set((state) => ({ profile: { ...state.profile, access_token } })),
  setZeroTrustGateway: (zero_trust_gateway) =>
    set((state) => ({ profile: { ...state.profile, zero_trust_gateway } })),
  setRouteBlock: (route_block) =>
    set((state) => ({ profile: { ...state.profile, route_block } })),
  setRouteDirect: (route_direct) =>
    set((state) => ({ profile: { ...state.profile, route_direct } })),
  setRoutesFile: (routes_file) =>
    set((state) => ({ profile: { ...state.profile, routes_file } })),
  setLoggingEnabled: async (enabled) => {
    set({ loggingEnabled: enabled, ...(enabled ? {} : { logs: [] }) });
    if (isAndroid) {
      const active = enabled && document.visibilityState === "visible";
      try {
        await invoke("set_android_logging", { enabled: active });
      } catch {
        set({ loggingEnabled: false, logs: [] });
      }
    }
  },
  setLogLineLimit: (logLineLimit) =>
    set((state) => ({
      logLineLimit,
      logs: state.logs.slice(-logLineLimit),
    })),
  clearLogs: () => set({ logs: [] }),
  retryAfterSidecarError: () => set({ sidecarError: null }),
}));

if (import.meta.env.DEV) {
  (window as unknown as { __conn?: typeof useConnectionStore }).__conn = useConnectionStore;
}

function appendLogBatch(batch: LogLine[]) {
  if (batch.length === 0) return;
  let budget: number | null = null;
  for (const item of batch) {
    const match = BUDGET_RE.exec(item.line);
    if (match) budget = Number(match[1]);
  }
  useConnectionStore.setState((state) => ({
    ...(state.loggingEnabled
      ? { logs: [...state.logs, ...batch].slice(-state.logLineLimit) }
      : {}),
    ...(budget !== null ? { scanBudgetSecs: budget } : {}),
  }));
}

function androidPollDelay(status: ConnectionStatus): number {
  switch (status.state) {
    case "Launching":
    case "Connecting":
    case "AwaitingAccessCode":
    case "StartingTunnel":
    case "Reconnecting":
    case "Disconnecting":
      return 500;
    case "Connected":
    case "Tunneling":
      return 2_000;
    default:
      return 3_000;
  }
}

/** Call once from App's top-level effect; returns a cleanup function. */
export async function initConnectionListeners(): Promise<() => void> {
  let pendingLogs: LogLine[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushLogs = () => {
    flushTimer = null;
    const batch = pendingLogs;
    pendingLogs = [];
    appendLogBatch(batch);
  };

  const [unlistenStatus, unlistenLog] = await Promise.all([
    listen<ConnectionStatus>("aether://status", (event) => {
      useConnectionStore.setState({
        status: event.payload,
        ...(!isAndroid && event.payload.state === "Launching"
          ? { scanBudgetSecs: null }
          : {}),
      });
    }),
    listen<LogLine>("aether://log", (event) => {
      pendingLogs.push(event.payload);
      flushTimer ??= setTimeout(flushLogs, 100);
    }),
  ]);

  try {
    const [status, profile] = await Promise.all([
      invoke<ConnectionStatus>("get_status"),
      invoke<Partial<ConnectionProfile>>("get_default_profile"),
    ]);
    useConnectionStore.setState({
      status,
      profile: { ...DEFAULT_PROFILE, ...profile, mtu: profile.mtu ?? DEFAULT_PROFILE.mtu },
    });
  } catch (error) {
    console.error("Failed to load initial connection state:", error);
  }

  let disposed = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastNativeLogId = 0;

  const scheduleAndroidPoll = () => {
    if (!isAndroid || disposed || document.visibilityState !== "visible") return;
    const delay = androidPollDelay(useConnectionStore.getState().status);
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (disposed || document.visibilityState !== "visible") return;
      try {
        const status = await invoke<ConnectionStatus>("get_status");
        useConnectionStore.setState({ status });
      } catch {
        // The service may be transitioning between processes.
      }

      if (useConnectionStore.getState().loggingEnabled) {
        try {
          const batch = await invoke<{
            entries: Array<{ id: number; timestamp: number; line: string }>;
            last_id: number;
          }>("get_android_logs", { afterId: lastNativeLogId });
          lastNativeLogId = Math.max(lastNativeLogId, batch.last_id);
          appendLogBatch(
            batch.entries.map((entry) => ({ timestamp: entry.timestamp, line: entry.line })),
          );
        } catch {
          // Logging is supplementary.
        }
      }
      scheduleAndroidPoll();
    }, delay);
  };

  const syncAndroidVisibility = () => {
    if (!isAndroid) return;
    const visible = document.visibilityState === "visible";
    const enabled = useConnectionStore.getState().loggingEnabled && visible;
    void invoke("set_android_logging", { enabled }).catch(() => undefined);
    if (visible) {
      if (pollTimer !== null) clearTimeout(pollTimer);
      scheduleAndroidPoll();
    } else {
      useConnectionStore.setState({ logs: [] });
      lastNativeLogId = 0;
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    }
  };

  if (isAndroid) {
    document.addEventListener("visibilitychange", syncAndroidVisibility);
    void invoke("set_android_logging", { enabled: false }).catch(() => undefined);
    scheduleAndroidPoll();
  }

  return () => {
    disposed = true;
    unlistenStatus();
    unlistenLog();
    if (flushTimer !== null) clearTimeout(flushTimer);
    if (pollTimer !== null) clearTimeout(pollTimer);
    if (isAndroid) {
      document.removeEventListener("visibilitychange", syncAndroidVisibility);
      void invoke("set_android_logging", { enabled: false }).catch(() => undefined);
    }
  };
}
