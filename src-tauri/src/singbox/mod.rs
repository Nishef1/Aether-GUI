pub mod config;
pub mod process;
pub mod status;

use crate::diagnostics;
use crate::error::AetherError;
use crate::events::{now_millis, LogEvent, LOG_EVENT};
use process::SingboxProcess;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const COMPATIBLE_VERSION_TAG: &str = "v1.13.12";

pub struct SingboxManager {
    process: Option<SingboxProcess>,
    config_path: Option<PathBuf>,
    active: bool,
    socks_port: Option<u16>,
}

impl SingboxManager {
    pub fn new() -> Self {
        Self {
            process: None,
            config_path: None,
            active: false,
            socks_port: None,
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }
}

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "sing-box.exe"
    } else {
        "sing-box"
    }
}

fn app_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
}

fn managed_dir(app: &AppHandle) -> PathBuf {
    app_data_dir(app).join("tun")
}

fn pid_file(data_dir: &Path) -> PathBuf {
    data_dir.join("singbox.pid")
}

fn write_pid(data_dir: &Path, pid: u32) {
    let _ = fs::write(pid_file(data_dir), pid.to_string());
}

fn clear_pid(data_dir: &Path) {
    let _ = fs::remove_file(pid_file(data_dir));
}

fn ensure_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o755));
    }
}

/// Accept a TUN engine only when it carries the metadata written by our
/// verified fetcher for the exact config schema tested by this GUI. On Windows,
/// the Wintun driver must also be present beside the executable.
fn compatible_binary_in(dir: &Path) -> Option<PathBuf> {
    let version = fs::read_to_string(dir.join("sing-box-version.txt")).ok()?;
    if version.trim() != COMPATIBLE_VERSION_TAG {
        return None;
    }

    #[cfg(windows)]
    if !dir.join("wintun.dll").exists() {
        return None;
    }

    let binary = dir.join(binary_name());
    if !binary.exists() {
        return None;
    }
    ensure_executable(&binary);
    Some(binary)
}

fn existing_binary(app: &AppHandle) -> Option<PathBuf> {
    if let Some(path) = compatible_binary_in(&managed_dir(app)) {
        return Some(path);
    }

    if let Some(path) = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|dir| compatible_binary_in(&dir.join("binaries")))
    {
        return Some(path);
    }

    compatible_binary_in(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"))
}

fn fetch_script(app: &AppHandle) -> Option<PathBuf> {
    let script = if cfg!(windows) {
        "fetch-singbox.ps1"
    } else {
        "fetch-singbox.sh"
    };
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("binaries").join(script))
        .filter(|path| path.exists())
        .or_else(|| {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(script);
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

fn emit_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let message = message.into();
    diagnostics::record("sing-box", level, &message);
    let _ = app.emit(
        LOG_EVENT,
        LogEvent {
            line: format!("[sing-box] {message}"),
            timestamp: now_millis(),
        },
    );
}

fn fetch_binary(app: &AppHandle) -> Result<PathBuf, AetherError> {
    let script = fetch_script(app).ok_or_else(|| {
        AetherError::SingboxBinaryMissing("sing-box fetch helper was not bundled".into())
    })?;
    let dest = managed_dir(app);
    fs::create_dir_all(&dest).map_err(|e| AetherError::Internal(e.to_string()))?;

    emit_log(
        app,
        "info",
        format!(
            "validated TUN dependency {COMPATIBLE_VERSION_TAG} is missing; fetching a verified release"
        ),
    );
    let mut command = if cfg!(windows) {
        let mut cmd = Command::new("powershell.exe");
        cmd.arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&script)
            .arg("-DestDir")
            .arg(&dest);
        cmd
    } else {
        let mut cmd = Command::new("bash");
        cmd.arg(&script).arg("--dest-dir").arg(&dest);
        cmd
    };
    no_window(&mut command);
    let output = command
        .output()
        .map_err(|e| AetherError::SingboxBinaryMissing(format!("launch fetch helper: {e}")))?;

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if !line.trim().is_empty() {
            emit_log(app, "info", line);
        }
    }
    for line in String::from_utf8_lossy(&output.stderr).lines() {
        if !line.trim().is_empty() {
            emit_log(app, "warn", line);
        }
    }
    if !output.status.success() {
        return Err(AetherError::SingboxBinaryMissing(format!(
            "verified dependency fetch failed with {}",
            output.status
        )));
    }

    existing_binary(app).ok_or_else(|| {
        AetherError::SingboxBinaryMissing(format!(
            "verified sing-box {COMPATIBLE_VERSION_TAG} was not installed correctly in {}",
            dest.display()
        ))
    })
}

