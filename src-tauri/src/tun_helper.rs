#[cfg(windows)]
use crate::aether::profiles::TunEngine;
#[cfg(windows)]
use crate::error::AetherError;
#[cfg(windows)]
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::io::{BufRead, BufReader, Seek, SeekFrom};
#[cfg(windows)]
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::ExitStatus;
#[cfg(windows)]
use std::sync::mpsc::Sender;
#[cfg(windows)]
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
const APP_IDENTIFIER: &str = "com.cluvexstudio.aethergui";

#[cfg(windows)]
#[derive(Debug)]
pub struct HelperLog {
    pub stream: &'static str,
    pub line: String,
}

#[cfg(windows)]
#[derive(Debug, Serialize, Deserialize)]
struct HelperRequest {
    engine: TunEngine,
    binary: PathBuf,
    config: PathBuf,
    parent_pid: u32,
}

#[cfg(windows)]
#[derive(Debug, Serialize, Deserialize)]
struct HelperReady {
    core_pid: u32,
}

#[cfg(windows)]
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

#[cfg(windows)]
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
        let paths = Self::from_dir(request.parent()?.to_path_buf());
        (paths.request == request).then_some(paths)
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
        Some(run_helper(Path::new(&request_path)))
    }

    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
pub struct ElevatedTunProcess {
    helper_handle: isize,
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
        if process_handle_is_alive(self.helper_handle) {
            return Ok(None);
        }

