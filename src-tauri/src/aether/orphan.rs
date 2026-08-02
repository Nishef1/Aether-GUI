use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

fn pid_file(data_dir: &Path) -> PathBuf {
    data_dir.join("aether.pid")
}

pub fn write_pid(data_dir: &Path, pid: u32) {
    let _ = fs::write(pid_file(data_dir), pid.to_string());
}

pub fn clear_pid(data_dir: &Path) {
    let _ = fs::remove_file(pid_file(data_dir));
}

/// On startup, if a pid file survives from a prior crash and that process is
/// still alive, terminate it before a new connection can claim the same SOCKS
/// endpoint. On Windows this always kills the complete descendant tree so a
/// PTY helper or transport child cannot survive the GUI.
pub fn reap_orphan(data_dir: &Path) {
    let path = pid_file(data_dir);
    let Ok(contents) = fs::read_to_string(&path) else {
        return;
    };
    if let Ok(pid) = contents.trim().parse::<u32>() {
        if is_alive(pid) {
            terminate_process_tree(pid);
        }
    }
    let _ = fs::remove_file(&path);
}

/// Best-effort, bounded process-tree termination shared by disconnect, normal
/// application shutdown and orphan recovery.
pub fn terminate_process_tree(pid: u32) {
    if pid == 0 {
        return;
    }

    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill.exe");
        command.args(taskkill_args(pid));
        no_window(&mut command);
        let _ = command.status();
        wait_until_dead(pid, Duration::from_secs(2));
    }

    #[cfg(unix)]
    {
        let pid_string = pid.to_string();
        let _ = Command::new("kill").args(["-TERM", &pid_string]).status();
        if !wait_until_dead(pid, Duration::from_millis(750)) {
            let _ = Command::new("kill").args(["-KILL", &pid_string]).status();
            wait_until_dead(pid, Duration::from_millis(750));
        }
    }
}

fn wait_until_dead(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !is_alive(pid) {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    !is_alive(pid)
}

#[cfg(windows)]
fn taskkill_args(pid: u32) -> [String; 4] {
    ["/PID".into(), pid.to_string(), "/T".into(), "/F".into()]
}

#[cfg(windows)]
fn no_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(unix)]
fn is_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_alive(pid: u32) -> bool {
    let expected = pid.to_string();
    let mut command = Command::new("tasklist.exe");
    command.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
    no_window(&mut command);
    command
        .output()
        .map(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                    line.split(',')
                        .nth(1)
                        .map(|value| value.trim().trim_matches('"'))
                        == Some(expected.as_str())
                })
        })
        .unwrap_or(false)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn windows_termination_always_includes_descendants() {
        assert_eq!(
            taskkill_args(1819),
            [
                "/PID".to_owned(),
                "1819".to_owned(),
                "/T".to_owned(),
                "/F".to_owned(),
            ]
        );
    }
}
