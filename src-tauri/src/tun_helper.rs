use crate::aether::profiles::TunEngine;
use crate::error::AetherError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub struct HelperLog {
    pub stream: &'static str,
    pub line: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct HelperRequest {
    engine: TunEngine,
    binary: PathBuf,
    config: PathBuf,
    parent_pid: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct HelperReady {
    helper_pid: u32,
    core_pid: u32,
}

#[derive(Clone, Debug)]
struct ControlPaths {
    dir: PathBuf,
    request: PathBuf,
    ready: PathBuf,
    stop: PathBuf,
    error: PathBuf,
    exit: PathBuf,
    stdout: PathBuf,
    stderr: PathBuf,
}

impl ControlPaths {
    fn from_dir(dir: PathBuf) -> Self {
        Self {
            request: dir.join("request.json"),
            ready: dir.join("ready.json"),
            stop: dir.join("stop"),
            error: dir.join("error.txt"),
            exit: dir.join("exit-code.txt"),
            stdout: dir.join("stdout.log"),
            stderr: dir.join("stderr.log"),
            dir,
        }
    }

    fn from_request(request: &Path) -> Option<Self> {
        let dir = request.parent()?.to_path_buf();
        let paths = Self::from_dir(dir);
        if paths.request == request {
            Some(paths)
        } else {
            None
        }
    }
}

pub fn is_supported() -> bool {
    cfg!(windows)
}

pub fn run_if_requested() -> Option<i32> {
    #[cfg(windows)]
    {
        let mut args = std::env::args_os();
        let _ = args.next();
        if args.next().as_deref() != Some(std::ffi::OsStr::new("--tun-helper")) {
            return None;
        }
        let Some(request_path) = args.next() else {
            return Some(2);
        };
        if args.next().is_some() {
            return Some(2);
        }
        return Some(run_helper(Path::new(&request_path)));
    }

    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
pub struct ElevatedTunProcess {
    helper_pid: u32,
    core_pid: u32,
    paths: ControlPaths,
    exit_code: Option<u32>,
}

#[cfg(windows)]
impl ElevatedTunProcess {
    pub fn pid(&self) -> u32 {
        self.core_pid
    }

    pub fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        use std::os::windows::process::ExitStatusExt;

        if let Some(code) = self.exit_code {
            return Ok(Some(ExitStatus::from_raw(code)));
        }
        if process_is_alive(self.helper_pid) {
            return Ok(None);
        }

        let code = fs::read_to_string(&self.paths.exit)
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok())
            .unwrap_or(1);
        self.exit_code = Some(code);
        self.cleanup_control_dir();
        Ok(Some(ExitStatus::from_raw(code)))
    }

    pub fn kill(&mut self) {
        if self.exit_code.is_some() {
            self.cleanup_control_dir();
            return;
        }

        let _ = fs::write(&self.paths.stop, b"stop");
        let deadline = Instant::now() + Duration::from_secs(10);
        while process_is_alive(self.helper_pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }

        if !process_is_alive(self.helper_pid) {
            self.exit_code = fs::read_to_string(&self.paths.exit)
                .ok()
                .and_then(|value| value.trim().parse::<u32>().ok())
                .or(Some(0));
            self.cleanup_control_dir();
        }
    }

    fn cleanup_control_dir(&self) {
        let _ = fs::remove_dir_all(&self.paths.dir);
    }
}

#[cfg(windows)]
impl Drop for ElevatedTunProcess {
    fn drop(&mut self) {
        if self.exit_code.is_none() {
            let _ = fs::write(&self.paths.stop, b"stop");
        }
    }
}

#[cfg(windows)]
pub fn spawn(
    engine: TunEngine,
    binary: &Path,
    config: &Path,
    log_tx: Sender<HelperLog>,
) -> Result<ElevatedTunProcess, AetherError> {
    let tun_dir = config
        .parent()
        .ok_or_else(|| AetherError::Internal("TUN config has no runtime directory".into()))?;
    let session = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let paths = ControlPaths::from_dir(tun_dir.join("elevation").join(session));
    fs::create_dir_all(&paths.dir)
        .map_err(|error| AetherError::Internal(format!("create TUN helper runtime: {error}")))?;

    let request = HelperRequest {
        engine,
        binary: binary.to_path_buf(),
        config: config.to_path_buf(),
        parent_pid: std::process::id(),
    };
    let request_json = serde_json::to_vec(&request)
        .map_err(|error| AetherError::Internal(format!("serialize TUN helper request: {error}")))?;
    fs::write(&paths.request, request_json)
        .map_err(|error| AetherError::Internal(format!("write TUN helper request: {error}")))?;

    if !launch_elevated_helper(&paths.request) {
        let _ = fs::remove_dir_all(&paths.dir);
        return Err(AetherError::Internal(
            "administrator approval was cancelled or the TUN helper could not start".into(),
        ));
    }

    let deadline = Instant::now() + Duration::from_secs(30);
    let ready = loop {
        if let Ok(error) = fs::read_to_string(&paths.error) {
            let _ = fs::remove_dir_all(&paths.dir);
            return Err(AetherError::SpawnFailed(format!(
                "elevated TUN helper failed: {}",
                error.trim()
            )));
        }
        if let Ok(contents) = fs::read(&paths.ready) {
            match serde_json::from_slice::<HelperReady>(&contents) {
                Ok(ready) => break ready,
                Err(_) => {
                    // The helper publishes readiness atomically, but antivirus
                    // scanning can briefly expose the destination before rename.
                }
            }
        }
        if Instant::now() >= deadline {
            let _ = fs::write(&paths.stop, b"stop");
            return Err(AetherError::SpawnFailed(
                "timed out waiting for the elevated TUN helper".into(),
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    };

    spawn_log_tail(
        paths.stdout.clone(),
        "stdout",
        ready.helper_pid,
        log_tx.clone(),
    );
    spawn_log_tail(paths.stderr.clone(), "stderr", ready.helper_pid, log_tx);

    Ok(ElevatedTunProcess {
        helper_pid: ready.helper_pid,
        core_pid: ready.core_pid,
        paths,
        exit_code: None,
    })
}

#[cfg(windows)]
fn run_helper(request_path: &Path) -> i32 {
    let fallback_paths = ControlPaths::from_request(request_path);
    let result = run_helper_inner(request_path);
    match result {
        Ok(code) => code,
        Err(error) => {
            if let Some(paths) = fallback_paths {
                let _ = fs::write(&paths.error, error.as_bytes());
                let _ = fs::write(&paths.exit, b"1");
            }
            1
        }
    }
}

#[cfg(windows)]
fn run_helper_inner(request_path: &Path) -> Result<i32, String> {
    if !crate::is_admin() {
        return Err("TUN helper was not granted administrator privileges".into());
    }

    let request_path = fs::canonicalize(request_path)
        .map_err(|error| format!("canonicalize helper request: {error}"))?;
    let paths = ControlPaths::from_request(&request_path)
        .ok_or_else(|| "invalid helper request filename".to_string())?;
    validate_control_dir(&paths.dir)?;

    let request: HelperRequest = serde_json::from_slice(
        &fs::read(&request_path).map_err(|error| format!("read helper request: {error}"))?,
    )
    .map_err(|error| format!("parse helper request: {error}"))?;

    if !process_is_alive(request.parent_pid) {
        return Err("requesting GUI process is no longer running".into());
    }

    let tun_dir = paths
        .dir
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "helper runtime is outside the TUN directory".to_string())?;
    let tun_dir = fs::canonicalize(tun_dir)
        .map_err(|error| format!("canonicalize TUN runtime: {error}"))?;
    let config = fs::canonicalize(&request.config)
        .map_err(|error| format!("canonicalize TUN config: {error}"))?;
    if config.parent() != Some(tun_dir.as_path()) {
        return Err("TUN config is outside the application runtime directory".into());
    }
    let expected_config = match request.engine {
        TunEngine::Xray => "xray-config.json",
        TunEngine::Singbox => "singbox-config.json",
    };
    if config.file_name().and_then(|name| name.to_str()) != Some(expected_config) {
        return Err("unexpected TUN config filename".into());
    }

    let binary = fs::canonicalize(&request.binary)
        .map_err(|error| format!("canonicalize TUN core: {error}"))?;
    if !expected_core_name(request.engine, &binary) {
        return Err("unexpected TUN core executable name".into());
    }
    if request.engine == TunEngine::Xray {
        let wintun = binary
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("wintun.dll");
        if !wintun.is_file() {
            return Err(format!("missing {}", wintun.display()));
        }
    }

    let stdout = fs::File::create(&paths.stdout)
        .map_err(|error| format!("create helper stdout log: {error}"))?;
    let stderr = fs::File::create(&paths.stderr)
        .map_err(|error| format!("create helper stderr log: {error}"))?;

    let mut command = std::process::Command::new(&binary);
    command
        .arg("run")
        .arg("-c")
        .arg(&config)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(stdout))
        .stderr(std::process::Stdio::from(stderr));
    if let Some(parent) = binary.parent() {
        command.current_dir(parent);
    }
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|error| format!("launch elevated TUN core: {error}"))?;
    let ready = HelperReady {
        helper_pid: std::process::id(),
        core_pid: child.id(),
    };
    write_json_atomic(&paths.ready, &ready)?;

    let code = loop {
        if paths.stop.exists() || !process_is_alive(request.parent_pid) {
            let _ = child.kill();
            let _ = child.wait();
            break 0;
        }
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(1).max(0) as u32,
            Ok(None) => std::thread::sleep(Duration::from_millis(150)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("query elevated TUN core status: {error}"));
            }
        }
    };

    let _ = fs::write(&paths.exit, code.to_string());
    clear_pid_if_owned(&tun_dir, ready.core_pid);
    Ok(code as i32)
}

