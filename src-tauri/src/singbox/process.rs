use crate::error::AetherError;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::Sender;

#[derive(Debug)]
pub struct ProcessLog {
    pub stream: &'static str,
    pub line: String,
}

enum SingboxProcessKind {
    Local(Child),
    #[cfg(windows)]
    Elevated(crate::tun_helper::ElevatedTunProcess),
}

pub struct SingboxProcess {
    inner: SingboxProcessKind,
}

impl SingboxProcess {
    pub fn pid(&self) -> u32 {
        match &self.inner {
            SingboxProcessKind::Local(child) => child.id(),
            #[cfg(windows)]
            SingboxProcessKind::Elevated(process) => process.pid(),
        }
    }

    pub fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        match &mut self.inner {
            SingboxProcessKind::Local(child) => child.try_wait(),
            #[cfg(windows)]
            SingboxProcessKind::Elevated(process) => process.try_wait(),
        }
    }

    pub fn kill(&mut self) {
        match &mut self.inner {
            SingboxProcessKind::Local(child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            #[cfg(windows)]
            SingboxProcessKind::Elevated(process) => process.kill(),
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

pub fn check_config(binary: &Path, config_path: &Path) -> Result<(), AetherError> {
    let mut command = Command::new(binary);
    command.arg("check").arg("-c").arg(config_path);
    no_window(&mut command);
    let output = command
        .output()
        .map_err(|e| AetherError::SingboxConfigFailed(format!("run config check: {e}")))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    Err(AetherError::SingboxConfigFailed(if detail.is_empty() {
        format!("sing-box check exited with {}", output.status)
    } else {
        detail
    }))
}

pub fn spawn(
    binary: &Path,
    config_path: &Path,
    log_tx: Sender<ProcessLog>,
) -> Result<SingboxProcess, AetherError> {
    #[cfg(windows)]
    if crate::tun_helper::is_supported() && !crate::is_admin() {
        let (helper_tx, helper_rx) =
            std::sync::mpsc::channel::<crate::tun_helper::HelperLog>();
        let forwarded = log_tx.clone();
        std::thread::spawn(move || {
            for log in helper_rx {
                let _ = forwarded.send(ProcessLog {
                    stream: log.stream,
                    line: log.line,
                });
            }
        });
        let process = crate::tun_helper::spawn(
            crate::aether::profiles::TunEngine::Singbox,
            binary,
            config_path,
            helper_tx,
        )?;
        return Ok(SingboxProcess {
            inner: SingboxProcessKind::Elevated(process),
        });
    }

    let mut command = Command::new(binary);
    command
        .arg("run")
        .arg("-c")
        .arg(config_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut command);

    let mut child = command
        .spawn()
        .map_err(|e| AetherError::SpawnFailed(format!("failed to launch sing-box: {e}")))?;

    // Drain both pipes for the entire process lifetime. Runtime config keeps
    // sing-box at warning level, so these channels carry only low-volume logs.
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

    Ok(SingboxProcess {
        inner: SingboxProcessKind::Local(child),
    })
}
