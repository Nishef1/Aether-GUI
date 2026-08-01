#!/usr/bin/env python3

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MASQUE_MARKER = "Android auto H2 latency window"
MASQUE_ORDER_MARKER = "Android documented MASQUE ingress order"
WG_MARKER = "Android bounded official WARP scan"
WG_RUNTIME_MARKER = "Android WireGuard transient receive policy"


def target_root(argument: str | None) -> Path:
    return Path(argument).resolve() if argument else ROOT


def replace_pattern(
    source: str,
    pattern: str,
    replacement: str,
    label: str,
) -> str:
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.DOTALL)
    if count != 1:
        raise SystemExit(f"could not patch {label}; expected exactly one source block")
    return updated


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"could not patch {label}; expected exactly one source block, found {count}")
    return source.replace(old, new, 1)


root = target_root(sys.argv[1] if len(sys.argv) > 1 else None)
core = root / "vendor/aether/aether/src"
prober_path = core / "prober.rs"
wg_prober_path = core / "wg_prober.rs"
wireguard_path = core / "wireguard.rs"

for path in (prober_path, wg_prober_path, wireguard_path):
    if not path.is_file():
        raise SystemExit(f"Aether source file was not found: {path}")

prober = prober_path.read_text(encoding="utf-8")
if MASQUE_ORDER_MARKER not in prober:
    prober = replace_pattern(
        prober,
        r"pub const MASQUE_CIDRS_V4: &\[&str\] = &\[.*?\n\];",
        '''// Android documented MASQUE ingress order: probe the current ingress
// range first, then the proven consumer compatibility pools. This preserves the
// fork's deliberately bounded list while adopting Aether v1.5.0 scan priority.
pub const MASQUE_CIDRS_V4: &[&str] = &[
    "162.159.197.0/24",
    "162.159.198.0/24",
    "162.159.192.0/24",
];''',
        "MASQUE IPv4 ingress order",
    )
    prober = replace_pattern(
        prober,
        r"pub const MASQUE_SEEDS: &\[&str\] = &\[.*?\n\];",
        '''pub const MASQUE_SEEDS: &[&str] = &[
    "162.159.197.3",
    "162.159.197.1",
    "162.159.198.2",
    "162.159.198.1",
    "162.159.192.1",
];''',
        "MASQUE seed order",
    )

if MASQUE_MARKER not in prober:
    prober = replace_pattern(
        prober,
        r"ScanMode::Turbo => Strategy \{.*?\n\s*\},\n\s*ScanMode::Balanced => Strategy \{",
        '''ScanMode::Turbo => Strategy {
                // Android auto H2 latency window: wait briefly after the first
                // verified gateway so Auto can choose the lowest-latency result
                // without turning a normal connection into a long scan.
                concurrency: 20,
                per_probe_timeout: Duration::from_secs(4),
                overall_deadline: Duration::from_secs(8),
                settle_after_target: Duration::from_millis(650),
                target_successes: 1,
                early_exit_first: false,
                sample_per_cidr: 24,
                finalists: 4,
                finalist_attempts: 1,
                secondary_port_passes: 0,
                include_compat_ranges: false,
            },
            ScanMode::Balanced => Strategy {''',
        "MASQUE Turbo strategy",
    )

wg_prober = wg_prober_path.read_text(encoding="utf-8")
if WG_MARKER not in wg_prober:
    wg_prober = replace_pattern(
        wg_prober,
        r"WgScanMode::Ironclad => WgStrategy \{.*?\n\s*\},\n\s*\}\n\s*\}",
        '''WgScanMode::Ironclad => WgStrategy {
                // Android bounded official WARP scan: explicit WireGuard/Gool
                // still require real HTTP egress, but should fail clearly rather
                // than cycling through thousands of compatibility endpoints.
                concurrency: 8,
                per_probe_timeout: Duration::from_secs(8),
                overall_deadline: Duration::from_secs(60),
                settle_after_target: Duration::from_secs(2),
                target_successes: 6,
                early_exit_first: false,
                sample_per_cidr: 64,
                finalists: 4,
                finalist_attempts: 2,
                include_compatibility: false,
                compatibility_ports: 0,
            },
        }
    }''',
        "WireGuard Ironclad strategy",
    )

