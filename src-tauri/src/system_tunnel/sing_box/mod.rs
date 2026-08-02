pub mod config;
pub mod process;
pub mod status;

use super::{SystemTunnelAdapter, SystemTunnelDescriptor, TunnelContext};
use crate::events::{now_millis, LogEvent, LOG_EVENT};
use crate::runtime_error::RuntimeError;
use process::SingBoxProcess;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const PID_FILE: &str = "sing-box.pid";
const CONFIG_FILE: &str = "sing-box.json";

#[derive(Default)]
struct SingBoxState {
    process: Option<SingBoxProcess>,
    active: bool,
    pid_file: Option<PathBuf>,
    config_file: Option<PathBuf>,
}

#[derive(Default)]
pub struct SingBoxTunnel {
    state: Mutex<SingBoxState>,
}

impl SingBoxTunnel {
    fn runtime_dir(app: &AppHandle) -> PathBuf {
        app.path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("system-tunnel")
            .join("sing-box")
    }

    fn resolve_binary(app: &AppHandle) -> Result<PathBuf, RuntimeError> {
        let executable = if cfg!(windows) {
            "sing-box.exe"
        } else {
            "sing-box"
        };
        let mut candidates = Vec::new();
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join("binaries").join(executable));
        }
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(executable),
        );

        for path in candidates {
            if !path.is_file() {
                continue;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o755));
            }
            #[cfg(windows)]
            {
                let wintun = path
                    .parent()
                    .unwrap_or_else(|| Path::new("."))
                    .join("wintun.dll");
                if !wintun.is_file() {
                    return Err(RuntimeError::SystemTunnel(format!(
                        "wintun.dll is missing next to {}",
                        path.display()
                    )));
                }
            }
            return Ok(path);
        }
        Err(RuntimeError::SystemTunnel(
            "sing-box binary is missing; run the pinned sidecar preparation script and rebuild"
                .into(),
        ))
    }

    fn emit_log(app: &AppHandle, line: impl Into<String>) {
        let _ = app.emit(
            LOG_EVENT,
            LogEvent {
                line: format!("[sing-box] {}", line.into()),
                timestamp: now_millis(),
            },
        );
    }

    fn write_config(app: &AppHandle, content: &str) -> Result<PathBuf, RuntimeError> {
        let dir = Self::runtime_dir(app);
        fs::create_dir_all(&dir).map_err(|error| RuntimeError::SystemTunnel(error.to_string()))?;
        let path = dir.join(CONFIG_FILE);
        let temporary = dir.join(format!("{CONFIG_FILE}.new"));
        fs::write(&temporary, content)
            .map_err(|error| RuntimeError::SystemTunnel(error.to_string()))?;
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| RuntimeError::SystemTunnel(error.to_string()))?;
        }
        fs::rename(&temporary, &path)
            .map_err(|error| RuntimeError::SystemTunnel(error.to_string()))?;
        Ok(path)
    }

    fn process_exit(&self) -> Result<Option<String>, RuntimeError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Internal("sing-box state is unavailable".into()))?;
        let Some(process) = state.process.as_mut() else {
            return Ok(None);
        };
        let exit = process
            .try_wait()
            .map_err(|error| RuntimeError::SystemTunnel(format!("query sing-box: {error}")))?;
        let Some(exit) = exit else {
            return Ok(None);
        };
        state.process = None;
        state.active = false;
        if let Some(path) = state.pid_file.take() {
            let _ = fs::remove_file(path);
        }
        Ok(Some(format!("sing-box exited unexpectedly ({exit})")))
    }

    fn reap_orphan(data_dir: &Path) {
        let pid_file = data_dir
            .join("system-tunnel")
            .join("sing-box")
            .join(PID_FILE);
        let Some(pid) = fs::read_to_string(&pid_file)
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok())
        else {
            let _ = fs::remove_file(pid_file);
            return;
        };
        if process_name(pid)
            .map(|name| name.to_ascii_lowercase().contains("sing-box"))
            .unwrap_or(false)
        {
            terminate_pid(pid);
        }
        let _ = fs::remove_file(pid_file);
    }
}

