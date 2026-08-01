// Mirrors src-tauri/src/state.rs::ConnectionState and
// src-tauri/src/aether/profiles.rs::ConnectionProfile.

export type ConnectionStatus =
  | { state: "Idle" }
  | { state: "Launching" }
  | { state: "Connecting" }
  | { state: "StartingTunnel"; socks_addr: string }
  | { state: "Connected"; socks_addr: string; connected_at_ms: number }
  | {
      state: "Tunneling"
      tun_addr: string
      socks_addr: string
      connected_at_ms: number
    }
  | { state: "Reconnecting"; attempt: number; max_attempts: number }
  | { state: "Disconnecting" }
  | { state: "Error"; message: string; phase: string }

export type Protocol = "auto" | "masque" | "wireguard" | "gool"
export type ScanMode = "turbo" | "balanced" | "thorough" | "stealth" | "ironclad"
export type IpVersion = "v4" | "v6" | "both"
export type ConnectionMode = "proxy" | "tunnel" | "both"
export type TunEngine = "xray" | "singbox"
export type MasqueNoize = "firewall" | "gfw" | "off"
export type WgNoize = "balanced" | "aggressive" | "light" | "off"

export interface ConnectionProfile {
  protocol: Protocol
  scan_mode: ScanMode
  ip_version: IpVersion
  connection_mode: ConnectionMode
  tun_engine: TunEngine
  quick_reconnect: boolean
  masque_http2: boolean
  masque_noize: MasqueNoize
  wg_noize: WgNoize
  /** DNS resolver used by the system TUN engines. Defaults to Cloudflare. */
  dns_server: string
  /** Loopback-only SOCKS5 address. The port is configurable. */
  bind_address: string
  /** Encapsulates UDP through the SOCKS TCP control path to prevent direct STUN/WebRTC egress. */
  webrtc_leak_protection: boolean
  /** Android-only one-time migration marker; ignored by desktop runtimes. */
  android_runtime_defaults_version?: number
}

export interface TrafficStats {
  received_bytes: number
  sent_bytes: number
}

export interface RuntimeTelemetry extends TrafficStats {
  public_ip: string | null
  country_code: string | null
  latency_ms: number | null
  sampled_at_ms: number
  egress_probe_complete: boolean
}

export interface LogLine {
  line: string
  timestamp: number
}
