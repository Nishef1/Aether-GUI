use super::profiles::{ConnectionProfile, Protocol, ScanMode};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

pub const DEFAULT_SOCKS_ADDR: &str = "127.0.0.1:1819";
const ESTABLISHMENT_MARGIN: Duration = Duration::from_secs(15);

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

/// Ground-truth local readiness signal: TCP connect to the SOCKS5 listener.
/// System-wide protection is verified separately by the system-tunnel adapter.
pub fn port_is_live(addr: &SocketAddr) -> bool {
    TcpStream::connect_timeout(&probe_addr(addr), Duration::from_millis(300)).is_ok()
}

/// Mirror the currently packaged core's own scan ceilings. These are not a
/// second selection policy: the core still decides when a scan succeeds or
/// fails. The native wrapper only adds a fixed establishment margin so a stuck
/// child process cannot hold the GUI forever.
///
/// WireGuard and WARP-in-WARP share the WireGuard prober; WiW asks that one scan
/// for distinct hops rather than running a second independent deadline.
fn core_scan_budget(profile: &ConnectionProfile) -> Duration {
    let wireguard_family = matches!(
        &profile.protocol,
        Protocol::Wireguard | Protocol::Gool
    );

    match (&profile.scan_mode, wireguard_family) {
        (ScanMode::Turbo, true) => Duration::from_secs(30),
        (ScanMode::Balanced, true) => Duration::from_secs(80),
        (ScanMode::Thorough, true) => Duration::from_secs(250),
        (ScanMode::Stealth, true) => Duration::from_secs(150),
        (ScanMode::Ironclad, true) => Duration::from_secs(180),
        (ScanMode::Turbo, false) => Duration::from_secs(45),
        (ScanMode::Balanced, false) => Duration::from_secs(120),
        (ScanMode::Thorough, false) => Duration::from_secs(300),
        (ScanMode::Stealth, false) => Duration::from_secs(180),
        (ScanMode::Ironclad, false) => Duration::from_secs(180),
    }
}

pub fn connect_timeout(profile: &ConnectionProfile) -> Duration {
    core_scan_budget(profile) + ESTABLISHMENT_MARGIN
}

/// How long to wait after sending Ctrl-C before force-killing. Aether does not
/// consistently exit quickly on SIGINT, and this GUI process owns no elevated
/// TUN resource that would make a hard kill unsafe.
pub const GRACEFUL_SHUTDOWN_GRACE: Duration = Duration::from_secs(3);

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
    fn supervisor_mirrors_core_scan_budgets_and_adds_one_margin() {
        let cases = [
            (Protocol::Masque, ScanMode::Turbo, 45),
            (Protocol::Masque, ScanMode::Balanced, 120),
            (Protocol::Masque, ScanMode::Thorough, 300),
            (Protocol::Masque, ScanMode::Stealth, 180),
            (Protocol::Masque, ScanMode::Ironclad, 180),
            (Protocol::Wireguard, ScanMode::Turbo, 30),
            (Protocol::Wireguard, ScanMode::Balanced, 80),
            (Protocol::Wireguard, ScanMode::Thorough, 250),
            (Protocol::Wireguard, ScanMode::Stealth, 150),
            (Protocol::Wireguard, ScanMode::Ironclad, 180),
            (Protocol::Gool, ScanMode::Turbo, 30),
            (Protocol::Gool, ScanMode::Balanced, 80),
        ];

        for (protocol, scan_mode, budget) in cases {
            let profile = ConnectionProfile {
                protocol,
                scan_mode,
                ..Default::default()
            };
            assert_eq!(core_scan_budget(&profile), Duration::from_secs(budget));
            assert_eq!(
                connect_timeout(&profile),
                Duration::from_secs(budget) + ESTABLISHMENT_MARGIN
            );
        }
    }
}