impl SystemTunnelAdapter for SingBoxTunnel {
    fn id(&self) -> &'static str {
        super::SING_BOX_TUNNEL_ID
    }

    fn descriptor(&self) -> SystemTunnelDescriptor {
        SystemTunnelDescriptor {
            id: self.id().into(),
            display_name: "sing-box system tunnel".into(),
            requires_elevation: true,
            capabilities: ["tun", "dual-stack", "dns-hijack", "traffic-counters"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
        }
    }

    fn prepare(&self, _app: &AppHandle, data_dir: &Path) -> Result<(), RuntimeError> {
        Self::reap_orphan(data_dir);
        Ok(())
    }

    fn start(&self, app: &AppHandle, context: &TunnelContext) -> Result<(), RuntimeError> {
        {
            let state = self
                .state
                .lock()
                .map_err(|_| RuntimeError::Internal("sing-box state is unavailable".into()))?;
            if state.process.is_some() {
                return Err(RuntimeError::SystemTunnelBusy);
            }
        }

        let binary = Self::resolve_binary(app)?;
        let config =
            config::generate(&context.upstream_socks_addr).map_err(RuntimeError::SystemTunnel)?;
        let config_file = Self::write_config(app, &config)?;
        process::check_config(&binary, &config_file)?;
        Self::emit_log(
            app,
            format!("validated configuration with {}", binary.display()),
        );

        let (log_tx, log_rx) = mpsc::channel::<process::ProcessLog>();
        let process = process::spawn(&binary, &config_file, log_tx)?;
        let pid = process.pid();
        let pid_file = Self::runtime_dir(app).join(PID_FILE);
        fs::write(&pid_file, pid.to_string())
            .map_err(|error| RuntimeError::SystemTunnel(error.to_string()))?;

        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| RuntimeError::Internal("sing-box state is unavailable".into()))?;
            state.process = Some(process);
            state.active = false;
            state.pid_file = Some(pid_file);
            state.config_file = Some(config_file);
        }
        Self::emit_log(app, format!("system tunnel process started (pid {pid})"));

        let app_for_logs = app.clone();
        std::thread::spawn(move || {
            for log in log_rx {
                SingBoxTunnel::emit_log(&app_for_logs, format!("{}: {}", log.stream, log.line));
            }
        });

        let deadline = Instant::now() + status::STARTUP_TIMEOUT;
        let mut last_error = "system route is not ready".to_string();
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(750));
            if let Some(message) = self.process_exit()? {
                self.stop(app);
                return Err(RuntimeError::SystemTunnel(message));
            }
            if !self.is_running() {
                return Err(RuntimeError::SystemTunnel(
                    "sing-box startup was cancelled".into(),
                ));
            }
            match status::verify(&context.upstream_socks_addr) {
                Ok(()) => {
                    let mut state = self.state.lock().map_err(|_| {
                        RuntimeError::Internal("sing-box state is unavailable".into())
                    })?;
                    state.active = true;
                    drop(state);
                    Self::emit_log(app, "system-wide TUN data path verified");
                    return Ok(());
                }
                Err(error) => last_error = error.to_string(),
            }
        }

        self.stop(app);
        Err(RuntimeError::SystemTunnel(format!(
            "sing-box data-plane verification timed out: {last_error}"
        )))
    }

    fn stop(&self, app: &AppHandle) {
        let (mut process, pid_file, config_file) = match self.state.lock() {
            Ok(mut state) => {
                state.active = false;
                (
                    state.process.take(),
                    state.pid_file.take(),
                    state.config_file.take(),
                )
            }
            Err(_) => return,
        };
        if let Some(process) = process.as_mut() {
            process.kill();
        }
        if let Some(path) = pid_file {
            let _ = fs::remove_file(path);
        }
        if let Some(path) = config_file {
            let _ = fs::remove_file(path);
        }
        if process.is_some() {
            Self::emit_log(app, "system tunnel stopped");
        }
    }

    fn is_running(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.process.is_some())
            .unwrap_or(false)
    }

    fn is_active(&self) -> bool {
        self.state.lock().map(|state| state.active).unwrap_or(false)
    }

    fn poll_exit(&self) -> Result<Option<String>, RuntimeError> {
        self.process_exit()
    }

    fn traffic_interface(&self) -> Option<&'static str> {
        self.is_active().then_some(config::TUN_INTERFACE_NAME)
    }

    fn shutdown(&self, app: &AppHandle, _data_dir: &Path) {
        self.stop(app);
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

fn process_name(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        let mut command = Command::new("tasklist.exe");
        command.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
        no_window(&mut command);
        let output = command.output().ok()?;
        let line = String::from_utf8_lossy(&output.stdout);
        return line
            .split(',')
            .next()
            .map(|value| value.trim().trim_matches('"').to_string());
    }
    #[cfg(target_os = "linux")]
    {
        return fs::read_to_string(format!("/proc/{pid}/comm"))
            .ok()
            .map(|value| value.trim().to_string());
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        let output = Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "comm="])
            .output()
            .ok()?;
        return Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    #[allow(unreachable_code)]
    None
}

fn terminate_pid(pid: u32) {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill.exe");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        no_window(&mut command);
        let _ = command.status();
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
}
