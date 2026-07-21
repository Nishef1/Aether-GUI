use serde::Serialize;
use std::path::Path;

pub const TUN_INTERFACE_NAME: &str = "aether-tun";
pub const TUN_ADDRESS: &str = "172.19.0.1/30";
pub const TUN_ADDRESS_V6: &str = "fdfe:dcba:9876::1/126";

/// Match both Core Registry binaries such as
/// `.../cores/singbox/sing-box-v1.13.14.exe` and the bundled recovery binary
/// `.../binaries/sing-box.exe`. Keeping this rule tied to Aether-GUI's known
/// directory layout avoids coupling TUN routing to one selected core version.
fn singbox_process_path_regex() -> String {
    r"(?i)^.*[\\/](?:cores[\\/]singbox[\\/]sing-box-[A-Za-z0-9._-]+|binaries[\\/]sing-box)(?:\.exe)?$"
        .into()
}

pub fn generate_config(
    aether_socks_port: u16,
    aether_binary: &Path,
) -> Result<String, serde_json::Error> {
    let config = Config {
        log: LogConfig {
            // Per-flow info logs are extremely high volume in TUN mode and can
            // overwhelm the WebView event bridge. Lifecycle/health information
            // is emitted by the GUI itself, while sing-box still surfaces warnings.
            level: "warn".into(),
            timestamp: true,
        },
        dns: DnsConfig {
            servers: vec![DnsServer {
                // DNS-over-TCP keeps system name resolution on the protected
                // Aether path without making bootstrap DNS depend on SOCKS5 UDP
                // ASSOCIATE behavior. General TUN UDP traffic is still supported.
                type_: "tcp".into(),
                tag: "dns-proxy".into(),
                server: "1.1.1.1".into(),
                server_port: 53,
                detour: "proxy".into(),
            }],
            final_: "dns-proxy".into(),
        },
        inbounds: vec![TunInbound {
            type_: "tun".into(),
            tag: "tun-in".into(),
            interface_name: TUN_INTERFACE_NAME.into(),
            address: vec![TUN_ADDRESS.into(), TUN_ADDRESS_V6.into()],
            auto_route: true,
            strict_route: true,
            stack: "mixed".into(),
        }],
        outbounds: vec![Outbound::socks(aether_socks_port), Outbound::direct()],
        route: RouteConfig {
            rules: vec![
                // Aether's outer Cloudflare transport must never be captured by
                // the TUN, otherwise it recursively routes through its own SOCKS.
                RouteRule::route_process_path(aether_binary.to_string_lossy().into_owned()),
                // Core Registry installs sing-box with a versioned filename while
                // recovery resources use sing-box(.exe). Match both layouts so a
                // core upgrade/downgrade cannot silently break the self-bypass.
                RouteRule::route_process_path_regex(singbox_process_path_regex()),
                // `protocol: dns` only matches after protocol sniffing. We do not
                // sniff all TUN traffic, so match DNS by destination port instead.
                // This handles both UDP and TCP DNS without extra sniff overhead.
                RouteRule::hijack_dns_port(),
            ],
            final_: "proxy".into(),
            auto_detect_interface: true,
        },
    };

    serde_json::to_string_pretty(&config)
}

#[derive(Serialize)]
struct Config {
    log: LogConfig,
    dns: DnsConfig,
    inbounds: Vec<TunInbound>,
    outbounds: Vec<Outbound>,
    route: RouteConfig,
}

#[derive(Serialize)]
struct LogConfig {
    level: String,
    timestamp: bool,
}

#[derive(Serialize)]
struct DnsConfig {
    servers: Vec<DnsServer>,
    #[serde(rename = "final")]
    final_: String,
}

#[derive(Serialize)]
struct DnsServer {
    #[serde(rename = "type")]
    type_: String,
    tag: String,
    server: String,
    server_port: u16,
    detour: String,
}

#[derive(Serialize)]
struct TunInbound {
    #[serde(rename = "type")]
    type_: String,
    tag: String,
    interface_name: String,
    address: Vec<String>,
    auto_route: bool,
    strict_route: bool,
    stack: String,
}

#[derive(Serialize)]
struct Outbound {
    #[serde(rename = "type")]
    type_: String,
    tag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    server_port: Option<u16>,
}

impl Outbound {
    fn socks(port: u16) -> Self {
        Self {
            type_: "socks".into(),
            tag: "proxy".into(),
            server: Some("127.0.0.1".into()),
            server_port: Some(port),
        }
    }

