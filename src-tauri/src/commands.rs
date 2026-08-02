use crate::aether::profiles::ConnectionProfile;
use crate::engine::EngineDescriptor;
use crate::runtime_error::RuntimeError;
use crate::state::{AppState, ConnectionState};
use crate::system_tunnel::{SystemTunnelDescriptor, SystemTunnelSelection};
use crate::telemetry::RuntimeTelemetry;
use crate::tray;
use serde_json::Value;
use tauri::{AppHandle, State};

// Compatibility commands used by Matin's upstream frontend. They remain
// Aether-shaped so upstream UI updates can be merged without modification.
#[tauri::command]
pub fn connect(
    app: AppHandle,
    state: State<AppState>,
    profile_override: Option<ConnectionProfile>,
) -> Result<(), RuntimeError> {
    state.runtime.connect_aether(app, profile_override)
}

#[tauri::command]
pub fn disconnect(app: AppHandle, state: State<AppState>) -> Result<(), RuntimeError> {
    state.runtime.disconnect(&app)
}

#[tauri::command]
pub fn submit_access_code(state: State<AppState>, code: String) -> Result<(), RuntimeError> {
    state.runtime.submit_aether_access_code(code)
}

#[tauri::command]
pub fn get_status(state: State<AppState>) -> ConnectionState {
    state.runtime.status()
}

#[tauri::command]
pub fn get_default_profile(
    app: AppHandle,
    state: State<AppState>,
) -> Result<ConnectionProfile, RuntimeError> {
    state.runtime.aether_default_profile(&app)
}

#[tauri::command]
pub fn set_default_profile(
    app: AppHandle,
    state: State<AppState>,
    profile: ConnectionProfile,
) -> Result<(), RuntimeError> {
    state.runtime.set_aether_default_profile(&app, profile)
}

// Engine-neutral extension API.
#[tauri::command]
pub fn list_engines(state: State<AppState>) -> Vec<EngineDescriptor> {
    state.runtime.list()
}

#[tauri::command]
pub fn get_active_engine(state: State<AppState>) -> String {
    state.runtime.active_engine()
}

#[tauri::command]
pub fn connect_engine(
    app: AppHandle,
    state: State<AppState>,
    engine_id: String,
    profile: Option<Value>,
) -> Result<(), RuntimeError> {
    state.runtime.connect(app, Some(&engine_id), profile)
}

#[tauri::command]
pub fn get_engine_default_profile(
    app: AppHandle,
    state: State<AppState>,
    engine_id: String,
) -> Result<Value, RuntimeError> {
    state.runtime.default_profile(&app, Some(&engine_id))
}

#[tauri::command]
pub fn set_engine_default_profile(
    app: AppHandle,
    state: State<AppState>,
    engine_id: String,
    profile: Value,
) -> Result<(), RuntimeError> {
    state
        .runtime
        .set_default_profile(&app, Some(&engine_id), profile)
}

#[tauri::command]
pub fn submit_engine_interaction(
    state: State<AppState>,
    engine_id: String,
    interaction: String,
    payload: Value,
) -> Result<(), RuntimeError> {
    state
        .runtime
        .submit_interaction(Some(&engine_id), &interaction, payload)
}

// System-wide TUN API. sing-box is a sidecar over Aether SOCKS, not another
// transport engine, so it stays independently replaceable.
#[tauri::command]
pub fn list_system_tunnels(state: State<AppState>) -> Vec<SystemTunnelDescriptor> {
    state.runtime.list_system_tunnels()
}

#[tauri::command]
pub fn get_system_tunnel(state: State<AppState>) -> SystemTunnelSelection {
    state.runtime.system_tunnel_selection()
}

#[tauri::command]
pub fn set_system_tunnel(
    app: AppHandle,
    state: State<AppState>,
    selection: SystemTunnelSelection,
) -> Result<(), RuntimeError> {
    state.runtime.set_system_tunnel_selection(&app, selection)
}

#[tauri::command]
pub fn get_runtime_telemetry() -> RuntimeTelemetry {
    crate::telemetry::snapshot()
}

#[tauri::command]
pub fn get_close_to_tray() -> bool {
    tray::get_close_to_tray()
}

#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) {
    tray::set_close_to_tray(&app, enabled);
}
