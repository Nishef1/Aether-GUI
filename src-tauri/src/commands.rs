use crate::aether::{self, profiles::ConnectionProfile};
use crate::core_manager::{self, CoreKind, CoreRelease, CoreStatus};
use crate::error::AetherError;
use crate::state::{AppState, ConnectionState};
use crate::tray;
use tauri::{AppHandle, State};

fn require_disconnected(state: &State<AppState>) -> Result<(), AetherError> {
    if state.manager.lock().unwrap().is_busy() {
        Err(AetherError::CoreManager(
            "disconnect before changing core versions".into(),
        ))
    } else {
        Ok(())
    }
}

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
        // Prepare verified binaries before UAC. The elevated process only runs
        // already-installed binaries and never executes downloader helpers.
        let _ = core_manager::ensure_active(&app, CoreKind::Aether)?;
        let _ = core_manager::ensure_active(&app, CoreKind::Singbox)?;
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
pub fn list_core_versions(app: AppHandle, kind: CoreKind) -> Result<Vec<CoreRelease>, AetherError> {
    core_manager::list_releases(&app, kind)
}

#[tauri::command]
pub fn get_core_status(app: AppHandle, kind: CoreKind) -> Result<CoreStatus, AetherError> {
    core_manager::status(&app, kind)
}

#[tauri::command]
pub fn install_core_version(
    app: AppHandle,
    state: State<AppState>,
    kind: CoreKind,
    version: String,
) -> Result<CoreStatus, AetherError> {
    require_disconnected(&state)?;
    core_manager::install_version(&app, kind, &version)
}

#[tauri::command]
pub fn select_core_version(
    app: AppHandle,
    state: State<AppState>,
    kind: CoreKind,
    version: String,
) -> Result<CoreStatus, AetherError> {
    require_disconnected(&state)?;
    core_manager::select_version(&app, kind, &version)
}

#[tauri::command]
pub fn remove_core_version(
    app: AppHandle,
    state: State<AppState>,
    kind: CoreKind,
    version: String,
) -> Result<CoreStatus, AetherError> {
    require_disconnected(&state)?;
    core_manager::remove_version(&app, kind, &version)
}

#[tauri::command]
pub fn get_diagnostics_path() -> Option<String> {
    crate::diagnostics::path().map(|path| path.display().to_string())
}
