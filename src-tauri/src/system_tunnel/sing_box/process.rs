use crate::runtime_error::RuntimeError;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::Sender;

#[derive(Debug)]
pub struct ProcessLog {
    pub stream: &'static str,
    pub line: String,
}

pub struct SingBoxProcess {
    inner: ProcessKind,
}

enum ProcessKind {
    Local(Child),
    #[cfg(windows)]
    Elevated(ElevatedProcess),
}

impl SingBoxProcess {
    pub fn pid(&self) -> u32 {
        match &self.inner {
            ProcessKind::Local(child) => child.id(),
            #[cfg(windows)]
            ProcessKind::Elevated(process) => process.pid,
        }
    }

    pub fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        match &mut self.inner {
            ProcessKind::Local(child) => child.try_wait(),
            #[cfg(windows)]
            ProcessKind::Elevated(process) => process.try_wait(),
        }
    }

    pub fn kill(&mut self) {
        match &mut self.inner {
            ProcessKind::Local(child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            #[cfg(windows)]
            ProcessKind::Elevated(process) => process.kill(),
        }
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

pub fn check_config(binary: &Path, config_path: &Path) -> Result<(), RuntimeError> {
    let mut command = Command::new(binary);
    command.arg("check").arg("-c").arg(config_path);
    no_window(&mut command);
    let output = command
        .output()
        .map_err(|error| RuntimeError::SystemTunnel(format!("run sing-box check: {error}")))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    Err(RuntimeError::SystemTunnel(if detail.is_empty() {
        format!("sing-box check exited with {}", output.status)
    } else {
        detail
    }))
}

pub fn spawn(
    binary: &Path,
    config_path: &Path,
    log_tx: Sender<ProcessLog>,
) -> Result<SingBoxProcess, RuntimeError> {
    #[cfg(windows)]
    if !is_elevated() {
        return spawn_elevated(binary, config_path).map(|process| SingBoxProcess {
            inner: ProcessKind::Elevated(process),
        });
    }

    #[cfg(target_os = "linux")]
    if !is_elevated() {
        return spawn_pkexec(binary, config_path, log_tx);
    }

    #[cfg(target_os = "macos")]
    if !is_elevated() {
        return Err(RuntimeError::SystemTunnel(
            "sing-box TUN currently requires launching Aether-GUI as administrator on macOS"
                .into(),
        ));
    }

    spawn_local(binary, config_path, log_tx)
}

fn spawn_local(
    binary: &Path,
    config_path: &Path,
    log_tx: Sender<ProcessLog>,
) -> Result<SingBoxProcess, RuntimeError> {
    let mut command = Command::new(binary);
    command
        .arg("run")
        .arg("-c")
        .arg(config_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(parent) = binary.parent() {
        command.current_dir(parent);
    }
    no_window(&mut command);
    let child = command
        .spawn()
        .map_err(|error| RuntimeError::SystemTunnel(format!("launch sing-box: {error}")))?;
    Ok(wrap_local(child, log_tx))
}

#[cfg(target_os = "linux")]
fn spawn_pkexec(
    binary: &Path,
    config_path: &Path,
    log_tx: Sender<ProcessLog>,
) -> Result<SingBoxProcess, RuntimeError> {
    let mut command = Command::new("pkexec");
    command
        .arg(binary)
        .arg("run")
        .arg("-c")
        .arg(config_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command.spawn().map_err(|error| {
        RuntimeError::SystemTunnel(format!(
            "launch sing-box through pkexec: {error}; install/configure polkit or run as root"
        ))
    })?;
    Ok(wrap_local(child, log_tx))
}

fn wrap_local(mut child: Child, log_tx: Sender<ProcessLog>) -> SingBoxProcess {
    if let Some(stdout) = child.stdout.take() {
        let tx = log_tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = tx.send(ProcessLog {
                    stream: "stdout",
                    line,
                });
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = log_tx.send(ProcessLog {
                    stream: "stderr",
                    line,
                });
            }
        });
    }
    SingBoxProcess {
        inner: ProcessKind::Local(child),
    }
}

#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
fn is_elevated() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::IsUserAnAdmin;
        return unsafe { IsUserAnAdmin() != 0 };
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        return Command::new("id")
            .arg("-u")
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).trim() == "0")
            .unwrap_or(false);
    }
}

#[cfg(windows)]
struct ElevatedProcess {
    pid: u32,
    exit_code: Option<u32>,
}

#[cfg(windows)]
impl ElevatedProcess {
    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        use std::os::windows::process::ExitStatusExt;
        if let Some(code) = self.exit_code {
            return Ok(Some(ExitStatus::from_raw(code)));
        }
        if process_is_alive(self.pid) {
            return Ok(None);
        }
        self.exit_code = Some(0);
        Ok(Some(ExitStatus::from_raw(0)))
    }

    fn kill(&mut self) {
        if self.exit_code.is_some() {
            return;
        }
        let mut command = Command::new("taskkill.exe");
        command.args(["/PID", &self.pid.to_string(), "/T", "/F"]);
        no_window(&mut command);
        let _ = command.status();
        self.exit_code = Some(0);
    }
}

#[cfg(windows)]
fn escape_powershell_literal(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(windows)]
fn spawn_elevated(binary: &Path, config_path: &Path) -> Result<ElevatedProcess, RuntimeError> {
    let binary = escape_powershell_literal(&binary.to_string_lossy());
    let config = escape_powershell_literal(&config_path.to_string_lossy());
    let script = format!(
        "$p = Start-Process -FilePath '{binary}' -ArgumentList @('run','-c','{config}') -Verb RunAs -WindowStyle Hidden -PassThru; $p.Id"
    );
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    no_window(&mut command);
    let output = command.output().map_err(|error| {
        RuntimeError::SystemTunnel(format!("launch elevated sing-box helper: {error}"))
    })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(RuntimeError::SystemTunnel(if detail.is_empty() {
            "administrator approval was cancelled or sing-box could not start".into()
        } else {
            detail
        }));
    }
    let pid = String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .find_map(|line| line.trim().parse::<u32>().ok())
        .ok_or_else(|| RuntimeError::SystemTunnel("elevated sing-box returned no PID".into()))?;
    Ok(ElevatedProcess {
        pid,
        exit_code: None,
    })
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    let mut command = Command::new("tasklist.exe");
    command.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
    no_window(&mut command);
    command
        .output()
        .map(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\""))
        })
        .unwrap_or(false)
}
