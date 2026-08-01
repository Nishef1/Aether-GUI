pub mod config;
pub mod process;
pub mod status;

use crate::aether::profiles::TunEngine;
use crate::core_manager::{self, CoreKind};
use crate::diagnostics;
use crate::error::AetherError;
use crate::events::{now_millis, LogEvent, LOG_EVENT};
use crate::xray;
use process::SingboxProcess;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const ENGINE_XRAY: u8 = 0;
const ENGINE_SINGBOX: u8 = 1;
static SELECTED_ENGINE: AtomicU8 = AtomicU8::new(ENGINE_XRAY);

pub fn set_tun_engine(engine: TunEngine) {
    SELECTED_ENGINE.store(
        match engine {
            TunEngine::Xray => ENGINE_XRAY,
            TunEngine::Singbox => ENGINE_SINGBOX,
        },
        Ordering::Release,
    );
}

pub fn selected_tun_engine() -> TunEngine {
    match SELECTED_ENGINE.load(Ordering::Acquire) {
        ENGINE_SINGBOX => TunEngine::Singbox,
        _ => TunEngine::Xray,
    }
}

enum TunnelProcess {
    Singbox(SingboxProcess),
    Xray(xray::process::XrayProcess),
}

impl TunnelProcess {
    fn pid(&self) -> u32 {
        match self {
            Self::Singbox(process) => process.pid(),
            Self::Xray(process) => process.pid(),
        }
    }

    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        match self {
            Self::Singbox(process) => process.try_wait(),
            Self::Xray(process) => process.try_wait(),
        }
    }

    fn kill(&mut self) {
        match self {
            Self::Singbox(process) => process.kill(),
            Self::Xray(process) => process.kill(),
        }
    }
}

pub struct SingboxManager {
    process: Option<TunnelProcess>,
    config_path: Option<PathBuf>,
    active: bool,
    socks_port: Option<u16>,
    engine: Option<TunEngine>,
}