    fn direct() -> Self {
        Self {
            type_: "direct".into(),
            tag: "direct".into(),
            server: None,
            server_port: None,
        }
    }
}

#[derive(Serialize)]
struct RouteConfig {
    rules: Vec<RouteRule>,
    #[serde(rename = "final")]
    final_: String,
    auto_detect_interface: bool,
}

#[derive(Serialize)]
struct RouteRule {
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<Vec<u16>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    process_path: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    process_path_regex: Option<Vec<String>>,
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    outbound: Option<String>,
}

impl RouteRule {
    fn route_process_path(path: String) -> Self {
        Self {
            port: None,
            process_path: Some(vec![path]),
            process_path_regex: None,
            action: "route".into(),
            outbound: Some("direct".into()),
        }
    }

    fn route_process_path_regex(pattern: String) -> Self {
        Self {
            port: None,
            process_path: None,
            process_path_regex: Some(vec![pattern]),
            action: "route".into(),
            outbound: Some("direct".into()),
        }
    }

    fn hijack_dns_port() -> Self {
        Self {
            port: Some(vec![53]),
            process_path: None,
            process_path_regex: None,
            action: "hijack-dns".into(),
            outbound: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn config_is_dual_stack_and_bypasses_cores_before_dns_hijack() {
        let core = PathBuf::from(if cfg!(windows) {
            r"C:\Users\test\AppData\Roaming\Aether-GUI\cores\aether\aether-v1.3.0.exe"
        } else {
            "/home/test/.local/share/aether-gui/cores/aether/aether-v1.3.0"
        });
        let value: serde_json::Value =
            serde_json::from_str(&generate_config(1819, &core).unwrap()).unwrap();

        assert_eq!(
            value["route"]["rules"][0]["process_path"][0],
            core.to_string_lossy().as_ref()
        );
        assert_eq!(value["route"]["rules"][0]["outbound"], "direct");
        assert!(value["route"]["rules"][1]["process_path_regex"][0]
            .as_str()
            .unwrap()
            .contains("cores"));
        assert_eq!(value["route"]["rules"][1]["outbound"], "direct");
        assert_eq!(value["route"]["rules"][2]["port"][0], 53);
        assert_eq!(value["route"]["rules"][2]["action"], "hijack-dns");
        assert!(value["route"]["rules"][2].get("outbound").is_none());
        assert_eq!(value["route"]["auto_detect_interface"], true);
        assert_eq!(value["inbounds"][0]["strict_route"], true);
        assert_eq!(value["inbounds"][0]["address"][0], TUN_ADDRESS);
        assert_eq!(value["inbounds"][0]["address"][1], TUN_ADDRESS_V6);
        assert_eq!(value["dns"]["servers"][0]["type"], "tcp");
        assert_eq!(value["dns"]["servers"][0]["detour"], "proxy");
        assert_eq!(value["log"]["level"], "warn");
    }

    /// Offline TUN smoke test: protects the routing contract without needing
    /// administrator privileges, a network connection, or installed cores.
    #[test]
    fn tun_smoke_config_routes_system_and_dns_through_aether_socks() {
        let core = PathBuf::from("C:/test/aether.exe");
        let value: serde_json::Value =
            serde_json::from_str(&generate_config(1919, &core).unwrap()).unwrap();

        let tun = &value["inbounds"][0];
        assert_eq!(tun["type"], "tun");
        assert_eq!(tun["tag"], "tun-in");
        assert_eq!(tun["interface_name"], TUN_INTERFACE_NAME);
        assert_eq!(tun["auto_route"], true);
        assert_eq!(tun["strict_route"], true);
        assert_eq!(tun["stack"], "mixed");

        let proxy = value["outbounds"]
            .as_array()
            .unwrap()
            .iter()
            .find(|outbound| outbound["tag"] == "proxy")
            .expect("TUN must have an Aether SOCKS outbound");
        assert_eq!(proxy["type"], "socks");
        assert_eq!(proxy["server"], "127.0.0.1");
        assert_eq!(proxy["server_port"], 1919);

        assert_eq!(value["route"]["final"], "proxy");
        assert_eq!(value["dns"]["final"], "dns-proxy");
        assert_eq!(value["dns"]["servers"][0]["type"], "tcp");
        assert_eq!(value["dns"]["servers"][0]["detour"], "proxy");
        assert_eq!(value["route"]["rules"][2]["port"][0], 53);
        assert_eq!(value["route"]["rules"][2]["action"], "hijack-dns");
    }
}
