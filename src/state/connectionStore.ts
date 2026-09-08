import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RingBuffer } from "@/lib/ringBuffer";
import { isAndroid } from "@/lib/platform";
import type { RuntimePathSelection, PathTransport } from "@/lib/pathIntelligence";
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
const MAX_LOG_LINE_LIMIT = 500;
const LOG_FLUSH_MS = isAndroid ? 250 : 100;
const BUDGET_RE = /budget=(\d+)s/;
const ACCESS_CODE_MARKER = "[gui] Zero Trust access code required";
const PATH_MARKER_RE = /^\[gui\] path selected transport=(h2|h3|wg|gool) endpoint=(.+)$/;
const PATH_UNAVAILABLE_MARKER = "[gui] path unavailable";
const ANDROID_SCAN_BUDGETS: Record<ScanMode, number> = {
  turbo: 75,
  balanced: 150,
  thorough: 330,
  stealth: 210,
  ironclad: 240,
};

const logBuffer = new RingBuffer<LogLine>(MAX_LOG_LINE_LIMIT);

const DEFAULT_PROFILE: ConnectionProfile = {
  protocol: "auto",
  scan_mode: "balanced",
  ip_version: "v4",
  quick_reconnect: false,
  masque_http2: false,
  masque_noize: "firewall",
  wg_noize: "balanced",
  bind_address: "127.0.0.1:1819",
  http_proxy: "",
  upstream: "",
  dns: "",
  mtu: 1280,
  peer: "",
  wg_peer: "",
  wiw_outer: "",
  wiw_inner: "",
  wiw_scan: false,
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
  route_sniff: true,
  route_sniff_ms: 400,
  auto_reprovision: true,
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
  accessCodeRequired: boolean;
  runtimePath: RuntimePathSelection | null;
  runtimePathAttemptId: number | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  clearAccessCodeRequirement: () => void;
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

function normalizedProfile(profile: Partial<ConnectionProfile>): ConnectionProfile {
  return {
    ...DEFAULT_PROFILE,
    ...profile,
    mtu: profile.mtu ?? DEFAULT_PROFILE.mtu,
    validate_secs: profile.validate_secs ?? DEFAULT_PROFILE.validate_secs,
    reconnect_secs: profile.reconnect_secs ?? DEFAULT_PROFILE.reconnect_secs,
    keepalive: profile.keepalive ?? DEFAULT_PROFILE.keepalive,
    route_sniff: profile.route_sniff ?? DEFAULT_PROFILE.route_sniff,
    route_sniff_ms: profile.route_sniff_ms ?? DEFAULT_PROFILE.route_sniff_ms,
    auto_reprovision: profile.auto_reprovision ?? DEFAULT_PROFILE.auto_reprovision,
    // Upstream URLs can contain credentials and are intentionally session-only.
    upstream: "",
  };
}

function terminalStateClearsInteraction(status: ConnectionStatus): boolean {
  return (
    status.state === "Idle" ||
    status.state === "Connected" ||
    status.state === "Tunneling" ||
    status.state === "Disconnecting" ||
    status.state === "Error"
  );
}

function connectionStatusEqual(left: ConnectionStatus, right: ConnectionStatus): boolean {
  if (left.state !== right.state) return false;

  switch (left.state) {
    case "Connected":
      return (
        right.state === "Connected" &&
        left.socks_addr === right.socks_addr &&
        left.connected_at_ms === right.connected_at_ms
      );
    case "StartingTunnel":
    case "Tunneling":
      return (
        right.state === left.state &&
        left.tunnel === right.tunnel &&
        left.socks_addr === right.socks_addr &&
        left.connected_at_ms === right.connected_at_ms
      );
    case "Reconnecting":
      return (
        right.state === "Reconnecting" &&
        left.attempt === right.attempt &&
        left.max_attempts === right.max_attempts
      );
    case "Error":
      return right.state === "Error" && left.message === right.message && left.phase === right.phase;
    default:
      return true;
  }
}

function clearBufferedLogs(): void {
  logBuffer.clear();
}

async function syncNativeLogging(enabled: boolean): Promise<void> {
  const active = enabled && (!isAndroid || document.visibilityState === "visible");
  if (isAndroid) {
    await invoke("set_android_logging", { enabled: active });
    return;
  }
  await invoke("set_diagnostics_logging", { enabled: active });
}

function updateStatus(status: ConnectionStatus, resetDesktopBudget = false): void {
  const current = useConnectionStore.getState();
  const clearInteraction = terminalStateClearsInteraction(status);
  const statusChanged = !connectionStatusEqual(current.status, status);
  const shouldClearInteraction = clearInteraction && current.accessCodeRequired;
  const shouldResetBudget = resetDesktopBudget && current.scanBudgetSecs !== null;

  if (!statusChanged && !shouldClearInteraction && !shouldResetBudget) return;

  useConnectionStore.setState({
    ...(statusChanged ? { status } : {}),
    ...(shouldClearInteraction ? { accessCodeRequired: false } : {}),
    ...(shouldResetBudget ? { scanBudgetSecs: null } : {}),
  });
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
  accessCodeRequired: false,
  runtimePath: null,
  runtimePathAttemptId: null,

  connect: async () => {
    const profile = get().profile;
    clearBufferedLogs();
    set((state) => ({
      logs: [],
      accessCodeRequired: false,
      runtimePath: null,
      runtimePathAttemptId: null,
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
        set({ sidecarError: message, accessCodeRequired: false });
      } else {
        set({
          status: { state: "Error", message, phase: "launching" },
          accessCodeRequired: false,
        });
      }
    }
  },

  disconnect: async () => {
    set({ accessCodeRequired: false });
    try {
      await invoke("disconnect");
    } catch {
      // Native reconciliation handles an already-stopped backend.
    }
  },

  clearAccessCodeRequirement: () => set({ accessCodeRequired: false }),
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
    if (!enabled) clearBufferedLogs();
    set({ loggingEnabled: enabled, ...(enabled ? {} : { logs: [] }) });
    try {
      await syncNativeLogging(enabled);
    } catch {
      clearBufferedLogs();
      void syncNativeLogging(false).catch(() => undefined);
      set({ loggingEnabled: false, logs: [] });
    }
  },
  setLogLineLimit: (logLineLimit) =>
    set({
      logLineLimit,
      logs: logBuffer.toArray(logLineLimit),
    }),
  clearLogs: () => {
    clearBufferedLogs();
    set({ logs: [] });
  },
  retryAfterSidecarError: () => set({ sidecarError: null }),
}));

