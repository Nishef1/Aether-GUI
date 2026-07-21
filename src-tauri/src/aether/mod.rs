pub mod orphan;
pub mod profiles;
pub mod prompts;
pub mod pty;
pub mod status;
pub mod updater;

use crate::diagnostics;
use crate::error::AetherError;
use crate::events::{now_millis, LogEvent, LOG_EVENT, STATUS_EVENT};
use crate::singbox;
use crate::state::ConnectionState;
use profiles::ConnectionProfile;
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
    retry_count: u32,
    tun_enabled: bool,
}

impl AetherManager {
    pub fn new() -> Self {
        Self {
            session: None,
            state: ConnectionState::Idle,
            user_requested_stop: false,
            retry_count: 0,
            tun_enabled: false,
        }
    }

    pub fn status(&self) -> ConnectionState {
        self.state.clone()
    }

    pub fn is_busy(&self) -> bool {
        !matches!(self.state, ConnectionState::Idle | ConnectionState::Error { .. })
    }
}

fn app_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
}

fn set_state_and_emit(
    app: &AppHandle,
    manager: &Arc<Mutex<AetherManager>>,
    new_state: ConnectionState,
) {
    manager.lock().unwrap().state = new_state.clone();
    diagnostics::record_status(&new_state);
    let _ = app.emit(STATUS_EVENT, &new_state);
}

fn terminate_session(manager: &Arc<Mutex<AetherManager>>) {
    let mut session = manager.lock().unwrap().session.take();
    if let Some(session) = session.as_mut() {
        session.kill();
    }
}

pub fn start_connect(
    app: AppHandle,
    manager: Arc<Mutex<AetherManager>>,
    profile_override: Option<ConnectionProfile>,
    singbox_manager: Arc<Mutex<singbox::SingboxManager>>,
) -> Result<(), AetherError> {
    let profile = profile_override
        .unwrap_or_else(|| profiles::load(&app))
        .sanitized();

    if profile.tun_enabled && !crate::is_admin() {
        return Err(AetherError::ElevationRequired);
    }

    // Prefer the independently managed core, then the bundled/dev fallback.
    // On a true first run where neither exists yet, synchronously fetch a
    // verified stable core so Connect is not racing the background updater.
    let binary = match updater::resolve_binary(&app) {
        Ok(binary) => binary,
        Err(AetherError::BinaryMissing(_)) => {
            updater::refresh_now(&app)?;
            updater::resolve_binary(&app)?
        }
        Err(e) => return Err(e),
    };
    if profile.tun_enabled {
        let _ = singbox::ensure_binary(&app)?;
    }
    let data_dir = app_data_dir(&app);
    std::fs::create_dir_all(&data_dir).map_err(|e| AetherError::Internal(e.to_string()))?;

    {
        let mut mgr = manager.lock().unwrap();
        if mgr.is_busy() {
            return Err(AetherError::AlreadyRunning);
        }
        let socks = status::parse_bind_address(&profile.bind_address);
        if status::port_is_live(&socks) {
            return Err(AetherError::PortInUse(socks.port()));
        }
        mgr.state = ConnectionState::Launching;
        mgr.retry_count = 0;
        mgr.tun_enabled = profile.tun_enabled;
        mgr.user_requested_stop = false;
    }
    diagnostics::record_status(&ConnectionState::Launching);
    let _ = app.emit(STATUS_EVENT, &ConnectionState::Launching);

    spawn_and_monitor(app, manager, binary, data_dir, profile, singbox_manager)
}

