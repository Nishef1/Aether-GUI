export type ConnectionStatus =
  | { state: "Idle" }
  | { state: "Launching" }
  | { state: "Connecting" }
  | { state: "AwaitingAccessCode" }
  | { state: "Connected"; socks_addr: string; connected_at_ms: number }
  | {
      state: "StartingTunnel";
      tunnel: string;
      socks_addr: string;
      connected_at_ms: number;
    }
  | {
      state: "Tunneling";
      tunnel: string;
      socks_addr: string;
      connected_at_ms: number;
    }
  | { state: "Reconnecting"; attempt: number; max_attempts: number }
  | { state: "Disconnecting" }
  | { state: "Error"; message: string; phase: string };

export type Protocol = "auto" | "masque" | "wireguard" | "gool";
export type ScanMode = "turbo" | "balanced" | "thorough" | "stealth" | "ironclad";
export type IpVersion = "v4" | "v6" | "both";
export type NoizeProfile =
  | "off"
  | "light"
  | "firewall"
  | "balanced"
  | "gfw"
  | "aggressive";
export type MasqueNoize = NoizeProfile;
export type WgNoize = NoizeProfile;
export type H2MaskMode = "off" | "legacy" | "clienthello" | "patterniha";
export type TlsProfileMode =
  | "automatic"
  | "current"
  | "native-minimal"
  | "compatibility"
  | "experimental";
export type ZeroTrustAuth = "email" | "service" | "token";
export type SystemTunnelSelection = "off" | "singbox" | "native";
export type PerfProfile = "auto" | "low" | "medium" | "high";
export type PathHealth = "unknown" | "healthy" | "suspect" | "failed";
export type TunnelValidation = "unknown" | "pending" | "healthy" | "suspect" | "failed";

export interface ConnectionProfile {
  protocol: Protocol;
  scan_mode: ScanMode;
  ip_version: IpVersion;
  quick_reconnect: boolean;
  masque_http2: boolean;
  masque_noize: MasqueNoize;
  wg_noize: WgNoize;
  bind_address: string;
  http_proxy: string;
  /** Aether's outbound chaining proxy. May contain credentials; never persist it. */
  upstream: string;
  dns: string;
  mtu: number;
  peer: string;
  /** Legacy outer WireGuard peer; retained for old saved profiles. */
  wg_peer: string;
  wiw_outer: string;
  wiw_inner: string;
  wiw_scan: boolean;
  h2_peer: string;
  ech: string;
  no_data_check: boolean;
  validate_secs: number;
  reconnect_secs: number;
  /** Explicit H2 ClientHello mask. Missing on old saved profiles. */
  masque_mask?: H2MaskMode;
  /** Legacy boolean retained for backward-compatible saved profiles. */
  fragment: boolean;
  fragment_size: string;
  fragment_delay: string;
  keepalive: number;
  no_profile_retry: boolean;
  tls_profile?: TlsProfileMode;
  tls_groups: string;
  perf_profile: PerfProfile;
  route_sniff: boolean;
  route_sniff_ms: number;
  auto_reprovision: boolean;
  zero_trust_team: string;
  zero_trust_auth: ZeroTrustAuth;
  access_email: string;
  access_client_id: string;
  access_client_secret: string;
  access_token: string;
  zero_trust_gateway: boolean;
  route_block: string;
  route_direct: string;
  routes_file: string;
  /** Internal automatic-policy attempt. Native layers must never persist it as user intent. */
  runtime_only?: boolean;
}

export interface RuntimeTelemetry {
  received_bytes: number;
  sent_bytes: number;
  public_ip: string | null;
  country_code: string | null;
  latency_ms: number | null;
  sampled_at_ms: number;
  egress_probe_complete: boolean;
  path_health?: PathHealth;
  tunnel_validation?: TunnelValidation;
  probe_failures?: number;
  smoothed_latency_ms?: number | null;
  jitter_ms?: number | null;
  quality_score?: number;
  quality_confidence?: number;
  capacity_probe_complete?: boolean;
  download_kbps?: number | null;
  upload_kbps?: number | null;
  upload_limited?: boolean;
}

export interface LogLine {
  line: string;
  timestamp: number;
}