pub fn ensure_binary(app: &AppHandle) -> Result<PathBuf, AetherError> {
    existing_binary(app).map(Ok).unwrap_or_else(|| fetch_binary(app))
}

fn write_config(app: &AppHandle, port: u16) -> Result<PathBuf, AetherError> {
    let dir = managed_dir(app);
    fs::create_dir_all(&dir).map_err(|e| AetherError::SingboxConfigFailed(e.to_string()))?;
    let content = config::generate_config(port)
        .map_err(|e| AetherError::SingboxConfigFailed(e.to_string()))?;
    let path = dir.join("singbox-config.json");
    fs::write(&path, content).map_err(|e| AetherError::SingboxConfigFailed(e.to_string()))?;
    Ok(path)
}

pub fn start_tunnel(
    app: AppHandle,
    manager: Arc<Mutex<SingboxManager>>,
    aether_socks_port: u16,
) -> Result<(), AetherError> {
    {
        let mgr = manager.lock().unwrap();
        if mgr.process.is_some() {
            return Err(AetherError::SingboxAlreadyRunning);
        }
    }

    let binary = ensure_binary(&app)?;
    let config_path = write_config(&app, aether_socks_port)?;
    process::check_config(&binary, &config_path)?;
    emit_log(
        &app,
        "info",
        format!(
            "configuration validated with {COMPATIBLE_VERSION_TAG} ({})",
            binary.display()
        ),
    );

    let (log_tx, log_rx) = mpsc::channel();
    let process = process::spawn(&binary, &config_path, log_tx)?;
    let pid = process.pid();
    let data_dir = managed_dir(&app);
    write_pid(&data_dir, pid);

    {
        let mut mgr = manager.lock().unwrap();
        mgr.process = Some(process);
        mgr.config_path = Some(config_path);
        mgr.active = false;
        mgr.socks_port = Some(aether_socks_port);
    }

    let app_for_logs = app.clone();
    std::thread::spawn(move || {
        for log in log_rx {
            let level = if log.stream == "stderr" {
                "warn"
            } else {
                "info"
            };
            emit_log(&app_for_logs, level, log.line);
        }
    });

    let deadline = Instant::now() + status::TUN_STARTUP_TIMEOUT;
    let mut last_error = String::from("TUN data plane did not become healthy");
    loop {
        std::thread::sleep(Duration::from_millis(750));

        if manager.lock().unwrap().process.is_none() {
            return Err(AetherError::TunHealthFailed("TUN startup cancelled".into()));
        }

        if let Some(exit) = process_exit_status(&manager)? {
            stop_tunnel(&app, &manager);
            return Err(AetherError::TunHealthFailed(format!(
                "sing-box exited during startup ({exit})"
            )));
        }

        match status::verify_tunnel(aether_socks_port) {
            Ok(()) => {
                manager.lock().unwrap().active = true;
                emit_log(&app, "info", "system-wide TUN data plane verified");
                return Ok(());
            }
            Err(e) => {
                last_error = e.to_string();
                diagnostics::record("tun-health", "warn", &last_error);
            }
        }

        if Instant::now() >= deadline {
            stop_tunnel(&app, &manager);
            return Err(AetherError::TunHealthFailed(last_error));
        }
    }
}

