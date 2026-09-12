use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    #[default]
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

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ScanMode {
    Turbo,
    #[default]
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

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum IpVersion {
    #[default]
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
pub enum NoizeProfile {
    Off,
    Light,
    #[default]
    Firewall,
    Balanced,
    Gfw,
    Aggressive,
}

impl NoizeProfile {
    pub fn as_flag(&self) -> &'static str {
        match self {
            NoizeProfile::Off => "off",
            NoizeProfile::Light => "light",
            NoizeProfile::Firewall => "firewall",
            NoizeProfile::Balanced => "balanced",
            NoizeProfile::Gfw => "gfw",
            NoizeProfile::Aggressive => "aggressive",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum MasqueMask {
    #[default]
    Off,
    Legacy,
    Clienthello,
    Patterniha,
}

impl MasqueMask {
    pub fn as_env(&self) -> &'static str {
        match self {
            MasqueMask::Off => "off",
            MasqueMask::Legacy => "legacy",
            MasqueMask::Clienthello => "clienthello",
            MasqueMask::Patterniha => "patterniha-experimental",
        }
    }

    pub fn is_off(&self) -> bool {
        matches!(self, MasqueMask::Off)
    }

    fn uses_legacy_fragment_controls(&self) -> bool {
        matches!(self, MasqueMask::Legacy)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TlsProfile {
    #[default]
    Automatic,
    Current,
    NativeMinimal,
    Compatibility,
    Experimental,
}

impl TlsProfile {
    pub fn as_env(&self) -> &'static str {
        match self {
            TlsProfile::Automatic => "automatic",
            TlsProfile::Current => "current",
            TlsProfile::NativeMinimal => "native-minimal",
            TlsProfile::Compatibility => "compatibility",
            TlsProfile::Experimental => "experimental",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PerfProfile {
    #[default]
    Auto,
    Low,
    Medium,
    High,
}

impl PerfProfile {
    fn as_flag(&self) -> Option<&'static str> {
        match self {
            PerfProfile::Auto => None,
            PerfProfile::Low => Some("low"),
            PerfProfile::Medium => Some("medium"),
            PerfProfile::High => Some("high"),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ZeroTrustAuth {
    #[default]
    Email,
    Service,
    Token,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ConnectionProfile {
    #[serde(default)]
    pub protocol: Protocol,
    #[serde(default)]
    pub scan_mode: ScanMode,
    #[serde(default)]
    pub ip_version: IpVersion,
    #[serde(default)]
    pub quick_reconnect: bool,
    #[serde(default)]
    pub masque_http2: bool,
    #[serde(default = "default_masque_noize")]
    pub masque_noize: NoizeProfile,
    #[serde(default = "default_wg_noize")]
    pub wg_noize: NoizeProfile,
    #[serde(default = "default_bind_address")]
    pub bind_address: String,
    #[serde(default)]
    pub http_proxy: String,
    #[serde(default)]
    pub upstream: String,
    #[serde(default)]
    pub dns: String,
    #[serde(default = "default_mtu")]
    pub mtu: u16,
    #[serde(default)]
    pub peer: String,
    #[serde(default)]
    pub wg_peer: String,
    #[serde(default)]
    pub wiw_outer: String,
    #[serde(default)]
    pub wiw_inner: String,
    #[serde(default)]
    pub wiw_scan: bool,
    #[serde(default)]
    pub h2_peer: String,
    #[serde(default)]
    pub ech: String,
    #[serde(default)]
    pub no_data_check: bool,
    #[serde(default = "default_validate_secs")]
    pub validate_secs: u16,
    #[serde(default = "default_reconnect_secs")]
    pub reconnect_secs: u16,
    /// Explicit v2 ClientHello mask mode. Old profiles without this field keep
    /// using `fragment=true` as the legacy random TCP-fragment switch.
    #[serde(default)]
    pub masque_mask: MasqueMask,
    #[serde(default)]
    pub fragment: bool,
    #[serde(default = "default_fragment_size")]
    pub fragment_size: String,
    #[serde(default = "default_fragment_delay")]
    pub fragment_delay: String,
    #[serde(default = "default_keepalive")]
    pub keepalive: u16,
    #[serde(default)]
    pub no_profile_retry: bool,
    #[serde(default)]
    pub tls_profile: TlsProfile,
    #[serde(default)]
    pub tls_groups: String,
    #[serde(default)]
    pub perf_profile: PerfProfile,
    #[serde(default = "default_true")]
    pub route_sniff: bool,
    #[serde(default = "default_route_sniff_ms")]
    pub route_sniff_ms: u16,
    #[serde(default = "default_true")]
    pub auto_reprovision: bool,
    #[serde(default)]
    pub zero_trust_team: String,
    #[serde(default)]
    pub zero_trust_auth: ZeroTrustAuth,
    #[serde(default)]
    pub access_email: String,
    #[serde(default)]
    pub access_client_id: String,
    #[serde(default)]
    pub access_client_secret: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub zero_trust_gateway: bool,
    #[serde(default)]
    pub route_block: String,
    #[serde(default)]
    pub route_direct: String,
    #[serde(default)]
    pub routes_file: String,
    /// Frontend Automatic expands one user profile into concrete transport
    /// attempts. Those runtime candidates must never replace persisted intent.
    #[serde(default, skip_serializing_if = "is_false")]
    pub runtime_only: bool,
}

fn default_masque_noize() -> NoizeProfile {
    NoizeProfile::Firewall
}

fn default_wg_noize() -> NoizeProfile {
    NoizeProfile::Balanced
}

fn default_bind_address() -> String {
    "127.0.0.1:1819".into()
}

const fn default_mtu() -> u16 {
    1280
}

const fn default_validate_secs() -> u16 {
    10
}

const fn default_reconnect_secs() -> u16 {
    2
}

const fn default_keepalive() -> u16 {
    25
}

const fn default_route_sniff_ms() -> u16 {
    400
}

const fn default_true() -> bool {
    true
}

fn default_fragment_size() -> String {
    "16-32".into()
}

fn default_fragment_delay() -> String {
    "2-10".into()
}

fn push_non_empty(args: &mut Vec<String>, flag: &str, value: &str) {
    let value = value.trim();
    if !value.is_empty() {
        args.push(flag.into());
        args.push(value.into());
    }
}

impl ConnectionProfile {
    pub fn as_args(&self) -> Vec<String> {
        let mut args = Vec::with_capacity(48);
        match self.protocol {
            Protocol::Auto | Protocol::Masque => args.push("--masque".into()),
            Protocol::Wireguard => args.push("--wg".into()),
            Protocol::Gool => args.push("--gool".into()),
        }
        args.push(match self.scan_mode {
            ScanMode::Turbo => "--turbo".into(),
            ScanMode::Balanced => "--balanced".into(),
            ScanMode::Thorough => "--thorough".into(),
            ScanMode::Stealth => "--stealth".into(),
            ScanMode::Ironclad => "--ironclad".into(),
        });
        args.push(match self.ip_version {
            IpVersion::V4 => "-4".into(),
            IpVersion::V6 => "-6".into(),
            IpVersion::Both => "--dual".into(),
        });
        args.push(if self.quick_reconnect {
            "--quick-reconnect".into()
        } else {
            "--no-quick-reconnect".into()
        });
        args.push("--noize".into());
        args.push(
            match self.protocol {
                Protocol::Auto | Protocol::Masque => self.masque_noize.as_flag(),
                Protocol::Wireguard | Protocol::Gool => self.wg_noize.as_flag(),
            }
            .into(),
        );

        if self.bind_address != default_bind_address()
            && self.bind_address.parse::<std::net::SocketAddr>().is_ok()
        {
            args.push("--bind".into());
            args.push(self.bind_address.clone());
        }
        if self
            .http_proxy
            .trim()
            .parse::<std::net::SocketAddr>()
            .is_ok()
        {
            push_non_empty(&mut args, "--http-proxy", &self.http_proxy);
        }

        match self.protocol {
            Protocol::Auto | Protocol::Masque => {
                push_non_empty(&mut args, "--peer", &self.peer);
                if self.masque_http2 {
                    args.push("--h2".into());
                    push_non_empty(&mut args, "--h2-peer", &self.h2_peer);
                    let legacy_fragment =
                        self.fragment || self.masque_mask.uses_legacy_fragment_controls();
                    if legacy_fragment {
                        args.push("--fragment".into());
                        push_non_empty(&mut args, "--fragment-size", &self.fragment_size);
                        push_non_empty(&mut args, "--fragment-delay", &self.fragment_delay);
                    }
                }
                push_non_empty(&mut args, "--ech", &self.ech);
            }
            Protocol::Wireguard => {
                push_non_empty(&mut args, "--peer", &self.peer);
            }
            Protocol::Gool => {
                if self.wiw_scan {
                    args.push("--wiw-scan".into());
                } else {
                    if self.wiw_outer.trim().is_empty() {
                        push_non_empty(&mut args, "--wg-peer", &self.wg_peer);
                    }
                    push_non_empty(&mut args, "--wiw-outer", &self.wiw_outer);
                    push_non_empty(&mut args, "--wiw-inner", &self.wiw_inner);
                }
            }
        }

        if self.no_data_check {
            args.push("--no-data-check".into());
        }
        args.push("--validate-secs".into());
        args.push(self.validate_secs.clamp(1, 120).to_string());
        args.push("--reconnect-secs".into());
        args.push(self.reconnect_secs.clamp(1, 60).to_string());
        push_non_empty(&mut args, "--dns", &self.dns);

        if matches!(self.protocol, Protocol::Wireguard | Protocol::Gool) {
            args.push("--keepalive".into());
            args.push(self.keepalive.clamp(1, 120).to_string());
            if self.no_profile_retry {
                args.push("--no-profile-retry".into());
            }
        }

        if !self.zero_trust_team.trim().is_empty() {
            push_non_empty(&mut args, "--team", &self.zero_trust_team);
            if self.zero_trust_gateway {
                args.push("--gateway".into());
            }
        }
        push_non_empty(&mut args, "--route-block", &self.route_block);
        push_non_empty(&mut args, "--route-direct", &self.route_direct);
        push_non_empty(&mut args, "--routes", &self.routes_file);
        push_non_empty(&mut args, "--tls-groups", &self.tls_groups);
        if let Some(value) = self.perf_profile.as_flag() {
            args.push("--perf".into());
            args.push(value.into());
        }
        args
    }

    pub fn zero_trust_env(&self) -> Option<(&'static str, &str)> {
        if self.zero_trust_team.trim().is_empty() {
            return None;
        }
        match self.zero_trust_auth {
            ZeroTrustAuth::Email if !self.access_email.trim().is_empty() => {
                Some(("AETHER_ACCESS_EMAIL", self.access_email.trim()))
            }
            ZeroTrustAuth::Service => None,
            ZeroTrustAuth::Token if !self.access_token.trim().is_empty() => {
                Some(("AETHER_ACCESS_TOKEN", self.access_token.trim()))
            }
            _ => None,
        }
    }
}

impl Default for ConnectionProfile {
    fn default() -> Self {
        Self {
            protocol: Protocol::Auto,
            // Fresh installs use the reachability-first path. Persisted profiles
            // keep their explicit scan mode through serde and are not migrated.
            scan_mode: ScanMode::Turbo,
            ip_version: IpVersion::V4,
            quick_reconnect: true,
            masque_http2: true,
            masque_noize: NoizeProfile::Firewall,
            wg_noize: NoizeProfile::Balanced,
            bind_address: default_bind_address(),
            http_proxy: String::new(),
            upstream: String::new(),
            dns: String::new(),
            mtu: default_mtu(),
            peer: String::new(),
            wg_peer: String::new(),
            wiw_outer: String::new(),
            wiw_inner: String::new(),
            wiw_scan: false,
            h2_peer: String::new(),
            ech: String::new(),
            no_data_check: false,
            validate_secs: default_validate_secs(),
            reconnect_secs: default_reconnect_secs(),
            masque_mask: MasqueMask::Off,
            fragment: false,
            fragment_size: default_fragment_size(),
            fragment_delay: default_fragment_delay(),
            keepalive: default_keepalive(),
            no_profile_retry: false,
            tls_profile: TlsProfile::Automatic,
            tls_groups: String::new(),
            perf_profile: PerfProfile::Auto,
            route_sniff: true,
            route_sniff_ms: default_route_sniff_ms(),
            auto_reprovision: true,
            zero_trust_team: String::new(),
            zero_trust_auth: ZeroTrustAuth::Email,
            access_email: String::new(),
            access_client_id: String::new(),
            access_client_secret: String::new(),
            access_token: String::new(),
            zero_trust_gateway: false,
            route_block: String::new(),
            route_direct: String::new(),
            routes_file: String::new(),
            runtime_only: false,
        }
    }
}

const STORE_FILE: &str = "profile.json";
const STORE_KEY: &str = "last_successful_profile";

pub fn load(app: &tauri::AppHandle) -> ConnectionProfile {
    use tauri_plugin_store::StoreExt;
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(STORE_KEY))
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

pub fn save(app: &tauri::AppHandle, profile: &ConnectionProfile) {
    if profile.runtime_only {
        return;
    }
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store(STORE_FILE) {
        let mut persisted = profile.clone();
        persisted.runtime_only = false;
        persisted.access_email.clear();
        persisted.access_client_id.clear();
        persisted.access_client_secret.clear();
        persisted.access_token.clear();
        persisted.upstream.clear();
        if let Ok(value) = serde_json::to_value(persisted) {
            store.set(STORE_KEY, value);
            let _ = store.save();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has_pair(args: &[String], flag: &str, value: &str) -> bool {
        args.windows(2)
            .any(|pair| pair[0] == flag && pair[1] == value)
    }

    #[test]
    fn defaults_match_aether_19_safe_path() {
        let profile = ConnectionProfile::default();
        let args = profile.as_args();
        assert_eq!(args.first().map(String::as_str), Some("--masque"));
        assert!(args.iter().any(|arg| arg == "--turbo"));
        assert!(args.iter().any(|arg| arg == "--quick-reconnect"));
        assert!(args.iter().any(|arg| arg == "--h2"));
        assert_eq!(profile.keepalive, 25);
        assert!(profile.route_sniff);
        assert!(profile.auto_reprovision);
        assert_eq!(profile.masque_mask, MasqueMask::Off);
        assert_eq!(profile.tls_profile, TlsProfile::Automatic);
        assert!(!profile.runtime_only);
    }

    #[test]
    fn old_fragment_profiles_keep_legacy_flags() {
        let profile = ConnectionProfile {
            protocol: Protocol::Masque,
            masque_http2: true,
            fragment: true,
            ..Default::default()
        };
        let args = profile.as_args();
        assert!(args.iter().any(|arg| arg == "--fragment"));
        assert!(has_pair(&args, "--fragment-size", "16-32"));
    }

    #[test]
    fn explicit_legacy_mask_uses_existing_fragment_tuning() {
        let profile = ConnectionProfile {
            protocol: Protocol::Masque,
            masque_http2: true,
            masque_mask: MasqueMask::Legacy,
            ..Default::default()
        };
        let args = profile.as_args();
        assert!(args.iter().any(|arg| arg == "--fragment"));
        assert!(has_pair(&args, "--fragment-delay", "2-10"));
    }

    #[test]
    fn deterministic_masks_do_not_emit_legacy_fragment_flags() {
        for masque_mask in [MasqueMask::Clienthello, MasqueMask::Patterniha] {
            let profile = ConnectionProfile {
                protocol: Protocol::Masque,
                masque_http2: true,
                masque_mask,
                ..Default::default()
            };
            let args = profile.as_args();
            assert!(!args.iter().any(|arg| arg == "--fragment"));
        }
    }

    #[test]
    fn stale_masque_values_never_leak_into_wireguard() {
        let profile = ConnectionProfile {
            protocol: Protocol::Wireguard,
            masque_http2: true,
            masque_mask: MasqueMask::Patterniha,
            fragment: true,
            ..Default::default()
        };
        let args = profile.as_args();
        assert!(!args.iter().any(|arg| matches!(
            arg.as_str(),
            "--h2" | "--h2-peer" | "--ech" | "--fragment" | "--fragment-size" | "--fragment-delay"
        )));
    }

    #[test]
    fn old_profile_json_gets_new_optional_defaults_without_rewriting_explicit_choices() {
        let json = r#"{"protocol":"auto","scan_mode":"balanced","ip_version":"v4"}"#;
        let profile: ConnectionProfile = serde_json::from_str(json).unwrap();
        assert_eq!(profile.scan_mode, ScanMode::Balanced);
        assert!(!profile.quick_reconnect);
        assert!(!profile.masque_http2);
        assert_eq!(profile.keepalive, 25);
        assert_eq!(profile.masque_mask, MasqueMask::Off);
        assert_eq!(profile.tls_profile, TlsProfile::Automatic);
        assert!(profile.route_sniff);
        assert!(profile.auto_reprovision);
        assert_eq!(profile.mtu, 1280);
        assert!(!profile.runtime_only);
    }

    #[test]
    fn runtime_only_marker_is_not_serialized_when_false() {
        let json = serde_json::to_string(&ConnectionProfile::default()).unwrap();
        assert!(!json.contains("runtime_only"));
    }
}
