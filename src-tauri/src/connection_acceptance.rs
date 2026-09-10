use serde::Serialize;
use std::net::IpAddr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::io::Write;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::process::{Command, Stdio};

const BASELINE_TTL: Duration = Duration::from_secs(15 * 60);
const QUICK_DOWNLOAD_BYTES: u64 = 16 * 1024;
const QUICK_UPLOAD_BYTES: usize = 8 * 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AcceptanceStatus {
    #[default]
    Unverified,
    Protected,
    Degraded,
    LeakDetected,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct ConnectionAcceptanceReport {
    pub status: AcceptanceStatus,
    pub public_ipv4: Option<String>,
    pub public_ipv6: Option<String>,
    pub ipv4_protected: Option<bool>,
    pub ipv6_protected: Option<bool>,
    pub download_kbps: Option<u64>,
    pub upload_kbps: Option<u64>,
    pub upload_limited: bool,
    pub reason: Option<String>,
}

#[derive(Clone, Debug)]
struct UnderlayBaseline {
    network_key: Option<String>,
    captured_at: Instant,
    ipv4: Option<IpAddr>,
    ipv6: Option<IpAddr>,
}

static UNDERLAY: OnceLock<Mutex<Option<UnderlayBaseline>>> = OnceLock::new();

fn underlay_state() -> &'static Mutex<Option<UnderlayBaseline>> {
    UNDERLAY.get_or_init(|| Mutex::new(None))
}

fn family_matches(value: &IpAddr, ipv6: bool) -> bool {
    if ipv6 {
        value.is_ipv6()
    } else {
        value.is_ipv4()
    }
}

fn changed_identity(left: Option<IpAddr>, right: Option<IpAddr>) -> Option<bool> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left != right),
        _ => None,
    }
}

fn classify_upload_limited(download_kbps: u64, upload_kbps: u64) -> bool {
    download_kbps >= 384
        && upload_kbps < 96
        && upload_kbps.saturating_mul(8) < download_kbps
}

