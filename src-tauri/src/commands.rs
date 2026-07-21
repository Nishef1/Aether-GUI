use crate::aether::{self, profiles::ConnectionProfile};
use crate::core_manager::{self, CoreKind, CoreRelease, CoreStatus};
use crate::error::AetherError;
use crate::state::{AppState, ConnectionState};
use crate::tray;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, State};

const APP_RELEASE_REPO: &str = "Nishef1/Aether-GUI";
const APP_RELEASE_PREFIX: &str = "https://github.com/Nishef1/Aether-GUI/releases/";

#[derive(Deserialize)]
struct GithubAppRelease {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
}

#[derive(Serialize)]
pub struct AppUpdateInfo {
    current_version: String,
    latest_version: String,
    release_url: String,
}

fn require_disconnected(state: &State<AppState>) -> Result<(), AetherError> {
    if state.manager.lock().unwrap().is_busy() {
        Err(AetherError::CoreManager(
            "disconnect before changing core versions".into(),
        ))
    } else {
        Ok(())
    }
}

fn no_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn parse_version(value: &str) -> Option<Vec<u64>> {
    let trimmed = value.trim().trim_start_matches(['v', 'V']);
    let core = trimmed.split('-').next().unwrap_or(trimmed);
    let parts = core
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    (!parts.is_empty()).then_some(parts)
}

fn version_is_newer(candidate: &str, current: &str) -> bool {
    let (Some(mut candidate), Some(mut current)) =
        (parse_version(candidate), parse_version(current))
    else {
        return candidate != current;
    };
    let width = candidate.len().max(current.len());
    candidate.resize(width, 0);
    current.resize(width, 0);
    candidate > current
}

fn fetch_app_update(app: &AppHandle) -> Result<Option<AppUpdateInfo>, AetherError> {
    let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
    let url = format!("https://api.github.com/repos/{APP_RELEASE_REPO}/releases/latest");
    let mut command = Command::new(curl);
    command.args([
        "-fsSL",
        "--max-time",
        "12",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "User-Agent: Aether-GUI-Updater",
        &url,
    ]);
    no_window(&mut command);
    let output = command
        .output()
        .map_err(|error| AetherError::Internal(format!("app update query failed: {error}")))?;
    if !output.status.success() {
        return Err(AetherError::Internal(format!(
            "app update query failed with {}",
            output.status
        )));
    }

    let release: GithubAppRelease = serde_json::from_slice(&output.stdout)
        .map_err(|error| AetherError::Internal(format!("invalid app release response: {error}")))?;
    if release.draft || release.prerelease {
        return Ok(None);
    }

    let current_version = app.package_info().version.to_string();
    if !version_is_newer(&release.tag_name, &current_version) {
        return Ok(None);
    }

    Ok(Some(AppUpdateInfo {
        current_version,
        latest_version: release.tag_name,
        release_url: release.html_url,
    }))
}

fn open_external_url(url: &str) -> Result<(), AetherError> {
    if !url.starts_with(APP_RELEASE_PREFIX) {
        return Err(AetherError::Internal(
            "refusing to open an untrusted update URL".into(),
        ));
    }

    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler").arg(url);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    no_window(&mut command);
    command
        .spawn()
        .map_err(|error| AetherError::Internal(format!("could not open update page: {error}")))?;
    Ok(())
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
pub async fn check_app_update(app: AppHandle) -> Result<Option<AppUpdateInfo>, AetherError> {
    tauri::async_runtime::spawn_blocking(move || fetch_app_update(&app))
        .await
        .map_err(|error| AetherError::Internal(format!("app update task failed: {error}")))?
}

#[tauri::command]
pub fn open_app_update(release_url: String) -> Result<(), AetherError> {
    open_external_url(&release_url)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_version_comparison_handles_v_prefix() {
        assert!(version_is_newer("v0.6.0", "0.5.0"));
        assert!(version_is_newer("1.3.1", "v1.3.0"));
        assert!(!version_is_newer("v1.3.0", "1.3.0"));
        assert!(!version_is_newer("v1.2.9", "1.3.0"));
    }
}
