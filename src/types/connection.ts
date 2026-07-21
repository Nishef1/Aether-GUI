// Mirrors src-tauri/src/state.rs::ConnectionState and
// src-tauri/src/aether/profiles.rs::ConnectionProfile.

export type ConnectionStatus =
  | { state: "Idle" }
  | { state: "Launching" }
  | { state: "Connecting" }
  | { state: "Connected"; socks_addr: string; connected_at_ms: number }
  | {
      state: "Tunneling";
      tun_addr: string;
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

export interface ConnectionProfile {
  protocol: Protocol;
  scan_mode: ScanMode;
  ip_version: IpVersion;
  quick_reconnect: boolean;
  masque_http2: boolean;
  masque_noize: MasqueNoize;
  wg_noize: WgNoize;
  /** Loopback-only SOCKS5 address. The port is configurable. */
  bind_address: string;
  /** Route all system traffic through a supervised sing-box TUN. */
  tun_enabled: boolean;
}

export interface LogLine {
  line: string;
  timestamp: number;
}
