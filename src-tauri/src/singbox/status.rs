use crate::error::AetherError;
use std::process::Command;
use std::time::Duration;

pub const TUN_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
pub const TUN_HEALTH_INTERVAL: Duration = Duration::from_secs(60);
pub const MAX_CONSECUTIVE_HEALTH_FAILURES: u32 = 3;
const PROBE_TIMEOUT_SECS: &str = "8";
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
        return Err(AetherError::TunHealthFailed(format!(
            "network probe exited with {}",
            output.status
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_ip(body: &str) -> Option<String> {
    body.lines()
        .find_map(|line| line.strip_prefix("ip="))
        .map(|value| value.trim().to_string())
}

fn probe(port: Option<u16>, family: AddressFamily) -> Result<String, AetherError> {
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
            args.push(format!("socks5h://127.0.0.1:{port}"));
        }
        None => {
            args.push("--noproxy".into());
            args.push("*".into());
        }
    }
    args.push(TRACE_URL.into());
    parse_ip(&run_curl(&args)?).ok_or_else(|| {
        AetherError::TunHealthFailed(format!("{} probe returned no public egress", family.label()))
    })
}

fn verify_family(port: u16, family: AddressFamily) -> Result<bool, AetherError> {
    let system = match probe(None, family) {
        Ok(ip) => ip,
        Err(_) => return Ok(false),
    };
    let socks = probe(Some(port), family).map_err(|_| {
        AetherError::TunHealthFailed(format!(
            "{} has system egress but the Aether SOCKS path failed",
            family.label()
        ))
    })?;
    if system == socks {
        Ok(true)
    } else {
        Err(AetherError::TunHealthFailed(format!(
            "{} system egress does not match the Aether SOCKS egress; possible TUN bypass",
            family.label()
        )))
    }
}

/// Verify every address family that the host can actually use. A family with no
/// system egress is ignored; a family with egress must match the Aether SOCKS
/// egress exactly. Public IP values are used only in memory and never included
/// in persistent diagnostics.
pub fn verify_tunnel(aether_socks_port: u16) -> Result<(), AetherError> {
    let ipv4_verified = verify_family(aether_socks_port, AddressFamily::V4)?;
    let ipv6_verified = verify_family(aether_socks_port, AddressFamily::V6)?;
    if ipv4_verified || ipv6_verified {
        Ok(())
    } else {
        Err(AetherError::TunHealthFailed(
            "neither IPv4 nor IPv6 produced a verifiable tunneled data path".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_trace_ip_without_exposing_it_in_errors() {
        assert_eq!(
            parse_ip("fl=1\nip=203.0.113.5\nwarp=on\n").as_deref(),
            Some("203.0.113.5")
        );
        assert_eq!(parse_ip("fl=1\nwarp=off\n"), None);
    }
}
