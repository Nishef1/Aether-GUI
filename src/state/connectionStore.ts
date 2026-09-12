import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { profileForNativeInvoke, decodeNativeConnectionProfile } from "@/lib/nativeProfile";
import { isAndroid } from "@/lib/platform";
import { appendRingBuffer } from "@/lib/ringBuffer";
import type {
  ConnectionProfile,
  ConnectionStatus,
  LogLine,
  RuntimeTelemetry,
  ScanMode,
  IpVersion,
  Protocol,
  MasqueNoize,
  WgNoize,
  ZeroTrustAuth,
  PerfProfile,
  H2MaskMode,
  TlsProfileMode,
} from "@/types/connection";

const DEFAULT_PROFILE: ConnectionProfile = {
  protocol: "auto",
  scan_mode: "turbo",
  ip_version: "v4",
  quick_reconnect: true,
  masque_http2: true,
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
  masque_mask: "off",
  fragment: false,
  fragment_size: "16-32",
  fragment_delay: "2-10",
  keepalive: 25,
  no_profile_retry: false,
  tls_profile: "automatic",
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

const LOG_LIMITS = [100, 250, 500] as const;
export type LogLineLimit = (typeof LOG_LIMITS)[number];
const DEFAULT_LOG_LINE_LIMIT: LogLineLimit = 250;

function normalizeLogLineLimit(value: unknown): LogLineLimit {
  const numeric = Number(value);
  return LOG_LIMITS.includes(numeric as LogLineLimit)
    ? (numeric as LogLineLimit)
    : DEFAULT_LOG_LINE_LIMIT;
}

function normalizeProfile(profile: Partial<ConnectionProfile> | null | undefined): ConnectionProfile {
  return {
    ...DEFAULT_PROFILE,
    ...decodeNativeConnectionProfile(profile ?? {}),
  };
}

function androidStartupBudgetSecs(profile: ConnectionProfile): number {
  const transport =
    profile.protocol === "gool"
      ? "gool"
      : profile.protocol === "wireguard"
        ? "wg"
        : profile.masque_http2
          ? "h2"
          : "h3";

  switch (profile.scan_mode) {
    case "turbo":
      if (transport === "gool") return 90;
      if (transport === "wg") return 70;
      return 60;
    case "balanced":
      if (transport === "gool") return 165;
      if (transport === "wg") return 135;
      return 120;
    case "thorough":
      if (transport === "gool") return 360;
      if (transport === "wg") return 330;
      return 300;
    case "stealth":
      if (transport === "gool") return 270;
      if (transport === "wg") return 240;
      return 210;
    case "ironclad":
      if (transport === "gool") return 300;
      if (transport === "wg") return 270;
      return 240;
  }
}

interface RuntimePath {
  transport: string;
  endpoint: string;
}

interface RuntimeCapacity {
  downloadKbps: number;
  uploadKbps: number;
  uploadLimited: boolean;
}

interface ConnectionStore {
  status: ConnectionStatus;
  profile: ConnectionProfile;
  logs: LogLine[];
  loggingEnabled: boolean;
  logLineLimit: LogLineLimit;
  accessCodeRequired: boolean;
  scanBudgetSecs: number | null;
  sidecarError: string | null;
  runtimePath: RuntimePath | null;
  runtimePathAttemptId: number | null;
  runtimeCapacity: RuntimeCapacity | null;
  runtimeCapacityAttemptId: number | null;
  attemptId: number;
  setProtocol: (protocol: Protocol) => void;
  setScanMode: (scan_mode: ScanMode) => void;
  setIpVersion: (ip_version: IpVersion) => void;
  setQuickReconnect: (quick_reconnect: boolean) => void;
  setMasqueHttp2: (masque_http2: boolean) => void;
  setMasqueNoize: (masque_noize: MasqueNoize) => void;
  setWgNoize: (wg_noize: WgNoize) => void;
  setBindAddress: (bind_address: string) => void;
  setDns: (dns: string) => void;
  setMtu: (mtu: number) => void;
  setProfileField: <K extends keyof ConnectionProfile>(field: K, value: ConnectionProfile[K]) => void;
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
  clearAccessCodeRequirement: () => void;
  retryAfterSidecarError: () => void;
  connect: (profileOverride?: ConnectionProfile) => Promise<void>;
  disconnect: () => Promise<void>;
}

function appendLog(logs: LogLine[], line: string, limit: LogLineLimit): LogLine[] {
  return appendRingBuffer(logs, { line, timestamp: Date.now() }, limit);
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  status: { state: "Idle" },
  profile: DEFAULT_PROFILE,
  logs: [],
  loggingEnabled: false,
  logLineLimit: DEFAULT_LOG_LINE_LIMIT,
  accessCodeRequired: false,
  scanBudgetSecs: null,
  sidecarError: null,
  runtimePath: null,
  runtimePathAttemptId: null,
  runtimeCapacity: null,
  runtimeCapacityAttemptId: null,
  attemptId: 0,

  setProtocol: (protocol) =>
    set((state) => ({ profile: { ...state.profile, protocol } })),
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
    await invoke("set_logging_enabled", { enabled });
    set({ loggingEnabled: enabled });
  },
  setLogLineLimit: (limit) =>
    set((state) => ({
      logLineLimit: normalizeLogLineLimit(limit),
      logs: state.logs.slice(-normalizeLogLineLimit(limit)),
    })),
  clearLogs: () => set({ logs: [] }),
  clearAccessCodeRequirement: () => set({ accessCodeRequired: false }),
  retryAfterSidecarError: () => set({ sidecarError: null, status: { state: "Idle" } }),

  connect: async (profileOverride) => {
    const current = get();
    const profile = normalizeProfile(profileOverride ?? current.profile);
    const attemptId = current.attemptId + 1;
    set({
      status: { state: "Launching" },
      accessCodeRequired: false,
      runtimePath: null,
      runtimePathAttemptId: null,
      runtimeCapacity: null,
      runtimeCapacityAttemptId: null,
      scanBudgetSecs: isAndroid ? androidStartupBudgetSecs(profile) : null,
      sidecarError: null,
      attemptId,
    });
    try {
      await invoke("connect", { profileOverride: profileForNativeInvoke(profile) });
    } catch (error) {
      const message = String(error);
      set({ status: { state: "Error", message, phase: "launching" } });
      if (
        message.toLowerCase().includes("binary not found") ||
        message.toLowerCase().includes("bundled arm64 aether core was not found")
      ) {
        set({ sidecarError: message });
      }
    }
  },

  disconnect: async () => {
    set({ status: { state: "Disconnecting" } });
    try {
      await invoke("disconnect");
    } catch (error) {
      set({ status: { state: "Error", message: String(error), phase: "disconnect" } });
    }
  },
}));