wireguard = wireguard_path.read_text(encoding="utf-8")
if WG_RUNTIME_MARKER not in wireguard:
    wireguard = replace_once(
        wireguard,
        '''const WG_MSG_TYPE_MIN: u8 = 1;
const WG_MSG_TYPE_MAX: u8 = 4;
''',
        '''const WG_MSG_TYPE_MIN: u8 = 1;
const WG_MSG_TYPE_MAX: u8 = 4;

// Android WireGuard transient receive policy: connected UDP sockets can report
// temporary ICMP/network errors during handoff. Keep the authenticated runtime
// alive for a bounded retry window instead of tearing the whole VPN down.
const MAX_TRANSIENT_RECV_ERRORS: u32 = 64;
const TRANSIENT_RECV_BACKOFF: Duration = Duration::from_millis(50);

pub fn is_transient_socket_error(error: &std::io::Error) -> bool {
    use std::io::ErrorKind;

    matches!(
        error.kind(),
        ErrorKind::ConnectionRefused
            | ErrorKind::ConnectionReset
            | ErrorKind::ConnectionAborted
            | ErrorKind::HostUnreachable
            | ErrorKind::NetworkUnreachable
            | ErrorKind::Interrupted
            | ErrorKind::WouldBlock
            | ErrorKind::TimedOut
    )
}

struct TaskGuard(Vec<tokio::task::AbortHandle>);

impl Drop for TaskGuard {
    fn drop(&mut self) {
        for handle in self.0.drain(..) {
            handle.abort();
        }
    }
}
''',
        "WireGuard transient error helpers",
    )
    wireguard = replace_once(
        wireguard,
        '''        let recv_task = tokio::spawn(async move {
            let mut buffer = vec![0u8; MAX_PACKET];
            let mut temporary = vec![0u8; MAX_PACKET];
            loop {
                let read = sock_r.recv(&mut buffer).await.map_err(|error| {
                    AetherError::Other(format!("wireguard receive failed: {error}"))
                })?;
                strip_client_id(&mut buffer[..read]);
''',
        '''        let recv_task = tokio::spawn(async move {
            let mut buffer = vec![0u8; MAX_PACKET];
            let mut temporary = vec![0u8; MAX_PACKET];
            let mut transient_errors = 0u32;
            loop {
                let read = match sock_r.recv(&mut buffer).await {
                    Ok(read) => {
                        transient_errors = 0;
                        read
                    }
                    Err(error) if is_transient_socket_error(&error) => {
                        transient_errors = transient_errors.saturating_add(1);
                        if transient_errors > MAX_TRANSIENT_RECV_ERRORS {
                            return Err(AetherError::Other(format!(
                                "wireguard receive failed after {transient_errors} transient errors: {error}"
                            )));
                        }
                        log::debug!(
                            "wireguard transient receive error: {error}; retrying ({transient_errors}/{MAX_TRANSIENT_RECV_ERRORS})"
                        );
                        tokio::time::sleep(TRANSIENT_RECV_BACKOFF).await;
                        continue;
                    }
                    Err(error) => {
                        return Err(AetherError::Other(format!(
                            "wireguard receive failed: {error}"
                        )));
                    }
                };
                strip_client_id(&mut buffer[..read]);
''',
        "WireGuard receive retry loop",
    )
    wireguard = replace_once(
        wireguard,
        '''        let recv_abort = recv_task.abort_handle();
        let send_abort = send_task.abort_handle();
        let timer_abort = timer_task.abort_handle();
        let health_abort = health_task.abort_handle();

        let result = tokio::select! {
            result = recv_task => flatten_task_result("receive", result),
            result = send_task => flatten_task_result("send", result),
            result = timer_task => flatten_task_result("timer", result),
            result = health_task => flatten_task_result("health", result),
        };

        recv_abort.abort();
        send_abort.abort();
        timer_abort.abort();
        health_abort.abort();
        result
''',
        '''        let _task_guard = TaskGuard(vec![
            recv_task.abort_handle(),
            send_task.abort_handle(),
            timer_task.abort_handle(),
            health_task.abort_handle(),
        ]);

        tokio::select! {
            result = recv_task => flatten_task_result("receive", result),
            result = send_task => flatten_task_result("send", result),
            result = timer_task => flatten_task_result("timer", result),
            result = health_task => flatten_task_result("health", result),
        }
''',
        "WireGuard task cancellation guard",
    )
    if "transient_udp_errors_do_not_end_the_runtime" not in wireguard:
        wireguard = replace_pattern(
            wireguard,
            r"\n}\s*$",
            '''

    #[test]
    fn transient_udp_errors_do_not_end_the_runtime() {
        for kind in [
            std::io::ErrorKind::ConnectionRefused,
            std::io::ErrorKind::ConnectionReset,
            std::io::ErrorKind::ConnectionAborted,
            std::io::ErrorKind::HostUnreachable,
            std::io::ErrorKind::NetworkUnreachable,
            std::io::ErrorKind::Interrupted,
            std::io::ErrorKind::WouldBlock,
            std::io::ErrorKind::TimedOut,
        ] {
            assert!(is_transient_socket_error(&std::io::Error::from(kind)));
        }
    }

    #[test]
    fn broken_or_invalid_sockets_remain_fatal() {
        for kind in [
            std::io::ErrorKind::NotConnected,
            std::io::ErrorKind::AddrNotAvailable,
            std::io::ErrorKind::PermissionDenied,
            std::io::ErrorKind::InvalidInput,
        ] {
            assert!(!is_transient_socket_error(&std::io::Error::from(kind)));
        }
    }
}
''',
            "WireGuard transient error tests",
        )

