use crate::engine::EngineRuntime;
use crate::events::{now_millis, TELEMETRY_EVENT};
use crate::path_health::{PathHealth, PathHealthSnapshot};
use crate::state::ConnectionState;
use crate::traffic::{self, TrafficStats};
use crate::tunnel_validation::{TunnelProbe, TunnelValidation};
use serde::Serialize;
use std::net::IpAddr;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "macos")]
const ACTIVE_SAMPLE_INTERVAL: Duration = Duration::from_secs(5);
#[cfg(not(target_os = "macos"))]
const ACTIVE_SAMPLE_INTERVAL: Duration = Duration::from_secs(2);
const IDLE_SAMPLE_INTERVAL: Duration = Duration::from_secs(15);
const PROBE_INTERVAL: Duration = Duration::from_secs(60);
const TRACE_URL: &str = "https://www.cloudflare.com/cdn-cgi/trace";

#[derive(Serialize, Clone, Debug, Default)]
pub struct RuntimeTelemetry {
    pub received_bytes: u64,
    pub sent_bytes: u64,
    pub public_ip: Option<String>,
    pub country_code: Option<String>,
    pub latency_ms: Option<u64>,
    pub sampled_at_ms: u64,
    pub egress_probe_complete: bool,
    pub path_health: PathHealth,
    pub tunnel_validation: TunnelValidation,
    pub probe_failures: u32,
}

#[derive(Debug, Default)]
struct TelemetryState {
    snapshot: RuntimeTelemetry,
    last_raw_traffic: Option<TrafficStats>,
    health: PathHealthSnapshot,
    tunnel_required: bool,
    traffic_seen: bool,
}

#[derive(Debug)]
struct EgressProbe {
    public_ip: String,
    country_code: Option<String>,
    latency_ms: u64,
}

static TELEMETRY: OnceLock<Mutex<TelemetryState>> = OnceLock::new();
static SESSION_TOKEN: AtomicU64 = AtomicU64::new(0);

fn telemetry_state() -> &'static Mutex<TelemetryState> {
    TELEMETRY.get_or_init(|| Mutex::new(TelemetryState::default()))
}

pub fn snapshot() -> RuntimeTelemetry {
    telemetry_state()
        .lock()
        .map(|state| state.snapshot.clone())
        .unwrap_or_default()
}

fn emit_snapshot(app: &AppHandle, snapshot: RuntimeTelemetry) {
    let _ = app.emit(TELEMETRY_EVENT, snapshot);
}

fn validation_for(state: &TelemetryState) -> TunnelValidation {
    TunnelProbe {
        required: state.tunnel_required,
        interface_up: !state.tunnel_required || state.last_raw_traffic.is_some(),
        traffic_seen: state.traffic_seen,
        egress_ok: state.health.health == PathHealth::Healthy,
        latency_ms: state.health.latency_ms,
    }
    .validate()
}

fn reset_session(app: &AppHandle, raw_traffic: Option<TrafficStats>, tunnel_required: bool) {
    SESSION_TOKEN.fetch_add(1, Ordering::SeqCst);
    let mut state = TelemetryState {
        snapshot: RuntimeTelemetry {
            sampled_at_ms: now_millis(),
            tunnel_validation: if tunnel_required {
                TunnelValidation::Pending
            } else {
                TunnelValidation::Unknown
            },
            ..RuntimeTelemetry::default()
        },
        last_raw_traffic: raw_traffic,
        health: PathHealthSnapshot::default(),
        tunnel_required,
        traffic_seen: false,
    };
    state.snapshot.path_health = state.health.health;
    if let Ok(mut current) = telemetry_state().lock() {
        *current = state;
        emit_snapshot(app, current.snapshot.clone());
    }
}

fn traffic_delta(previous: Option<TrafficStats>, current: Option<TrafficStats>) -> TrafficStats {
    let (Some(previous), Some(current)) = (previous, current) else {
        return TrafficStats::default();
    };

    TrafficStats {
        received_bytes: current
            .received_bytes
            .saturating_sub(previous.received_bytes),
        sent_bytes: current.sent_bytes.saturating_sub(previous.sent_bytes),
    }
}

