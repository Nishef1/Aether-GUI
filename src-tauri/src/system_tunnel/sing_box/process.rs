use crate::runtime_error::RuntimeError;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::Sender;
use std::thread;
use std::time::{Duration, Instant};

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

    pub fn kill(&mut self) -> bool {
        match &mut self.inner {
            ProcessKind::Local(child) => {
                let tree_stopped = crate::aether::orphan::terminate_process_tree(child.id());
                let _ = child.kill();
                let child_stopped = child.wait().is_ok();
                tree_stopped || child_stopped
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
    pid_file: &Path,
    stop_file: &Path,
) -> Result<SingBoxProcess, RuntimeError> {
    #[cfg(windows)]
    if !is_elevated() {
        return spawn_elevated(binary, config_path, pid_file, stop_file).map(|process| {
            SingBoxProcess {
                inner: ProcessKind::Elevated(process),
            }
        });
    }

    #[cfg(not(windows))]
    let _ = (pid_file, stop_file);

    #[cfg(target_os = "linux")]
    if !is_elevated() {
        return spawn_pkexec(binary, config_path, log_tx);
    }

    #[cfg(target_os = "macos")]
    if !is_elevated() {
        return Err(RuntimeError::SystemTunnel(
            "sing-box TUN currently requires launching Aether-GUI as administrator on macOS".into(),
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
        unsafe { IsUserAnAdmin() != 0 }
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
    controller_pid: u32,
    stop_file: PathBuf,
    exit_code: Option<u32>,
}

#[cfg(windows)]
impl ElevatedProcess {
    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        use std::os::windows::process::ExitStatusExt;
        if let Some(code) = self.exit_code {
            return Ok(Some(ExitStatus::from_raw(code)));
        }
        if process_is_alive(self.pid) || process_is_alive(self.controller_pid) {
            return Ok(None);
        }
        self.exit_code = Some(0);
        Ok(Some(ExitStatus::from_raw(0)))
    }

    fn kill(&mut self) -> bool {
        if self.exit_code.is_some() {
            return true;
        }
        // The elevated controller owns the elevated sing-box child. Asking it
        // to stop avoids a second UAC prompt on every normal disconnect.
        request_controller_stop(self.controller_pid, &self.stop_file);
        let stopped = wait_until_stopped(&[self.pid, self.controller_pid], Duration::from_secs(3));
        if !stopped {
            // This is only an emergency path for a crashed/unresponsive
            // controller. It may require administrator consent, but we never
            // claim the TUN is gone unless both processes are actually dead.
            let _ = terminate_elevated_process_tree(self.controller_pid);
        }
        let stopped = wait_until_stopped(&[self.pid, self.controller_pid], Duration::from_secs(2));
        if stopped {
            self.exit_code = Some(0);
        }
        stopped
    }
}

#[cfg(windows)]
fn escape_powershell_literal(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(windows)]
fn spawn_elevated(
    binary: &Path,
    config_path: &Path,
    pid_file: &Path,
    stop_file: &Path,
) -> Result<ElevatedProcess, RuntimeError> {
    let pid_path = pid_file.to_path_buf();
    let stop_path = stop_file.to_path_buf();
    let working_dir = binary
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_string_lossy()
        .to_string();
    let working_dir = escape_powershell_literal(&working_dir);
    let binary = escape_powershell_literal(&binary.to_string_lossy());
    let config = escape_powershell_literal(&config_path.to_string_lossy());
    let pid_file = escape_powershell_literal(&pid_file.to_string_lossy());
    let stop_file = escape_powershell_literal(&stop_file.to_string_lossy());
    let parent_pid = std::process::id();
    let controller = format!(
        "$ErrorActionPreference = 'Stop'; $child = $null; $exitCode = 0; try {{ $child = Start-Process -FilePath '{binary}' -ArgumentList @('run','-c','{config}') -WorkingDirectory '{working_dir}' -WindowStyle Hidden -PassThru; Set-Content -LiteralPath '{pid_file}' -Value $child.Id -NoNewline; while ($true) {{ if (Test-Path -LiteralPath '{stop_file}') {{ break }}; if ($child.HasExited) {{ $exitCode = $child.ExitCode; break }}; if (-not (Get-Process -Id {parent_pid} -ErrorAction SilentlyContinue)) {{ break }}; Start-Sleep -Milliseconds 200 }} }} catch {{ $exitCode = 1 }} finally {{ if ($child -and -not $child.HasExited) {{ & taskkill.exe /PID $child.Id /T /F | Out-Null; $child.WaitForExit() }}; Remove-Item -LiteralPath '{pid_file}' -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath '{stop_file}' -Force -ErrorAction SilentlyContinue }}; exit $exitCode"
    );
    let controller = escape_powershell_literal(&controller);
    let script = format!(
        "$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command','{controller}') -Verb RunAs -WindowStyle Hidden -PassThru; $p.Id"
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
    let controller_pid = String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .find_map(|line| line.trim().parse::<u32>().ok())
        .ok_or_else(|| {
            RuntimeError::SystemTunnel("elevated sing-box controller returned no PID".into())
        })?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let pid = loop {
        if let Ok(value) = fs::read_to_string(&pid_path) {
            if let Ok(pid) = value.trim().parse::<u32>() {
                if process_is_alive(pid) {
                    break pid;
                }
            }
        }
        if !process_is_alive(controller_pid) {
            return Err(RuntimeError::SystemTunnel(
                "elevated sing-box controller exited before starting sing-box".into(),
            ));
        }
        if Instant::now() >= deadline {
            request_controller_stop(controller_pid, &stop_path);
            return Err(RuntimeError::SystemTunnel(
                "elevated sing-box did not report its PID".into(),
            ));
        }
        thread::sleep(Duration::from_millis(50));
    };
    Ok(ElevatedProcess {
        pid,
        controller_pid,
        stop_file: stop_path,
        exit_code: None,
    })
}

#[cfg(windows)]
fn request_controller_stop(controller_pid: u32, stop_file: &Path) {
    let _ = fs::write(stop_file, b"stop");
    if !wait_until_stopped(&[controller_pid], Duration::from_secs(3)) {
        let _ = terminate_elevated_process_tree(controller_pid);
    }
}

#[cfg(windows)]
fn wait_until_stopped(pids: &[u32], timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if pids.iter().all(|pid| !process_is_alive(*pid)) {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    pids.iter().all(|pid| !process_is_alive(*pid))
}

#[cfg(windows)]
fn terminate_elevated_process_tree(pid: u32) -> bool {
    if pid == 0 || !process_is_alive(pid) {
        return true;
    }
    let script = format!(
        "$p = Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID','{pid}','/T','/F') -Verb RunAs -WindowStyle Hidden -PassThru; $p.WaitForExit(); exit $p.ExitCode"
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
    let _ = command.status();
    wait_until_stopped(&[pid], Duration::from_secs(3))
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