if WG_MARKER not in wireguard:
    replacement = '''// Android bounded official WARP scan: consumer WARP uses the documented
// ingress pool and the four documented WireGuard UDP ports. Compatibility
// ranges remain an upstream concern and are not scanned by the mobile build.
pub const WG_PREFIXES_V4: &[&str] = &["162.159.192.0/24"];
pub const WG_PRIMARY_PREFIXES_V4: &[&str] = WG_PREFIXES_V4;
pub const WG_PREFIXES_V6: &[&str] = &["2606:4700:100::/48"];
pub const WG_PRIMARY_PREFIXES_V6: &[&str] = WG_PREFIXES_V6;

pub const WG_PORTS: &[u16] = &[2408, 500, 1701, 4500];
pub const WG_PRIMARY_PORTS: &[u16] = WG_PORTS;

pub const WG_SEEDS_V4: &[&str] = &["162.159.192.1", "162.159.192.2"];

pub const WG_SEEDS_V6: &[&str] = &["2606:4700:100::1"];'''
    wireguard = replace_pattern(
        wireguard,
        r"pub const WG_PREFIXES_V4:.*?pub const WG_SEEDS_V6:.*?\n\];",
        replacement,
        "official WireGuard ranges and ports",
    )

for name, source, marker in (
    ("prober.rs", prober, MASQUE_MARKER),
    ("prober.rs", prober, MASQUE_ORDER_MARKER),
    ("wg_prober.rs", wg_prober, WG_MARKER),
    ("wireguard.rs", wireguard, WG_MARKER),
    ("wireguard.rs", wireguard, WG_RUNTIME_MARKER),
):
    if marker not in source:
        raise SystemExit(f"{name}: mobile network policy marker is missing")

if "early_exit_first: false" not in prober or "Duration::from_millis(650)" not in prober:
    raise SystemExit("MASQUE Auto latency sampling policy was not applied")
if 'MASQUE_CIDRS_V4: &[&str] = &[\n    "162.159.197.0/24"' not in prober:
    raise SystemExit("documented MASQUE IPv4 ingress is not first")
if 'MASQUE_SEEDS: &[&str] = &[\n    "162.159.197.3"' not in prober:
    raise SystemExit("documented live MASQUE seed is not first")
if "overall_deadline: Duration::from_secs(60)" not in wg_prober:
    raise SystemExit("bounded WireGuard Ironclad deadline was not applied")
if "188.114.96.0/24" in wireguard or "854," in wireguard:
    raise SystemExit("legacy WireGuard compatibility ranges or ports remain")
if "pub const WG_PORTS: &[u16] = &[2408, 500, 1701, 4500];" not in wireguard:
    raise SystemExit("official WireGuard port set was not applied")
if "is_transient_socket_error" not in wireguard or "TaskGuard(vec![" not in wireguard:
    raise SystemExit("WireGuard runtime resilience policy was not applied")
if "transient_udp_errors_do_not_end_the_runtime" not in wireguard:
    raise SystemExit("WireGuard transient error tests were not added")

prober_path.write_text(prober, encoding="utf-8")
wg_prober_path.write_text(wg_prober, encoding="utf-8")
wireguard_path.write_text(wireguard, encoding="utf-8")
print(f"Applied Android mobile transport discovery and WireGuard runtime policy in {core}")