fn add_traffic_sample(
    app: &AppHandle,
    raw: Option<TrafficStats>,
    tunnel_required: bool,
) {
    let payload = telemetry_state().lock().ok().and_then(|mut state| {
        let previous_validation = state.snapshot.tunnel_validation;
        let delta = traffic_delta(state.last_raw_traffic, raw);
        state.last_raw_traffic = raw;
        state.tunnel_required = tunnel_required;

        if delta.received_bytes > 0 || delta.sent_bytes > 0 {
            state.traffic_seen = true;
            state.snapshot.received_bytes = state
                .snapshot
                .received_bytes
                .saturating_add(delta.received_bytes);
            state.snapshot.sent_bytes = state
                .snapshot
                .sent_bytes
                .saturating_add(delta.sent_bytes);
        }

        state.snapshot.tunnel_validation = validation_for(&state);
        let traffic_changed = delta.received_bytes > 0 || delta.sent_bytes > 0;
        let validation_changed = state.snapshot.tunnel_validation != previous_validation;
        if !traffic_changed && !validation_changed {
            return None;
        }

        state.snapshot.sampled_at_ms = now_millis();
        Some(state.snapshot.clone())
    });
    if let Some(payload) = payload {
        emit_snapshot(app, payload);
    }
}

fn publish_probe_result(app: &AppHandle, token: u64, result: Result<EgressProbe, String>) {
    if SESSION_TOKEN.load(Ordering::SeqCst) != token {
        return;
    }

    let payload = telemetry_state().lock().ok().map(|mut state| {
        state.snapshot.egress_probe_complete = true;
        state.snapshot.sampled_at_ms = now_millis();
        let sampled_at_ms = state.snapshot.sampled_at_ms;

        match result {
            Ok(probe) => {
                state.health.mark_success(probe.latency_ms, sampled_at_ms);
                state.snapshot.public_ip = Some(probe.public_ip);
                state.snapshot.country_code = probe.country_code;
                state.snapshot.latency_ms = Some(probe.latency_ms);
            }
            Err(_) => {
                state.health.mark_suspect();
                state.snapshot.public_ip = None;
                state.snapshot.country_code = None;
                state.snapshot.latency_ms = None;
            }
        }

        state.snapshot.path_health = state.health.health;
        state.snapshot.probe_failures = state.health.failures;
        state.snapshot.tunnel_validation = validation_for(&state);
        state.snapshot.clone()
    });
    if let Some(payload) = payload {
        emit_snapshot(app, payload);
    }
}

fn spawn_egress_probe(app: AppHandle, token: u64, socks_addr: String) {
    std::thread::spawn(move || {
        publish_probe_result(&app, token, probe_egress(&socks_addr));
    });
}

fn connected_details(status: &ConnectionState) -> Option<(String, u64, bool)> {
    match status {
        ConnectionState::Connected {
            socks_addr,
            connected_at_ms,
        } => Some((socks_addr.clone(), *connected_at_ms, false)),
        ConnectionState::StartingTunnel {
            socks_addr,
            connected_at_ms,
            ..
        }
        | ConnectionState::Tunneling {
            socks_addr,
            connected_at_ms,
            ..
        } => Some((socks_addr.clone(), *connected_at_ms, true)),
        _ => None,
    }
}

pub fn spawn_watcher(app: AppHandle, runtime: Arc<EngineRuntime>) {
    std::thread::spawn(move || {
        let mut active_session: Option<u64> = None;
        let mut next_probe: Option<Instant> = None;

        loop {
            let status = runtime.status();
            let connected = connected_details(&status);
            if let Some((socks_addr, connected_at_ms, tunnel_required)) = connected {
                let raw = runtime.traffic_interface().and_then(traffic::current);
                if active_session != Some(connected_at_ms) {
                    active_session = Some(connected_at_ms);
                    reset_session(&app, raw, tunnel_required);
                    next_probe = None;
                } else {
                    add_traffic_sample(&app, raw, tunnel_required);
                }

                let now = Instant::now();
                if next_probe.map(|deadline| now >= deadline).unwrap_or(true) {
                    next_probe = Some(now + PROBE_INTERVAL);
                    let token = SESSION_TOKEN.load(Ordering::SeqCst);
                    spawn_egress_probe(app.clone(), token, socks_addr);
                }
                std::thread::sleep(ACTIVE_SAMPLE_INTERVAL);
            } else {
                if active_session.take().is_some() {
                    next_probe = None;
                    reset_session(&app, None, false);
                }
                std::thread::sleep(IDLE_SAMPLE_INTERVAL);
            }
        }
    });
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}

