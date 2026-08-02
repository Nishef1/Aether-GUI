export type ConnectionStatus =
  | { state: "Idle" }
  | { state: "Launching" }
  | { state: "Connecting" }
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
export type SystemTunnelSelection = "off" | "singbox";

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
