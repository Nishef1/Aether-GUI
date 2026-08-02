pub mod orphan;
pub mod profiles;
pub mod prompts;
pub mod pty;
pub mod status;

use crate::error::AetherError;
use crate::events::{now_millis, LogEvent, LOG_EVENT, STATUS_EVENT};
use crate::state::ConnectionState;
use profiles::{ConnectionProfile, ScanMode};
use pty::PtySession;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub struct AetherManager {
    session: Option<PtySession>,
    state: ConnectionState,
    user_requested_stop: bool,
    /// Invalidates every monitor, retry and delayed launch from an older
    /// connection lineage when Disconnect or a new Connect is requested.
    generation: u64,
    /// Retry count within the current connection lineage. Before the first
    /// proven connection it is used only for the single Turbo -> Balanced
    /// fallback. After Connected it counts transient recovery attempts.
    retry_count: u32,
    /// Distinguishes an initial scan failure from a drop after a proven tunnel.
    connected_once: bool,
}

impl AetherManager {
    pub fn new() -> Self {
        Self {
            session: None,
            state: ConnectionState::Idle,
            user_requested_stop: false,
            generation: 0,
            retry_count: 0,
            connected_once: false,
        }
    }

    pub fn status(&self) -> ConnectionState {
        self.state.clone()
    }
}

fn app_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
}