#[cfg(windows)]
fn validate_control_dir(dir: &Path) -> Result<(), String> {
    let canonical = fs::canonicalize(dir)
        .map_err(|error| format!("canonicalize helper runtime: {error}"))?;
    let Some(elevation) = canonical.parent() else {
        return Err("helper runtime has no elevation parent".into());
    };
    if elevation.file_name().and_then(|name| name.to_str()) != Some("elevation") {
        return Err("helper runtime is outside the elevation directory".into());
    }
    Ok(())
}

#[cfg(windows)]
fn expected_core_name(engine: TunEngine, binary: &Path) -> bool {
    let Some(name) = binary.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let name = name.to_ascii_lowercase();
    match engine {
        TunEngine::Xray => name == "xray.exe" || (name.starts_with("xray-v") && name.ends_with(".exe")),
        TunEngine::Singbox => {
            name == "sing-box.exe" || (name.starts_with("sing-box-v") && name.ends_with(".exe"))
        }
    }
}

#[cfg(windows)]
fn clear_pid_if_owned(tun_dir: &Path, core_pid: u32) {
    let path = tun_dir.join("system-tun.pid");
    let owned = fs::read_to_string(&path)
        .ok()
        .and_then(|contents| contents.split_whitespace().last()?.parse::<u32>().ok())
        == Some(core_pid);
    if owned {
        let _ = fs::remove_file(path);
    }
}

