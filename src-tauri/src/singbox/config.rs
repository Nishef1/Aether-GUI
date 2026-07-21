use serde::Serialize;
use std::path::Path;

pub const TUN_INTERFACE_NAME: &str = "aether-tun";
pub const TUN_ADDRESS: &str = "172.19.0.1/30";
pub const TUN_ADDRESS_V6: &str = "fdfe:dcba:9876::1/126";

pub fn generate_config(
    aether_socks_port: u16,
    aether_binary: &Path,
) -> Result<String, serde_json::Error> {
    let singbox_process = if cfg!(windows) { "sing-box.exe" } else { "sing-box" };

    let config = Config {
        log: LogConfig {
            level: "info".into(),
            timestamp: true,
        },
        dns: DnsConfig {
            servers: vec![DnsServer {
                type_: "udp".into(),
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
                RouteRule {
                    process_path: Some(vec![aether_binary.to_string_lossy().into_owned()]),
                    process_name: None,
                    action: "route".into(),
                    outbound: "direct".into(),
                },
                RouteRule {
                    process_path: None,
                    process_name: Some(vec![singbox_process.into()]),
                    action: "route".into(),
                    outbound: "direct".into(),
                },
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
    process_path: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    process_name: Option<Vec<String>>,
    action: String,
    outbound: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn config_is_dual_stack_and_bypasses_core_with_separate_rules() {
        let core = PathBuf::from(if cfg!(windows) {
            r"C:\Users\test\AppData\Roaming\Aether-GUI\cores\aether\aether-v1.3.0.exe"
        } else {
            "/home/test/.local/share/aether-gui/cores/aether/aether-v1.3.0"
        });
        let value: serde_json::Value =
            serde_json::from_str(&generate_config(1819, &core).unwrap()).unwrap();

        assert_eq!(value["route"]["rules"][0]["process_path"][0], core.to_string_lossy().as_ref());
        assert!(value["route"]["rules"][0].get("process_name").is_none());
        assert!(value["route"]["rules"][1].get("process_path").is_none());
        assert_eq!(value["route"]["rules"][0]["outbound"], "direct");
        assert_eq!(value["route"]["rules"][1]["outbound"], "direct");
        assert_eq!(value["route"]["auto_detect_interface"], true);
        assert_eq!(value["inbounds"][0]["strict_route"], true);
        assert_eq!(value["inbounds"][0]["address"][0], TUN_ADDRESS);
        assert_eq!(value["inbounds"][0]["address"][1], TUN_ADDRESS_V6);
        assert_eq!(value["dns"]["servers"][0]["detour"], "proxy");
    }
}