impl SingboxManager {
    pub fn new() -> Self {
        Self {
            process: None,
            config_path: None,
            active: false,
            socks_port: None,
            engine: None,
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
    runtime_dir(app).join("system-tun.pid")
}

fn legacy_singbox_pid_file(app: &AppHandle) -> PathBuf {
    runtime_dir(app).join("singbox.pid")
}

fn write_pid(app: &AppHandle, pid: u32, engine: TunEngine) {
    let dir = runtime_dir(app);
    let _ = fs::create_dir_all(&dir);
    let engine = match engine {
        TunEngine::Xray => "xray",
        TunEngine::Singbox => "singbox",
    };
    let _ = fs::write(pid_file(app), format!("{engine} {pid}"));
    let _ = fs::remove_file(legacy_singbox_pid_file(app));
}

fn clear_pid(app: &AppHandle) {
    let _ = fs::remove_file(pid_file(app));
    let _ = fs::remove_file(legacy_singbox_pid_file(app));
}

fn no_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn engine_label(engine: TunEngine) -> &'static str {
    match engine {
        TunEngine::Xray => "xray",
        TunEngine::Singbox => "sing-box",
    }
}

fn emit_log(app: &AppHandle, engine: TunEngine, level: &str, message: impl Into<String>) {
    let message = message.into();
    let source = engine_label(engine);
    diagnostics::record(source, level, &message);
    let _ = app.emit(
        LOG_EVENT,
        LogEvent {
            line: format!("[{source}] {message}"),
            timestamp: now_millis(),
        },
    );
}

fn ensure_xray_wintun(binary: &Path) -> Result<(), AetherError> {
    #[cfg(windows)]
    {
        let wintun = binary
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("wintun.dll");
        if !wintun.exists() {
            return Err(AetherError::XrayBinaryMissing(format!(
                "{} is missing next to {}; reinstall the selected Xray version",
                wintun.display(),
                binary.display()
            )));
        }
    }
    Ok(())
}

pub fn ensure_binary(app: &AppHandle) -> Result<PathBuf, AetherError> {
    match selected_tun_engine() {
        TunEngine::Xray => {
            let binary = core_manager::ensure_active(app, CoreKind::Xray)
                .map_err(|error| AetherError::XrayBinaryMissing(error.to_string()))?;
            ensure_xray_wintun(&binary)?;
            Ok(binary)
        }
        TunEngine::Singbox => core_manager::ensure_active(app, CoreKind::Singbox)
            .map_err(|error| AetherError::SingboxBinaryMissing(error.to_string())),
    }
}

fn write_config(
    app: &AppHandle,
    engine: TunEngine,
    port: u16,
    aether_binary: &Path,
) -> Result<PathBuf, AetherError> {
    let dir = runtime_dir(app);
    fs::create_dir_all(&dir).map_err(|e| AetherError::Internal(e.to_string()))?;
    let (content, file_name) = match engine {
        TunEngine::Xray => (
            xray::config::generate_config(port, aether_binary)
                .map_err(|e| AetherError::XrayConfigFailed(e.to_string()))?,
            "xray-config.json",
        ),
        TunEngine::Singbox => (
            config::generate_config(port, aether_binary)
                .map_err(|e| AetherError::SingboxConfigFailed(e.to_string()))?,
            "singbox-config.json",
        ),
    };
    let path = dir.join(file_name);
    fs::write(&path, content).map_err(|e| match engine {
        TunEngine::Xray => AetherError::XrayConfigFailed(e.to_string()),
        TunEngine::Singbox => AetherError::SingboxConfigFailed(e.to_string()),
    })?;
    Ok(path)
}

fn check_config(engine: TunEngine, binary: &Path, config_path: &Path) -> Result<(), AetherError> {
    match engine {
        TunEngine::Xray => xray::process::check_config(binary, config_path),
        TunEngine::Singbox => process::check_config(binary, config_path),
    }
}

fn spawn_process(
    engine: TunEngine,
    binary: &Path,
    config_path: &Path,
    log_tx: mpsc::Sender<process::ProcessLog>,
) -> Result<TunnelProcess, AetherError> {
    match engine {
        TunEngine::Singbox => {
            process::spawn(binary, config_path, log_tx).map(TunnelProcess::Singbox)
        }
        TunEngine::Xray => {
            let (xray_tx, xray_rx) = mpsc::channel::<xray::process::ProcessLog>();
            std::thread::spawn(move || {
                for log in xray_rx {
                    let _ = log_tx.send(process::ProcessLog {
                        stream: log.stream,
                        line: log.line,
                    });
                }
            });
            xray::process::spawn(binary, config_path, xray_tx).map(TunnelProcess::Xray)
        }
    }
}

pub fn start_tunnel(
    app: AppHandle,
    manager: Arc<Mutex<SingboxManager>>,
    aether_socks_port: u16,
    connection_generation: u64,
    connection_manager: Arc<Mutex<crate::aether::AetherManager>>,
) -> Result<(), AetherError> {
    {
        let mgr = manager.lock().unwrap();
        if mgr.process.is_some() {
            return Err(match mgr.engine.unwrap_or_else(selected_tun_engine) {
                TunEngine::Xray => AetherError::XrayAlreadyRunning,
                TunEngine::Singbox => AetherError::SingboxAlreadyRunning,
            });
        }
    }

    let engine = selected_tun_engine();
    let binary = ensure_binary(&app)?;
    let aether_binary = crate::aether::updater::resolve_binary(&app)?;
    let config_path = write_config(&app, engine, aether_socks_port, &aether_binary)?;

    check_config(engine, &binary, &config_path)?;
    emit_log(
        &app,
        engine,
        "info",
        format!(
            "validated system TUN config with core={} and aether={}",
            binary.display(),
            aether_binary.display()
        ),
    );

    emit_log(&app, engine, "info", "starting system TUN process");
    let (log_tx, log_rx) = mpsc::channel::<process::ProcessLog>();
    let process = spawn_process(engine, &binary, &config_path, log_tx)?;
    let pid = process.pid();
    write_pid(&app, pid, engine);

    {
        let mut mgr = manager.lock().unwrap();
        mgr.process = Some(process);
        mgr.config_path = Some(config_path);
        mgr.active = false;
        mgr.socks_port = Some(aether_socks_port);
        mgr.engine = Some(engine);
    }
    emit_log(
        &app,
        engine,
        "info",
        format!("TUN process started (pid {pid})"),
    );

    let app_for_logs = app.clone();
    std::thread::spawn(move || {
        for log in log_rx {
            let level = if log.stream == "stderr" {
                "warn"
            } else {
                "info"
            };
            emit_log(&app_for_logs, engine, level, log.line);
        }
    });

    let deadline = Instant::now() + status::TUN_STARTUP_TIMEOUT;
    loop {
        std::thread::sleep(Duration::from_millis(750));

        if !connection_manager
            .lock()
            .unwrap()
            .is_current_generation(connection_generation)
        {
            emit_log(
                &app,
                engine,
                "info",
                "TUN startup superseded by a newer connection attempt",
            );
            return Err(AetherError::TunHealthFailed(
                "TUN startup superseded by a newer connection attempt".into(),
            ));
        }

        if manager.lock().unwrap().process.is_none() {
            emit_log(
                &app,
                engine,
                "warn",
                "TUN startup cancelled before data-plane verification",
            );
            return Err(AetherError::TunHealthFailed("TUN startup cancelled".into()));
        }

        if let Some(exit) = process_exit_status(&manager)? {
            emit_log(
                &app,
                engine,
                "error",
                format!("TUN process exited during startup ({exit})"),
            );
            stop_tunnel(&app, &manager);
            return Err(AetherError::TunHealthFailed(format!(
                "{} exited during startup ({exit})",
                engine_label(engine)
            )));
        }

        let health_error = match status::verify_tunnel(aether_socks_port) {
            Ok(()) => {
                manager.lock().unwrap().active = true;
                emit_log(&app, engine, "info", "system-wide TUN data plane verified");
                return Ok(());
            }
            Err(error) => error.to_string(),
        };
        if !connection_manager
            .lock()
            .unwrap()
            .is_current_generation(connection_generation)
        {
            emit_log(
                &app,
                engine,
                "info",
                "TUN health result superseded by a newer connection attempt",
            );
            return Err(AetherError::TunHealthFailed(
                "TUN health result superseded by a newer connection attempt".into(),
            ));
        }
        diagnostics::record("tun-health", "warn", &health_error);

        if Instant::now() >= deadline {
            emit_log(
                &app,
                engine,
                "error",
                format!("TUN data-plane verification timed out: {health_error}"),
            );
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
            .map_err(|e| AetherError::Internal(format!("check TUN process: {e}"))),
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
    let (mut process, engine) = {
        let mut mgr = manager.lock().unwrap();
        mgr.active = false;
        mgr.socks_port = None;
        mgr.config_path = None;
        (mgr.process.take(), mgr.engine.take())
    };
    let had_process = process.is_some();
    if let Some(process) = process.as_mut() {
        process.kill();
    }
    clear_pid(app);
    if had_process {
        emit_log(
            app,
            engine.unwrap_or_else(selected_tun_engine),
            "info",
            "TUN stopped",
        );
    }
}

pub fn shutdown_blocking(manager: &Arc<Mutex<SingboxManager>>, data_dir: &Path) {
    let mut process = {
        let mut mgr = manager.lock().unwrap();
        mgr.active = false;
        mgr.socks_port = None;
        mgr.config_path = None;
        mgr.engine = None;
        mgr.process.take()
    };
    if let Some(process) = process.as_mut() {
        process.kill();
    }
    let _ = fs::remove_file(data_dir.join("tun").join("system-tun.pid"));
    let _ = fs::remove_file(data_dir.join("tun").join("singbox.pid"));
}

fn expected_process_name(engine: TunEngine, name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    match (engine, cfg!(windows)) {
        (TunEngine::Singbox, true) => {
            name == "sing-box.exe" || (name.starts_with("sing-box-v") && name.ends_with(".exe"))
        }
        (TunEngine::Singbox, false) => name == "sing-box" || name.starts_with("sing-box-v"),
        (TunEngine::Xray, true) => {
            name == "xray.exe" || (name.starts_with("xray-v") && name.ends_with(".exe"))
        }
        (TunEngine::Xray, false) => name == "xray" || name.starts_with("xray-v"),
    }
}

fn expected_process_is_alive(pid: u32, engine: TunEngine) -> bool {
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
                        .map(|name| expected_process_name(engine, name.trim_matches('"')))
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
                        .map(|name| expected_process_name(engine, &name.to_string_lossy()))
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

fn parse_pid(contents: &str) -> Option<(TunEngine, u32)> {
    let mut parts = contents.split_whitespace();
    let first = parts.next()?;
    if let Ok(pid) = first.parse::<u32>() {
        return Some((TunEngine::Singbox, pid));
    }
    let engine = match first {
        "xray" => TunEngine::Xray,
        "singbox" => TunEngine::Singbox,
        _ => return None,
    };
    Some((engine, parts.next()?.parse().ok()?))
}

pub fn reap_orphan(app: &AppHandle) {
    let (path, contents) = match fs::read_to_string(pid_file(app)) {
        Ok(contents) => (pid_file(app), contents),
        Err(_) => match fs::read_to_string(legacy_singbox_pid_file(app)) {
            Ok(contents) => (legacy_singbox_pid_file(app), contents),
            Err(_) => return,
        },
    };
    let Some((engine, pid)) = parse_pid(&contents) else {
        let _ = fs::remove_file(path);
        return;
    };

    if !expected_process_is_alive(pid, engine) {
        diagnostics::record(
            "system-tun",
            "info",
            format!(
                "stale PID file ignored because PID {pid} is not an owned {} core",
                engine_label(engine)
            ),
        );
        clear_pid(app);
        return;
    }

    diagnostics::record(
        "system-tun",
        "warn",
        format!("reaping owned {} orphan PID {pid}", engine_label(engine)),
    );
    if kill_pid(pid) {
        clear_pid(app);
        diagnostics::record("system-tun", "info", format!("orphan PID {pid} terminated"));
    } else {
        diagnostics::record(
            "system-tun",
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
    fn recognizes_only_expected_tun_core_names() {
        assert!(expected_process_name(
            TunEngine::Singbox,
            if cfg!(windows) {
                "sing-box.exe"
            } else {
                "sing-box"
            }
        ));
        assert!(expected_process_name(
            TunEngine::Xray,
            if cfg!(windows) {
                "xray-v26.5.9.exe"
            } else {
                "xray-v26.5.9"
            }
        ));
        assert!(!expected_process_name(TunEngine::Xray, "not-xray.exe"));
    }

    #[test]
    fn parses_current_and_legacy_pid_files() {
        assert_eq!(parse_pid("xray 42"), Some((TunEngine::Xray, 42)));
        assert_eq!(parse_pid("singbox 43"), Some((TunEngine::Singbox, 43)));
        assert_eq!(parse_pid("44"), Some((TunEngine::Singbox, 44)));
    }
}
