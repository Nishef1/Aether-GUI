use crate::runtime_error::RuntimeError;
use std::process::Command;
use std::time::Duration;

pub const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
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

fn run_curl(args: &[String]) -> Result<String, RuntimeError> {
    let binary = if cfg!(windows) { "curl.exe" } else { "curl" };
    let mut command = Command::new(binary);
    command.args(args);
    no_window(&mut command);
    let output = command.output().map_err(|error| {
        RuntimeError::SystemTunnel(format!("could not run tunnel health probe: {error}"))
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim();
        return Err(RuntimeError::SystemTunnel(if detail.is_empty() {
            format!("network probe exited with {}", output.status)
        } else {
            format!("network probe exited with {}: {detail}", output.status)
        }));
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

fn probe(
    upstream_socks_addr: Option<&str>,
    family: AddressFamily,
) -> Result<TraceProbe, RuntimeError> {
    let mut args = vec![
        "--silent".into(),
        "--show-error".into(),
        "--fail".into(),
        "--max-time".into(),
        PROBE_TIMEOUT_SECS.into(),
        family.curl_flag().into(),
    ];
    if let Some(socks_addr) = upstream_socks_addr {
        args.push("--proxy".into());
        args.push(format!("socks5://{socks_addr}"));
    } else {
        args.push("--noproxy".into());
        args.push("*".into());
    }
    args.push(TRACE_URL.into());
    parse_trace(&run_curl(&args)?).ok_or_else(|| {
        RuntimeError::SystemTunnel(format!(
            "{} probe returned no public egress",
            family.label()
        ))
    })
}

fn traces_share_protected_path(system: &TraceProbe, socks: &TraceProbe) -> bool {
    system.ip == socks.ip || (system.is_warp_protected() && socks.is_warp_protected())
}

fn verify_family(upstream_socks_addr: &str, family: AddressFamily) -> FamilyVerification {
    let system = match probe(None, family) {
        Ok(trace) => trace,
        Err(error) => {
            return FamilyVerification::Unavailable(format!(
                "{} system probe unavailable: {error}",
                family.label()
            ));
        }
    };
    let socks = match probe(Some(upstream_socks_addr), family) {
        Ok(trace) => trace,
        Err(error) => {
            return FamilyVerification::Failed(format!(
                "{} system route exists but the Aether SOCKS path failed: {error}",
                family.label()
            ));
        }
    };

    if traces_share_protected_path(&system, &socks) {
        FamilyVerification::Verified
    } else if socks.is_warp_protected() && !system.is_warp_protected() {
        FamilyVerification::Failed(format!(
            "{} system egress bypassed WARP while the upstream SOCKS path was protected",
            family.label()
        ))
    } else {
        FamilyVerification::Failed(format!(
            "{} system egress could not be correlated with the protected SOCKS path",
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

/// Prove that every usable address family follows the same protected path as
/// Aether's SOCKS endpoint. Public addresses are compared in memory only and
/// never included in the returned diagnostic text.
pub fn verify(upstream_socks_addr: &str) -> Result<(), RuntimeError> {
    let ipv4 = verify_family(upstream_socks_addr, AddressFamily::V4);
    let ipv6 = verify_family(upstream_socks_addr, AddressFamily::V6);

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
    Err(RuntimeError::SystemTunnel(if details.is_empty() {
        "neither IPv4 nor IPv6 produced a verifiable system tunnel".into()
    } else {
        format!("system tunnel could not be verified: {details}")
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cloudflare_trace() {
        let trace = parse_trace("fl=1\nip=203.0.113.5\nwarp=on\n").unwrap();
        assert_eq!(trace.ip, "203.0.113.5");
        assert_eq!(trace.warp.as_deref(), Some("on"));
    }

    #[test]
    fn separate_warp_egress_ips_still_share_the_protected_path() {
        let system = TraceProbe {
            ip: "2001:db8::1".into(),
            warp: Some("on".into()),
        };
        let socks = TraceProbe {
            ip: "2001:db8::2".into(),
            warp: Some("plus".into()),
        };
        assert!(traces_share_protected_path(&system, &socks));
    }

    #[test]
    fn different_unprotected_addresses_are_rejected() {
        let system = TraceProbe {
            ip: "203.0.113.1".into(),
            warp: Some("off".into()),
        };
        let socks = TraceProbe {
            ip: "203.0.113.2".into(),
            warp: Some("off".into()),
        };
        assert!(!traces_share_protected_path(&system, &socks));
    }
}
