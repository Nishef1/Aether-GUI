use crate::error::AetherError;
use std::process::Command;
use std::time::Duration;

pub const TUN_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
pub const TUN_HEALTH_INTERVAL: Duration = Duration::from_secs(60);
pub const MAX_CONSECUTIVE_HEALTH_FAILURES: u32 = 3;
const PROBE_TIMEOUT_SECS: &str = "6";
const TRACE_URL: &str = "https://www.cloudflare.com/cdn-cgi/trace";

#[derive(Clone, Copy)]
enum AddressFamily {
    V4,
    V6,
}

impl AddressFamily {
    fn curl_flag(self) -> &'static str {
        match self {
            Self::V4 => "--ipv4",
            Self::V6 => "--ipv6",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::V4 => "IPv4",
            Self::V6 => "IPv6",
        }
    }
}

#[derive(Debug)]
enum FamilyVerification {
    Verified,
    Unavailable(String),
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TraceProbe {
    ip: String,
    warp: Option<String>,
}

impl TraceProbe {
    fn is_warp_protected(&self) -> bool {
        matches!(self.warp.as_deref(), Some("on" | "plus"))
    }
}

fn no_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn run_curl(args: &[String]) -> Result<String, AetherError> {
    let binary = if cfg!(windows) { "curl.exe" } else { "curl" };
    let mut command = Command::new(binary);
    command.args(args);
    no_window(&mut command);
    let output = command
        .output()
        .map_err(|e| AetherError::TunHealthFailed(format!("could not run curl: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim();
        let suffix = if detail.is_empty() {
            String::new()
        } else {
            format!(": {detail}")
        };
        return Err(AetherError::TunHealthFailed(format!(
            "network probe exited with {}{suffix}",
            output.status
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_trace(body: &str) -> Option<TraceProbe> {
    let mut ip = None;
    let mut warp = None;

    for line in body.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key {
            "ip" => ip = Some(value.trim().to_string()),
            "warp" => warp = Some(value.trim().to_ascii_lowercase()),
            _ => {}
        }
    }

    ip.map(|ip| TraceProbe { ip, warp })
}

fn probe(port: Option<u16>, family: AddressFamily) -> Result<TraceProbe, AetherError> {
    let mut args = vec![
        "--silent".into(),
        "--show-error".into(),
        "--fail".into(),
        "--max-time".into(),
        PROBE_TIMEOUT_SECS.into(),
        family.curl_flag().into(),
    ];
    match port {
        Some(port) => {
            args.push("--proxy".into());
            // Use local resolution here instead of socks5h. Aether's SOCKS
            // domain resolver is intentionally simple and currently resolves A
            // records; forcing remote hostname resolution can therefore make an
            // otherwise healthy IPv6 tunnel fail its verification. With TUN DNS
            // hijacking enabled, local resolution itself is still exercised over
            // the protected data path before curl connects through SOCKS.
            args.push(format!("socks5://127.0.0.1:{port}"));
        }
        None => {
            // Ignore conventional HTTP(S)_PROXY environment settings. This probe
            // must exercise the operating system route installed by the TUN.
            args.push("--noproxy".into());
            args.push("*".into());
        }
    }
    args.push(TRACE_URL.into());
    parse_trace(&run_curl(&args)?).ok_or_else(|| {
        AetherError::TunHealthFailed(format!(
            "{} probe returned no public egress",
            family.label()
        ))
    })
}

fn traces_share_protected_path(system: &TraceProbe, socks: &TraceProbe) -> bool {
    // Exact public-IP equality is strong evidence, but it is not a requirement:
    // two independent flows through the same Cloudflare WARP tunnel can be
    // presented with different public IPv6 egress addresses. Cloudflare's trace
    // endpoint exposes the WARP state explicitly, so two protected WARP results
    // are sufficient to prove that both probes are on the protected data path.
    system.ip == socks.ip || (system.is_warp_protected() && socks.is_warp_protected())
}

fn verify_family(port: u16, family: AddressFamily) -> FamilyVerification {
    let system = match probe(None, family) {
        Ok(trace) => trace,
        Err(error) => {
            return FamilyVerification::Unavailable(format!(
                "{} system probe unavailable: {error}",
                family.label()
            ));
        }
    };

    let socks = match probe(Some(port), family) {
        Ok(trace) => trace,
        Err(error) => {
            return FamilyVerification::Failed(format!(
                "{} has system egress but the Aether SOCKS path failed: {error}",
                family.label()
            ));
        }
    };

    if traces_share_protected_path(&system, &socks) {
        FamilyVerification::Verified
    } else if socks.is_warp_protected() && !system.is_warp_protected() {
        FamilyVerification::Failed(format!(
            "{} system egress is not WARP-protected while the Aether SOCKS path is; possible TUN bypass",
            family.label()
        ))
    } else {
        FamilyVerification::Failed(format!(
            "{} system egress could not be correlated with the protected Aether SOCKS path",
            family.label()
        ))
    }
}

fn verification_detail(result: &FamilyVerification) -> Option<&str> {
    match result {
        FamilyVerification::Verified => None,
        FamilyVerification::Unavailable(detail) | FamilyVerification::Failed(detail) => {
            Some(detail.as_str())
        }
    }
}

/// Verify every address family the host can actually use. A family whose system
/// probe is unavailable is ignored when another family is proven healthy. Public
/// IP values are used only in memory and are never included in diagnostics.
pub fn verify_tunnel(aether_socks_port: u16) -> Result<(), AetherError> {
    let ipv4 = verify_family(aether_socks_port, AddressFamily::V4);
    let ipv6 = verify_family(aether_socks_port, AddressFamily::V6);

    let has_verified = matches!(&ipv4, FamilyVerification::Verified)
        || matches!(&ipv6, FamilyVerification::Verified);
    let has_failed = matches!(&ipv4, FamilyVerification::Failed(_))
        || matches!(&ipv6, FamilyVerification::Failed(_));

    if has_verified && !has_failed {
        return Ok(());
    }

    let details = [verification_detail(&ipv4), verification_detail(&ipv6)]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("; ");

    let message = if details.is_empty() {
        "neither IPv4 nor IPv6 produced a verifiable tunneled data path".into()
    } else {
        format!("TUN data path could not be verified: {details}")
    };
    Err(AetherError::TunHealthFailed(message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_trace_without_exposing_values_in_errors() {
        let trace = parse_trace("fl=1\nip=203.0.113.5\nwarp=on\n").unwrap();
        assert_eq!(trace.ip, "203.0.113.5");
        assert_eq!(trace.warp.as_deref(), Some("on"));
        assert!(trace.is_warp_protected());
    }

    #[test]
    fn different_warp_egress_ips_still_share_a_protected_path() {
        let system = TraceProbe {
            ip: "2001:db8::1".into(),
            warp: Some("on".into()),
        };
        let socks = TraceProbe {
            ip: "2001:db8::2".into(),
            warp: Some("on".into()),
        };
        assert!(traces_share_protected_path(&system, &socks));
    }

    #[test]
    fn differing_unprotected_egress_is_not_accepted() {
        let system = TraceProbe {
            ip: "203.0.113.10".into(),
            warp: Some("off".into()),
        };
        let socks = TraceProbe {
            ip: "203.0.113.11".into(),
            warp: Some("off".into()),
        };
        assert!(!traces_share_protected_path(&system, &socks));
    }

    #[test]
    fn verification_details_never_include_verified_values() {
        assert!(verification_detail(&FamilyVerification::Verified).is_none());
        assert_eq!(
            verification_detail(&FamilyVerification::Unavailable("no v6".into())),
            Some("no v6")
        );
    }
}
