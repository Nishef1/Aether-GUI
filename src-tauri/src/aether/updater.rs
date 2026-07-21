use crate::diagnostics;
use crate::error::AetherError;
use crate::events::{now_millis, LogEvent, LOG_EVENT};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone, Debug)]
pub struct CoreInfo {
    pub path: String,
    pub version: Option<String>,
    pub source: String,
}

fn binary_name() -> &'static str {
    if cfg!(windows) { "aether.exe" } else { "aether" }
}

fn managed_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("core")
}

fn managed_binary(app: &AppHandle) -> PathBuf {
    managed_dir(app).join(binary_name())
}

fn resource_binary(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("binaries").join(binary_name()))
        .filter(|path| path.exists())
}

fn development_binary() -> Option<PathBuf> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(binary_name());
    path.exists().then_some(path)
}

fn ensure_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
    }
}

pub fn resolve_binary(app: &AppHandle) -> Result<PathBuf, AetherError> {
    let managed = managed_binary(app);
    if managed.exists() {
        ensure_executable(&managed);
        return Ok(managed);
    }

    if let Some(path) = resource_binary(app).or_else(development_binary) {
        ensure_executable(&path);
        return Ok(path);
    }

    Err(AetherError::BinaryMissing(managed.display().to_string()))
}

fn fetch_script(app: &AppHandle) -> Option<PathBuf> {
    let script_name = if cfg!(windows) {
        "fetch-aether.ps1"
    } else {
        "fetch-aether.sh"
    };

    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("binaries").join(script_name))
        .filter(|path| path.exists())
        .or_else(|| {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(script_name);
            path.exists().then_some(path)
        })
}

fn command_output(mut command: Command) -> std::io::Result<std::process::Output> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.output()
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

fn emit_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let message = message.into();
    diagnostics::record("core-updater", level, &message);
    let _ = app.emit(
        LOG_EVENT,
        LogEvent {
            line: format!("[core-updater] {message}"),
            timestamp: now_millis(),
        },
    );
}

pub fn current_info(app: &AppHandle) -> Result<CoreInfo, AetherError> {
    let path = resolve_binary(app)?;
    let managed = managed_binary(app);
    Ok(CoreInfo {
        version: detect_version(&path),
        source: if path == managed { "managed" } else { "bundled" }.into(),
        path: path.display().to_string(),
    })
}

/// Best-effort update of the independently managed Aether core. A failure never
/// removes the currently working core; the fetch scripts verify checksums and
/// replace the binary only after the download is complete.
pub fn refresh_now(app: &AppHandle) -> Result<CoreInfo, AetherError> {
    let script = fetch_script(app).ok_or_else(|| {
        AetherError::CoreUpdateFailed("Aether update helper script was not bundled".into())
    })?;
    let dest = managed_dir(app);
    std::fs::create_dir_all(&dest)
        .map_err(|e| AetherError::CoreUpdateFailed(format!("create core directory: {e}")))?;

    emit_log(app, "info", "checking for a newer stable Aether core");

    let output = if cfg!(windows) {
        let mut command = Command::new("powershell.exe");
        command
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&script)
            .arg("-DestDir")
            .arg(&dest);
        command_output(command)
    } else {
        let mut command = Command::new("bash");
        command.arg(&script).arg("--dest-dir").arg(&dest);
        command_output(command)
    }
    .map_err(|e| AetherError::CoreUpdateFailed(format!("launch updater: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stdout.is_empty() {
        for line in stdout.lines() {
            emit_log(app, "info", line);
        }
    }
    if !stderr.is_empty() {
        for line in stderr.lines() {
            emit_log(app, "warn", line);
        }
    }

    if !output.status.success() {
        return Err(AetherError::CoreUpdateFailed(if stderr.is_empty() {
            format!("updater exited with {}", output.status)
        } else {
            stderr
        }));
    }

    let info = current_info(app)?;
    emit_log(
        app,
        "info",
        format!(
            "active core: {} ({})",
            info.version.clone().unwrap_or_else(|| "unknown version".into()),
            info.source
        ),
    );
    Ok(info)
}

pub fn refresh_in_background(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(e) = refresh_now(&app) {
            emit_log(&app, "warn", format!("core update skipped: {e}"));
        }
    });
}
