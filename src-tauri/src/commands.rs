use crate::aether::{self, profiles::ConnectionProfile};
use crate::error::AetherError;
use crate::state::{AppState, ConnectionState};
use crate::tray;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn connect(
    app: AppHandle,
    state: State<AppState>,
    profile_override: Option<ConnectionProfile>,
) -> Result<(), AetherError> {
    let profile = profile_override
        .unwrap_or_else(|| aether::profiles::load(&app))
        .sanitized();
    if profile.tun_enabled && !crate::is_admin() {
        aether::profiles::save_pending_elevation(&app, &profile);
        return Err(AetherError::ElevationRequired);
    }
    aether::start_connect(
        app,
        state.manager.clone(),
        Some(profile),
        state.singbox.clone(),
    )
}

#[tauri::command]
pub fn disconnect(app: AppHandle, state: State<AppState>) -> Result<(), AetherError> {
    aether::request_disconnect(&app, &state.manager, &state.singbox)
}

#[tauri::command]
pub fn get_status(state: State<AppState>) -> ConnectionState {
    state.manager.lock().unwrap().status()
}

#[tauri::command]
pub fn get_default_profile(app: AppHandle) -> ConnectionProfile {
    aether::profiles::load(&app)
}

#[tauri::command]
pub fn take_pending_elevation_profile(app: AppHandle) -> Option<ConnectionProfile> {
    if crate::is_admin() {
        aether::profiles::take_pending_elevation(&app)
    } else {
        None
    }
}

#[tauri::command]
pub fn set_default_profile(app: AppHandle, profile: ConnectionProfile) -> Result<(), AetherError> {
    aether::profiles::save(&app, &profile.sanitized());
    Ok(())
}

#[tauri::command]
pub fn get_close_to_tray() -> bool {
    tray::get_close_to_tray()
}

#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) {
    tray::set_close_to_tray(&app, enabled);
}

#[tauri::command]
pub fn elevate(app: AppHandle) -> Result<(), AetherError> {
    if crate::is_admin() {
        return Ok(());
    }
    if crate::relaunch_as_admin() {
        std::process::exit(0);
    }

    // UAC/pkexec/osascript was cancelled or failed. Consume the one-shot
    // pending profile now so a later unrelated manual Administrator launch
    // cannot unexpectedly resume an old connection request.
    let _ = aether::profiles::take_pending_elevation(&app);
    Err(AetherError::Internal(
        "administrator elevation was cancelled or failed".into(),
    ))
}

#[tauri::command]
pub fn get_tun_status(state: State<AppState>) -> bool {
    state.singbox.lock().unwrap().is_active()
}

#[tauri::command]
pub fn get_core_info(app: AppHandle) -> Result<aether::updater::CoreInfo, AetherError> {
    aether::updater::current_info(&app)
}

#[tauri::command]
pub fn refresh_core(
    app: AppHandle,
    state: State<AppState>,
) -> Result<aether::updater::CoreInfo, AetherError> {
    if state.manager.lock().unwrap().is_busy() {
        return Err(AetherError::CoreUpdateFailed(
            "disconnect before updating the Aether core".into(),
        ));
    }
    aether::updater::refresh_now(&app)
}

#[tauri::command]
pub fn get_diagnostics_path() -> Option<String> {
    crate::diagnostics::path().map(|path| path.display().to_string())
}
