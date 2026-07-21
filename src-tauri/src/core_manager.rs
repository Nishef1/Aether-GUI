use crate::diagnostics;
use crate::error::AetherError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

const ACTIVE_VERSION_FILE: &str = "active-version.txt";
const REJECTED_VERSION_FILE: &str = "rejected-version.txt";
const RELEASE_LIMIT: usize = 30;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CoreKind {
    Aether,
    Singbox,
}

impl CoreKind {
    pub fn id(self) -> &'static str {
        match self {
            Self::Aether => "aether",
            Self::Singbox => "singbox",
        }
    }

    fn repository(self) -> &'static str {
        match self {
            Self::Aether => "CluvexStudio/Aether",
            Self::Singbox => "SagerNet/sing-box",
        }
    }

    fn binary_stem(self) -> &'static str {
        match self {
            Self::Aether => "aether",
            Self::Singbox => "sing-box",
        }
    }

    fn bundled_version_file(self) -> &'static str {
        match self {
            Self::Aether => "aether-version.txt",
            Self::Singbox => "sing-box-version.txt",
        }
    }

    fn installer_script(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Self::Aether, true) => "fetch-aether.ps1",
            (Self::Aether, false) => "fetch-aether.sh",
            (Self::Singbox, true) => "fetch-singbox.ps1",
            (Self::Singbox, false) => "fetch-singbox.sh",
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct CoreInfo {
    pub kind: CoreKind,
    pub path: String,
    pub version: Option<String>,
    pub source: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct CoreRelease {
    pub version: String,
    pub prerelease: bool,
    pub installed: bool,
    pub active: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct CoreStatus {
    pub kind: CoreKind,
    pub active_version: Option<String>,
    pub bundled_version: Option<String>,
    pub installed_versions: Vec<String>,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    prerelease: bool,
    draft: bool,
}

fn safe_tag(tag: &str) -> String {
    tag.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn executable_name(kind: CoreKind, version: &str) -> String {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    format!("{}-{}{}", kind.binary_stem(), safe_tag(version), extension)
}

fn conventional_binary_name(kind: CoreKind) -> String {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    format!("{}{}", kind.binary_stem(), extension)
}

fn managed_dir(app: &AppHandle, kind: CoreKind) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("cores")
        .join(kind.id())
}

fn binaries_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries")
}

fn resource_binaries_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("binaries"))
}

fn ensure_executable(_path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(_path, fs::Permissions::from_mode(0o755));
    }
}

