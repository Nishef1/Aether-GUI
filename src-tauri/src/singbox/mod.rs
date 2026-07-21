pub mod config;
pub mod process;
pub mod status;

use crate::core_manager::{self, CoreKind};
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

fn runtime_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("tun")
}

fn pid_file(app: &AppHandle) -> PathBuf {
    runtime_dir(app).join("singbox.pid")
}

fn write_pid(app: &AppHandle, pid: u32) {
    let dir = runtime_dir(app);
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(pid_file(app), pid.to_string());
}

fn clear_pid(app: &AppHandle) {
    let _ = fs::remove_file(pid_file(app));
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

pub fn ensure_binary(app: &AppHandle) -> Result<PathBuf, AetherError> {
    core_manager::ensure_active(app, CoreKind::Singbox)
        .map_err(|error| AetherError::SingboxBinaryMissing(error.to_string()))
}

fn write_config(app: &AppHandle, port: u16, aether_binary: &Path) -> Result<PathBuf, AetherError> {
    let dir = runtime_dir(app);
    fs::create_dir_all(&dir).map_err(|e| AetherError::SingboxConfigFailed(e.to_string()))?;
    let content = config::generate_config(port, aether_binary)
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
    let aether_binary = crate::aether::updater::resolve_binary(&app)?;
    let config_path = write_config(&app, aether_socks_port, &aether_binary)?;

    // Every selectable sing-box version must prove that it understands the
    // current generated schema before it is allowed to take over system routes.
    process::check_config(&binary, &config_path)?;
    emit_log(
        &app,
        "info",
        format!(
            "validated TUN config with core={} and aether={}",
            binary.display(),
            aether_binary.display()
        ),
    );

    let (log_tx, log_rx) = mpsc::channel();
    let process = process::spawn(&binary, &config_path, log_tx)?;
    write_pid(&app, process.pid());

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

        let health_error = match status::verify_tunnel(aether_socks_port) {
            Ok(()) => {
                manager.lock().unwrap().active = true;
                emit_log(&app, "info", "system-wide TUN data plane verified");
                return Ok(());
            }
            Err(error) => error.to_string(),
        };
        diagnostics::record("tun-health", "warn", &health_error);

        if Instant::now() >= deadline {
            stop_tunnel(&app, &manager);
            return Err(AetherError::TunHealthFailed(health_error));
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
    clear_pid(app);
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
    let _ = fs::remove_file(data_dir.join("tun").join("singbox.pid"));
}

fn expected_singbox_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    if cfg!(windows) {
        name == "sing-box.exe" || (name.starts_with("sing-box-v") && name.ends_with(".exe"))
    } else {
        name == "sing-box" || name.starts_with("sing-box-v")
    }
}

fn expected_process_is_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let mut command = Command::new("tasklist");
        command.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
        no_window(&mut command);
        command
            .output()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                    line.split(',')
                        .next()
                        .map(|name| expected_singbox_name(name.trim_matches('"')))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
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
                        .map(|name| expected_singbox_name(&name.to_string_lossy()))
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
        command
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
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

pub fn reap_orphan(app: &AppHandle) {
    let path = pid_file(app);
    let Ok(contents) = fs::read_to_string(&path) else {
        return;
    };
    let Ok(pid) = contents.trim().parse::<u32>() else {
        clear_pid(app);
        return;
    };

    if !expected_process_is_alive(pid) {
        diagnostics::record(
            "sing-box",
            "info",
            format!("stale PID file ignored because PID {pid} is not an owned sing-box core"),
        );
        clear_pid(app);
        return;
    }

    diagnostics::record(
        "sing-box",
        "warn",
        format!("reaping owned orphan PID {pid}"),
    );
    if kill_pid(pid) {
        clear_pid(app);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_expected_singbox_names() {
        assert!(expected_singbox_name(if cfg!(windows) {
            "sing-box.exe"
        } else {
            "sing-box"
        }));
        assert!(expected_singbox_name(if cfg!(windows) {
            "sing-box-v1.13.12.exe"
        } else {
            "sing-box-v1.13.12"
        }));
        assert!(!expected_singbox_name("not-sing-box.exe"));
    }
}