pub fn process_exit_status(
    manager: &Arc<Mutex<SingboxManager>>,
) -> Result<Option<ExitStatus>, AetherError> {
    let mut mgr = manager.lock().unwrap();
    match mgr.process.as_mut() {
        Some(process) => process
            .try_wait()
            .map_err(|e| AetherError::Internal(format!("check sing-box process: {e}"))),
        None => Ok(None),
    }
}

pub fn verify_active_tunnel(manager: &Arc<Mutex<SingboxManager>>) -> Result<(), AetherError> {
    let port = {
        let mgr = manager.lock().unwrap();
        if !mgr.active {
            return Err(AetherError::TunHealthFailed("TUN is not active".into()));
        }
        mgr.socks_port
            .ok_or_else(|| AetherError::TunHealthFailed("missing SOCKS port".into()))?
    };
    status::verify_tunnel(port)
}

pub fn stop_tunnel(app: &AppHandle, manager: &Arc<Mutex<SingboxManager>>) {
    let mut process = {
        let mut mgr = manager.lock().unwrap();
        mgr.active = false;
        mgr.socks_port = None;
        mgr.config_path = None;
        mgr.process.take()
    };
    let had_process = process.is_some();
    if let Some(process) = process.as_mut() {
        process.kill();
    }
    clear_pid(&managed_dir(app));
    if had_process {
        emit_log(app, "info", "TUN stopped");
    }
}

pub fn shutdown_blocking(manager: &Arc<Mutex<SingboxManager>>, data_dir: &Path) {
    let mut process = {
        let mut mgr = manager.lock().unwrap();
        mgr.active = false;
        mgr.socks_port = None;
        mgr.config_path = None;
        mgr.process.take()
    };
    if let Some(process) = process.as_mut() {
        process.kill();
    }
    clear_pid(&data_dir.join("tun"));
}

fn expected_process_is_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let mut command = Command::new("tasklist");
        command.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
        no_window(&mut command);
        return command
            .output()
            .map(|output| {
                let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
                text.lines().any(|line| {
                    line.split(',')
                        .next()
                        .map(|name| name.trim_matches('"') == "sing-box.exe")
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);
    }

    #[cfg(unix)]
    {
        Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "comm="])
            .output()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                    Path::new(line.trim())
                        .file_name()
                        .map(|name| name.to_string_lossy() == "sing-box")
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    }
}

fn kill_pid(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/F"]);
        no_window(&mut command);
        return command
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);
    }

    #[cfg(unix)]
    {
        Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

/// Reap only a process that both matches our persisted PID and has the expected
/// executable name. If an unelevated restart cannot terminate an elevated
/// orphan, retain the PID file so the next privileged TUN launch can finish the
/// cleanup instead of losing ownership information.
pub fn reap_orphan(app: &AppHandle) {
    let dir = managed_dir(app);
    let path = pid_file(&dir);
    let Ok(contents) = fs::read_to_string(&path) else {
        return;
    };
    let Ok(pid) = contents.trim().parse::<u32>() else {
        clear_pid(&dir);
        return;
    };

    if !expected_process_is_alive(pid) {
        diagnostics::record(
            "sing-box",
            "info",
            format!("stale PID file ignored because PID {pid} is not sing-box"),
        );
        clear_pid(&dir);
        return;
    }

    diagnostics::record("sing-box", "warn", format!("reaping owned orphan PID {pid}"));
    if kill_pid(pid) {
        clear_pid(&dir);
        diagnostics::record("sing-box", "info", format!("orphan PID {pid} terminated"));
    } else {
        diagnostics::record(
            "sing-box",
            "warn",
            format!(
                "could not terminate owned orphan PID {pid}; retaining PID file for a privileged cleanup attempt"
            ),
        );
    }
}