export async function initConnectionListeners(): Promise<() => void> {
  const unlistenStatus = await listen<ConnectionStatus>("connection-status", (event) => {
    useConnectionStore.setState({ status: event.payload });
  });
  const unlistenProfile = await listen<Partial<ConnectionProfile>>("connection-profile", (event) => {
    useConnectionStore.setState({ profile: normalizeProfile(event.payload) });
  });
  const unlistenLog = await listen<string>("connection-log", (event) => {
    const state = useConnectionStore.getState();
    if (!state.loggingEnabled) return;
    useConnectionStore.setState({ logs: appendLog(state.logs, event.payload, state.logLineLimit) });
  });
  const unlistenAccessCode = await listen<boolean>("access-code-required", (event) => {
    useConnectionStore.setState({ accessCodeRequired: event.payload });
  });
  const unlistenRuntimePath = await listen<RuntimePath>("runtime-path", (event) => {
    const state = useConnectionStore.getState();
    useConnectionStore.setState({
      runtimePath: event.payload,
      runtimePathAttemptId: state.attemptId,
    });
  });
  const unlistenRuntimeCapacity = await listen<RuntimeCapacity>("runtime-capacity", (event) => {
    const state = useConnectionStore.getState();
    useConnectionStore.setState({
      runtimeCapacity: event.payload,
      runtimeCapacityAttemptId: state.attemptId,
    });
  });

  const current = await invoke<{
    status: ConnectionStatus;
    profile: Partial<ConnectionProfile>;
    logging_enabled: boolean;
    log_line_limit?: number;
  }>("get_initial_state");

  useConnectionStore.setState({
    status: current.status,
    profile: normalizeProfile(current.profile),
    loggingEnabled: current.logging_enabled,
    logLineLimit: normalizeLogLineLimit(current.log_line_limit),
  });

  return () => {
    unlistenStatus();
    unlistenProfile();
    unlistenLog();
    unlistenAccessCode();
    unlistenRuntimePath();
    unlistenRuntimeCapacity();
  };
}

export function resetConnectionTelemetrySnapshot(): RuntimeTelemetry {
  return {
    received_bytes: 0,
    sent_bytes: 0,
    public_ip: null,
    country_code: null,
    latency_ms: null,
    sampled_at_ms: 0,
    egress_probe_complete: false,
    path_health: "unknown",
    tunnel_validation: "unknown",
    probe_failures: 0,
    smoothed_latency_ms: null,
    jitter_ms: null,
    quality_score: 0,
    quality_confidence: 0,
    capacity_probe_complete: false,
    download_kbps: null,
    upload_kbps: null,
    upload_limited: false,
  };
}
