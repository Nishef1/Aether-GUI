use super::profiles::ScanMode;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

pub const DEFAULT_SOCKS_ADDR: &str = "127.0.0.1:1819";

pub fn parse_bind_address(addr: &str) -> SocketAddr {
    addr.parse()
        .unwrap_or_else(|_| DEFAULT_SOCKS_ADDR.parse().unwrap())
}

/// When Aether listens on 0.0.0.0, we probe 127.0.0.1 instead.
fn probe_addr(listen: &SocketAddr) -> SocketAddr {
    if listen.ip().is_unspecified() {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), listen.port())
    } else {
        *listen
    }
}

/// Ground-truth "are we connected" signal: TCP connect to SOCKS5 port.
pub fn port_is_live(addr: &SocketAddr) -> bool {
    TcpStream::connect_timeout(&probe_addr(addr), Duration::from_millis(300)).is_ok()
}

/// Aether v1.5 scan budgets are 45/120/300/180/180 seconds. The GUI waits
/// only a small fixed establishment margin beyond each core budget, preventing
/// a dead process or prompt regression from leaving the UI spinning for
/// several extra minutes.
pub fn connect_timeout(scan_mode: &ScanMode) -> Duration {
    Duration::from_secs(match scan_mode {
        ScanMode::Turbo => 60,
        ScanMode::Balanced => 135,
        ScanMode::Thorough => 315,
        ScanMode::Stealth => 195,
        ScanMode::Ironclad => 195,
    })
}

/// How long to wait after sending Ctrl-C before force-killing. Aether does not
/// consistently exit quickly on SIGINT, and this GUI process owns no elevated
/// TUN resource that would make a hard kill unsafe.
pub const GRACEFUL_SHUTDOWN_GRACE: Duration = Duration::from_secs(3);

/// A failed first Turbo scan gets one safer Balanced fallback. Other initial
/// scans fail visibly instead of repeating the same long scan in a loop.
pub const INITIAL_TURBO_FALLBACK_BACKOFF: Duration = Duration::from_secs(1);

/// Once a connection has actually worked, transient drops may be retried with
/// backoff. This budget is deliberately separate from initial scan failure.
pub const MAX_POST_CONNECT_RETRIES: u32 = 3;
pub const POST_CONNECT_RETRY_BACKOFF: [Duration; MAX_POST_CONNECT_RETRIES as usize] = [
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
    fn parse_valid_and_invalid() {
        assert_eq!(
            parse_bind_address("127.0.0.1:1919"),
            "127.0.0.1:1919".parse().unwrap()
        );
        assert_eq!(
            parse_bind_address("0.0.0.0:1819"),
            "0.0.0.0:1819".parse().unwrap()
        );
        assert_eq!(
            parse_bind_address("0.0.0.0:9999"),
            "0.0.0.0:9999".parse().unwrap()
        );
        assert_eq!(
            parse_bind_address("127.0.0.1:"),
            DEFAULT_SOCKS_ADDR.parse().unwrap()
        );
        assert_eq!(
            parse_bind_address("not-an-addr"),
            DEFAULT_SOCKS_ADDR.parse().unwrap()
        );
    }

    #[test]
    fn probe_addr_rewrites_unspecified() {
        let any: SocketAddr = "0.0.0.0:1919".parse().unwrap();
        assert_eq!(probe_addr(&any), "127.0.0.1:1919".parse().unwrap());
        let loopback: SocketAddr = "127.0.0.1:1919".parse().unwrap();
        assert_eq!(probe_addr(&loopback), loopback);
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
    fn port_is_live_probes_loopback_when_bound_any() {
        let listener = TcpListener::bind("0.0.0.0:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            let _ = listener.accept();
        });
        let any = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), addr.port());
        assert!(
            port_is_live(&any),
            "should probe 127.0.0.1 when listen is 0.0.0.0"
        );
    }

    #[test]
    fn connect_timeout_exceeds_core_scan_budgets_without_large_slack() {
        let budgets = [
            (ScanMode::Turbo, 45),
            (ScanMode::Balanced, 120),
            (ScanMode::Thorough, 300),
            (ScanMode::Stealth, 180),
            (ScanMode::Ironclad, 180),
        ];
        for (mode, budget) in budgets {
            let timeout = connect_timeout(&mode);
            assert!(timeout > Duration::from_secs(budget));
            assert!(timeout <= Duration::from_secs(budget + 15));
        }
    }
}
