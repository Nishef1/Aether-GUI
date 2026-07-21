use crate::diagnostics;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn pid_file(data_dir: &Path) -> PathBuf {
    data_dir.join("aether.pid")
}

pub fn write_pid(data_dir: &Path, pid: u32) {
    let _ = fs::write(pid_file(data_dir), pid.to_string());
}

pub fn clear_pid(data_dir: &Path) {
    let _ = fs::remove_file(pid_file(data_dir));
}

fn no_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

#[cfg(windows)]
fn is_expected_process(pid: u32) -> bool {
    let mut command = Command::new("tasklist");
    command.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
    no_window(&mut command);
    command
        .output()
        .map(|output| {
            let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
            text.lines().any(|line| {
                line.split(',')
                    .next()
                    .map(|name| name.trim_matches('"') == "aether.exe")
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

#[cfg(unix)]
fn is_expected_process(pid: u32) -> bool {
    Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                Path::new(line.trim())
                    .file_name()
                    .map(|name| name.to_string_lossy() == "aether")
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let mut command = Command::new("taskkill");
    command.args(["/PID", &pid.to_string(), "/F"]);
    no_window(&mut command);
    let _ = command.output();
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
}

/// Reap a crash orphan only when the persisted PID still belongs to an Aether
/// executable. A PID alone is not a stable identity: after a reboot/crash the
/// OS can reuse it for an unrelated application, which older code could kill.
pub fn reap_orphan(data_dir: &Path) {
    let path = pid_file(data_dir);
    let Ok(contents) = fs::read_to_string(&path) else {
        return;
    };
    if let Ok(pid) = contents.trim().parse::<u32>() {
        if is_expected_process(pid) {
            diagnostics::record("aether", "warn", format!("reaping owned orphan PID {pid}"));
            kill_pid(pid);
        } else {
            diagnostics::record(
                "aether",
                "info",
                format!("stale PID file ignored because PID {pid} is not Aether"),
            );
        }
    }
    let _ = fs::remove_file(&path);
}
