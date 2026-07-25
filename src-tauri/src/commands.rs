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

    // A single system-TUN manager owns either Xray (default) or sing-box. Set
    // the selection from the exact profile before resolving binaries or UAC.
    crate::singbox::set_tun_engine(profile.tun_engine);

    // Windows elevates only the detached TUN helper, so the normal connection
    // lifecycle can continue inside this GUI process. Other platforms retain
    // the existing whole-app elevation fallback until they gain an equivalent
    // privileged helper implementation.
    if profile.uses_tun() && !crate::is_admin() {
        let _ = core_manager::ensure_active(&app, CoreKind::Aether)?;
        let _ = crate::singbox::ensure_binary(&app)?;
        aether::profiles::save_pending_elevation_checked(&app, &profile)?;
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
pub fn take_pending_elevation_profile(
    app: AppHandle,
) -> Result<Option<ConnectionProfile>, AetherError> {
    if crate::tun_helper::is_supported() {
        // Windows no longer replaces the GUI process. Remove any handoff left
        // by an older build so a later elevated launch cannot auto-connect it.
        let _ = aether::profiles::take_pending_elevation(&app);
        Ok(None)
    } else if crate::os_is_admin() {
        aether::profiles::take_pending_elevation_checked(&app)
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn set_default_profile(app: AppHandle, profile: ConnectionProfile) -> Result<(), AetherError> {
    aether::profiles::save_checked(&app, &profile.sanitized())
}

#[tauri::command]
pub fn get_close_to_tray() -> bool {
    tray::get_close_to_tray()
}

#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) -> Result<(), AetherError> {
    tray::set_close_to_tray(&app, enabled).map_err(AetherError::Internal)
}

#[tauri::command]
pub fn sync_tray_state(app: AppHandle, state: String) {
    tray::set_visual_state(&app, &state);
}

#[tauri::command]
pub fn get_is_elevated() -> bool {
    crate::os_is_admin()
}

#[tauri::command]
pub fn elevate(app: AppHandle) -> Result<(), AetherError> {
    if crate::os_is_admin() {
        return Ok(());
    }

    // Kept as a non-Windows fallback. Windows no longer reaches this command for
    // Tunnel/Both because the detached helper owns the UAC boundary.
    if crate::relaunch_as_admin() {
        std::process::exit(0);
    }

    let _ = aether::profiles::take_pending_elevation(&app);
    Err(AetherError::Internal(
        "administrator elevation was cancelled or failed".into(),
    ))
}

#[tauri::command]
pub fn prepare_app_relaunch() {
    crate::single_instance::release_for_handoff();
}

#[tauri::command]
pub fn restore_instance_guard() -> Result<(), AetherError> {
    if crate::single_instance::acquire() {
        Ok(())
    } else {
        Err(AetherError::Internal(
            "another Aether-GUI instance acquired the application lock".into(),
        ))
    }
}

#[tauri::command]
pub fn get_tun_status(state: State<AppState>) -> bool {
    state.singbox.lock().unwrap().is_active()
}

#[tauri::command]
pub fn get_traffic() -> crate::traffic::TrafficStats {
    crate::traffic::current()
}

#[tauri::command]
pub fn get_runtime_telemetry() -> crate::telemetry::RuntimeTelemetry {
    crate::telemetry::snapshot()
}

#[tauri::command]
pub async fn list_core_versions(
    app: AppHandle,
    kind: CoreKind,
) -> Result<Vec<CoreRelease>, AetherError> {
    tauri::async_runtime::spawn_blocking(move || core_manager::list_releases(&app, kind))
        .await
        .map_err(|error| AetherError::Internal(format!("core release task failed: {error}")))?
}

#[tauri::command]
pub fn get_core_status(app: AppHandle, kind: CoreKind) -> Result<CoreStatus, AetherError> {
    let mut status = core_manager::status(&app, kind)?;
    let current = core_manager::current_info(&app, kind)?;

    if current.source != "managed" {
        status.active_version = None;
    }

    Ok(status)
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