#[cfg(windows)]
fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    let contents = serde_json::to_vec(value)
        .map_err(|error| format!("serialize helper readiness: {error}"))?;
    fs::write(&temp, contents)
        .map_err(|error| format!("write helper readiness: {error}"))?;
    fs::rename(&temp, path).map_err(|error| format!("publish helper readiness: {error}"))
}

#[cfg(windows)]
fn launch_elevated_helper(request_path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let params = format!(
        "--tun-helper {}",
        quote_windows_argument(&request_path.as_os_str().to_string_lossy())
    );
    let mut exe_wide: Vec<u16> = exe.as_os_str().encode_wide().collect();
    exe_wide.push(0);
    let mut params_wide: Vec<u16> = params.encode_utf16().collect();
    params_wide.push(0);
    let verb: Vec<u16> = "runas\0".encode_utf16().collect();

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            exe_wide.as_ptr(),
            params_wide.as_ptr(),
            std::ptr::null(),
            SW_HIDE,
        )
    };
    result as isize > 32
}

#[cfg(windows)]
fn quote_windows_argument(value: &str) -> String {
    if !value.chars().any(|character| character.is_whitespace() || character == '"') {
        return value.to_string();
    }

    let mut result = String::from("\"");
    let mut backslashes = 0usize;
    for character in value.chars() {
        match character {
            '\\' => backslashes += 1,
            '"' => {
                result.push_str(&"\\".repeat(backslashes * 2 + 1));
                result.push('"');
                backslashes = 0;
            }
            _ => {
                result.push_str(&"\\".repeat(backslashes));
                backslashes = 0;
                result.push(character);
            }
        }
    }
    result.push_str(&"\\".repeat(backslashes * 2));
    result.push('"');
    result
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return false;
    }
    let mut exit_code = 0u32;
    let ok = unsafe { GetExitCodeProcess(handle, &mut exit_code) } != 0;
    unsafe {
        CloseHandle(handle);
    }
    ok && exit_code == 259
}

#[cfg(windows)]
fn spawn_log_tail(path: PathBuf, stream: &'static str, helper_pid: u32, tx: Sender<HelperLog>) {
    std::thread::spawn(move || {
        let mut offset = 0u64;
        loop {
            if let Ok(mut file) = fs::File::open(&path) {
                let _ = file.seek(SeekFrom::Start(offset));
                let mut reader = BufReader::new(file);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line) {
                        Ok(0) => break,
                        Ok(read) => {
                            offset += read as u64;
                            let line = line.trim_end_matches(['\r', '\n']).to_string();
                            if !line.is_empty() {
                                let _ = tx.send(HelperLog { stream, line });
                            }
                        }
                        Err(_) => break,
                    }
                }
            }

            if !process_is_alive(helper_pid) {
                if let Ok(metadata) = fs::metadata(&path) {
                    if offset >= metadata.len() {
                        break;
                    }
                } else {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    });
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    use super::*;

    #[cfg(windows)]
    #[test]
    fn quotes_windows_arguments() {
        assert_eq!(quote_windows_argument("plain"), "plain");
        assert_eq!(quote_windows_argument("C:\\Aether GUI\\request.json"), "\"C:\\Aether GUI\\request.json\"");
    }
}
