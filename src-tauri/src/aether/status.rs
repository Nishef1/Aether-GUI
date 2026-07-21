use super::profiles::ScanMode;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

pub const DEFAULT_SOCKS_ADDR: &str = "127.0.0.1:1819";

pub fn parse_bind_address(addr: &str) -> SocketAddr {
    super::profiles::sanitize_bind_address(addr)
        .parse()
        .unwrap_or_else(|_| DEFAULT_SOCKS_ADDR.parse().unwrap())
}

fn probe_addr(listen: &SocketAddr) -> SocketAddr {
    if listen.ip().is_unspecified() {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), listen.port())
    } else {
        *listen
    }
}

/// The port is a readiness signal, not the sole long-term health signal. Newer
/// Aether cores perform their own data-plane validation before exposing SOCKS;
/// TUN mode adds an independent end-to-end system-path check on top.
pub fn port_is_live(addr: &SocketAddr) -> bool {
    TcpStream::connect_timeout(&probe_addr(addr), Duration::from_millis(300)).is_ok()
}

/// Aether core releases are independent from GUI releases, so the GUI must not
/// encode per-version scan budgets. This is only a generous stuck-process
/// watchdog; normal scan/reconnect policy belongs to the core itself.
pub fn connect_timeout(_scan_mode: &ScanMode) -> Duration {
    Duration::from_secs(15 * 60)
}

pub const GRACEFUL_SHUTDOWN_GRACE: Duration = Duration::from_secs(3);

pub const MAX_AUTO_RETRIES: u32 = 3;
pub const RETRY_BACKOFF: [Duration; MAX_AUTO_RETRIES as usize] = [
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(10),
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    #[test]
    fn unsafe_bind_is_sanitized() {
        assert_eq!(parse_bind_address("0.0.0.0:1919"), "127.0.0.1:1919".parse().unwrap());
        assert_eq!(parse_bind_address("not-an-addr"), DEFAULT_SOCKS_ADDR.parse().unwrap());
    }

    #[test]
    fn port_is_live_detects_listener() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            let _ = listener.accept();
        });
        assert!(port_is_live(&addr));
        let dead: SocketAddr = format!("127.0.0.1:{}", addr.port().wrapping_add(1).max(20000))
            .parse()
            .unwrap();
        if TcpStream::connect_timeout(&dead, Duration::from_millis(50)).is_err() {
            assert!(!port_is_live(&dead));
        }
    }

    #[test]
    fn watchdog_is_version_agnostic_and_generous() {
        assert_eq!(connect_timeout(&ScanMode::Turbo), Duration::from_secs(900));
        assert_eq!(connect_timeout(&ScanMode::Ironclad), Duration::from_secs(900));
    }
}
