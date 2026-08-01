use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_aether_vpn::{AetherVpnExt, VpnProfile, VpnStatus};

const CURRENT_ANDROID_RUNTIME_DEFAULTS_VERSION: u8 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub protocol: String,
    pub scan_mode: String,
    pub ip_version: String,
    pub connection_mode: String,
    pub tun_engine: String,
    #[serde(default)]
    pub quick_reconnect: bool,
    pub masque_http2: bool,
    pub masque_noize: String,
    pub wg_noize: String,
    pub dns_server: String,
    pub bind_address: String,
    #[serde(default)]
    pub webrtc_leak_protection: bool,
    #[serde(default)]
    pub android_runtime_defaults_version: u8,
}

impl Default for ConnectionProfile {
    fn default() -> Self {
        Self {
            protocol: "auto".into(),
            scan_mode: "balanced".into(),
            ip_version: "v4".into(),
            connection_mode: "tunnel".into(),
            tun_engine: "xray".into(),
            quick_reconnect: false,
            masque_http2: false,
            masque_noize: "firewall".into(),
            wg_noize: "balanced".into(),
            dns_server: "1.1.1.1".into(),
            bind_address: "127.0.0.1:1819".into(),
            webrtc_leak_protection: false,
            android_runtime_defaults_version: CURRENT_ANDROID_RUNTIME_DEFAULTS_VERSION,
        }
    }
}

impl From<ConnectionProfile> for VpnProfile {
    fn from(profile: ConnectionProfile) -> Self {
        Self {
            protocol: profile.protocol,
            scan_mode: profile.scan_mode,
            ip_version: profile.ip_version,
            connection_mode: profile.connection_mode,
            tun_engine: profile.tun_engine,
            quick_reconnect: profile.quick_reconnect,
            masque_http2: profile.masque_http2,
            masque_noize: profile.masque_noize,
            wg_noize: profile.wg_noize,
            dns_server: profile.dns_server,
            bind_address: profile.bind_address,
            webrtc_leak_protection: profile.webrtc_leak_protection,
        }
    }
}

#[derive(Default)]
struct MobileState {
    profile: Mutex<ConnectionProfile>,
}

fn profile_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("mobile-profile.json"))
        .map_err(|error| error.to_string())
}

fn normalize_runtime_defaults(mut profile: ConnectionProfile) -> (ConnectionProfile, bool) {
    if profile.android_runtime_defaults_version >= CURRENT_ANDROID_RUNTIME_DEFAULTS_VERSION {
        return (profile, false);
    }

    profile.quick_reconnect = false;
    profile.webrtc_leak_protection = false;
    profile.android_runtime_defaults_version = CURRENT_ANDROID_RUNTIME_DEFAULTS_VERSION;
    (profile, true)
}

fn load_profile(app: &AppHandle) -> ConnectionProfile {
    let loaded = profile_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let (profile, migrated) = normalize_runtime_defaults(loaded);
    if migrated {
        let _ = save_profile(app, &profile);
    }
    profile
}

