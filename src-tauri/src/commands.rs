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

    if profile.uses_tun() && !crate::is_admin() {
        // Resolve and verify all privileged-mode dependencies before UAC. The
        // elevated copy only launches already-installed cores and resumes the
        // exact pending profile. Windows GUI-subsystem builds do not create an
        // extra console window, including debug builds launched by `tauri dev`.
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
pub fn sync_tray_state(app: AppHandle, state: String) {
    tray::set_visual_state(&app, &state);
}

#[tauri::command]
pub fn get_is_elevated() -> bool {
    crate::is_admin()
}

#[tauri::command]
pub fn elevate(app: AppHandle) -> Result<(), AetherError> {
    if crate::is_admin() {
        return Ok(());
    }

    // connect() has already verified dependencies and stored the exact profile
    // selected by the user. Do not reload or overwrite it here: doing so could
    // replace a pending Tunnel/Both selection with the last successful profile.
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
pub fn get_traffic() -> crate::traffic::TrafficStats {
    crate::traffic::current()
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

    // A persisted managed-version pointer is not authoritative when its binary
    // has disappeared or was quarantined. `current_info` resolves the same path
    // the connection runtime will actually launch, so expose a managed active
    // version only when the resolved source is genuinely managed. This also
    // prevents a bundled version metadata file from masquerading as a usable
    // core when the corresponding executable was not packaged.
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