if (import.meta.env.DEV) {
  (window as unknown as { __conn?: typeof useConnectionStore }).__conn = useConnectionStore;
}

function updateScanBudgetFromLine(line: string): void {
  const match = BUDGET_RE.exec(line);
  if (!match) return;

  const budget = Number(match[1]);
  if (useConnectionStore.getState().scanBudgetSecs !== budget) {
    useConnectionStore.setState({ scanBudgetSecs: budget });
  }
}

function updateControlStateFromLine(line: string): void {
  const state = useConnectionStore.getState();

  if (line.includes(ACCESS_CODE_MARKER) && !state.accessCodeRequired) {
    useConnectionStore.setState({ accessCodeRequired: true });
  }

  updateScanBudgetFromLine(line);

  const pathMatch = PATH_MARKER_RE.exec(line.trim());
  if (pathMatch) {
    useConnectionStore.setState({
      runtimePath: {
        transport: pathMatch[1] as PathTransport,
        endpoint: pathMatch[2].trim(),
      },
      runtimePathAttemptId: state.attemptId,
    });
  } else if (line.trim() === PATH_UNAVAILABLE_MARKER) {
    useConnectionStore.setState({ runtimePath: null, runtimePathAttemptId: state.attemptId });
  }
}

function appendLogBatch(batch: LogLine[]): void {
  if (batch.length === 0) return;

  const state = useConnectionStore.getState();
  if (!state.loggingEnabled) return;

  logBuffer.pushMany(batch);
  useConnectionStore.setState({ logs: logBuffer.toArray(state.logLineLimit) });
}

