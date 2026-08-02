use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, io, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_aether_vpn::{AetherVpnExt, VpnProfile, VpnStatus};

const MOBILE_SETTINGS_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum MobileSystemTunnel { Off, #[default] Native }

#[derive(Clone, Debug, Deserialize, Serialize)]
struct MobileConnectionProfile {
    protocol: String,
    scan_mode: String,
    ip_version: String,
    #[serde(default)] quick_reconnect: bool,
    #[serde(default)] masque_http2: bool,
    masque_noize: String,
    wg_noize: String,
    bind_address: String,
    #[serde(default)] dns: String,
    #[serde(default)] zero_trust_team: String,
    #[serde(default)] zero_trust_auth: String,
    #[serde(default)] access_email: String,
    #[serde(default)] access_client_id: String,
    #[serde(default)] access_client_secret: String,
    #[serde(default)] access_token: String,
    #[serde(default)] zero_trust_gateway: bool,
    #[serde(default)] route_block: String,
    #[serde(default)] route_direct: String,
    #[serde(default)] routes_file: String,
}

impl Default for MobileConnectionProfile {
    fn default() -> Self {
        Self {
            protocol: "auto".into(), scan_mode: "balanced".into(), ip_version: "v4".into(),
            quick_reconnect: false, masque_http2: false,
            masque_noize: "firewall".into(), wg_noize: "balanced".into(),
            bind_address: "127.0.0.1:1819".into(), dns: String::new(),
            zero_trust_team: String::new(), zero_trust_auth: "email".into(),
            access_email: String::new(), access_client_id: String::new(),
            access_client_secret: String::new(), access_token: String::new(),
            zero_trust_gateway: false, route_block: String::new(),
            route_direct: String::new(), routes_file: String::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct MobileSettings {
    #[serde(default = "settings_version")] version: u8,
    #[serde(default)] profile: MobileConnectionProfile,
    #[serde(default)] system_tunnel: MobileSystemTunnel,
}
const fn settings_version() -> u8 { MOBILE_SETTINGS_VERSION }
impl Default for MobileSettings {
    fn default() -> Self {
        Self { version: MOBILE_SETTINGS_VERSION, profile: MobileConnectionProfile::default(), system_tunnel: MobileSystemTunnel::Native }
    }
}
#[derive(Default)] struct MobileState { settings: Mutex<MobileSettings> }

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map(|directory| directory.join("mobile-settings.json")).map_err(|error| error.to_string())
}
fn load_settings(app: &AppHandle) -> MobileSettings {
    settings_path(app).ok().and_then(|path| fs::read_to_string(path).ok()).and_then(|body| serde_json::from_str(&body).ok()).unwrap_or_default()
}
fn save_settings(app: &AppHandle, settings: &MobileSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let temporary = path.with_extension("json.new");
    fs::write(&temporary, serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    if path.exists() { fs::remove_file(&path).map_err(|error| error.to_string())?; }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}
fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

fn validate_profile(profile: &MobileConnectionProfile) -> Result<(), String> {
    if !profile.zero_trust_team.trim().is_empty() {
        return Err("Cloudflare Zero Trust enrolment is not enabled in the Android bridge yet; clear the team field before connecting".into());
    }
    if !profile.route_block.trim().is_empty() || !profile.route_direct.trim().is_empty() || !profile.routes_file.trim().is_empty() {
        return Err("Aether route files/lists are not enabled in the Android bridge yet; Android app routing is owned by VpnService".into());
    }
    Ok(())
}
fn primary_dns(profile: &MobileConnectionProfile) -> String {
    profile.dns.split([',', '\n']).map(str::trim).find(|value| !value.is_empty()).unwrap_or("1.1.1.1").to_string()
}
fn vpn_profile(profile: MobileConnectionProfile, tunnel: MobileSystemTunnel) -> VpnProfile {
    let dns_server = primary_dns(&profile);
    VpnProfile {
        protocol: profile.protocol, scan_mode: profile.scan_mode, ip_version: profile.ip_version,
        connection_mode: if tunnel == MobileSystemTunnel::Native { "tunnel".into() } else { "proxy".into() },
        tun_engine: "hev".into(), quick_reconnect: profile.quick_reconnect,
        masque_http2: profile.masque_http2, masque_noize: profile.masque_noize,
        wg_noize: profile.wg_noize, dns_server, bind_address: profile.bind_address,
        webrtc_leak_protection: false,
    }
}
fn status_value(status: VpnStatus) -> Value {
    let socks = status.socks_addr.unwrap_or_else(|| "127.0.0.1:1819".into());
    match status.state.as_str() {
        "Launching" => json!({ "state": "Launching" }),
        "Verifying" => json!({ "state": "Connecting" }),
        "StartingTunnel" => json!({ "state": "StartingTunnel", "tunnel": "native", "socks_addr": socks, "connected_at_ms": status.connected_at_ms.unwrap_or_else(now_ms) }),
        "Connected" => json!({ "state": "Connected", "socks_addr": socks, "connected_at_ms": status.connected_at_ms.unwrap_or_else(now_ms) }),
        "Tunneling" => json!({ "state": "Tunneling", "tunnel": "native", "socks_addr": socks, "connected_at_ms": status.connected_at_ms.unwrap_or_else(now_ms) }),
        "Disconnecting" => json!({ "state": "Disconnecting" }),
        "Error" => json!({ "state": "Error", "message": status.message.unwrap_or_else(|| "Android Aether service failed".into()), "phase": "android-runtime" }),
        _ => json!({ "state": "Idle" }),
    }
}
fn emit_status(app: &AppHandle, value: &Value) { let _ = app.emit("aether://status", value); }

#[tauri::command]
async fn connect(app: AppHandle, state: State<'_, MobileState>, profile_override: Option<MobileConnectionProfile>) -> Result<(), String> {
    let mut settings = state.settings.lock().map_err(|_| "mobile state unavailable")?.clone();
    if let Some(profile) = profile_override { settings.profile = profile; }
    validate_profile(&settings.profile)?;
    if settings.system_tunnel == MobileSystemTunnel::Native {
        let permission = app.aether_vpn().prepare().map_err(|error| error.to_string())?;
        if !permission.prepared { return Err("Android VPN permission was not granted".into()); }
    }
    settings.version = MOBILE_SETTINGS_VERSION;
    save_settings(&app, &settings)?;
    *state.settings.lock().map_err(|_| "mobile state unavailable")? = settings.clone();
    emit_status(&app, &json!({ "state": "Launching" }));
    match app.aether_vpn().start(vpn_profile(settings.profile, settings.system_tunnel)) {
        Ok(status) => { emit_status(&app, &status_value(status)); Ok(()) }
        Err(error) => { let message = error.to_string(); emit_status(&app, &json!({ "state": "Error", "message": message, "phase": "android-runtime" })); Err(message) }
    }
}
#[tauri::command]
async fn disconnect(app: AppHandle) -> Result<(), String> {
    emit_status(&app, &json!({ "state": "Disconnecting" }));
    let status = app.aether_vpn().stop().map_err(|error| error.to_string())?;
    emit_status(&app, &status_value(status)); Ok(())
}
#[tauri::command] fn get_status(app: AppHandle) -> Result<Value, String> { app.aether_vpn().status().map(status_value).map_err(|error| error.to_string()) }
#[tauri::command] fn get_default_profile(state: State<'_, MobileState>) -> MobileConnectionProfile { state.settings.lock().map(|settings| settings.profile.clone()).unwrap_or_default() }
#[tauri::command]
fn set_default_profile(app: AppHandle, state: State<'_, MobileState>, profile: MobileConnectionProfile) -> Result<(), String> {
    validate_profile(&profile)?;
    let mut settings = state.settings.lock().map_err(|_| "mobile state unavailable")?.clone();
    settings.profile = profile; save_settings(&app, &settings)?;
    *state.settings.lock().map_err(|_| "mobile state unavailable")? = settings; Ok(())
}
#[tauri::command] fn submit_access_code(_code: String) -> Result<(), String> { Err("Zero Trust email-code enrolment is not enabled in the Android bridge yet".into()) }
#[tauri::command] fn get_system_tunnel(state: State<'_, MobileState>) -> MobileSystemTunnel { state.settings.lock().map(|settings| settings.system_tunnel).unwrap_or_default() }
#[tauri::command]
fn set_system_tunnel(app: AppHandle, state: State<'_, MobileState>, selection: MobileSystemTunnel) -> Result<(), String> {
    let current = app.aether_vpn().status().map_err(|error| error.to_string())?;
    if current.state != "Idle" && current.state != "Error" { return Err("System tunnel mode cannot change while connected".into()); }
    let mut settings = state.settings.lock().map_err(|_| "mobile state unavailable")?.clone();
    settings.system_tunnel = selection; save_settings(&app, &settings)?;
    *state.settings.lock().map_err(|_| "mobile state unavailable")? = settings; Ok(())
}
#[tauri::command]
fn get_runtime_telemetry(app: AppHandle) -> Result<Value, String> {
    app.aether_vpn().telemetry().map(|telemetry| json!({
        "received_bytes": telemetry.received_bytes, "sent_bytes": telemetry.sent_bytes,
        "public_ip": telemetry.public_ip, "country_code": telemetry.country_code,
        "latency_ms": telemetry.latency_ms, "sampled_at_ms": telemetry.sampled_at_ms,
        "egress_probe_complete": telemetry.egress_probe_complete,
    })).map_err(|error| error.to_string())
}
#[tauri::command]
fn get_android_logs(app: AppHandle, after_id: u64) -> Result<Value, String> {
    app.aether_vpn().logs(after_id).map(|batch| json!({
        "entries": batch.entries.into_iter().map(|entry| json!({ "id": entry.id, "timestamp": entry.timestamp, "line": entry.line })).collect::<Vec<_>>(),
        "last_id": batch.last_id,
    })).map_err(|error| error.to_string())
}
#[tauri::command] fn get_close_to_tray() -> bool { false }
#[tauri::command] fn set_close_to_tray(_app: AppHandle, _enabled: bool) {}
#[tauri::command] fn list_engines() -> Value { json!([{ "id": "aether", "display_name": "Aether", "built_in": true, "capabilities": ["masque", "wireguard", "gool", "android-vpn"] }]) }
#[tauri::command] fn get_active_engine() -> &'static str { "aether" }

pub fn run_inner() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_aether_vpn::init())
        .manage(MobileState::default())
        .setup(|app| {
            let settings = load_settings(app.handle());
            *app.state::<MobileState>().settings.lock().map_err(|_| io::Error::other("mobile state unavailable"))? = settings;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![connect, disconnect, submit_access_code, get_status, get_default_profile, set_default_profile, get_system_tunnel, set_system_tunnel, get_runtime_telemetry, get_android_logs, get_close_to_tray, set_close_to_tray, list_engines, get_active_engine])
        .run(tauri::generate_context!())
        .expect("error running Aether Android application");
}
