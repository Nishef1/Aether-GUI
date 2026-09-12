use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs, io,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_aether_vpn::{AetherVpnExt, DiagnosticsExport, VpnProfile, VpnStatus};

const MOBILE_SETTINGS_VERSION: u8 = 3;
const DEFAULT_MTU: u16 = 1280;
const MIN_MTU: u16 = 1280;
const MAX_MTU: u16 = 1500;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum MobileSystemTunnel {
    Off,
    #[default]
    Native,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
struct MobileConnectionProfile {
    protocol: String,
    scan_mode: String,
    ip_version: String,
    quick_reconnect: bool,
    masque_http2: bool,
    masque_noize: String,
    wg_noize: String,
    bind_address: String,
    http_proxy: String,
    upstream: String,
    dns: String,
    mtu: u16,
    peer: String,
    wg_peer: String,
    wiw_outer: String,
    wiw_inner: String,
    wiw_scan: bool,
    h2_peer: String,
    ech: String,
    no_data_check: bool,
    validate_secs: u16,
    reconnect_secs: u16,
    /// Optional because profiles saved before mask v2 only carry the legacy
    /// `fragment` boolean. `None` intentionally preserves that old behavior.
    masque_mask: Option<String>,
    fragment: bool,
    fragment_size: String,
    fragment_delay: String,
    keepalive: u16,
    no_profile_retry: bool,
    tls_groups: String,
    perf_profile: String,
    route_sniff: bool,
    route_sniff_ms: u16,
    auto_reprovision: bool,
    zero_trust_team: String,
    zero_trust_auth: String,
    access_email: String,
    access_client_id: String,
    access_client_secret: String,
    access_token: String,
    zero_trust_gateway: bool,
    route_block: String,
    route_direct: String,
    routes_file: String,
    /// Concrete Automatic candidates are execution-only and must not replace
    /// the user's saved Automatic profile.
    runtime_only: bool,
}

impl Default for MobileConnectionProfile {
    fn default() -> Self {
        Self {
            protocol: "auto".into(),
            // Fresh installs match the reachability-first desktop policy.
            // Existing mobile-settings.json values are deserialized as-is.
            scan_mode: "turbo".into(),
            ip_version: "v4".into(),
            quick_reconnect: true,
            masque_http2: true,
            masque_noize: "firewall".into(),
            wg_noize: "balanced".into(),
            bind_address: "127.0.0.1:1819".into(),
            http_proxy: String::new(),
            upstream: String::new(),
            dns: String::new(),
            mtu: DEFAULT_MTU,
            peer: String::new(),
            wg_peer: String::new(),
            wiw_outer: String::new(),
            wiw_inner: String::new(),
            wiw_scan: false,
            h2_peer: String::new(),
            ech: String::new(),
            no_data_check: false,
            validate_secs: 10,
            reconnect_secs: 2,
            masque_mask: None,
            fragment: false,
            fragment_size: "16-32".into(),
            fragment_delay: "2-10".into(),
            keepalive: 25,
            no_profile_retry: false,
            tls_groups: String::new(),
            perf_profile: "auto".into(),
            route_sniff: true,
            route_sniff_ms: 400,
            auto_reprovision: true,
            zero_trust_team: String::new(),
            zero_trust_auth: "email".into(),
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

impl MobileConnectionProfile {
    fn without_secrets(&self) -> Self {
        let mut sanitized = self.clone();
        sanitized.access_email.clear();
        sanitized.access_client_id.clear();
        sanitized.access_client_secret.clear();
        sanitized.access_token.clear();
        sanitized.upstream.clear();
        sanitized.runtime_only = false;
        sanitized
    }

    fn apply_h2_mask_bridge(&mut self) {
        if !self.masque_http2 {
            self.fragment = false;
            return;
        }

        match self.masque_mask.as_deref() {
            None => {}
            Some("off") => self.fragment = false,
            Some("legacy") => self.fragment = true,
            Some("clienthello") => {
                self.fragment = true;
                self.fragment_size = "clienthello".into();
                self.fragment_delay = "0".into();
            }
            Some("patterniha") => {
                self.fragment = true;
                self.fragment_size = "patterniha".into();
                self.fragment_delay = "0".into();
            }
            Some(_) => self.fragment = false,
        }
    }

    fn for_runtime(mut self) -> Self {
        match self.protocol.as_str() {
            "wireguard" => {
                self.wg_peer.clear();
                self.wiw_outer.clear();
                self.wiw_inner.clear();
                self.wiw_scan = false;
                self.masque_http2 = false;
                self.h2_peer.clear();
                self.ech.clear();
                self.fragment = false;
            }
            "gool" => {
                self.peer.clear();
                self.masque_http2 = false;
                self.h2_peer.clear();
                self.ech.clear();
                self.fragment = false;
                if self.wiw_scan {
                    self.wg_peer.clear();
                    self.wiw_outer.clear();
                    self.wiw_inner.clear();
                } else if !self.wiw_outer.trim().is_empty() {
                    self.wg_peer.clear();
                }
            }
            _ => {
                self.wg_peer.clear();
                self.wiw_outer.clear();
                self.wiw_inner.clear();
                self.wiw_scan = false;
                if !self.masque_http2 {
                    self.h2_peer.clear();
                }
                self.apply_h2_mask_bridge();
            }
        }
        self
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct MobileSettings {
    #[serde(default = "settings_version")]
    version: u8,
    #[serde(default)]
    profile: MobileConnectionProfile,
    #[serde(default)]
    system_tunnel: MobileSystemTunnel,
}

const fn settings_version() -> u8 {
    MOBILE_SETTINGS_VERSION
}

impl Default for MobileSettings {
    fn default() -> Self {
        Self {
            version: MOBILE_SETTINGS_VERSION,
            profile: MobileConnectionProfile::default(),
            system_tunnel: MobileSystemTunnel::Native,
        }
    }
}

#[derive(Default)]
struct MobileState {
    settings: Mutex<MobileSettings>,
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("mobile-settings.json"))
        .map_err(|error| error.to_string())
}

fn load_settings(app: &AppHandle) -> MobileSettings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|body| serde_json::from_str(&body).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &MobileSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut persisted = settings.clone();
    persisted.profile = persisted.profile.without_secrets();
    persisted.version = MOBILE_SETTINGS_VERSION;
    let temporary = path.with_extension("json.new");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&persisted).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn validate_profile(profile: &MobileConnectionProfile) -> Result<(), String> {
    if !matches!(
        profile.protocol.as_str(),
        "auto" | "masque" | "wireguard" | "gool"
    ) {
        return Err("Unknown connection protocol".into());
    }
    if !matches!(
        profile.scan_mode.as_str(),
        "turbo" | "balanced" | "thorough" | "stealth" | "ironclad"
    ) {
        return Err("Unknown route discovery mode".into());
    }
    if !matches!(profile.ip_version.as_str(), "v4" | "v6" | "both") {
        return Err("Unknown IP version selection".into());
    }
    if !matches!(
        profile.masque_noize.as_str(),
        "off" | "light" | "firewall" | "balanced" | "gfw" | "aggressive"
    ) || !matches!(
        profile.wg_noize.as_str(),
        "off" | "light" | "firewall" | "balanced" | "gfw" | "aggressive"
    ) {
        return Err("Unknown obfuscation profile".into());
    }
    if !(MIN_MTU..=MAX_MTU).contains(&profile.mtu) {
        return Err(format!("MTU must be between {MIN_MTU} and {MAX_MTU}"));
    }
    if !(1..=120).contains(&profile.validate_secs) {
        return Err("Validation timeout must be between 1 and 120 seconds".into());
    }
    if !(1..=60).contains(&profile.reconnect_secs) {
        return Err("Reconnect delay must be between 1 and 60 seconds".into());
    }
    if !(1..=120).contains(&profile.keepalive) {
        return Err("WireGuard keepalive must be between 1 and 120 seconds".into());
    }
    if !(50..=5_000).contains(&profile.route_sniff_ms) {
        return Err("Route sniff timeout must be between 50 and 5000 milliseconds".into());
    }
    if !matches!(
        profile.perf_profile.as_str(),
        "auto" | "low" | "medium" | "high"
    ) {
        return Err("Unknown performance profile".into());
    }
    if let Some(mask) = profile.masque_mask.as_deref() {
        if !matches!(mask, "off" | "legacy" | "clienthello" | "patterniha") {
            return Err("Unknown HTTP/2 ClientHello mask".into());
        }
    }
    if !profile.dns.trim().is_empty() {
        let resolvers = crate::dns_policy::parse_resolvers(&profile.dns);
        if resolvers.is_empty() {
            return Err("DNS must contain at least one IPv4/IPv6 resolver address".into());
        }
        if resolvers.iter().any(|resolver| resolver.port() != 53) {
            return Err("Android system DNS resolvers must use port 53".into());
        }
        let wrong_family = resolvers
            .iter()
            .any(|resolver| match profile.ip_version.as_str() {
                "v4" => resolver.ip().is_ipv6(),
                "v6" => resolver.ip().is_ipv4(),
                _ => false,
            });
        if wrong_family {
            return Err("DNS resolver family must match the selected Android IP family".into());
        }
    }
    if !profile.http_proxy.trim().is_empty() {
        let address = profile
            .http_proxy
            .trim()
            .parse::<std::net::SocketAddr>()
            .map_err(|_| "HTTP proxy listen address must be ip:port")?;
        if !address.ip().is_loopback() {
            return Err("Android HTTP proxy listener must stay on loopback".into());
        }
    }
    if profile.zero_trust_team.trim().is_empty() {
        return Ok(());
    }
    match profile.zero_trust_auth.as_str() {
        "email" if profile.access_email.trim().is_empty() => {
            Err("Zero Trust email is required".into())
        }
        "service"
            if profile.access_client_id.trim().is_empty()
                || profile.access_client_secret.trim().is_empty() =>
        {
            Err("Zero Trust service-token id and secret are required".into())
        }
        "token" if profile.access_token.trim().is_empty() => {
            Err("Zero Trust access token is required".into())
        }
        "email" | "service" | "token" => Ok(()),
        _ => Err("Unknown Zero Trust authentication method".into()),
    }
}

fn normalize_runtime_dns(profile: &mut MobileConnectionProfile) {
    profile.dns =
        crate::dns_policy::effective_resolvers_for_ip_version(&profile.dns, &profile.ip_version)
            .into_iter()
            .map(|resolver| resolver.ip().to_string())
            .collect::<Vec<_>>()
            .join(",");
}

fn primary_dns(profile: &MobileConnectionProfile) -> String {
    crate::dns_policy::effective_resolvers_for_ip_version(&profile.dns, &profile.ip_version)
        .first()
        .map(|resolver| resolver.ip().to_string())
        .unwrap_or_else(|| "1.1.1.1".into())
}

fn vpn_profile(mut profile: MobileConnectionProfile, tunnel: MobileSystemTunnel) -> VpnProfile {
    normalize_runtime_dns(&mut profile);
    let profile = profile.for_runtime();
    let dns_server = primary_dns(&profile);
    VpnProfile {
        protocol: profile.protocol,
        scan_mode: profile.scan_mode,
        ip_version: profile.ip_version,
        connection_mode: if tunnel == MobileSystemTunnel::Native {
            "tunnel".into()
        } else {
            "proxy".into()
        },
        quick_reconnect: profile.quick_reconnect,
        masque_http2: profile.masque_http2,
        masque_noize: profile.masque_noize,
        wg_noize: profile.wg_noize,
        dns_server,
        dns: profile.dns,
        bind_address: profile.bind_address,
        http_proxy: profile.http_proxy,
        upstream: profile.upstream,
        mtu: profile.mtu,
        peer: profile.peer,
        wg_peer: profile.wg_peer,
        wiw_outer: profile.wiw_outer,
        wiw_inner: profile.wiw_inner,
        wiw_scan: profile.wiw_scan,
        h2_peer: profile.h2_peer,
        ech: profile.ech,
        no_data_check: profile.no_data_check,
        validate_secs: profile.validate_secs,
        reconnect_secs: profile.reconnect_secs,
        fragment: profile.fragment,
        fragment_size: profile.fragment_size,
        fragment_delay: profile.fragment_delay,
        keepalive: profile.keepalive,
        no_profile_retry: profile.no_profile_retry,
        tls_groups: profile.tls_groups,
        perf_profile: profile.perf_profile,
        route_sniff: profile.route_sniff,
        route_sniff_ms: profile.route_sniff_ms,
        auto_reprovision: profile.auto_reprovision,
        zero_trust_team: profile.zero_trust_team,
        zero_trust_auth: profile.zero_trust_auth,
        access_email: profile.access_email,
        access_client_id: profile.access_client_id,
        access_client_secret: profile.access_client_secret,
        access_token: profile.access_token,
        zero_trust_gateway: profile.zero_trust_gateway,
        route_block: profile.route_block,
        route_direct: profile.route_direct,
        routes_file: profile.routes_file,
    }
}

fn status_value(status: VpnStatus) -> Value {
    let socks = status.socks_addr.unwrap_or_else(|| "127.0.0.1:1819".into());
    match status.state.as_str() {
        "Launching" => json!({ "state": "Launching" }),
        "Connecting" => json!({ "state": "Connecting" }),
        "AwaitingAccessCode" => json!({ "state": "AwaitingAccessCode" }),
        "Verifying" => json!({ "state": "Connecting" }),
        "StartingTunnel" => json!({
            "state": "StartingTunnel",
            "tunnel": "native",
            "socks_addr": socks,
            "connected_at_ms": status.connected_at_ms.unwrap_or_else(now_ms)
        }),
        "Connected" => json!({
            "state": "Connected",
            "socks_addr": socks,
            "connected_at_ms": status.connected_at_ms.unwrap_or_else(now_ms)
        }),
        "Tunneling" => json!({
            "state": "Tunneling",
            "tunnel": "native",
            "socks_addr": socks,
            "connected_at_ms": status.connected_at_ms.unwrap_or_else(now_ms)
        }),
        "Disconnecting" => json!({ "state": "Disconnecting" }),
        "Error" => json!({
            "state": "Error",
            "message": status.message.unwrap_or_else(|| "Android Aether service failed".into()),
            "phase": "android-runtime"
        }),
        _ => json!({ "state": "Idle" }),
    }
}

fn emit_status(app: &AppHandle, value: &Value) {
    let _ = app.emit("aether://status", value);
}

#[tauri::command]
async fn connect(
    app: AppHandle,
    state: State<'_, MobileState>,
    profile_override: Option<MobileConnectionProfile>,
) -> Result<(), String> {
    let mut settings = state
        .settings
        .lock()
        .map_err(|_| "mobile state unavailable")?
        .clone();
    let mut runtime_profile = profile_override.unwrap_or_else(|| settings.profile.clone());
    validate_profile(&runtime_profile)?;
    let tunnel = settings.system_tunnel;
    if tunnel == MobileSystemTunnel::Native {
        let permission = app
            .aether_vpn()
            .prepare()
            .map_err(|error| error.to_string())?;
        if !permission.prepared {
            return Err("Android VPN permission was not granted".into());
        }
    }
    let _ = app.aether_vpn().ensure_notification_permission();

    if !runtime_profile.runtime_only {
        runtime_profile.runtime_only = false;
        settings.profile = runtime_profile.clone();
        settings.version = MOBILE_SETTINGS_VERSION;
        save_settings(&app, &settings)?;
        *state
            .settings
            .lock()
            .map_err(|_| "mobile state unavailable")? = settings;
    }

    crate::network_context::sync_process_environment();
    emit_status(&app, &json!({ "state": "Launching" }));
    match app.aether_vpn().start(vpn_profile(runtime_profile, tunnel)) {
        Ok(status) => {
            emit_status(&app, &status_value(status));
            Ok(())
        }
        Err(error) => {
            let message = error.to_string();
            emit_status(
                &app,
                &json!({ "state": "Error", "message": message, "phase": "android-runtime" }),
            );
            Err(message)
        }
    }
}

#[tauri::command]
async fn disconnect(app: AppHandle) -> Result<(), String> {
    emit_status(&app, &json!({ "state": "Disconnecting" }));
    match app.aether_vpn().stop() {
        Ok(status) => {
            emit_status(&app, &status_value(status));
            Ok(())
        }
        Err(error) => {
            let message = error.to_string();
            match app.aether_vpn().status() {
                Ok(status) => emit_status(&app, &status_value(status)),
                Err(_) => emit_status(
                    &app,
                    &json!({ "state": "Error", "message": message, "phase": "disconnect" }),
                ),
            }
            Err(message)
        }
    }
}

#[tauri::command]
async fn disconnect_for_recovery(app: AppHandle) -> Result<(), String> {
    emit_status(&app, &json!({ "state": "Disconnecting" }));
    match app.aether_vpn().stop_for_recovery() {
        Ok(status) => {
            emit_status(&app, &status_value(status));
            Ok(())
        }
        Err(error) => {
            let message = error.to_string();
            match app.aether_vpn().status() {
                Ok(status) => emit_status(&app, &status_value(status)),
                Err(_) => emit_status(
                    &app,
                    &json!({ "state": "Error", "message": message, "phase": "automatic-stop" }),
                ),
            }
            Err(message)
        }
    }
}

#[tauri::command]
fn get_status(app: AppHandle) -> Result<Value, String> {
    app.aether_vpn()
        .status()
        .map(status_value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_profile(state: State<'_, MobileState>) -> MobileConnectionProfile {
    state
        .settings
        .lock()
        .map(|settings| settings.profile.without_secrets())
        .unwrap_or_default()
}

#[tauri::command]
fn set_default_profile(
    app: AppHandle,
    state: State<'_, MobileState>,
    mut profile: MobileConnectionProfile,
) -> Result<(), String> {
    profile.runtime_only = false;
    validate_profile(&profile)?;
    let mut settings = state
        .settings
        .lock()
        .map_err(|_| "mobile state unavailable")?
        .clone();
    settings.profile = profile;
    save_settings(&app, &settings)?;
    *state
        .settings
        .lock()
        .map_err(|_| "mobile state unavailable")? = settings;
    Ok(())
}

#[tauri::command]
fn submit_access_code(app: AppHandle, code: String) -> Result<(), String> {
    app.aether_vpn()
        .submit_access_code(&code)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn export_android_diagnostics(app: AppHandle) -> Result<DiagnosticsExport, String> {
    app.aether_vpn()
        .export_diagnostics()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_system_tunnel(state: State<'_, MobileState>) -> MobileSystemTunnel {
    state
        .settings
        .lock()
        .map(|settings| settings.system_tunnel)
        .unwrap_or_default()
}

#[tauri::command]
fn set_system_tunnel(
    app: AppHandle,
    state: State<'_, MobileState>,
    selection: MobileSystemTunnel,
) -> Result<(), String> {
    let current = app
        .aether_vpn()
        .status()
        .map_err(|error| error.to_string())?;
    if current.state != "Idle" {
        return Err("System tunnel mode can change only after an explicit Disconnect".into());
    }
    let mut settings = state
        .settings
        .lock()
        .map_err(|_| "mobile state unavailable")?
        .clone();
    settings.system_tunnel = selection;
    save_settings(&app, &settings)?;
    *state
        .settings
        .lock()
        .map_err(|_| "mobile state unavailable")? = settings;
    Ok(())
}

#[tauri::command]
fn set_android_logging(app: AppHandle, enabled: bool) -> Result<bool, String> {
    app.aether_vpn()
        .set_logging(enabled)
        .map(|status| status.enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_runtime_telemetry(app: AppHandle) -> Result<Value, String> {
    app.aether_vpn()
        .telemetry()
        .map(|telemetry| {
            json!({
                "received_bytes": telemetry.received_bytes,
                "sent_bytes": telemetry.sent_bytes,
                "public_ip": telemetry.public_ip,
                "country_code": telemetry.country_code,
                "latency_ms": telemetry.latency_ms,
                "sampled_at_ms": telemetry.sampled_at_ms,
                "egress_probe_complete": telemetry.egress_probe_complete,
                "capacity_probe_complete": telemetry.capacity_probe_complete,
                "download_kbps": telemetry.download_kbps,
                "upload_kbps": telemetry.upload_kbps,
                "upload_limited": telemetry.upload_limited,
            })
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_network_context() -> Option<String> {
    crate::network_context::current_network_key()
}

#[tauri::command]
fn get_android_logs(app: AppHandle, after_id: u64) -> Result<Value, String> {
    app.aether_vpn()
        .logs(after_id)
        .map(|batch| {
            json!({
                "entries": batch.entries.into_iter().map(|entry| json!({
                    "id": entry.id,
                    "timestamp": entry.timestamp,
                    "line": entry.line
                })).collect::<Vec<_>>(),
                "last_id": batch.last_id,
            })
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_close_to_tray() -> bool {
    false
}

#[tauri::command]
fn set_close_to_tray(_app: AppHandle, _enabled: bool) {}

#[tauri::command]
fn list_engines() -> Value {
    json!([{
        "id": "aether",
        "display_name": "Aether",
        "built_in": true,
        "capabilities": [
            "masque", "wireguard", "gool", "zero-trust", "routing", "dns",
            "interactive-access-code", "android-vpn", "custom-mtu", "upstream-proxy",
            "http-connect-proxy", "manual-wiw-peers"
        ]
    }])
}

#[tauri::command]
fn get_active_engine() -> &'static str {
    "aether"
}

pub fn run_inner() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_aether_vpn::init())
        .manage(MobileState::default())
        .setup(|app| {
            let settings = load_settings(app.handle());
            app.aether_vpn()
                .set_logging(false)
                .map_err(|error| io::Error::other(error.to_string()))?;
            *app.state::<MobileState>()
                .settings
                .lock()
                .map_err(|_| io::Error::other("mobile state unavailable"))? = settings;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            disconnect_for_recovery,
            submit_access_code,
            export_android_diagnostics,
            get_status,
            get_default_profile,
            set_default_profile,
            get_system_tunnel,
            set_system_tunnel,
            set_android_logging,
            get_runtime_telemetry,
            get_network_context,
            get_android_logs,
            get_close_to_tray,
            set_close_to_tray,
            list_engines,
            get_active_engine
        ])
        .run(tauri::generate_context!())
        .expect("error running Aether Android application");
}