fn spawn_and_monitor(
    app: AppHandle,
    manager: Arc<Mutex<AetherManager>>,
    binary: PathBuf,
    data_dir: PathBuf,
    profile: ConnectionProfile,
    singbox_manager: Arc<Mutex<singbox::SingboxManager>>,
) -> Result<(), AetherError> {
    diagnostics::record(
        "aether",
        "info",
        format!(
            "launching core {} ({})",
            updater::detect_version(&binary).unwrap_or_else(|| "unknown version".into()),
            binary.display()
        ),
    );

    let (log_tx, log_rx) = mpsc::channel::<LogEvent>();
    let session = match pty::spawn(&binary, &data_dir, profile.clone(), log_tx) {
        Ok(session) => session,
        Err(e) => {
            // Integrity verification proves the download is authentic, not that
            // a newly released core remains compatible with this GUI/runtime.
            // If the independently managed core cannot even launch, retry once
            // with the tested core shipped with this GUI before surfacing Error.
            if updater::is_managed_binary(&app, &binary) {
                if let Some(fallback) = updater::bundled_recovery_binary(&app) {
                    diagnostics::record(
                        "core-updater",
                        "warn",
                        format!(
                            "managed core failed to launch ({e}); retrying with bundled fallback {}",
                            fallback.display()
                        ),
                    );
                    return spawn_and_monitor(
                        app,
                        manager,
                        fallback,
                        data_dir,
                        profile,
                        singbox_manager,
                    );
                }
            }
            set_state_and_emit(
                &app,
                &manager,
                ConnectionState::Error {
                    message: e.to_string(),
                    phase: "launching".into(),
                },
            );
            return Err(e);
        }
    };
    if session.pid() != 0 {
        orphan::write_pid(&data_dir, session.pid());
    }

    {
        let mut mgr = manager.lock().unwrap();
        mgr.session = Some(session);
        mgr.user_requested_stop = false;
    }

    {
        let app_for_logs = app.clone();
        std::thread::spawn(move || {
            for log in log_rx {
                diagnostics::record("aether", "info", &log.line);
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
            monitor_connect(
                app,
                manager,
                binary,
                data_dir,
                profile,
                singbox_manager,
            )
        });
    }

    Ok(())
}

fn handle_unexpected_failure(
    app: AppHandle,
    manager: Arc<Mutex<AetherManager>>,
    binary: PathBuf,
    data_dir: PathBuf,
    profile: ConnectionProfile,
    failure_message: String,
    phase: &'static str,
    singbox_manager: Arc<Mutex<singbox::SingboxManager>>,
) {
    singbox::stop_tunnel(&app, &singbox_manager);
    let attempt = {
        let mut mgr = manager.lock().unwrap();
        if mgr.user_requested_stop {
            return;
        }
        mgr.session = None;
        mgr.retry_count += 1;
        mgr.retry_count
    };
    orphan::clear_pid(&data_dir);
    diagnostics::record(
        "supervisor",
        "warn",
        format!("{phase}: {failure_message}; recovery attempt {attempt}"),
    );

    if attempt > status::MAX_AUTO_RETRIES {
        set_state_and_emit(
            &app,
            &manager,
            ConnectionState::Error {
                message: format!(
                    "{failure_message} (gave up after {} retries)",
                    status::MAX_AUTO_RETRIES
                ),
                phase: phase.into(),
            },
        );
        return;
    }

    set_state_and_emit(
        &app,
        &manager,
        ConnectionState::Reconnecting {
            attempt,
            max_attempts: status::MAX_AUTO_RETRIES,
        },
    );

    let backoff = status::RETRY_BACKOFF[(attempt - 1) as usize];
    std::thread::spawn(move || {
        std::thread::sleep(backoff);
        {
            let mgr = manager.lock().unwrap();
            if mgr.user_requested_stop {
                return;
            }
        }
        set_state_and_emit(&app, &manager, ConnectionState::Launching);
        let _ = spawn_and_monitor(
            app,
            manager,
            binary,
            data_dir,
            profile,
            singbox_manager,
        );
    });
}

fn monitor_connect(
    app: AppHandle,
    manager: Arc<Mutex<AetherManager>>,
    binary: PathBuf,
    data_dir: PathBuf,
    profile: ConnectionProfile,
    singbox_manager: Arc<Mutex<singbox::SingboxManager>>,
) {
    let deadline = Instant::now() + status::connect_timeout(&profile.scan_mode);
    let socks = status::parse_bind_address(&profile.bind_address);
    let mut announced_connecting = false;

    loop {
        std::thread::sleep(Duration::from_millis(400));
        let mut mgr = manager.lock().unwrap();
        if mgr.user_requested_stop {
            return;
        }

        if let Some(exit) = mgr.session.as_mut().and_then(|s| s.try_wait()) {
            mgr.session = None;
            drop(mgr);
            orphan::clear_pid(&data_dir);

            // A managed core that starts as a process but exits before it ever
            // exposes SOCKS is treated as a possible compatibility regression.
            // Fall back once to the core bundled with this GUI. Once on the
            // bundled core, ordinary bounded reconnect logic applies normally.
            if updater::is_managed_binary(&app, &binary) {
                if let Some(fallback) = updater::bundled_recovery_binary(&app) {
                    diagnostics::record(
                        "core-updater",
                        "warn",
                        format!(
                            "managed core exited before connecting ({exit}); retrying with bundled fallback {}",
                            fallback.display()
                        ),
                    );
                    set_state_and_emit(&app, &manager, ConnectionState::Launching);
                    let _ = spawn_and_monitor(
                        app,
                        manager,
                        fallback,
                        data_dir,
                        profile,
                        singbox_manager,
                    );
                    return;
                }
            }

            handle_unexpected_failure(
                app,
                manager,
                binary,
                data_dir,
                profile,
                format!("Aether exited before connecting ({exit})"),
                "connecting",
                singbox_manager,
            );
            return;
        }

        if !announced_connecting {
            let done = mgr
                .session
                .as_ref()
                .map(|s| s.prompts_done())
                .unwrap_or(false);
            if done {
                mgr.state = ConnectionState::Connecting;
                let new_state = mgr.state.clone();
                drop(mgr);
                diagnostics::record_status(&new_state);
                let _ = app.emit(STATUS_EVENT, &new_state);
                announced_connecting = true;
                continue;
            }
        }

        if status::port_is_live(&socks) {
            let connected_at_ms = now_millis();
            let connected_state = ConnectionState::Connected {
                socks_addr: profile.bind_address.clone(),
                connected_at_ms,
            };
            mgr.state = connected_state.clone();
            mgr.retry_count = 0;
            let tun_enabled = mgr.tun_enabled;
            drop(mgr);
            diagnostics::record_status(&connected_state);
            let _ = app.emit(STATUS_EVENT, &connected_state);

            if tun_enabled {
                match singbox::start_tunnel(app.clone(), singbox_manager.clone(), socks.port()) {
                    Ok(()) => {
                        // The user may have clicked Disconnect while the TUN
                        // startup health probe was running. Never resurrect a
                        // cancelled connection into Tunneling afterward.
                        if manager.lock().unwrap().user_requested_stop {
                            singbox::stop_tunnel(&app, &singbox_manager);
                            return;
                        }
                        let tunneling = ConnectionState::Tunneling {
                            tun_addr: singbox::config::TUN_ADDRESS.into(),
                            socks_addr: profile.bind_address.clone(),
                            connected_at_ms,
                        };
                        set_state_and_emit(&app, &manager, tunneling);
                        profiles::save(&app, &profile);
                        monitor_connected(
                            app,
                            manager,
                            binary,
                            data_dir,
                            profile,
                            singbox_manager,
                        );
                    }
                    Err(e) => {
                        // start_tunnel returns a cancellation error when
                        // request_disconnect() removed its owned process. The
                        // disconnect thread owns the state transition to Idle;
                        // do not overwrite it with a stale Error.
                        if manager.lock().unwrap().user_requested_stop {
                            return;
                        }
                        diagnostics::record("supervisor", "error", e.to_string());
                        singbox::stop_tunnel(&app, &singbox_manager);
                        terminate_session(&manager);
                        orphan::clear_pid(&data_dir);
                        set_state_and_emit(
                            &app,
                            &manager,
                            ConnectionState::Error {
                                message: format!("System-wide TUN failed: {e}"),
                                phase: "tunnel".into(),
                            },
                        );
                    }
                }
            } else {
                profiles::save(&app, &profile);
                monitor_connected(
                    app,
                    manager,
                    binary,
                    data_dir,
                    profile,
                    singbox_manager,
                );
            }
            return;
        }

        if Instant::now() >= deadline {
            if let Some(session) = mgr.session.as_mut() {
                session.kill();
            }
            mgr.session = None;
            drop(mgr);
            handle_unexpected_failure(
                app,
                manager,
                binary,
                data_dir,
                profile,
                "Timed out waiting for Aether to expose a healthy SOCKS proxy".into(),
                "connecting",
                singbox_manager,
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
    singbox_manager: Arc<Mutex<singbox::SingboxManager>>,
) {
    let tun_enabled = profile.tun_enabled;
    let mut next_tun_health = Instant::now() + singbox::status::TUN_HEALTH_INTERVAL;
    let mut consecutive_tun_failures = 0u32;

    loop {
        std::thread::sleep(Duration::from_millis(500));

        {
            let mut mgr = manager.lock().unwrap();
            if mgr.user_requested_stop {
                return;
            }
            if let Some(exit) = mgr.session.as_mut().and_then(|s| s.try_wait()) {
                mgr.session = None;
                drop(mgr);
                singbox::stop_tunnel(&app, &singbox_manager);
                handle_unexpected_failure(
                    app,
                    manager,
                    binary,
                    data_dir,
                    profile,
                    format!("Aether exited unexpectedly ({exit})"),
                    "connected",
                    singbox_manager,
                );
                return;
            }
        }

        if !tun_enabled {
            continue;
        }

        match singbox::process_exit_status(&singbox_manager) {
            Ok(Some(exit)) => {
                singbox::stop_tunnel(&app, &singbox_manager);
                terminate_session(&manager);
                handle_unexpected_failure(
                    app,
                    manager,
                    binary,
                    data_dir,
                    profile,
                    format!("sing-box TUN exited unexpectedly ({exit})"),
                    "tunnel",
                    singbox_manager,
                );
                return;
            }
            Err(e) => diagnostics::record("tun-health", "warn", e.to_string()),
            Ok(None) => {}
        }

        if Instant::now() < next_tun_health {
            continue;
        }
        next_tun_health = Instant::now() + singbox::status::TUN_HEALTH_INTERVAL;

        match singbox::verify_active_tunnel(&singbox_manager) {
            Ok(()) => {
                consecutive_tun_failures = 0;
                diagnostics::record("tun-health", "info", "system-wide data plane healthy");
            }
            Err(e) => {
                if manager.lock().unwrap().user_requested_stop {
                    return;
                }
                consecutive_tun_failures += 1;
                diagnostics::record(
                    "tun-health",
                    "warn",
                    format!(
                        "health failure {}/{}: {e}",
                        consecutive_tun_failures,
                        singbox::status::MAX_CONSECUTIVE_HEALTH_FAILURES
                    ),
                );
                if consecutive_tun_failures >= singbox::status::MAX_CONSECUTIVE_HEALTH_FAILURES {
                    singbox::stop_tunnel(&app, &singbox_manager);
                    terminate_session(&manager);
                    handle_unexpected_failure(
                        app,
                        manager,
                        binary,
                        data_dir,
                        profile,
                        format!("TUN data plane became unhealthy: {e}"),
                        "tunnel",
                        singbox_manager,
                    );
                    return;
                }
            }
        }
    }
}

pub fn request_disconnect(
    app: &AppHandle,
    manager: &Arc<Mutex<AetherManager>>,
    singbox_manager: &Arc<Mutex<singbox::SingboxManager>>,
) -> Result<(), AetherError> {
    let had_session = {
        let mut mgr = manager.lock().unwrap();
        let reconnecting = matches!(mgr.state, ConnectionState::Reconnecting { .. });
        if mgr.session.is_none() && !reconnecting {
            return Err(AetherError::NotConnected);
        }
        mgr.user_requested_stop = true;
        mgr.retry_count = 0;
        if let Some(session) = mgr.session.as_ref() {
            session.send_ctrl_c();
        }
        mgr.session.is_some()
    };

    singbox::stop_tunnel(app, singbox_manager);

    if !had_session {
        set_state_and_emit(app, manager, ConnectionState::Idle);
        return Ok(());
    }

    set_state_and_emit(app, manager, ConnectionState::Disconnecting);

    let app = app.clone();
    let manager = Arc::clone(manager);
    std::thread::spawn(move || {
        let deadline = Instant::now() + status::GRACEFUL_SHUTDOWN_GRACE;
        loop {
            std::thread::sleep(Duration::from_millis(200));
            let mut mgr = manager.lock().unwrap();
            let exited = mgr.session.as_mut().and_then(|s| s.try_wait()).is_some();
            if exited || Instant::now() >= deadline {
                if !exited {
                    if let Some(session) = mgr.session.as_mut() {
                        session.kill();
                    }
                }
                mgr.session = None;
                mgr.user_requested_stop = false;
                mgr.tun_enabled = false;
                drop(mgr);
                orphan::clear_pid(&app_data_dir(&app));
                set_state_and_emit(&app, &manager, ConnectionState::Idle);
                return;
            }
        }
    });

    Ok(())
}

pub fn shutdown_blocking(
    manager: &Arc<Mutex<AetherManager>>,
    singbox_manager: &Arc<Mutex<singbox::SingboxManager>>,
    data_dir: &Path,
) {
    singbox::shutdown_blocking(singbox_manager, data_dir);
    let mut mgr = manager.lock().unwrap();
    if let Some(session) = mgr.session.as_mut() {
        session.send_ctrl_c();
        std::thread::sleep(Duration::from_millis(500));
        session.kill();
    }
    mgr.session = None;
    drop(mgr);
    orphan::clear_pid(data_dir);
}
