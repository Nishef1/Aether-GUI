#[path = "../src/aether/profiles.rs"]
mod profiles;
#[path = "../src/system_tunnel/sing_box/config.rs"]
mod sing_box_config;

use profiles::{ConnectionProfile, IpVersion, MasqueMask, NoizeProfile, Protocol, TlsProfile};
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::Command;

fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|arg| arg == flag)
}

fn has_pair(args: &[String], flag: &str, value: &str) -> bool {
    args.windows(2)
        .any(|pair| pair[0] == flag && pair[1] == value)
}

fn assert_transport_exclusive(args: &[String], expected: &str) {
    for flag in ["--masque", "--wg", "--gool"] {
        assert_eq!(
            has_flag(args, flag),
            flag == expected,
            "transport flags were not exclusive: {args:?}"
        );
    }
}

#[test]
fn transport_argument_matrix_covers_masque_wireguard_and_warp_in_warp() {
    let masque_h2 = ConnectionProfile {
        protocol: Protocol::Masque,
        masque_http2: true,
        masque_noize: NoizeProfile::Firewall,
        h2_peer: "104.16.0.1:443".into(),
        ..Default::default()
    };
    let args = masque_h2.as_args();
    assert_transport_exclusive(&args, "--masque");
    assert!(has_flag(&args, "--h2"));
    assert!(has_pair(&args, "--h2-peer", "104.16.0.1:443"));
    assert!(has_pair(&args, "--noize", "firewall"));
    assert!(!has_flag(&args, "--keepalive"));

    let masque_h3 = ConnectionProfile {
        protocol: Protocol::Masque,
        masque_http2: false,
        ..Default::default()
    };
    let args = masque_h3.as_args();
    assert_transport_exclusive(&args, "--masque");
    assert!(!has_flag(&args, "--h2"));
    assert!(!has_flag(&args, "--fragment"));

    let wireguard = ConnectionProfile {
        protocol: Protocol::Wireguard,
        wg_noize: NoizeProfile::Aggressive,
        peer: "162.159.192.1:2408".into(),
        keepalive: 17,
        masque_http2: true,
        masque_mask: MasqueMask::Patterniha,
        fragment: true,
        ..Default::default()
    };
    let args = wireguard.as_args();
    assert_transport_exclusive(&args, "--wg");
    assert!(has_pair(&args, "--peer", "162.159.192.1:2408"));
    assert!(has_pair(&args, "--noize", "aggressive"));
    assert!(has_pair(&args, "--keepalive", "17"));
    for forbidden in [
        "--h2",
        "--h2-peer",
        "--fragment",
        "--fragment-size",
        "--fragment-delay",
        "--wiw-scan",
    ] {
        assert!(
            !has_flag(&args, forbidden),
            "{forbidden} leaked into WireGuard"
        );
    }

    let wiw_scan = ConnectionProfile {
        protocol: Protocol::Gool,
        wiw_scan: true,
        wg_peer: "stale.example:2408".into(),
        wiw_outer: "stale-outer.example:2408".into(),
        wiw_inner: "stale-inner.example:2408".into(),
        ..Default::default()
    };
    let args = wiw_scan.as_args();
    assert_transport_exclusive(&args, "--gool");
    assert!(has_flag(&args, "--wiw-scan"));
    assert!(!has_flag(&args, "--wg-peer"));
    assert!(!has_flag(&args, "--wiw-outer"));
    assert!(!has_flag(&args, "--wiw-inner"));
    assert!(has_flag(&args, "--keepalive"));

    let wiw_manual = ConnectionProfile {
        protocol: Protocol::Gool,
        wiw_scan: false,
        wg_peer: "stale.example:2408".into(),
        wiw_outer: "162.159.192.1:2408".into(),
        wiw_inner: "162.159.193.1:2408".into(),
        ..Default::default()
    };
    let args = wiw_manual.as_args();
    assert_transport_exclusive(&args, "--gool");
    assert!(has_pair(&args, "--wiw-outer", "162.159.192.1:2408"));
    assert!(has_pair(&args, "--wiw-inner", "162.159.193.1:2408"));
    assert!(!has_flag(&args, "--wg-peer"));
    assert!(!has_flag(&args, "--wiw-scan"));

    let wiw_legacy_outer = ConnectionProfile {
        protocol: Protocol::Gool,
        wiw_scan: false,
        wg_peer: "162.159.192.1:2408".into(),
        ..Default::default()
    };
    let args = wiw_legacy_outer.as_args();
    assert!(has_pair(&args, "--wg-peer", "162.159.192.1:2408"));
}

