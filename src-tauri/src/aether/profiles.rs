use crate::diagnostics;
use crate::error::AetherError;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{OnceLock, RwLock};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Auto,
    Masque,
    Wireguard,
    Gool,
}

impl Protocol {
    pub fn as_menu_choice(&self) -> &'static str {
        match self {
            Protocol::Auto | Protocol::Masque => "1",
            Protocol::Wireguard => "2",
            Protocol::Gool => "3",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScanMode {
    Turbo,
    Balanced,
    Thorough,
    Stealth,
    Ironclad,
}

impl ScanMode {
    pub fn as_menu_choice(&self) -> &'static str {
        match self {
            ScanMode::Turbo => "1",
            ScanMode::Balanced => "2",
            ScanMode::Thorough => "3",
            ScanMode::Stealth => "4",
            ScanMode::Ironclad => "5",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IpVersion {
    V4,
    V6,
    Both,
}

impl IpVersion {
    pub fn as_menu_choice(&self) -> &'static str {
        match self {
            IpVersion::V4 => "1",
            IpVersion::V6 => "2",
            IpVersion::Both => "3",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionMode {
    #[default]
    Proxy,
    Tunnel,
    Both,
}

impl ConnectionMode {
    pub fn uses_tun(&self) -> bool {
        matches!(self, Self::Tunnel | Self::Both)
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TunEngine {
    #[default]
    Xray,
    Singbox,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MasqueNoize {
    Firewall,
    Gfw,
    Off,
}

impl MasqueNoize {
    pub fn as_flag(&self) -> &'static str {
        match self {
            MasqueNoize::Firewall => "firewall",
            MasqueNoize::Gfw => "gfw",
            MasqueNoize::Off => "off",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WgNoize {
    Balanced,
    Aggressive,
    Light,
    Off,
}

impl WgNoize {
    pub fn as_flag(&self) -> &'static str {
        match self {
            WgNoize::Balanced => "balanced",
            WgNoize::Aggressive => "aggressive",
            WgNoize::Light => "light",
            WgNoize::Off => "off",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ConnectionProfile {
    pub protocol: Protocol,
    pub scan_mode: ScanMode,
    pub ip_version: IpVersion,
    #[serde(default)]
    pub connection_mode: ConnectionMode,
    #[serde(default)]
    pub tun_engine: TunEngine,
    /// Runtime-only derived cache used by the supervisor. `connection_mode` is
    /// the only persisted source of truth.
    #[serde(skip)]
    pub(crate) tun_enabled: bool,
    #[serde(default = "default_true")]
    pub quick_reconnect: bool,
    #[serde(default)]
    pub masque_http2: bool,
    #[serde(default = "default_masque_noize")]
    pub masque_noize: MasqueNoize,
    #[serde(default = "default_wg_noize")]
    pub wg_noize: WgNoize,
    /// Resolver used by the system TUN engines. Only IP literals are accepted so
    /// selecting DNS never requires an unprotected bootstrap lookup.
    #[serde(default = "default_dns_server")]
    pub dns_server: String,
    /// Aether-GUI intentionally keeps the unauthenticated SOCKS listener on a
    /// loopback address. The port is user-configurable, but LAN exposure is
    /// rejected in the backend as well as hidden from the UI.
    #[serde(default = "default_bind_address")]
    pub bind_address: String,
}

static ACTIVE_DNS_SERVER: OnceLock<RwLock<String>> = OnceLock::new();

fn default_true() -> bool {
    true
}

fn default_masque_noize() -> MasqueNoize {
    MasqueNoize::Firewall
}

fn default_wg_noize() -> WgNoize {
    WgNoize::Balanced
}

fn default_dns_server() -> String {
    "1.1.1.1".into()
}

fn default_bind_address() -> String {
    "127.0.0.1:1819".into()
}

fn active_dns_cell() -> &'static RwLock<String> {
    ACTIVE_DNS_SERVER.get_or_init(|| RwLock::new(default_dns_server()))
}

fn set_active_dns_server(value: &str) {
    if let Ok(mut active) = active_dns_cell().write() {
        *active = value.to_string();
    }
}

pub fn active_dns_server() -> String {
    active_dns_cell()
        .read()
        .map(|active| active.clone())
        .unwrap_or_else(|_| default_dns_server())
}

pub fn sanitize_dns_server(value: &str) -> String {
    let Ok(ip) = value.trim().parse::<IpAddr>() else {
        return default_dns_server();
    };
    if ip.is_unspecified() || ip.is_multicast() {
        return default_dns_server();
    }
    ip.to_string()
}

pub fn sanitize_bind_address(value: &str) -> String {
    let Ok(addr) = value.parse::<SocketAddr>() else {
        return default_bind_address();
    };
    if addr.ip().is_loopback() {
        return addr.to_string();
    }
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), addr.port()).to_string()
}

fn help_supports(help: Option<&str>, flag: &str) -> bool {
    let Some(help) = help else {
        return true;
    };
    help.lines().any(|line| {
        line.split_whitespace()
            .map(|token| token.trim_matches([',', ';']))
            .any(|token| token == flag)
    })
}

impl ConnectionProfile {
    pub fn sanitized(mut self) -> Self {
        self.dns_server = sanitize_dns_server(&self.dns_server);
        set_active_dns_server(&self.dns_server);
        self.bind_address = sanitize_bind_address(&self.bind_address);
        self.tun_enabled = self.connection_mode.uses_tun();
        self
    }

    pub fn uses_tun(&self) -> bool {
        self.connection_mode.uses_tun()
    }

    pub fn as_args_for_help(&self, help: Option<&str>) -> Vec<String> {
        let mut args = Vec::with_capacity(12);

        let protocol_flag = match self.protocol {
            Protocol::Auto => None,
            Protocol::Masque => Some("--masque"),
            Protocol::Wireguard => Some("--wg"),
            Protocol::Gool => Some("--gool"),
        };
        if let Some(flag) = protocol_flag.filter(|flag| help_supports(help, flag)) {
            args.push(flag.into());
        }

        let scan_flag = match self.scan_mode {
            ScanMode::Turbo => "--turbo",
            ScanMode::Balanced => "--balanced",
            ScanMode::Thorough => "--thorough",
            ScanMode::Stealth => "--stealth",
            ScanMode::Ironclad => "--ironclad",
        };
        if help_supports(help, scan_flag) {
            args.push(scan_flag.into());
        }

        let ip_flag = match self.ip_version {
            IpVersion::V4 => "-4",
            IpVersion::V6 => "-6",
            IpVersion::Both => "--dual",
        };
        if help_supports(help, ip_flag) {
            args.push(ip_flag.into());
        }

        let reconnect_flag = if self.quick_reconnect {
            "--quick-reconnect"
        } else {
            "--no-quick-reconnect"
        };
        if help_supports(help, reconnect_flag) {
            args.push(reconnect_flag.into());
        }

        if help_supports(help, "--noize") {
            args.push("--noize".into());
            args.push(
                match self.protocol {
                    Protocol::Auto | Protocol::Masque => self.masque_noize.as_flag(),
                    Protocol::Wireguard | Protocol::Gool => self.wg_noize.as_flag(),
                }
                .into(),
            );
        }

        let safe_bind = sanitize_bind_address(&self.bind_address);
        if safe_bind != default_bind_address() && help_supports(help, "--bind") {
            args.push("--bind".into());
            args.push(safe_bind);
        }
        args
    }
}

impl Default for ConnectionProfile {
    fn default() -> Self {
        Self {
            protocol: Protocol::Auto,
            scan_mode: ScanMode::Balanced,
            ip_version: IpVersion::V4,
            connection_mode: ConnectionMode::Proxy,
            tun_engine: TunEngine::Xray,
            tun_enabled: false,
            quick_reconnect: true,
            masque_http2: false,
            masque_noize: MasqueNoize::Firewall,
            wg_noize: WgNoize::Balanced,
            dns_server: default_dns_server(),
            bind_address: default_bind_address(),
        }
    }
}

const STORE_FILE: &str = "profile.json";
const STORE_KEY: &str = "last_successful_profile";
const PENDING_ELEVATION_KEY: &str = "pending_elevated_profile";

fn store_error(context: &str, error: impl std::fmt::Display) -> AetherError {
    AetherError::Internal(format!("{context}: {error}"))
}

pub fn load(app: &tauri::AppHandle) -> ConnectionProfile {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store(STORE_FILE) else {
        return ConnectionProfile::default().sanitized();
    };
    store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value::<ConnectionProfile>(v).ok())
        .unwrap_or_default()
        .sanitized()
}

pub fn take_pending_elevation_checked(
    app: &tauri::AppHandle,
) -> Result<Option<ConnectionProfile>, AetherError> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(STORE_FILE)
        .map_err(|error| store_error("failed to open profile store", error))?;
    let Some(profile) = store
        .get(PENDING_ELEVATION_KEY)
        .and_then(|value| serde_json::from_value::<ConnectionProfile>(value).ok())
    else {
        return Ok(None);
    };

    store.set(PENDING_ELEVATION_KEY, serde_json::Value::Null);
    store
        .save()
        .map_err(|error| store_error("failed to clear pending elevation profile", error))?;
    Ok(Some(profile.sanitized()))
}

pub fn take_pending_elevation(app: &tauri::AppHandle) -> Option<ConnectionProfile> {
    match take_pending_elevation_checked(app) {
        Ok(profile) => profile,
        Err(error) => {
            diagnostics::record("profile-store", "error", error.to_string());
            None
        }
    }
}

pub fn save_checked(
    app: &tauri::AppHandle,
    profile: &ConnectionProfile,
) -> Result<(), AetherError> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(STORE_FILE)
        .map_err(|error| store_error("failed to open profile store", error))?;
    let value = serde_json::to_value(profile.clone().sanitized())
        .map_err(|error| store_error("failed to serialize connection settings", error))?;
    store.set(STORE_KEY, value);
    store.set(PENDING_ELEVATION_KEY, serde_json::Value::Null);
    store
        .save()
        .map_err(|error| store_error("failed to persist connection settings", error))
}

pub fn save(app: &tauri::AppHandle, profile: &ConnectionProfile) {
    if let Err(error) = save_checked(app, profile) {
        diagnostics::record("profile-store", "error", error.to_string());
    }
}

pub fn save_pending_elevation_checked(
    app: &tauri::AppHandle,
    profile: &ConnectionProfile,
) -> Result<(), AetherError> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(STORE_FILE)
        .map_err(|error| store_error("failed to open profile store", error))?;
    let value = serde_json::to_value(profile.clone().sanitized())
        .map_err(|error| store_error("failed to serialize elevation profile", error))?;
    store.set(PENDING_ELEVATION_KEY, value);
    store
        .save()
        .map_err(|error| store_error("failed to persist elevation profile", error))
}

#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn save_pending_elevation(app: &tauri::AppHandle, profile: &ConnectionProfile) {
    if let Err(error) = save_pending_elevation_checked(app, profile) {
        diagnostics::record("profile-store", "error", error.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_loopback_port_is_forwarded() {
        let p = ConnectionProfile {
            bind_address: "127.0.0.1:1919".into(),
            ..ConnectionProfile::default()
        };
        let args = p.as_args_for_help(None);
        let i = args
            .iter()
            .position(|a| a == "--bind")
            .expect("missing --bind");
        assert_eq!(args.get(i + 1).map(String::as_str), Some("127.0.0.1:1919"));
    }

    #[test]
    fn lan_bind_is_rewritten_to_loopback() {
        assert_eq!(sanitize_bind_address("0.0.0.0:9999"), "127.0.0.1:9999");
        assert_eq!(sanitize_bind_address("192.168.1.2:1819"), "127.0.0.1:1819");
    }

    #[test]
    fn dns_server_defaults_to_cloudflare_and_rejects_invalid_values() {
        assert_eq!(sanitize_dns_server("8.8.8.8"), "8.8.8.8");
        assert_eq!(sanitize_dns_server("2001:4860:4860::8888"), "2001:4860:4860::8888");
        assert_eq!(sanitize_dns_server("not-a-resolver"), "1.1.1.1");
        assert_eq!(sanitize_dns_server("0.0.0.0"), "1.1.1.1");
    }

    #[test]
    fn missing_connection_mode_defaults_to_proxy_xray_and_cloudflare_dns() {
        let json = r#"{"protocol":"auto","scan_mode":"balanced","ip_version":"v4","quick_reconnect":true,"masque_http2":false,"bind_address":"127.0.0.1:1919"}"#;
        let p: ConnectionProfile = serde_json::from_str(json).unwrap();
        assert_eq!(p.connection_mode, ConnectionMode::Proxy);
        assert_eq!(p.tun_engine, TunEngine::Xray);
        assert_eq!(p.dns_server, "1.1.1.1");
        assert!(!p.uses_tun());
    }

    #[test]
    fn tunnel_modes_derive_runtime_tun_flag() {
        let tunnel = ConnectionProfile {
            connection_mode: ConnectionMode::Tunnel,
            ..ConnectionProfile::default()
        }
        .sanitized();
        let both = ConnectionProfile {
            connection_mode: ConnectionMode::Both,
            ..ConnectionProfile::default()
        }
        .sanitized();
        assert!(tunnel.tun_enabled);
        assert!(both.tun_enabled);
    }

    #[test]
    fn default_emits_noize() {
        let p = ConnectionProfile::default();
        let args = p.as_args_for_help(None);
        let i = args
            .iter()
            .position(|a| a == "--noize")
            .expect("missing --noize");
        assert_eq!(args.get(i + 1).map(String::as_str), Some("firewall"));
    }

    #[test]
    fn unsupported_future_flags_are_not_forwarded() {
        let p = ConnectionProfile {
            protocol: Protocol::Gool,
            scan_mode: ScanMode::Ironclad,
            ..ConnectionProfile::default()
        };
        let help = "Usage: aether [OPTIONS]\n  --masque\n  --balanced\n  -4\n  --bind <addr>";
        let args = p.as_args_for_help(Some(help));
        assert!(!args.iter().any(|arg| arg == "--gool"));
        assert!(!args.iter().any(|arg| arg == "--ironclad"));
        assert!(args.iter().any(|arg| arg == "-4"));
    }
}
