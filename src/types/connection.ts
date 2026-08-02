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
export type MasqueNoize = "firewall" | "gfw" | "off";
export type WgNoize = "balanced" | "aggressive" | "light" | "off";
export type ZeroTrustAuth = "email" | "service" | "token";
export type SystemTunnelSelection = "off" | "singbox" | "native";
export type PerfProfile = "auto" | "low" | "medium" | "high";

export interface SystemTunnelDescriptor {
  id: string;
  display_name: string;
  requires_elevation: boolean;
  capabilities: string[];
}

export interface ConnectionProfile {
  protocol: Protocol;
  scan_mode: ScanMode;
  ip_version: IpVersion;
  quick_reconnect: boolean;
  masque_http2: boolean;
  masque_noize: MasqueNoize;
  wg_noize: WgNoize;
  bind_address: string;
  dns: string;
  mtu: number;
  peer: string;
  wg_peer: string;
  h2_peer: string;
  ech: string;
  no_data_check: boolean;
  validate_secs: number;
  reconnect_secs: number;
  fragment: boolean;
  fragment_size: string;
  fragment_delay: string;
  keepalive: number;
  no_profile_retry: boolean;
  tls_groups: string;
  perf_profile: PerfProfile;
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
}

export interface RuntimeTelemetry {
  received_bytes: number;
  sent_bytes: number;
  public_ip: string | null;
  country_code: string | null;
  latency_ms: number | null;
  sampled_at_ms: number;
  egress_probe_complete: boolean;
}

export interface LogLine {
  line: string;
  timestamp: number;
}