fn active_version(app: &AppHandle, kind: CoreKind) -> Option<String> {
    fs::read_to_string(managed_dir(app, kind).join(ACTIVE_VERSION_FILE))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn rejected_version(app: &AppHandle, kind: CoreKind) -> Option<String> {
    fs::read_to_string(managed_dir(app, kind).join(REJECTED_VERSION_FILE))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn managed_binary(app: &AppHandle, kind: CoreKind) -> Option<PathBuf> {
    let version = active_version(app, kind)?;
    if rejected_version(app, kind).as_deref() == Some(version.as_str()) {
        diagnostics::record(
            "core-manager",
            "warn",
            format!("{} {version} is quarantined", kind.id()),
        );
        return None;
    }
    let path = managed_dir(app, kind).join(executable_name(kind, &version));
    if path.exists() {
        ensure_executable(&path);
        Some(path)
    } else {
        None
    }
}

pub fn bundled_recovery_binary(app: &AppHandle, kind: CoreKind) -> Option<PathBuf> {
    for dir in [resource_binaries_dir(app), Some(binaries_dir())]
        .into_iter()
        .flatten()
    {
        let path = dir.join(conventional_binary_name(kind));
        if path.exists() {
            ensure_executable(&path);
            return Some(path);
        }
    }
    None
}

pub fn resolve_binary(app: &AppHandle, kind: CoreKind) -> Result<PathBuf, AetherError> {
    if let Some(path) = managed_binary(app, kind) {
        return Ok(path);
    }
    bundled_recovery_binary(app, kind)
        .ok_or_else(|| AetherError::CoreManager(format!("{} core is not installed", kind.id())))
}

pub fn is_managed_binary(app: &AppHandle, kind: CoreKind, path: &Path) -> bool {
    path.starts_with(managed_dir(app, kind))
}

pub fn reject_active_version(app: &AppHandle, kind: CoreKind, path: &Path, reason: &str) {
    if !is_managed_binary(app, kind, path) {
        return;
    }
    let Some(version) = active_version(app, kind) else {
        return;
    };
    let expected = managed_dir(app, kind).join(executable_name(kind, &version));
    if expected != path {
        return;
    }
    let dir = managed_dir(app, kind);
    if fs::create_dir_all(&dir).is_ok()
        && fs::write(dir.join(REJECTED_VERSION_FILE), &version).is_ok()
    {
        diagnostics::record(
            "core-manager",
            "error",
            format!("quarantined {} {version}: {reason}", kind.id()),
        );
    }
}

pub fn select_version(
    app: &AppHandle,
    kind: CoreKind,
    version: &str,
) -> Result<CoreStatus, AetherError> {
    let dir = managed_dir(app, kind);
    let binary = dir.join(executable_name(kind, version));
    if !binary.exists() {
        return Err(AetherError::CoreManager(format!(
            "{} {version} is not installed",
            kind.id()
        )));
    }
    fs::create_dir_all(&dir).map_err(|e| AetherError::CoreManager(e.to_string()))?;

    // The binaries themselves are immutable/versioned. The pointer is tiny and
    // user-triggered while disconnected, so direct replacement is both simpler
    // and cross-platform (notably Windows, where rename-over-existing differs).
    fs::write(dir.join(ACTIVE_VERSION_FILE), version)
        .map_err(|e| AetherError::CoreManager(e.to_string()))?;
    let _ = fs::remove_file(dir.join(REJECTED_VERSION_FILE));

    diagnostics::record(
        "core-manager",
        "info",
        format!("selected {} {version}", kind.id()),
    );
    status(app, kind)
}

fn installer_script(app: &AppHandle, kind: CoreKind) -> Option<PathBuf> {
    let name = kind.installer_script();
    resource_binaries_dir(app)
        .map(|dir| dir.join(name))
        .filter(|path| path.exists())
        .or_else(|| {
            let path = binaries_dir().join(name);
            path.exists().then_some(path)
        })
}

fn no_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn command_output(mut command: Command) -> Result<std::process::Output, AetherError> {
    no_window(&mut command);
    command
        .output()
        .map_err(|e| AetherError::CoreManager(format!("failed to launch helper: {e}")))
}

pub fn install_version(
    app: &AppHandle,
    kind: CoreKind,
    version: &str,
) -> Result<CoreStatus, AetherError> {
    if crate::is_admin() {
        return Err(AetherError::CoreManager(
            "core installation is disabled while the GUI is elevated; restart normally".into(),
        ));
    }
    let script = installer_script(app, kind).ok_or_else(|| {
        AetherError::CoreManager(format!("{} installer helper is missing", kind.id()))
    })?;
    let dir = managed_dir(app, kind);
    fs::create_dir_all(&dir).map_err(|e| AetherError::CoreManager(e.to_string()))?;

    diagnostics::record(
        "core-manager",
        "info",
        format!("installing {} {version}", kind.id()),
    );

    let output = if cfg!(windows) {
        let mut command = Command::new("powershell.exe");
        command
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&script)
            .arg("-DestDir")
            .arg(&dir)
            .arg("-Version")
            .arg(version);
        command_output(command)?
    } else {
        let mut command = Command::new("bash");
        command
            .arg(&script)
            .arg("--dest-dir")
            .arg(&dir)
            .arg("--version")
            .arg(version);
        command_output(command)?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AetherError::CoreManager(if stderr.is_empty() {
            format!("{} installer exited with {}", kind.id(), output.status)
        } else {
            stderr
        }));
    }

    let expected = dir.join(executable_name(kind, version));
    if !expected.exists() {
        return Err(AetherError::CoreManager(format!(
            "installer did not produce expected binary {}",
            expected.display()
        )));
    }
    select_version(app, kind, version)
}

fn fetch_release_json(kind: CoreKind) -> Result<Vec<GithubRelease>, AetherError> {
    let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
    let url = format!(
        "https://api.github.com/repos/{}/releases?per_page={RELEASE_LIMIT}",
        kind.repository()
    );
    let mut command = Command::new(curl);
    command
        .args([
            "-fsSL",
            "--max-time",
            "15",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "User-Agent: Aether-GUI-Core-Manager",
        ])
        .arg(url);
    let output = command_output(command)?;
    if !output.status.success() {
        return Err(AetherError::CoreManager(format!(
            "GitHub release query failed with {}",
            output.status
        )));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| AetherError::CoreManager(format!("invalid GitHub release response: {e}")))
}