fn save_profile(app: &AppHandle, profile: &ConnectionProfile) -> Result<(), String> {
    let path = profile_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let body = serde_json::to_vec_pretty(profile).map_err(|error| error.to_string())?;
    fs::write(path, body).map_err(|error| error.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn status_value(status: VpnStatus) -> Value {
    match status.state.as_str() {
        "Launching" => json!({ "state": "Launching" }),
        // SOCKS is live but Android is still performing its mandatory
        // end-to-end egress check. This is a connecting phase, not Idle.
        "Verifying" => json!({ "state": "Connecting" }),
        "StartingTunnel" => json!({
            "state": "StartingTunnel",
            "socks_addr": status.socks_addr.unwrap_or_else(|| "127.0.0.1:1819".into())
        }),
        "Connected" => json!({
            "state": "Connected",
            "socks_addr": status.socks_addr.unwrap_or_else(|| "127.0.0.1:1819".into()),
            "connected_at_ms": status.connected_at_ms.unwrap_or_else(now_ms)
        }),
        "Tunneling" => json!({
            "state": "Tunneling",
            "tun_addr": status.tun_addr.unwrap_or_else(|| "198.18.0.1".into()),
            "socks_addr": status.socks_addr.unwrap_or_else(|| "127.0.0.1:1819".into()),
            "connected_at_ms": status.connected_at_ms.unwrap_or_else(now_ms)
        }),
        "Disconnecting" => json!({ "state": "Disconnecting" }),
        "Error" => json!({
            "state": "Error",
            "message": status.message.unwrap_or_else(|| "Android Aether service failed".into()),
            "phase": "android-core"
        }),
        _ => json!({ "state": "Idle" }),
    }
}

fn emit_status(app: &AppHandle, value: &Value) {
    let _ = app.emit("aether://status", value);
}

fn emit_log(app: &AppHandle, line: impl Into<String>) {
    let _ = app.emit(
        "aether://log",
        json!({ "line": line.into(), "timestamp": now_ms() }),
    );
}

#[tauri::command]
async fn connect(
    app: AppHandle,
    state: State<'_, MobileState>,
    profile_override: Option<ConnectionProfile>,
) -> Result<(), String> {
    let requested = profile_override.unwrap_or_else(|| state.profile.lock().unwrap().clone());
    let (profile, _) = normalize_runtime_defaults(requested);
    if profile.connection_mode != "proxy" {
        let permission = app
            .aether_vpn()
            .prepare()
            .map_err(|error| error.to_string())?;
        if !permission.prepared {
            return Err("Android VPN permission was not granted".into());
        }
    }

    save_profile(&app, &profile)?;
    *state.profile.lock().unwrap() = profile.clone();

    let launching = json!({ "state": "Launching" });
    emit_status(&app, &launching);
    emit_log(
        &app,
        "[android] start requested for bundled ARM64 Aether core",
    );

    match app.aether_vpn().start(profile.into()) {
        Ok(status) => {
            emit_status(&app, &status_value(status));
            Ok(())
        }
        Err(error) => {
            let message = error.to_string();
            let value = json!({
                "state": "Error",
                "message": message,
                "phase": "android-core"
            });
            emit_status(&app, &value);
            emit_log(&app, format!("[android:error] {message}"));
            Err(message)
        }
    }
}

#[tauri::command]
async fn disconnect(app: AppHandle) -> Result<(), String> {
    let disconnecting = json!({ "state": "Disconnecting" });
    emit_status(&app, &disconnecting);
    emit_log(&app, "[android] disconnect requested");
    let status = app.aether_vpn().stop().map_err(|error| error.to_string())?;
    emit_status(&app, &status_value(status));
    Ok(())
}

#[tauri::command]
fn get_status(app: AppHandle) -> Result<Value, String> {
    app.aether_vpn()
        .status()
        .map(status_value)
        .map_err(|error| error.to_string())
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
                    "line": entry.line,
                })).collect::<Vec<_>>(),
                "last_id": batch.last_id,
            })
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_android_logging_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    app.aether_vpn()
        .set_logging(enabled)
        .map(|status| status.enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_profile(state: State<'_, MobileState>) -> ConnectionProfile {
    state.profile.lock().unwrap().clone()
}

#[tauri::command]
fn set_default_profile(
    app: AppHandle,
    state: State<'_, MobileState>,
    profile: ConnectionProfile,
) -> Result<(), String> {
    let (profile, _) = normalize_runtime_defaults(profile);
    save_profile(&app, &profile)?;
    *state.profile.lock().unwrap() = profile;
    Ok(())
}

#[tauri::command]
fn take_pending_elevation_profile() -> Option<ConnectionProfile> {
    None
}

#[tauri::command]
fn get_close_to_tray() -> bool {
    false
}

#[tauri::command]
fn set_close_to_tray(_enabled: bool) {}

#[tauri::command]
fn sync_tray_state(_state: String) {}

#[tauri::command]
fn get_is_elevated() -> bool {
    false
}

#[tauri::command]
fn elevate() -> Result<(), String> {
    Err("Android does not use desktop elevation".into())
}

#[tauri::command]
fn prepare_app_relaunch() {}

#[tauri::command]
fn restore_instance_guard() {}

#[tauri::command]
fn get_tun_status(app: AppHandle) -> Value {
    match app.aether_vpn().status() {
        Ok(status) => json!({
            "available": true,
            "active": status.state == "Tunneling",
            "message": if status.state == "Tunneling" {
                "Android VpnService and tun2socks are active"
            } else {
                "Android TUN is available"
            }
        }),
        Err(error) => json!({
            "available": true,
            "active": false,
            "message": error.to_string()
        }),
    }
}

#[tauri::command]
fn get_traffic(app: AppHandle) -> Result<Value, String> {
    app.aether_vpn()
        .traffic()
        .map(|traffic| {
            json!({
                "received_bytes": traffic.received_bytes,
                "sent_bytes": traffic.sent_bytes
            })
        })
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
            })
        })
        .map_err(|error| error.to_string())
}

fn core_status(kind: &str) -> Value {
    if kind == "aether" {
        json!({
            "kind": "aether",
            "active_version": "1.4.0",
            "bundled_version": "1.4.0",
            "installed_versions": ["1.4.0"],
            "update_policy": "apk",
        })
    } else {
        json!({
            "kind": kind,
            "active_version": null,
            "bundled_version": null,
            "installed_versions": []
        })
    }
}

#[tauri::command]
fn list_core_versions(kind: String) -> Value {
    if kind == "aether" {
        json!([{
            "version": "1.4.0",
            "prerelease": false,
            "installed": true,
            "active": true
        }])
    } else {
        json!([])
    }
}

#[tauri::command]
fn get_core_status(kind: String) -> Value {
    core_status(&kind)
}

#[tauri::command]
fn install_core_version(kind: String, _version: String) -> Value {
    core_status(&kind)
}

#[tauri::command]
fn select_core_version(kind: String, _version: String) -> Value {
    core_status(&kind)
}

#[tauri::command]
fn remove_core_version(kind: String, _version: String) -> Value {
    core_status(&kind)
}

#[tauri::command]
fn get_diagnostics_path(app: AppHandle) -> Result<String, String> {
    app.aether_vpn()
        .diagnostics()
        .map(|result| result.path)
        .map_err(|error| error.to_string())
}

pub fn run_inner() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_aether_vpn::init())
        .manage(MobileState::default())
        .setup(|app| {
            let profile = load_profile(app.handle());
            *app.state::<MobileState>().profile.lock().unwrap() = profile;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            get_status,
            get_android_logs,
            set_android_logging_enabled,
            get_default_profile,
            take_pending_elevation_profile,
            set_default_profile,
            get_close_to_tray,
            set_close_to_tray,
            sync_tray_state,
            get_is_elevated,
            elevate,
            prepare_app_relaunch,
            restore_instance_guard,
            get_tun_status,
            get_traffic,
            get_runtime_telemetry,
            list_core_versions,
            get_core_status,
            install_core_version,
            select_core_version,
            remove_core_version,
            get_diagnostics_path,
        ])
        .run(tauri::generate_context!())
        .expect("error running Aether Android application");
}
