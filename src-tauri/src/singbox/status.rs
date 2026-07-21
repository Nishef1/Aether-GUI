use crate::error::AetherError;
use std::process::Command;
use std::time::Duration;

pub const TUN_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
pub const TUN_HEALTH_INTERVAL: Duration = Duration::from_secs(15);
pub const MAX_CONSECUTIVE_HEALTH_FAILURES: u32 = 3;
const PROBE_TIMEOUT_SECS: &str = "8";
const TRACE_URL: &str = "https://www.cloudflare.com/cdn-cgi/trace";

#[derive(Debug)]
struct Trace {
    ip: Option<String>,
    warp: Option<String>,
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
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AetherError::TunHealthFailed(if stderr.is_empty() {
            format!("curl exited with {}", output.status)
        } else {
            stderr
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_trace(body: &str) -> Trace {
    let mut trace = Trace { ip: None, warp: None };
    for line in body.lines() {
        if let Some(value) = line.strip_prefix("ip=") {
            trace.ip = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("warp=") {
            trace.warp = Some(value.trim().to_string());
        }
    }
    trace
}

fn socks_trace(port: u16) -> Result<Trace, AetherError> {
    let args = vec![
        "--silent".into(),
        "--show-error".into(),
        "--fail".into(),
        "--max-time".into(),
        PROBE_TIMEOUT_SECS.into(),
        "--proxy".into(),
        format!("socks5h://127.0.0.1:{port}"),
        TRACE_URL.into(),
    ];
    Ok(parse_trace(&run_curl(&args)?))
}

fn system_trace() -> Result<Trace, AetherError> {
    let args = vec![
        "--silent".into(),
        "--show-error".into(),
        "--fail".into(),
        "--max-time".into(),
        PROBE_TIMEOUT_SECS.into(),
        // Ignore HTTP(S)/ALL_PROXY environment variables. The request must be
        // captured by the OS TUN route itself, otherwise this probe could pass
        // while the system-wide route is actually broken.
        "--noproxy".into(),
        "*".into(),
        TRACE_URL.into(),
    ];
    Ok(parse_trace(&run_curl(&args)?))
}

/// Verify the complete path instead of treating an alive sing-box process as
/// proof of connectivity. We compare an explicit request through Aether SOCKS
/// with a normal system request that must be intercepted by the TUN route.
pub fn verify_tunnel(aether_socks_port: u16) -> Result<(), AetherError> {
    let via_socks = socks_trace(aether_socks_port)?;
    let via_system = system_trace()?;

    let socks_ip = via_socks.ip.as_deref().ok_or_else(|| {
        AetherError::TunHealthFailed("SOCKS probe returned no public IP".into())
    })?;
    let system_ip = via_system.ip.as_deref().ok_or_else(|| {
        AetherError::TunHealthFailed("system probe returned no public IP".into())
    })?;

    let same_ip = socks_ip == system_ip;
    // Cloudflare may occasionally return different anycast egress IPs between
    // two close requests. A matching non-off WARP state is a secondary signal.
    let same_active_warp = via_socks.warp.as_deref() == via_system.warp.as_deref()
        && via_socks.warp.as_deref().is_some_and(|value| value != "off");

    if same_ip || same_active_warp {
        Ok(())
    } else {
        Err(AetherError::TunHealthFailed(format!(
            "system traffic bypassed the tunnel (SOCKS IP {socks_ip}, system IP {system_ip})"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cloudflare_trace_fields() {
        let trace = parse_trace("fl=1\nip=203.0.113.5\nwarp=on\n");
        assert_eq!(trace.ip.as_deref(), Some("203.0.113.5"));
        assert_eq!(trace.warp.as_deref(), Some("on"));
    }
}