fn probe_egress(socks_addr: &str) -> Result<EgressProbe, String> {
    let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
    let mut command = Command::new(curl);
    command
        .args([
            "-fsS",
            "--connect-timeout",
            "4",
            "--max-time",
            "8",
            "--proxy",
        ])
        .arg(format!("socks5h://{socks_addr}"))
        .args([
            "--write-out",
            "\n__aether_time_total=%{time_total}\n",
            TRACE_URL,
        ]);
    hide_console_window(&mut command);

    let output = command
        .output()
        .map_err(|error| format!("failed to launch telemetry probe: {error}"))?;
    if !output.status.success() {
        return Err(format!("telemetry probe exited with {}", output.status));
    }
    parse_trace(&String::from_utf8_lossy(&output.stdout))
}

fn parse_trace(output: &str) -> Result<EgressProbe, String> {
    let mut public_ip = None;
    let mut country_code = None;
    let mut latency_ms = None;

    for line in output.lines() {
        if let Some(value) = line.strip_prefix("ip=") {
            let value = value.trim();
            if value.parse::<IpAddr>().is_ok() {
                public_ip = Some(value.to_string());
            }
        } else if let Some(value) = line.strip_prefix("loc=") {
            let value = value.trim().to_ascii_uppercase();
            if value.len() == 2
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphabetic())
            {
                country_code = Some(value);
            }
        } else if let Some(value) = line.strip_prefix("__aether_time_total=") {
            if let Ok(seconds) = value.trim().parse::<f64>() {
                if seconds.is_finite() && seconds >= 0.0 {
                    latency_ms = Some(((seconds * 1000.0).round() as u64).max(1));
                }
            }
        }
    }

    Ok(EgressProbe {
        public_ip: public_ip
            .ok_or_else(|| "telemetry response did not contain an IP".to_string())?,
        country_code,
        latency_ms: latency_ms
            .ok_or_else(|| "telemetry response did not contain timing data".to_string())?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cloudflare_trace_and_timing() {
        let probe = parse_trace(
            "fl=1f123\nip=203.0.113.10\nloc=DE\ncolo=FRA\n__aether_time_total=0.0421\n",
        )
        .unwrap();
        assert_eq!(probe.public_ip, "203.0.113.10");
        assert_eq!(probe.country_code.as_deref(), Some("DE"));
        assert_eq!(probe.latency_ms, 42);
    }

    #[test]
    fn rejects_trace_without_valid_ip() {
        assert!(parse_trace("ip=not-an-ip\nloc=US\n__aether_time_total=0.1\n").is_err());
    }

    #[test]
    fn delayed_interface_start_establishes_a_baseline_without_backfilling_old_bytes() {
        let current = TrafficStats {
            received_bytes: 2_000_000_000,
            sent_bytes: 500_000_000,
        };
        assert_eq!(traffic_delta(None, Some(current)), TrafficStats::default());
    }

    #[test]
    fn counter_reset_establishes_a_new_baseline_without_a_spike() {
        let previous = TrafficStats {
            received_bytes: 8_000,
            sent_bytes: 4_000,
        };
        let current = TrafficStats {
            received_bytes: 100,
            sent_bytes: 50,
        };
        assert_eq!(
            traffic_delta(Some(previous), Some(current)),
            TrafficStats::default()
        );
    }

    #[test]
    fn normal_counter_growth_is_reported_as_session_delta() {
        let previous = TrafficStats {
            received_bytes: 1_000,
            sent_bytes: 400,
        };
        let current = TrafficStats {
            received_bytes: 1_250,
            sent_bytes: 475,
        };
        assert_eq!(
            traffic_delta(Some(previous), Some(current)),
            TrafficStats {
                received_bytes: 250,
                sent_bytes: 75,
            }
        );
    }

    #[test]
    fn final_tunnel_requires_real_interface_traffic_after_egress_validation() {
        let mut state = TelemetryState {
            tunnel_required: true,
            last_raw_traffic: Some(TrafficStats::default()),
            ..TelemetryState::default()
        };
        state.health.mark_success(40, 1000);
        assert_eq!(validation_for(&state), TunnelValidation::Pending);
        state.traffic_seen = true;
        assert_eq!(validation_for(&state), TunnelValidation::Healthy);
    }
}
