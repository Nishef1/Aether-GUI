use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

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
    #[serde(default = "default_true")]
    pub quick_reconnect: bool,
    #[serde(default)]
    pub masque_http2: bool,
    #[serde(default = "default_masque_noize")]
    pub masque_noize: MasqueNoize,
    #[serde(default = "default_wg_noize")]
    pub wg_noize: WgNoize,
    /// Aether-GUI intentionally keeps the unauthenticated SOCKS listener on a
    /// loopback address. The port is user-configurable, but LAN exposure is
    /// rejected in the backend as well as hidden from the UI.
    #[serde(default = "default_bind_address")]
    pub bind_address: String,
    /// Route the whole system through Aether's SOCKS proxy using sing-box TUN.
    #[serde(default)]
    pub tun_enabled: bool,
}

fn default_true() -> bool {
    true
}

fn default_masque_noize() -> MasqueNoize {
    MasqueNoize::Firewall
}

fn default_wg_noize() -> WgNoize {
    WgNoize::Balanced
}

fn default_bind_address() -> String {
    "127.0.0.1:1819".into()
}

/// Preserve a valid custom port while forcing the listener back to loopback.
/// This also repairs profiles saved by older GUI versions that allowed
/// `0.0.0.0`, which exposed Aether's unauthenticated SOCKS proxy to the LAN.
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
        // If capability discovery itself fails, preserve current behavior.
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
        self.bind_address = sanitize_bind_address(&self.bind_address);
        self
    }

    pub fn as_args(&self) -> Vec<String> {
        self.as_args_for_help(None)
    }

    /// Build arguments against the *active* independently-updated Aether core.
    /// When `--help` is available we only pass flags advertised by that binary;
    /// unsupported settings fall back to Aether's interactive prompts/defaults
    /// instead of making a future core fail immediately on an unknown option.
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
            quick_reconnect: true,
            masque_http2: false,
            masque_noize: MasqueNoize::Firewall,
            wg_noize: WgNoize::Balanced,
            bind_address: default_bind_address(),
            tun_enabled: false,
        }
    }
}

const STORE_FILE: &str = "profile.json";
const STORE_KEY: &str = "last_successful_profile";
const PENDING_ELEVATION_KEY: &str = "pending_elevated_profile";

/// Load only the last profile that reached a proven Connected/Tunneling state.
/// Elevation-resume state is intentionally handled by `take_pending_elevation`
/// so a normal app launch never auto-connects just because TUN was used before.
pub fn load(app: &tauri::AppHandle) -> ConnectionProfile {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store(STORE_FILE) else {
        return ConnectionProfile::default();
    };
    store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value::<ConnectionProfile>(v).ok())
        .unwrap_or_default()
        .sanitized()
}

pub fn take_pending_elevation(app: &tauri::AppHandle) -> Option<ConnectionProfile> {
    use tauri_plugin_store::StoreExt;
    let store = app.store(STORE_FILE).ok()?;
    let profile = store
        .get(PENDING_ELEVATION_KEY)
        .and_then(|v| serde_json::from_value::<ConnectionProfile>(v).ok())?
        .sanitized();
    store.set(PENDING_ELEVATION_KEY, serde_json::Value::Null);
    let _ = store.save();
    Some(profile)
}

pub fn save(app: &tauri::AppHandle, profile: &ConnectionProfile) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store(STORE_FILE) {
        if let Ok(value) = serde_json::to_value(profile.clone().sanitized()) {
            store.set(STORE_KEY, value);
            store.set(PENDING_ELEVATION_KEY, serde_json::Value::Null);
            let _ = store.save();
        }
    }
}

pub fn save_pending_elevation(app: &tauri::AppHandle, profile: &ConnectionProfile) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store(STORE_FILE) {
        if let Ok(value) = serde_json::to_value(profile.clone().sanitized()) {
            store.set(PENDING_ELEVATION_KEY, value);
            let _ = store.save();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_loopback_port_is_forwarded() {
        let mut p = ConnectionProfile::default();
        p.bind_address = "127.0.0.1:1919".into();
        let args = p.as_args();
        let i = args.iter().position(|a| a == "--bind").expect("missing --bind");
        assert_eq!(args.get(i + 1).map(String::as_str), Some("127.0.0.1:1919"));
    }

    #[test]
    fn lan_bind_is_rewritten_to_loopback() {
        assert_eq!(sanitize_bind_address("0.0.0.0:9999"), "127.0.0.1:9999");
        assert_eq!(sanitize_bind_address("192.168.1.2:1819"), "127.0.0.1:1819");
    }

    #[test]
    fn old_profile_json_gets_safe_defaults() {
        let json = r#"{"protocol":"auto","scan_mode":"balanced","ip_version":"v4","quick_reconnect":true,"masque_http2":false,"bind_address":"0.0.0.0:1919"}"#;
        let p: ConnectionProfile = serde_json::from_str(json).unwrap();
        let p = p.sanitized();
        assert_eq!(p.bind_address, "127.0.0.1:1919");
        assert!(!p.tun_enabled);
    }

    #[test]
    fn default_emits_noize() {
        let p = ConnectionProfile::default();
        let args = p.as_args();
        let i = args.iter().position(|a| a == "--noize").expect("missing --noize");
        assert_eq!(args.get(i + 1).map(String::as_str), Some("firewall"));
    }

    #[test]
    fn unsupported_future_flags_are_not_forwarded() {
        let mut p = ConnectionProfile::default();
        p.protocol = Protocol::Gool;
        p.scan_mode = ScanMode::Ironclad;
        let help = "Usage: aether [OPTIONS]\n  --masque\n  --balanced\n  -4\n  --bind <addr>";
        let args = p.as_args_for_help(Some(help));
        assert!(!args.iter().any(|arg| arg == "--gool"));
        assert!(!args.iter().any(|arg| arg == "--ironclad"));
        assert!(args.iter().any(|arg| arg == "-4"));
    }
}
