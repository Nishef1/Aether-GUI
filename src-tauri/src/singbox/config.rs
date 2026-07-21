use serde::Serialize;

pub const TUN_INTERFACE_NAME: &str = "aether-tun";
pub const TUN_ADDRESS: &str = "172.19.0.1/30";

pub fn generate_config(aether_socks_port: u16) -> Result<String, serde_json::Error> {
    let aether_process = if cfg!(windows) { "aether.exe" } else { "aether" };
    let singbox_process = if cfg!(windows) { "sing-box.exe" } else { "sing-box" };

    let config = Config {
        log: LogConfig {
            level: "info",
            timestamp: true,
        },
        dns: DnsConfig {
            servers: vec![DnsServer {
                type_: "udp",
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
            address: vec![TUN_ADDRESS],
            auto_route: true,
            strict_route: true,
            stack: "mixed",
        }],
        outbounds: vec![
            Outbound::socks(aether_socks_port),
            Outbound::direct(),
        ],
        route: RouteConfig {
            rules: vec![RouteRule {
                process_name: vec![aether_process, singbox_process],
                action: "route",
                outbound: "direct",
            }],
            final_: "proxy",
            auto_detect_interface: true,
        },
    };

    serde_json::to_string_pretty(&config)
}

#[derive(Serialize)]
struct Config<'a> {
    log: LogConfig<'a>,
    dns: DnsConfig<'a>,
    inbounds: Vec<TunInbound<'a>>,
    outbounds: Vec<Outbound<'a>>,
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
    auto_route: bool,
    strict_route: bool,
    stack: &'a str,
}

#[derive(Serialize)]
struct Outbound<'a> {
    #[serde(rename = "type")]
    type_: &'a str,
    tag: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    server: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    server_port: Option<u16>,
}

impl<'a> Outbound<'a> {
    fn socks(port: u16) -> Self {
        Self {
            type_: "socks",
            tag: "proxy",
            server: Some("127.0.0.1"),
            server_port: Some(port),
        }
    }

    fn direct() -> Self {
        Self {
            type_: "direct",
            tag: "direct",
            server: None,
            server_port: None,
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
    process_name: Vec<&'a str>,
    action: &'a str,
    outbound: &'a str,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_config_uses_current_route_action_shape() {
        let value: serde_json::Value = serde_json::from_str(&generate_config(1819).unwrap()).unwrap();
        assert_eq!(value["route"]["rules"][0]["action"], "route");
        assert_eq!(value["route"]["rules"][0]["outbound"], "direct");
        assert_eq!(value["route"]["auto_detect_interface"], true);
        assert_eq!(value["inbounds"][0]["strict_route"], true);
        assert_eq!(value["dns"]["servers"][0]["type"], "udp");
        assert_eq!(value["dns"]["servers"][0]["detour"], "proxy");
    }
}
