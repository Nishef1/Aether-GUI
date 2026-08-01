use crate::aether::AetherManager;
use crate::events::{now_millis, TELEMETRY_EVENT};
use crate::state::ConnectionState;
use crate::traffic::{self, TrafficStats};
use serde::Serialize;
use std::net::IpAddr;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);
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
}

#[derive(Debug, Default)]
struct TelemetryState {
    snapshot: RuntimeTelemetry,
    last_raw_traffic: TrafficStats,
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

fn reset_session(app: &AppHandle, raw_traffic: TrafficStats) {
    SESSION_TOKEN.fetch_add(1, Ordering::SeqCst);
    let snapshot = RuntimeTelemetry {
        sampled_at_ms: now_millis(),
        ..RuntimeTelemetry::default()
    };

    if let Ok(mut state) = telemetry_state().lock() {
        state.snapshot = snapshot.clone();
        state.last_raw_traffic = raw_traffic;
    }
    emit_snapshot(app, snapshot);
}

fn invalidate_probe() {
    SESSION_TOKEN.fetch_add(1, Ordering::SeqCst);
}

fn clear_egress(app: &AppHandle) {
    let payload = telemetry_state().lock().ok().map(|mut state| {
        state.snapshot.public_ip = None;
        state.snapshot.country_code = None;
        state.snapshot.latency_ms = None;
        state.snapshot.egress_probe_complete = false;
        state.snapshot.sampled_at_ms = now_millis();
        state.snapshot.clone()
    });
    if let Some(payload) = payload {
        emit_snapshot(app, payload);
    }
}

fn add_traffic_sample(app: &AppHandle, raw: TrafficStats) {
    let payload = telemetry_state().lock().ok().map(|mut state| {
        let received_delta = raw
            .received_bytes
            .checked_sub(state.last_raw_traffic.received_bytes)
            .unwrap_or(raw.received_bytes);
        let sent_delta = raw
            .sent_bytes
            .checked_sub(state.last_raw_traffic.sent_bytes)
            .unwrap_or(raw.sent_bytes);

        state.snapshot.received_bytes =
            state.snapshot.received_bytes.saturating_add(received_delta);
        state.snapshot.sent_bytes = state.snapshot.sent_bytes.saturating_add(sent_delta);
        state.snapshot.sampled_at_ms = now_millis();
        state.last_raw_traffic = raw;
        state.snapshot.clone()
    });

    if let Some(payload) = payload {
        emit_snapshot(app, payload);
    }
}

fn touch_clock(app: &AppHandle) {
    let payload = telemetry_state().lock().ok().map(|mut state| {
        state.snapshot.sampled_at_ms = now_millis();
        state.snapshot.clone()
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
        if let Ok(probe) = result {
            state.snapshot.public_ip = Some(probe.public_ip);
            state.snapshot.country_code = probe.country_code;
            state.snapshot.latency_ms = Some(probe.latency_ms);
        }
        state.snapshot.clone()
    });

    if let Some(payload) = payload {
        emit_snapshot(app, payload);
    }
}

fn spawn_egress_probe(app: AppHandle, token: u64, socks_addr: String) {
    std::thread::spawn(move || {
        let result = probe_egress(&socks_addr);
        publish_probe_result(&app, token, result);
    });
}

pub fn spawn_watcher(app: AppHandle, manager: Arc<Mutex<AetherManager>>) {
    std::thread::spawn(move || {
        let mut session_open = false;
        let mut was_connected = false;
        let mut next_probe: Option<Instant> = None;

        loop {
            let status = match manager.lock() {
                Ok(manager) => manager.status(),
                Err(_) => return,
            };

            let (connected, tunneled, socks_addr) = match &status {
                ConnectionState::Connected { socks_addr, .. } => {
                    (true, false, Some(socks_addr.clone()))
                }
                ConnectionState::Tunneling { socks_addr, .. } => {
                    (true, true, Some(socks_addr.clone()))
                }
                _ => (false, false, None),
            };

            let terminal = matches!(
                &status,
                ConnectionState::Idle
                    | ConnectionState::Disconnecting
                    | ConnectionState::Error { .. }
            );

            if terminal && session_open {
                session_open = false;
                invalidate_probe();
                next_probe = None;
            }

            if connected {
                if !session_open {
                    session_open = true;
                    let raw = if tunneled {
                        traffic::current()
                    } else {
                        TrafficStats::default()
                    };
                    reset_session(&app, raw);
                    next_probe = None;
                } else if !was_connected && tunneled {
                    // Automatic reconnect can recreate the TUN interface and reset
                    // its OS counters. Preserve accumulated session totals while
                    // rebasing the raw counter used for future deltas.
                    if let Ok(mut state) = telemetry_state().lock() {
                        state.last_raw_traffic = traffic::current();
                    }
                }

                if tunneled {
                    add_traffic_sample(&app, traffic::current());
                } else {
                    touch_clock(&app);
                }

                let now = Instant::now();
                let should_probe = next_probe.map(|deadline| now >= deadline).unwrap_or(true);
                if should_probe {
                    next_probe = Some(now + PROBE_INTERVAL);
                    if let Some(socks_addr) = socks_addr {
                        let token = SESSION_TOKEN.load(Ordering::SeqCst);
                        spawn_egress_probe(app.clone(), token, socks_addr);
                    }
                }
                was_connected = true;
            } else {
                if was_connected && !terminal {
                    // Reject a late result from the route that just failed. The
                    // first connected sample after recovery starts a fresh probe.
                    invalidate_probe();
                    clear_egress(&app);
                    next_probe = None;
                }
                was_connected = false;
            }

            std::thread::sleep(SAMPLE_INTERVAL);
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
        .map_err(|error| format!("failed to launch curl telemetry probe: {error}"))?;
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
                    .all(|character| character.is_ascii_alphanumeric())
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
}
