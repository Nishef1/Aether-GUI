use serde_json::json;
use std::path::Path;

pub const TUN_INTERFACE_NAME: &str = "aether-tun";
pub const TUN_ADDRESS: &str = "172.19.0.1/30";
pub const TUN_ADDRESS_V6: &str = "fdfe:dcba:9876::1/126";

fn process_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn generate_config(
    aether_socks_port: u16,
    aether_binary: &Path,
) -> Result<String, serde_json::Error> {
    let config = json!({
        "log": {
            "loglevel": "warning",
            "dnsLog": false
        },
        "inbounds": [
            {
                "tag": "tun-in",
                "protocol": "tun",
                "settings": {
                    "name": TUN_INTERFACE_NAME,
                    "desc": "Aether TUN",
                    "mtu": 1500,
                    "gateway": [TUN_ADDRESS, TUN_ADDRESS_V6],
                    "dns": ["1.1.1.1", "2606:4700:4700::1111"],
                    "autoSystemRoutingTable": ["0.0.0.0/0", "::/0"],
                    "autoOutboundsInterface": "auto"
                },
                "sniffing": {
                    "enabled": true,
                    "destOverride": ["http", "tls", "quic"],
                    "routeOnly": true
                }
            }
        ],
        "outbounds": [
            {
                "tag": "proxy",
                "protocol": "socks",
                "sendThrough": "127.0.0.1",
                "settings": {
                    "address": "127.0.0.1",
                    "port": aether_socks_port
                }
            },
            {
                "tag": "direct",
                "protocol": "freedom",
                "settings": {}
            }
        ],
        "routing": {
            "domainStrategy": "AsIs",
            "rules": [
                {
                    "type": "field",
                    "process": [process_path(aether_binary), "self/", "xray/"],
                    "outboundTag": "direct"
                },
                {
                    "type": "field",
                    "inboundTag": ["tun-in"],
                    "port": "53,853",
                    "network": "tcp,udp",
                    "outboundTag": "proxy"
                },
                {
                    "type": "field",
                    "ip": [
                        "127.0.0.0/8",
                        "10.0.0.0/8",
                        "172.16.0.0/12",
                        "192.168.0.0/16",
                        "169.254.0.0/16",
                        "224.0.0.0/4",
                        "::1/128",
                        "fc00::/7",
                        "fe80::/10",
                        "ff00::/8"
                    ],
                    "outboundTag": "direct"
                },
                {
                    "type": "field",
                    "inboundTag": ["tun-in"],
                    "outboundTag": "proxy"
                }
            ]
        }
    });

    serde_json::to_string_pretty(&config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn xray_tun_routes_system_traffic_and_dns_to_aether_socks() {
        let core = PathBuf::from(if cfg!(windows) {
            r"C:\Users\test\AppData\Roaming\Aether-GUI\cores\aether\aether-v1.4.0.exe"
        } else {
            "/home/test/.local/share/aether-gui/cores/aether/aether-v1.4.0"
        });
        let value: serde_json::Value =
            serde_json::from_str(&generate_config(1819, &core).unwrap()).unwrap();

        assert_eq!(value["inbounds"][0]["protocol"], "tun");
        assert_eq!(value["inbounds"][0]["settings"]["gateway"][0], TUN_ADDRESS);
        assert_eq!(
            value["inbounds"][0]["settings"]["autoSystemRoutingTable"][0],
            "0.0.0.0/0"
        );
        assert_eq!(
            value["inbounds"][0]["settings"]["autoOutboundsInterface"],
            "auto"
        );
        assert_eq!(value["outbounds"][0]["protocol"], "socks");
        assert_eq!(value["outbounds"][0]["settings"]["port"], 1819);

        let rules = value["routing"]["rules"].as_array().unwrap();
        assert_eq!(rules[0]["outboundTag"], "direct");
        assert_eq!(rules[1]["port"], "53,853");
        assert_eq!(rules[1]["network"], "tcp,udp");
        assert_eq!(rules[1]["outboundTag"], "proxy");
        assert_eq!(rules[2]["outboundTag"], "direct");
        assert_eq!(rules[3]["outboundTag"], "proxy");
        assert!(!rules[0]["process"][0]
            .as_str()
            .unwrap()
            .contains('\\'));
    }
}