#[test]
fn ip_family_and_quick_reconnect_matrix_is_unambiguous() {
    for (family, expected) in [
        (IpVersion::V4, "-4"),
        (IpVersion::V6, "-6"),
        (IpVersion::Both, "--dual"),
    ] {
        for quick in [false, true] {
            let profile = ConnectionProfile {
                ip_version: family.clone(),
                quick_reconnect: quick,
                ..Default::default()
            };
            let args = profile.as_args();
            for candidate in ["-4", "-6", "--dual"] {
                assert_eq!(
                    has_flag(&args, candidate),
                    candidate == expected,
                    "IP-family flags were ambiguous for {family:?}: {args:?}"
                );
            }
            assert_eq!(has_flag(&args, "--quick-reconnect"), quick);
            assert_eq!(has_flag(&args, "--no-quick-reconnect"), !quick);
        }
    }
}

#[test]
fn masque_mask_and_tls_profile_matrix_matches_core_contract() {
    for (mask, encoded) in [
        (MasqueMask::Off, "off"),
        (MasqueMask::Legacy, "legacy"),
        (MasqueMask::Clienthello, "clienthello"),
        (MasqueMask::Patterniha, "patterniha-experimental"),
    ] {
        assert_eq!(mask.as_env(), encoded);
    }

    let legacy = ConnectionProfile {
        protocol: Protocol::Masque,
        masque_http2: true,
        masque_mask: MasqueMask::Legacy,
        ..Default::default()
    };
    assert!(has_flag(&legacy.as_args(), "--fragment"));

    for deterministic in [MasqueMask::Clienthello, MasqueMask::Patterniha] {
        let profile = ConnectionProfile {
            protocol: Protocol::Masque,
            masque_http2: true,
            masque_mask: deterministic,
            ..Default::default()
        };
        assert!(
            !has_flag(&profile.as_args(), "--fragment"),
            "deterministic mask must be carried by AETHER_MASQUE_H2_MASK, not legacy fragmentation"
        );
    }

    for (profile, encoded) in [
        (TlsProfile::Automatic, "automatic"),
        (TlsProfile::Current, "current"),
        (TlsProfile::NativeMinimal, "native-minimal"),
        (TlsProfile::Compatibility, "compatibility"),
        (TlsProfile::Experimental, "experimental"),
    ] {
        assert_eq!(profile.as_env(), encoded);
    }
}

fn resolver_sets() -> Vec<Vec<SocketAddr>> {
    vec![
        vec![],
        vec!["1.1.1.1:53".parse().unwrap()],
        vec![
            "94.140.14.14:53".parse().unwrap(),
            "94.140.15.15:53".parse().unwrap(),
        ],
        vec![
            "1.1.1.1:53".parse().unwrap(),
            "[2606:4700:4700::1111]:53".parse().unwrap(),
        ],
    ]
}

#[test]
fn system_tunnel_config_matrix_has_explicit_dns_and_fail_closed_routing() {
    for dns in resolver_sets() {
        let config = sing_box_config::generate("127.0.0.1:1819", &dns).unwrap();
        let value: serde_json::Value = serde_json::from_str(&config).unwrap();
        let route = &value["route"];
        let dns_config = &value["dns"];

        assert_eq!(value["inbounds"][0]["type"], "tun");
        assert_eq!(value["inbounds"][0]["auto_route"], true);
        assert_eq!(value["inbounds"][0]["strict_route"], true);
        assert_eq!(route["final"], "proxy");
        assert_eq!(route["rules"][1]["action"], "hijack-dns");
        assert_eq!(route["default_domain_resolver"], dns_config["final"]);
        assert!(route["default_domain_resolver"].as_str().is_some());

        let servers = dns_config["servers"].as_array().unwrap();
        assert!(!servers.is_empty());
        for server in servers {
            assert_eq!(server["detour"], "proxy");
        }
    }
}

fn pinned_sing_box_binary() -> PathBuf {
    let name = if cfg!(windows) {
        "sing-box.exe"
    } else {
        "sing-box"
    };
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(name)
}

#[test]
fn pinned_sing_box_accepts_every_generated_system_tunnel_config() {
    let binary = pinned_sing_box_binary();
    let required = std::env::var("AETHER_REQUIRE_SING_BOX_CHECK")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if !binary.is_file() {
        assert!(
            !required,
            "pinned sing-box binary is required for the pre-build configuration gate: {}",
            binary.display()
        );
        return;
    }

    for (index, dns) in resolver_sets().into_iter().enumerate() {
        let config = sing_box_config::generate("127.0.0.1:1819", &dns).unwrap();
        let path = std::env::temp_dir().join(format!(
            "aether-sing-box-check-{}-{index}.json",
            std::process::id()
        ));
        fs::write(&path, &config).unwrap();
        let output = Command::new(&binary)
            .arg("check")
            .arg("-c")
            .arg(&path)
            .output()
            .unwrap_or_else(|error| panic!("failed to execute {}: {error}", binary.display()));
        let _ = fs::remove_file(&path);

        assert!(
            output.status.success(),
            "sing-box rejected generated config case {index}:\nstdout:\n{}\nstderr:\n{}\nconfig:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
            config
        );
    }
}

fn main() {}