fn assess(
    baseline: Option<&UnderlayBaseline>,
    public_ipv4: Option<IpAddr>,
    public_ipv6: Option<IpAddr>,
    download_kbps: Option<u64>,
    upload_kbps: Option<u64>,
) -> ConnectionAcceptanceReport {
    let ipv4_protected = changed_identity(baseline.and_then(|value| value.ipv4), public_ipv4);
    let ipv6_protected = changed_identity(baseline.and_then(|value| value.ipv6), public_ipv6);
    let upload_limited = match (download_kbps, upload_kbps) {
        (Some(download), Some(upload)) => classify_upload_limited(download, upload),
        _ => false,
    };

    let leaked_v4 = ipv4_protected == Some(false);
    let leaked_v6 = ipv6_protected == Some(false);
    let has_tunnel_identity = public_ipv4.is_some() || public_ipv6.is_some();
    let has_baseline = baseline
        .map(|value| value.ipv4.is_some() || value.ipv6.is_some())
        .unwrap_or(false);

    let (status, reason) = if leaked_v4 || leaked_v6 {
        let family = match (leaked_v4, leaked_v6) {
            (true, true) => "IPv4 and IPv6",
            (true, false) => "IPv4",
            (false, true) => "IPv6",
            (false, false) => unreachable!(),
        };
        (
            AcceptanceStatus::LeakDetected,
            Some(format!(
                "{family} tunnel egress is identical to the public underlay address"
            )),
        )
    } else if upload_limited {
        (
            AcceptanceStatus::Degraded,
            Some("quick acceptance probe detected severe upstream throttling".to_string()),
        )
    } else if has_tunnel_identity && has_baseline {
        (AcceptanceStatus::Protected, None)
    } else {
        (
            AcceptanceStatus::Unverified,
            Some("public identity baseline or tunneled identity was unavailable".to_string()),
        )
    };

    ConnectionAcceptanceReport {
        status,
        public_ipv4: public_ipv4.map(|value| value.to_string()),
        public_ipv6: public_ipv6.map(|value| value.to_string()),
        ipv4_protected,
        ipv6_protected,
        download_kbps,
        upload_kbps,
        upload_limited,
        reason,
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn curl_command() -> Command {
    let command = if cfg!(windows) { "curl.exe" } else { "curl" };
    let mut process = Command::new(command);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        process.creation_flags(CREATE_NO_WINDOW);
    }
    process
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn direct_public_ip(url: &str, ipv6: bool) -> Option<IpAddr> {
    let mut command = curl_command();
    command.args([
        "-fsS",
        "--connect-timeout",
        "2",
        "--max-time",
        "3",
        if ipv6 { "-6" } else { "-4" },
        url,
    ]);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout)
        .trim()
        .lines()
        .next()?
        .trim()
        .parse::<IpAddr>()
        .ok()?;
    family_matches(&value, ipv6).then_some(value)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn proxy_public_ip(socks_addr: &str, url: &str, ipv6: bool) -> Option<IpAddr> {
    let mut command = curl_command();
    command
        .args([
            "-fsS",
            "--connect-timeout",
            "3",
            "--max-time",
            "5",
            "--proxy",
        ])
        .arg(format!("socks5h://{socks_addr}"))
        .arg(url);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout)
        .trim()
        .lines()
        .next()?
        .trim()
        .parse::<IpAddr>()
        .ok()?;
    family_matches(&value, ipv6).then_some(value)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn null_device() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn parse_speed_kbps(output: &str) -> Option<u64> {
    let bytes_per_second = output
        .lines()
        .find_map(|line| line.strip_prefix("__aether_speed="))?
        .trim()
        .parse::<f64>()
        .ok()?;
    if !bytes_per_second.is_finite() || bytes_per_second <= 0.0 {
        return None;
    }
    Some(((bytes_per_second * 8.0) / 1000.0).round().max(1.0) as u64)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn quick_download_kbps(socks_addr: &str) -> Option<u64> {
    let mut command = curl_command();
    command
        .args([
            "-fsS",
            "--connect-timeout",
            "3",
            "--max-time",
            "6",
            "--proxy",
        ])
        .arg(format!("socks5h://{socks_addr}"))
        .args([
            "--output",
            null_device(),
            "--write-out",
            "__aether_speed=%{speed_download}\n",
        ])
        .arg(format!(
            "https://speed.cloudflare.com/__down?bytes={QUICK_DOWNLOAD_BYTES}"
        ));
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_speed_kbps(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn quick_upload_kbps(socks_addr: &str) -> Option<u64> {
    let mut command = curl_command();
    command
        .args([
            "-fsS",
            "--connect-timeout",
            "3",
            "--max-time",
            "6",
            "--proxy",
        ])
        .arg(format!("socks5h://{socks_addr}"))
        .args([
            "--request",
            "POST",
            "--header",
            "Content-Type: application/octet-stream",
            "--data-binary",
            "@-",
            "--output",
            null_device(),
            "--write-out",
            "__aether_speed=%{speed_upload}\n",
            "https://speed.cloudflare.com/__up",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().ok()?;
    child
        .stdin
        .take()?
        .write_all(&vec![0u8; QUICK_UPLOAD_BYTES])
        .ok()?;
    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_speed_kbps(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn capture_underlay_baseline(network_key: Option<&str>) {
    if let Ok(state) = underlay_state().lock() {
        if let Some(current) = state.as_ref() {
            if current.captured_at.elapsed() < BASELINE_TTL
                && current.network_key.as_deref() == network_key
            {
                return;
            }
        }
    }

    let (ipv4, ipv6) = std::thread::scope(|scope| {
        let ipv4 = scope.spawn(|| {
            direct_public_ip("https://api4.ipify.org/", false)
                .or_else(|| direct_public_ip("https://checkip.amazonaws.com/", false))
        });
        let ipv6 = scope.spawn(|| direct_public_ip("https://api6.ipify.org/", true));
        (
            ipv4.join().ok().flatten(),
            ipv6.join().ok().flatten(),
        )
    });

    if let Ok(mut state) = underlay_state().lock() {
        *state = Some(UnderlayBaseline {
            network_key: network_key.map(str::to_owned),
            captured_at: Instant::now(),
            ipv4,
            ipv6,
        });
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn capture_underlay_baseline(_network_key: Option<&str>) {}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn probe_connection_acceptance(socks_addr: &str) -> ConnectionAcceptanceReport {
    let (public_ipv4, public_ipv6) = std::thread::scope(|scope| {
        let ipv4 = scope.spawn(|| proxy_public_ip(socks_addr, "https://api4.ipify.org/", false));
        let ipv6 = scope.spawn(|| proxy_public_ip(socks_addr, "https://api6.ipify.org/", true));
        (
            ipv4.join().ok().flatten(),
            ipv6.join().ok().flatten(),
        )
    });

    let baseline = underlay_state()
        .lock()
        .ok()
        .and_then(|state| state.clone());

    let download_kbps = quick_download_kbps(socks_addr);
    let upload_kbps = download_kbps.and_then(|_| quick_upload_kbps(socks_addr));

    assess(
        baseline.as_ref(),
        public_ipv4,
        public_ipv6,
        download_kbps,
        upload_kbps,
    )
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn probe_connection_acceptance(_socks_addr: &str) -> ConnectionAcceptanceReport {
    ConnectionAcceptanceReport {
        reason: Some("desktop acceptance probe is not used on mobile".to_string()),
        ..ConnectionAcceptanceReport::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn baseline(v4: &str, v6: Option<&str>) -> UnderlayBaseline {
        UnderlayBaseline {
            network_key: Some("test".to_string()),
            captured_at: Instant::now(),
            ipv4: Some(v4.parse().unwrap()),
            ipv6: v6.map(|value| value.parse().unwrap()),
        }
    }

    #[test]
    fn exact_ipv4_identity_match_is_a_hard_leak() {
        let underlay = baseline("198.51.100.7", None);
        let report = assess(
            Some(&underlay),
            Some("198.51.100.7".parse().unwrap()),
            None,
            Some(2_000),
            Some(500),
        );
        assert_eq!(report.status, AcceptanceStatus::LeakDetected);
        assert_eq!(report.ipv4_protected, Some(false));
    }

    #[test]
    fn changed_identity_is_protected() {
        let underlay = baseline("198.51.100.7", Some("2001:db8::7"));
        let report = assess(
            Some(&underlay),
            Some("203.0.113.9".parse().unwrap()),
            Some("2001:db8:1::9".parse().unwrap()),
            Some(2_000),
            Some(500),
        );
        assert_eq!(report.status, AcceptanceStatus::Protected);
        assert_eq!(report.ipv4_protected, Some(true));
        assert_eq!(report.ipv6_protected, Some(true));
    }

    #[test]
    fn severe_upstream_asymmetry_is_degraded_not_a_leak() {
        let underlay = baseline("198.51.100.7", None);
        let report = assess(
            Some(&underlay),
            Some("203.0.113.9".parse().unwrap()),
            None,
            Some(4_000),
            Some(80),
        );
        assert_eq!(report.status, AcceptanceStatus::Degraded);
        assert!(report.upload_limited);
    }

    #[test]
    fn missing_baseline_is_unverified_without_false_failure() {
        let report = assess(
            None,
            Some("203.0.113.9".parse().unwrap()),
            None,
            Some(2_000),
            Some(500),
        );
        assert_eq!(report.status, AcceptanceStatus::Unverified);
        assert!(!report.upload_limited);
    }
}
