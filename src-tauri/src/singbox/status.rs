use crate::error::AetherError;
use std::process::Command;
use std::time::Duration;

pub const TUN_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
pub const TUN_HEALTH_INTERVAL: Duration = Duration::from_secs(30);
pub const MAX_CONSECUTIVE_HEALTH_FAILURES: u32 = 3;
const PROBE_TIMEOUT_SECS: &str = "8";
const TRACE_URL: &str = "https://www.cloudflare.com/cdn-cgi/trace";

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

fn parse_ip(body: &str) -> Option<String> {
    body.lines()
        .find_map(|line| line.strip_prefix("ip="))
        .map(|value| value.trim().to_string())
}

fn socks_ip(port: u16) -> Result<String, AetherError> {
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
    parse_ip(&run_curl(&args)?)
        .ok_or_else(|| AetherError::TunHealthFailed("SOCKS probe returned no public IP".into()))
}

fn system_ip() -> Result<String, AetherError> {
    let args = vec![
        "--silent".into(),
        "--show-error".into(),
        "--fail".into(),
        "--max-time".into(),
        PROBE_TIMEOUT_SECS.into(),
        // Ignore user-level proxy environment variables. This request must be
        // captured by the operating-system TUN route itself.
        "--noproxy".into(),
        "*".into(),
        TRACE_URL.into(),
    ];
    parse_ip(&run_curl(&args)?)
        .ok_or_else(|| AetherError::TunHealthFailed("system probe returned no public IP".into()))
}

/// Verify the complete path instead of treating an alive sing-box process as
/// proof of connectivity. A direct system request must leave through the exact
/// same public egress IP as an explicit request through Aether's SOCKS proxy.
/// We intentionally do not accept a generic `warp=on` signal because another
/// independently-running WARP client could otherwise create a false positive.
pub fn verify_tunnel(aether_socks_port: u16) -> Result<(), AetherError> {
    let via_socks = socks_ip(aether_socks_port)?;
    let via_system = system_ip()?;

    if via_socks == via_system {
        Ok(())
    } else {
        Err(AetherError::TunHealthFailed(format!(
            "system traffic bypassed the Aether TUN (SOCKS IP {via_socks}, system IP {via_system})"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cloudflare_trace_ip() {
        assert_eq!(
            parse_ip("fl=1\nip=203.0.113.5\nwarp=on\n").as_deref(),
            Some("203.0.113.5")
        );
        assert_eq!(parse_ip("fl=1\nwarp=off\n"), None);
    }
}