        let code = read_exit_code(&self.paths).unwrap_or(1);
        self.exit_code = Some(code);
        self.close_helper_handle();
        self.cleanup_control_dir();
        Ok(Some(ExitStatus::from_raw(code)))
    }

    pub fn kill(&mut self) {
        if self.exit_code.is_some() {
            self.close_helper_handle();
            self.cleanup_control_dir();
            return;
        }

        let _ = fs::write(&self.paths.stop, b"stop");
        let deadline = Instant::now() + Duration::from_secs(10);
        while process_handle_is_alive(self.helper_handle) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }

        if !process_handle_is_alive(self.helper_handle) {
            self.exit_code = read_exit_code(&self.paths).or(Some(0));
            self.close_helper_handle();
            self.cleanup_control_dir();
        }
    }

    fn close_helper_handle(&mut self) {
        if self.helper_handle != 0 {
            close_process_handle(self.helper_handle);
            self.helper_handle = 0;
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
        self.close_helper_handle();
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
    let trusted_tun = trusted_tun_dir().map_err(AetherError::Internal)?;
    if !same_canonical_path(tun_dir, &trusted_tun) {
        return Err(AetherError::Internal(
            "TUN config is outside the application runtime directory".into(),
        ));
    }

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

    let Some(helper_handle) = launch_elevated_helper(&paths.request) else {
        let _ = fs::remove_dir_all(&paths.dir);
        return Err(AetherError::Internal(
            "administrator approval was cancelled or the TUN helper could not start".into(),
        ));
    };

    let deadline = Instant::now() + Duration::from_secs(30);
    let ready = loop {
        if let Ok(error) = fs::read_to_string(&paths.error) {
            close_process_handle(helper_handle);
            let _ = fs::remove_dir_all(&paths.dir);
            return Err(AetherError::SpawnFailed(format!(
                "elevated TUN helper failed: {}",
                error.trim()
            )));
        }
        if let Ok(contents) = fs::read(&paths.ready) {
            if let Ok(ready) = serde_json::from_slice::<HelperReady>(&contents) {
                break ready;
            }
        }
        if !process_handle_is_alive(helper_handle) {
            let detail = fs::read_to_string(&paths.error)
                .unwrap_or_else(|_| "the elevated TUN helper exited before readiness".into());
            close_process_handle(helper_handle);
            let _ = fs::remove_dir_all(&paths.dir);
            return Err(AetherError::SpawnFailed(detail.trim().to_string()));
        }
        if Instant::now() >= deadline {
            let _ = fs::write(&paths.stop, b"stop");
            close_process_handle(helper_handle);
            schedule_control_cleanup(paths.clone());
            return Err(AetherError::SpawnFailed(
                "timed out waiting for the elevated TUN helper".into(),
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    };

    spawn_log_tail(
        paths.stdout.clone(),
        paths.exit.clone(),
        "stdout",
        log_tx.clone(),
    );
    spawn_log_tail(paths.stderr.clone(), paths.exit.clone(), "stderr", log_tx);

    Ok(ElevatedTunProcess {
        helper_handle,
        core_pid: ready.core_pid,
        paths,
        exit_code: None,
    })
}

#[cfg(windows)]
fn run_helper(request_path: &Path) -> i32 {
    let fallback_paths = ControlPaths::from_request(request_path);
    match run_helper_inner(request_path) {
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
    if !crate::os_is_admin() {
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

    let trusted_tun = fs::canonicalize(trusted_tun_dir()?)
        .map_err(|error| format!("canonicalize trusted TUN runtime: {error}"))?;
    let config = fs::canonicalize(&request.config)
        .map_err(|error| format!("canonicalize TUN config: {error}"))?;
    if config.parent() != Some(trusted_tun.as_path()) {
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
    if !binary_is_in_trusted_root(&binary)? {
        return Err("TUN core is outside application-managed locations".into());
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
    clear_pid_if_owned(&trusted_tun, ready.core_pid);
    Ok(code as i32)
}

#[cfg(windows)]
fn trusted_tun_dir() -> Result<PathBuf, String> {
    let roaming = std::env::var_os("APPDATA")
        .ok_or_else(|| "APPDATA is unavailable for the TUN helper".to_string())?;
    Ok(PathBuf::from(roaming).join(APP_IDENTIFIER).join("tun"))
}

#[cfg(windows)]
fn validate_control_dir(dir: &Path) -> Result<(), String> {
    let canonical = fs::canonicalize(dir)
        .map_err(|error| format!("canonicalize helper runtime: {error}"))?;
    let trusted_elevation = fs::canonicalize(trusted_tun_dir()?.join("elevation"))
        .map_err(|error| format!("canonicalize trusted elevation runtime: {error}"))?;
    if canonical.parent() != Some(trusted_elevation.as_path()) {
        return Err("helper runtime is outside the trusted elevation directory".into());
    }
    Ok(())
}

#[cfg(windows)]
fn binary_is_in_trusted_root(binary: &Path) -> Result<bool, String> {
    let app_data_root = trusted_tun_dir()?
        .parent()
        .ok_or_else(|| "application data root is unavailable".to_string())?
        .to_path_buf();
    let app_data_root = fs::canonicalize(app_data_root)
        .map_err(|error| format!("canonicalize application data root: {error}"))?;

    let exe = fs::canonicalize(std::env::current_exe().map_err(|error| error.to_string())?)
        .map_err(|error| format!("canonicalize helper executable: {error}"))?;
    let install_root = exe
        .parent()
        .ok_or_else(|| "helper executable has no parent directory".to_string())?;

    if binary.starts_with(&app_data_root) || binary.starts_with(install_root) {
        return Ok(true);
    }

    // `tauri dev` places the GUI under src-tauri/target/debug while local cores
    // live under src-tauri/binaries. Allow only that common src-tauri root.
    let dev_root = exe
        .ancestors()
        .find(|ancestor| ancestor.file_name().and_then(|name| name.to_str()) == Some("target"))
        .and_then(Path::parent);
    Ok(dev_root.is_some_and(|root| binary.starts_with(root)))
}

#[cfg(windows)]
fn expected_core_name(engine: TunEngine, binary: &Path) -> bool {
    let Some(name) = binary.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let name = name.to_ascii_lowercase();
    match engine {
        TunEngine::Xray => {
            name == "xray.exe" || (name.starts_with("xray-v") && name.ends_with(".exe"))
        }
        TunEngine::Singbox => {
            name == "sing-box.exe" || (name.starts_with("sing-box-v") && name.ends_with(".exe"))
        }
    }
}

#[cfg(windows)]
fn same_canonical_path(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
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
fn read_exit_code(paths: &ControlPaths) -> Option<u32> {
    fs::read_to_string(&paths.exit)
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
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
fn launch_elevated_helper(request_path: &Path) -> Option<isize> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let exe = std::env::current_exe().ok()?;
    let params = format!(
        "--tun-helper {}",
        quote_windows_argument(&request_path.as_os_str().to_string_lossy())
    );
    let mut exe_wide: Vec<u16> = exe.as_os_str().encode_wide().collect();
    exe_wide.push(0);
    let mut params_wide: Vec<u16> = params.encode_utf16().collect();
    params_wide.push(0);
    let verb: Vec<u16> = "runas\0".encode_utf16().collect();

    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = exe_wide.as_ptr();
    info.lpParameters = params_wide.as_ptr();
    info.nShow = SW_HIDE;

    if unsafe { ShellExecuteExW(&mut info) } == 0 || info.hProcess.is_null() {
        None
    } else {
        Some(info.hProcess as isize)
    }
}

#[cfg(windows)]
fn quote_windows_argument(value: &str) -> String {
    if !value
        .chars()
        .any(|character| character.is_whitespace() || character == '"')
    {
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
fn process_handle_is_alive(handle: isize) -> bool {
    use windows_sys::Win32::System::Threading::GetExitCodeProcess;

    if handle == 0 {
        return false;
    }
    let mut exit_code = 0u32;
    (unsafe { GetExitCodeProcess(handle as _, &mut exit_code) != 0 }) && exit_code == 259
}

#[cfg(windows)]
fn close_process_handle(handle: isize) {
    use windows_sys::Win32::Foundation::CloseHandle;

    if handle != 0 {
        unsafe {
            CloseHandle(handle as _);
        }
    }
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
fn spawn_log_tail(
    path: PathBuf,
    exit_path: PathBuf,
    stream: &'static str,
    tx: Sender<HelperLog>,
) {
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

            let control_dir_exists = path.parent().is_some_and(Path::exists);
            if !control_dir_exists {
                break;
            }
            if exit_path.exists()
                && fs::metadata(&path)
                    .map(|metadata| offset >= metadata.len())
                    .unwrap_or(true)
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    });
}

#[cfg(windows)]
fn schedule_control_cleanup(paths: ControlPaths) {
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while !paths.exit.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(250));
        }
        let _ = fs::remove_dir_all(paths.dir);
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
        assert_eq!(
            quote_windows_argument("C:\\Aether GUI\\request.json"),
            "\"C:\\Aether GUI\\request.json\""
        );
    }

    #[cfg(windows)]
    #[test]
    fn accepts_only_expected_core_names() {
        assert!(expected_core_name(
            TunEngine::Xray,
            Path::new("xray-v26.6.1.exe")
        ));
        assert!(expected_core_name(
            TunEngine::Singbox,
            Path::new("sing-box.exe")
        ));
        assert!(!expected_core_name(
            TunEngine::Xray,
            Path::new("xray-helper.exe")
        ));
    }
}
