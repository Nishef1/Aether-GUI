use serde::Serialize;

pub const TUN_INTERFACE_NAME: &str = "aether-tun";
pub const TUN_ADDRESS_V4: &str = "172.19.0.1/30";
pub const TUN_ADDRESS_V6: &str = "fdfe:dcba:9876::1/126";

pub fn generate(upstream_socks_addr: &str) -> Result<String, String> {
    let socket = upstream_socks_addr
        .parse::<std::net::SocketAddr>()
        .map_err(|error| format!("invalid upstream SOCKS address: {error}"))?;
    if !socket.ip().is_loopback() {
        return Err("system tunnel requires a loopback upstream SOCKS address".into());
    }

    let config = Config {
        log: LogConfig {
            level: "warn",
            timestamp: true,
        },
        dns: DnsConfig {
            servers: vec![DnsServer {
                type_: "tcp",
                tag: "dns-proxy",
                server: "1.1.1.1",
                server_port: 53,
                detour: "proxy",
            }],
            final_: "dns-proxy",
        },
        inbounds: vec![TunInbound {
            type_: "tun",
            tag: "tun-in",
            interface_name: TUN_INTERFACE_NAME,
            address: vec![TUN_ADDRESS_V4, TUN_ADDRESS_V6],
            mtu: 1400,
            auto_route: true,
            strict_route: true,
            stack: "mixed",
        }],
        outbounds: vec![
            Outbound::socks(socket.ip().to_string(), socket.port()),
            Outbound::direct(),
        ],
        route: RouteConfig {
            rules: vec![
                RouteRule::route_process_names(vec![
                    "aether",
                    "aether.exe",
                    "sing-box",
                    "sing-box.exe",
                ]),
                RouteRule::hijack_dns(),
            ],
            final_: "proxy",
            auto_detect_interface: true,
        },
    };

    serde_json::to_string_pretty(&config).map_err(|error| error.to_string())
}

#[derive(Serialize)]
struct Config<'a> {
    log: LogConfig<'a>,
    dns: DnsConfig<'a>,
    inbounds: Vec<TunInbound<'a>>,
    outbounds: Vec<Outbound>,
    route: RouteConfig<'a>,
}

#[derive(Serialize)]
struct LogConfig<'a> {
    level: &'a str,
    timestamp: bool,
}

#[derive(Serialize)]
struct DnsConfig<'a> {
    servers: Vec<DnsServer<'a>>,
    #[serde(rename = "final")]
    final_: &'a str,
}

#[derive(Serialize)]
struct DnsServer<'a> {
    #[serde(rename = "type")]
    type_: &'a str,
    tag: &'a str,
    server: &'a str,
    server_port: u16,
    detour: &'a str,
}

#[derive(Serialize)]
struct TunInbound<'a> {
    #[serde(rename = "type")]
    type_: &'a str,
    tag: &'a str,
    interface_name: &'a str,
    address: Vec<&'a str>,
    mtu: u16,
    auto_route: bool,
    strict_route: bool,
    stack: &'a str,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

impl Outbound {
    fn socks(server: String, port: u16) -> Self {
        Self {
            type_: "socks".into(),
            tag: "proxy".into(),
            server: Some(server),
            server_port: Some(port),
            version: Some("5".into()),
        }
    }

    fn direct() -> Self {
        Self {
            type_: "direct".into(),
            tag: "direct".into(),
            server: None,
            server_port: None,
            version: None,
        }
    }
}

#[derive(Serialize)]
struct RouteConfig<'a> {
    rules: Vec<RouteRule<'a>>,
    #[serde(rename = "final")]
    final_: &'a str,
    auto_detect_interface: bool,
}

#[derive(Serialize)]
struct RouteRule<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    process_name: Option<Vec<&'a str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<Vec<u16>>,
    action: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    outbound: Option<&'a str>,
}

impl<'a> RouteRule<'a> {
    fn route_process_names(names: Vec<&'a str>) -> Self {
        Self {
            process_name: Some(names),
            port: None,
            action: "route",
            outbound: Some("direct"),
        }
    }

    fn hijack_dns() -> Self {
        Self {
            process_name: None,
            port: Some(vec![53]),
            action: "hijack-dns",
            outbound: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_routes_system_traffic_to_aether_and_bypasses_the_cores() {
        let value: serde_json::Value =
            serde_json::from_str(&generate("127.0.0.1:1819").unwrap()).unwrap();
        assert_eq!(value["inbounds"][0]["type"], "tun");
        assert_eq!(value["inbounds"][0]["interface_name"], TUN_INTERFACE_NAME);
        assert_eq!(value["inbounds"][0]["auto_route"], true);
        assert_eq!(value["inbounds"][0]["strict_route"], true);
        assert_eq!(value["outbounds"][0]["type"], "socks");
        assert_eq!(value["outbounds"][0]["server"], "127.0.0.1");
        assert_eq!(value["outbounds"][0]["server_port"], 1819);
        assert_eq!(value["route"]["rules"][0]["outbound"], "direct");
        assert_eq!(value["route"]["rules"][1]["action"], "hijack-dns");
        assert_eq!(value["route"]["final"], "proxy");
    }

    #[test]
    fn rejects_non_loopback_upstream() {
        assert!(generate("0.0.0.0:1819").is_err());
    }
}