pub fn list_releases(app: &AppHandle, kind: CoreKind) -> Result<Vec<CoreRelease>, AetherError> {
    let installed = installed_versions(app, kind);
    let active = active_version(app, kind);
    let mut releases = fetch_release_json(kind)?
        .into_iter()
        .filter(|release| !release.draft)
        .map(|release| CoreRelease {
            installed: installed.iter().any(|version| version == &release.tag_name),
            active: active.as_deref() == Some(release.tag_name.as_str()),
            version: release.tag_name,
            prerelease: release.prerelease,
        })
        .collect::<Vec<_>>();

    // Keep locally installed old releases selectable even when they have aged
    // out of the first GitHub release page.
    for version in installed {
        if releases.iter().all(|release| release.version != version) {
            releases.push(CoreRelease {
                active: active.as_deref() == Some(version.as_str()),
                version,
                prerelease: false,
                installed: true,
            });
        }
    }
    Ok(releases)
}

pub fn latest_stable(app: &AppHandle, kind: CoreKind) -> Result<String, AetherError> {
    list_releases(app, kind)?
        .into_iter()
        .find(|release| !release.prerelease)
        .map(|release| release.version)
        .ok_or_else(|| AetherError::CoreManager(format!("no stable {} release found", kind.id())))
}

pub fn install_latest_stable(app: &AppHandle, kind: CoreKind) -> Result<CoreStatus, AetherError> {
    let version = latest_stable(app, kind)?;
    install_version(app, kind, &version)
}

pub fn ensure_active(app: &AppHandle, kind: CoreKind) -> Result<PathBuf, AetherError> {
    match resolve_binary(app, kind) {
        Ok(path) => Ok(path),
        Err(_) if !crate::is_admin() => {
            install_latest_stable(app, kind)?;
            resolve_binary(app, kind)
        }
        Err(error) => Err(error),
    }
}

pub fn remove_version(
    app: &AppHandle,
    kind: CoreKind,
    version: &str,
) -> Result<CoreStatus, AetherError> {
    if active_version(app, kind).as_deref() == Some(version) {
        return Err(AetherError::CoreManager(
            "cannot remove the active core version; select another version first".into(),
        ));
    }
    let path = managed_dir(app, kind).join(executable_name(kind, version));
    if path.exists() {
        fs::remove_file(path).map_err(|e| AetherError::CoreManager(e.to_string()))?;
    }
    status(app, kind)
}

pub fn installed_versions(app: &AppHandle, kind: CoreKind) -> Vec<String> {
    let dir = managed_dir(app, kind);
    let prefix = format!("{}-", kind.binary_stem());
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let mut versions = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            let Some(value) = name.strip_prefix(&prefix) else {
                continue;
            };
            let value = if suffix.is_empty() {
                value
            } else {
                let Some(value) = value.strip_suffix(suffix) else {
                    continue;
                };
                value
            };
            if !value.is_empty() {
                versions.push(value.to_string());
            }
        }
    }

    versions.sort();
    versions.dedup();
    versions
}

fn bundled_version(app: &AppHandle, kind: CoreKind) -> Option<String> {
    for dir in [resource_binaries_dir(app), Some(binaries_dir())]
        .into_iter()
        .flatten()
    {
        if let Ok(value) = fs::read_to_string(dir.join(kind.bundled_version_file())) {
            let value = value.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

pub fn status(app: &AppHandle, kind: CoreKind) -> Result<CoreStatus, AetherError> {
    Ok(CoreStatus {
        kind,
        active_version: active_version(app, kind),
        bundled_version: bundled_version(app, kind),
        installed_versions: installed_versions(app, kind),
    })
}

pub fn current_info(app: &AppHandle, kind: CoreKind) -> Result<CoreInfo, AetherError> {
    let path = resolve_binary(app, kind)?;
    let managed = is_managed_binary(app, kind, &path);
    let version = if managed {
        active_version(app, kind)
    } else {
        bundled_version(app, kind)
    };
    Ok(CoreInfo {
        kind,
        version,
        source: if managed { "managed" } else { "bundled" }.into(),
        path: path.display().to_string(),
    })
}

pub fn detect_version(binary: &Path) -> Option<String> {
    let mut command = Command::new(binary);
    command.arg("--version");
    let output = command_output(command).ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let value = stdout.trim();
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_tags_are_filename_safe() {
        assert_eq!(safe_tag("v1.3.0"), "v1.3.0");
        assert_eq!(safe_tag("v1/../../evil"), "v1_.._.._evil");
    }

    #[test]
    fn versioned_binary_names_are_distinct() {
        assert_ne!(
            executable_name(CoreKind::Aether, "v1.2.0"),
            executable_name(CoreKind::Aether, "v1.3.0")
        );
    }
}
