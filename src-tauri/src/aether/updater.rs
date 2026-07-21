use crate::core_manager::{self, CoreKind};
use crate::error::AetherError;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub use crate::core_manager::CoreInfo;

pub fn resolve_binary(app: &AppHandle) -> Result<PathBuf, AetherError> {
    core_manager::resolve_binary(app, CoreKind::Aether).map_err(|_| {
        AetherError::BinaryMissing("no active or bundled Aether core is installed".into())
    })
}

pub fn bundled_recovery_binary(app: &AppHandle) -> Option<PathBuf> {
    core_manager::bundled_recovery_binary(app, CoreKind::Aether)
}

pub fn is_managed_binary(app: &AppHandle, path: &Path) -> bool {
    core_manager::is_managed_binary(app, CoreKind::Aether, path)
}

pub fn reject_managed_binary(app: &AppHandle, path: &Path, reason: &str) {
    core_manager::reject_active_version(app, CoreKind::Aether, path, reason);
}

pub fn detect_version(binary: &Path) -> Option<String> {
    core_manager::detect_version(binary)
}

pub fn current_info(app: &AppHandle) -> Result<CoreInfo, AetherError> {
    core_manager::current_info(app, CoreKind::Aether)
}

pub fn refresh_now(app: &AppHandle) -> Result<CoreInfo, AetherError> {
    core_manager::install_latest_stable(app, CoreKind::Aether)?;
    current_info(app)
}