fn resolve_binary(app: &AppHandle) -> Result<PathBuf, AetherError> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|error| AetherError::Internal(error.to_string()))?;
    let name = if cfg!(windows) {
        "aether.exe"
    } else {
        "aether"
    };
    let path = dir.join("binaries").join(name);
    if !path.exists() {
        return Err(AetherError::BinaryMissing(path.display().to_string()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
    }
    Ok(path)
}

fn is_current(manager: &AetherManager, generation: u64) -> bool {
    manager.generation == generation && !manager.user_requested_stop
}

fn set_state_and_emit_if_current(
    app: &AppHandle,
    manager: &Arc<Mutex<AetherManager>>,
    generation: u64,
    new_state: ConnectionState,
) -> bool {
    {
        let mut manager = manager.lock().unwrap();
        if !is_current(&manager, generation) {
            return false;
        }
        manager.state = new_state.clone();
    }
    let _ = app.emit(STATUS_EVENT, &new_state);
    true
}

fn initial_fallback_profile(
    profile: &ConnectionProfile,
    retry_count: u32,
) -> Option<ConnectionProfile> {
    if retry_count != 0 || !matches!(profile.scan_mode, ScanMode::Turbo) {
        return None;
    }
    let mut fallback = profile.clone();
    fallback.scan_mode = ScanMode::Balanced;
    Some(fallback)
}

pub fn start_connect(
    app: AppHandle,
    manager: Arc<Mutex<AetherManager>>,
    profile_override: Option<ConnectionProfile>,
) -> Result<(), AetherError> {
    let profile = profile_override.unwrap_or_else(|| profiles::load(&app));
    let binary = resolve_binary(&app)?;
    let data_dir = app_data_dir(&app);
    std::fs::create_dir_all(&data_dir).map_err(|error| AetherError::Internal(error.to_string()))?;

    let generation = {
        let mut manager = manager.lock().unwrap();
        if !matches!(
            manager.state,
            ConnectionState::Idle | ConnectionState::Error { .. }
        ) {
            return Err(AetherError::AlreadyRunning);
        }
        let socks = status::parse_bind_address(&profile.bind_address);
        if status::port_is_live(&socks) {
            return Err(AetherError::PortInUse(socks.port()));
        }
        manager.generation = manager.generation.wrapping_add(1);
        manager.user_requested_stop = false;
        manager.state = ConnectionState::Launching;
        manager.retry_count = 0;
        manager.connected_once = false;
        manager.generation
    };
    let _ = app.emit(STATUS_EVENT, &ConnectionState::Launching);

    spawn_and_monitor(app, manager, binary, data_dir, profile, generation)
}

fn spawn_and_monitor(
    app: AppHandle,
    manager: Arc<Mutex<AetherManager>>,
    binary: PathBuf,
    data_dir: PathBuf,
    profile: ConnectionProfile,
    generation: u64,
) -> Result<(), AetherError> {
    {
        let manager = manager.lock().unwrap();
        if !is_current(&manager, generation) {
            return Ok(());
        }
    }

    let (log_tx, log_rx) = mpsc::channel::<LogEvent>();
    let mut session = match pty::spawn(&binary, &data_dir, profile.clone(), log_tx) {
        Ok(session) => session,
        Err(error) => {
            set_state_and_emit_if_current(
                &app,
                &manager,
                generation,
                ConnectionState::Error {
                    message: error.to_string(),
                    phase: "launching".into(),
                },
            );
            return Err(error);
        }
    };

    {
        let mut manager = manager.lock().unwrap();
        if !is_current(&manager, generation) {
            drop(manager);
            session.kill();
            return Ok(());
        }
        orphan::write_pid(&data_dir, session.pid());
        manager.session = Some(session);
    }

    {
        let app_for_logs = app.clone();
        std::thread::spawn(move || {
            for log in log_rx {
                let _ = app_for_logs.emit(LOG_EVENT, &log);
            }
        });
    }

    {
        let app = app.clone();
        let manager = Arc::clone(&manager);
        let binary = binary.clone();
        let data_dir = data_dir.clone();
        std::thread::spawn(move || {
            monitor_connect(app, manager, binary, data_dir, profile, generation)
        });
    }

    Ok(())
}

enum RetryDecision {
    Fail(String),
    Retry {
        attempt: u32,
        max_attempts: u32,
        profile: ConnectionProfile,
        backoff: Duration,
        note: Option<String>,
    },
}

fn handle_unexpected_failure(
    app: AppHandle,
    manager: Arc<Mutex<AetherManager>>,
    binary: PathBuf,
    data_dir: PathBuf,
    profile: ConnectionProfile,
    failure_message: String,
    phase: &'static str,
    generation: u64,
) {
    let decision = {
        let mut manager = manager.lock().unwrap();
        if !is_current(&manager, generation) {
            return;
        }
        manager.session = None;

        if !manager.connected_once {
            if let Some(fallback) = initial_fallback_profile(&profile, manager.retry_count) {
                manager.retry_count = 1;
                RetryDecision::Retry {
                    attempt: 1,
                    max_attempts: 1,
                    profile: fallback,
                    backoff: status::INITIAL_TURBO_FALLBACK_BACKOFF,
                    note: Some(
                        "[gui] Turbo scan did not connect; retrying once with Balanced scan".into(),
                    ),
                }
            } else {
                let message = if manager.retry_count > 0 {
                    format!("{failure_message} (Balanced fallback also failed)")
                } else {
                    failure_message
                };
                RetryDecision::Fail(message)
            }
        } else {
            manager.retry_count += 1;
            let attempt = manager.retry_count;
            if attempt > status::MAX_POST_CONNECT_RETRIES {
                RetryDecision::Fail(format!(
                    "{failure_message} (gave up after {} recovery retries)",
                    status::MAX_POST_CONNECT_RETRIES
                ))
            } else {
                RetryDecision::Retry {
                    attempt,
                    max_attempts: status::MAX_POST_CONNECT_RETRIES,
                    profile,
                    backoff: status::POST_CONNECT_RETRY_BACKOFF[(attempt - 1) as usize],
                    note: None,
                }
            }
        }
    };
    orphan::clear_pid(&data_dir);

    match decision {
        RetryDecision::Fail(message) => {
            set_state_and_emit_if_current(
                &app,
                &manager,
                generation,
                ConnectionState::Error {
                    message,
                    phase: phase.into(),
                },
            );
        }
        RetryDecision::Retry {
            attempt,
            max_attempts,
            profile,
            backoff,
            note,
        } => {
            if let Some(line) = note {
                let _ = app.emit(
                    LOG_EVENT,
                    &LogEvent {
                        line,
                        timestamp: now_millis(),
                    },
                );
            }
            if !set_state_and_emit_if_current(
                &app,
                &manager,
                generation,
                ConnectionState::Reconnecting {
                    attempt,
                    max_attempts,
                },
            ) {
                return;
            }
            std::thread::spawn(move || {
                std::thread::sleep(backoff);
                {
                    let manager = manager.lock().unwrap();
                    if !is_current(&manager, generation) {
                        return;
                    }
                }
                if !set_state_and_emit_if_current(
                    &app,
                    &manager,
                    generation,
                    ConnectionState::Launching,
                ) {
                    return;
                }
                let _ = spawn_and_monitor(app, manager, binary, data_dir, profile, generation);
            });
        }
    }
}

fn monitor_connect(
    app: AppHandle,
    manager: Arc<Mutex<AetherManager>>,
    binary: PathBuf,
    data_dir: PathBuf,
    profile: ConnectionProfile,
    generation: u64,
) {
    let deadline = Instant::now() + status::connect_timeout(&profile.scan_mode);
    let socks = status::parse_bind_address(&profile.bind_address);
    let mut announced_connecting = false;

    loop {
        std::thread::sleep(Duration::from_millis(400));
        let mut manager_guard = manager.lock().unwrap();
        if !is_current(&manager_guard, generation) {
            return;
        }

        if let Some(exit) = manager_guard
            .session
            .as_mut()
            .and_then(|session| session.try_wait())
        {
            manager_guard.session = None;
            drop(manager_guard);
            handle_unexpected_failure(
                app,
                manager,
                binary,
                data_dir,
                profile,
                format!("Aether exited before connecting ({exit})"),
                "connecting",
                generation,
            );
            return;
        }

        if !announced_connecting {
            let prompts_done = manager_guard
                .session
                .as_ref()
                .map(|session| session.prompts_done())
                .unwrap_or(false);
            if prompts_done {
                manager_guard.state = ConnectionState::Connecting;
                let new_state = manager_guard.state.clone();
                drop(manager_guard);
                let _ = app.emit(STATUS_EVENT, &new_state);
                announced_connecting = true;
                continue;
            }
        }

        if status::port_is_live(&socks) {
            let new_state = ConnectionState::Connected {
                socks_addr: profile.bind_address.clone(),
                connected_at_ms: now_millis(),
            };
            manager_guard.state = new_state.clone();
            manager_guard.retry_count = 0;
            manager_guard.connected_once = true;
            drop(manager_guard);
            let _ = app.emit(STATUS_EVENT, &new_state);
            profiles::save(&app, &profile);
            monitor_connected(app, manager, binary, data_dir, profile, generation);
            return;
        }

        if Instant::now() >= deadline {
            if let Some(session) = manager_guard.session.as_mut() {
                session.kill();
            }
            manager_guard.session = None;
            drop(manager_guard);
            handle_unexpected_failure(
                app,
                manager,
                binary,
                data_dir,
                profile,
                "Timed out waiting for Aether to find a working route".into(),
                "connecting",
                generation,
            );
            return;
        }
    }
}

fn monitor_connected(
    app: AppHandle,
    manager: Arc<Mutex<AetherManager>>,
    binary: PathBuf,
    data_dir: PathBuf,
    profile: ConnectionProfile,
    generation: u64,
) {
    loop {
        std::thread::sleep(Duration::from_millis(500));
        let mut manager_guard = manager.lock().unwrap();
        if !is_current(&manager_guard, generation) {
            return;
        }
        if let Some(exit) = manager_guard
            .session
            .as_mut()
            .and_then(|session| session.try_wait())
        {
            manager_guard.session = None;
            drop(manager_guard);
            handle_unexpected_failure(
                app,
                manager,
                binary,
                data_dir,
                profile,
                format!("Lost connection unexpectedly ({exit})"),
                "connected",
                generation,
            );
            return;
        }
    }
}

fn stop_session_blocking(session: &mut PtySession, grace: Duration) {
    session.send_ctrl_c();

    #[cfg(windows)]
    {
        let _ = grace;
        // Kill while the parent PID is still alive so taskkill /T can reach
        // every descendant instead of leaving a detached helper behind.
        session.kill();
        return;
    }

    #[cfg(not(windows))]
    {
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            if session.try_wait().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        session.kill();
    }
}

pub fn request_disconnect(
    app: &AppHandle,
    manager: &Arc<Mutex<AetherManager>>,
) -> Result<(), AetherError> {
    let mut session = {
        let mut manager = manager.lock().unwrap();
        manager.generation = manager.generation.wrapping_add(1);
        manager.user_requested_stop = true;
        manager.retry_count = 0;
        manager.connected_once = false;
        manager.state = ConnectionState::Disconnecting;
        manager.session.take()
    };

    if session.is_none() {
        let data_dir = app_data_dir(app);
        orphan::reap_orphan(&data_dir);
        orphan::clear_pid(&data_dir);
        manager.lock().unwrap().state = ConnectionState::Idle;
        let _ = app.emit(STATUS_EVENT, &ConnectionState::Idle);
        return Ok(());
    }

    let _ = app.emit(STATUS_EVENT, &ConnectionState::Disconnecting);
    let app = app.clone();
    let manager = Arc::clone(manager);
    std::thread::spawn(move || {
        if let Some(session) = session.as_mut() {
            stop_session_blocking(session, status::GRACEFUL_SHUTDOWN_GRACE);
        }
        let data_dir = app_data_dir(&app);
        orphan::reap_orphan(&data_dir);
        orphan::clear_pid(&data_dir);
        manager.lock().unwrap().state = ConnectionState::Idle;
        let _ = app.emit(STATUS_EVENT, &ConnectionState::Idle);
    });

    Ok(())
}

pub fn submit_access_code(
    manager: &Arc<Mutex<AetherManager>>,
    code: String,
) -> Result<(), AetherError> {
    let manager = manager
        .lock()
        .map_err(|_| AetherError::Internal("Aether state is unavailable".into()))?;
    let session = manager.session.as_ref().ok_or(AetherError::NotConnected)?;
    session.send_access_code(&code)
}

pub fn shutdown_blocking(manager: &Arc<Mutex<AetherManager>>, data_dir: &Path) {
    let mut session = {
        let mut manager = manager.lock().unwrap();
        manager.generation = manager.generation.wrapping_add(1);
        manager.user_requested_stop = true;
        manager.retry_count = 0;
        manager.connected_once = false;
        manager.state = ConnectionState::Disconnecting;
        manager.session.take()
    };

    if let Some(session) = session.as_mut() {
        stop_session_blocking(session, status::GRACEFUL_SHUTDOWN_GRACE);
    }
    orphan::reap_orphan(data_dir);
    orphan::clear_pid(data_dir);

    let mut manager = manager.lock().unwrap();
    manager.session = None;
    manager.state = ConnectionState::Idle;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turbo_has_exactly_one_balanced_initial_fallback() {
        let mut profile = ConnectionProfile::default();
        profile.scan_mode = ScanMode::Turbo;
        let fallback = initial_fallback_profile(&profile, 0).expect("missing fallback");
        assert_eq!(fallback.scan_mode, ScanMode::Balanced);
        assert!(initial_fallback_profile(&profile, 1).is_none());
    }

    #[test]
    fn non_turbo_initial_scans_do_not_loop() {
        let profile = ConnectionProfile::default();
        assert!(initial_fallback_profile(&profile, 0).is_none());
    }

    #[test]
    fn generation_invalidates_stale_workers() {
        let mut manager = AetherManager::new();
        manager.generation = 7;
        assert!(is_current(&manager, 7));
        manager.generation = 8;
        assert!(!is_current(&manager, 7));
        manager.user_requested_stop = true;
        assert!(!is_current(&manager, 8));
    }
}