function androidPollDelay(status: ConnectionStatus): number {
  switch (status.state) {
    case "Launching":
    case "Connecting":
    case "AwaitingAccessCode":
    case "StartingTunnel":
    case "Reconnecting":
    case "Disconnecting":
      return 750;
    case "Connected":
    case "Tunneling":
      return 3_000;
    case "Idle":
    case "Error":
      return 15_000;
  }
}

function stableStatus(status: ConnectionStatus): boolean {
  return status.state === "Connected" || status.state === "Tunneling";
}

export async function initConnectionListeners(): Promise<() => void> {
  let pendingLogs: LogLine[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushLogs = () => {
    flushTimer = null;
    if (pendingLogs.length === 0) return;
    const batch = pendingLogs;
    pendingLogs = [];
    appendLogBatch(batch);
  };

  const [unlistenStatus, unlistenLog] = await Promise.all([
    listen<ConnectionStatus>("aether://status", (event) => {
      updateStatus(event.payload, !isAndroid && event.payload.state === "Launching");
    }),
    listen<LogLine>("aether://log", (event) => {
      updateControlStateFromLine(event.payload.line);

      if (!useConnectionStore.getState().loggingEnabled) return;
      pendingLogs.push(event.payload);
      flushTimer ??= setTimeout(flushLogs, LOG_FLUSH_MS);
    }),
  ]);

  try {
    const [status, profile] = await Promise.all([
      invoke<ConnectionStatus>("get_status"),
      invoke<Partial<ConnectionProfile>>("get_default_profile"),
    ]);
    useConnectionStore.setState({
      status,
      profile: normalizedProfile(profile),
      ...(terminalStateClearsInteraction(status) ? { accessCodeRequired: false } : {}),
    });
  } catch (error) {
    console.error("Failed to load initial connection state:", error);
  }

  let disposed = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastNativeLogId = 0;

  const scheduleAndroidPoll = () => {
    if (!isAndroid || disposed || document.visibilityState !== "visible" || pollTimer !== null) {
      return;
    }

    const delay = androidPollDelay(useConnectionStore.getState().status);
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (disposed || document.visibilityState !== "visible") return;

      try {
        const status = await invoke<ConnectionStatus>("get_status");
        updateStatus(status);
      } catch {
        // The foreground service can be between lifecycle states.
      }

      const connection = useConnectionStore.getState();
      const needsPathControl =
        connection.attemptId > 0 &&
        stableStatus(connection.status) &&
        connection.runtimePathAttemptId !== connection.attemptId;

      if (connection.loggingEnabled || needsPathControl) {
        try {
          const batch = await invoke<{
            entries: Array<{ id: number; timestamp: number; line: string }>;
            last_id: number;
          }>("get_android_logs", { afterId: lastNativeLogId });
          lastNativeLogId = Math.max(lastNativeLogId, batch.last_id);

          for (const entry of batch.entries) updateControlStateFromLine(entry.line);
          appendLogBatch(
            batch.entries.map((entry) => ({ timestamp: entry.timestamp, line: entry.line })),
          );
        } catch {
          // Control metadata and logging are supplementary and must not destabilize the VPN.
        }
      }
      scheduleAndroidPoll();
    }, delay);
  };

  const syncAndroidVisibility = () => {
    if (!isAndroid) return;
    const visible = document.visibilityState === "visible";
    void syncNativeLogging(useConnectionStore.getState().loggingEnabled).catch(() => undefined);

    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }

    if (visible) {
      scheduleAndroidPoll();
    } else {
      clearBufferedLogs();
      useConnectionStore.setState({ logs: [] });
      lastNativeLogId = 0;
    }
  };

  // Native diagnostics are opt-in and start disabled on every platform.
  void syncNativeLogging(false).catch(() => undefined);

  if (isAndroid) {
    document.addEventListener("visibilitychange", syncAndroidVisibility);
    scheduleAndroidPoll();
  }

  return () => {
    disposed = true;
    unlistenStatus();
    unlistenLog();
    if (flushTimer !== null) clearTimeout(flushTimer);
    if (pollTimer !== null) clearTimeout(pollTimer);
    pendingLogs = [];
    clearBufferedLogs();
    void syncNativeLogging(false).catch(() => undefined);

    if (isAndroid) {
      document.removeEventListener("visibilitychange", syncAndroidVisibility);
    }
  };
}
