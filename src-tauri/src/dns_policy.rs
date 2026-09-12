use serde_json::Value;
use std::net::{IpAddr, SocketAddr};

pub const DEFAULT_DNS_V4: [&str; 2] = ["1.1.1.1", "1.0.0.1"];
pub const DEFAULT_DNS_V6: [&str; 2] = ["2606:4700:4700::1111", "2606:4700:4700::1001"];
pub const DEFAULT_DNS_PORT: u16 = 53;

fn acceptable_ip(ip: IpAddr) -> bool {
    !ip.is_unspecified() && !ip.is_multicast()
}

fn parse_resolver(value: &str) -> Option<SocketAddr> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    if let Ok(socket) = value.parse::<SocketAddr>() {
        return acceptable_ip(socket.ip()).then_some(socket);
    }

    value
        .parse::<IpAddr>()
        .ok()
        .filter(|ip| acceptable_ip(*ip))
        .map(|ip| SocketAddr::new(ip, DEFAULT_DNS_PORT))
}

pub fn parse_resolvers(raw: &str) -> Vec<SocketAddr> {
    let mut resolvers = Vec::new();
    for value in raw.split([',', ';', ' ', '\n', '\t']) {
        let Some(resolver) = parse_resolver(value) else {
            continue;
        };
        if !resolvers.contains(&resolver) {
            resolvers.push(resolver);
        }
    }
    resolvers
}

fn matches_ip_version(resolver: &SocketAddr, ip_version: &str) -> bool {
    match ip_version {
        "v4" => resolver.is_ipv4(),
        "v6" => resolver.is_ipv6(),
        _ => true,
    }
}

fn default_resolvers(ip_version: &str) -> Vec<SocketAddr> {
    let defaults: &[&str] = match ip_version {
        "v6" => &DEFAULT_DNS_V6,
        // Keep the long-standing v4 default for callers without an explicit
        // family. Dual-stack profiles append the v6 pair below.
        _ => &DEFAULT_DNS_V4,
    };
    let mut resolvers: Vec<SocketAddr> = defaults
        .iter()
        .filter_map(|value| parse_resolver(value))
        .collect();

    if ip_version == "both" {
        resolvers.extend(
            DEFAULT_DNS_V6
                .iter()
                .filter_map(|value| parse_resolver(value)),
        );
    }
    resolvers
}

pub fn effective_resolvers_for_ip_version(raw: &str, ip_version: &str) -> Vec<SocketAddr> {
    let configured: Vec<SocketAddr> = parse_resolvers(raw)
        .into_iter()
        .filter(|resolver| matches_ip_version(resolver, ip_version))
        .collect();
    if !configured.is_empty() {
        return configured;
    }

    default_resolvers(ip_version)
}

/// Legacy/default resolver behavior for callers that do not carry an IP-family
/// policy. New connection paths should use `effective_resolvers_for_ip_version`.
pub fn effective_resolvers(raw: &str) -> Vec<SocketAddr> {
    effective_resolvers_for_ip_version(raw, "v4")
}

pub fn profile_dns(profile: Option<&Value>) -> Option<&str> {
    profile
        .and_then(|value| value.get("dns"))
        .and_then(Value::as_str)
}

pub fn profile_ip_version(profile: Option<&Value>) -> Option<&str> {
    profile
        .and_then(|value| value.get("ip_version"))
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "v4" | "v6" | "both"))
}

pub fn profile_resolvers(
    profile: Option<&Value>,
    fallback_profile: Option<&Value>,
) -> Vec<SocketAddr> {
    let configured = profile_dns(profile)
        .or_else(|| profile_dns(fallback_profile))
        .unwrap_or_default();
    let ip_version = profile_ip_version(profile)
        .or_else(|| profile_ip_version(fallback_profile))
        .unwrap_or("v4");
    effective_resolvers_for_ip_version(configured, ip_version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn empty_v4_profile_uses_cloudflare_v4_pair() {
        assert_eq!(
            effective_resolvers_for_ip_version("", "v4"),
            vec!["1.1.1.1:53".parse().unwrap(), "1.0.0.1:53".parse().unwrap()]
        );
    }

    #[test]
    fn empty_v6_profile_uses_cloudflare_v6_pair() {
        assert_eq!(
            effective_resolvers_for_ip_version("", "v6"),
            vec![
                "[2606:4700:4700::1111]:53".parse().unwrap(),
                "[2606:4700:4700::1001]:53".parse().unwrap(),
            ]
        );
    }

    #[test]
    fn dual_stack_default_contains_both_families() {
        let resolvers = effective_resolvers_for_ip_version("", "both");
        assert!(resolvers.iter().any(SocketAddr::is_ipv4));
        assert!(resolvers.iter().any(SocketAddr::is_ipv6));
    }

    #[test]
    fn configured_resolvers_are_filtered_to_selected_family() {
        assert_eq!(
            effective_resolvers_for_ip_version(
                "94.140.14.14,2a10:50c0::ad1:ff,94.140.15.15,2a10:50c0::ad2:ff",
                "v6",
            ),
            vec![
                "[2a10:50c0::ad1:ff]:53".parse().unwrap(),
                "[2a10:50c0::ad2:ff]:53".parse().unwrap(),
            ]
        );
    }

    #[test]
    fn incompatible_custom_family_falls_back_within_selected_family() {
        let resolvers = effective_resolvers_for_ip_version("9.9.9.9", "v6");
        assert!(resolvers.iter().all(SocketAddr::is_ipv6));
    }

    #[test]
    fn custom_ports_ipv6_and_duplicates_are_normalized() {
        assert_eq!(
            parse_resolvers("9.9.9.9:5353;[2620:fe::fe]:53 9.9.9.9:5353"),
            vec![
                "9.9.9.9:5353".parse().unwrap(),
                "[2620:fe::fe]:53".parse().unwrap(),
            ]
        );
    }

    #[test]
    fn malformed_entries_do_not_replace_valid_resolvers() {
        assert_eq!(
            effective_resolvers_for_ip_version("not-a-dns,94.140.14.14,0.0.0.0", "v4"),
            vec!["94.140.14.14:53".parse().unwrap()]
        );
    }

    #[test]
    fn attempt_profile_wins_over_saved_fallback_for_dns_and_family() {
        let attempt = json!({ "dns": "2a10:50c0::ad1:ff", "ip_version": "v6" });
        let saved = json!({ "dns": "1.1.1.1", "ip_version": "v4" });
        assert_eq!(
            profile_resolvers(Some(&attempt), Some(&saved)),
            vec!["[2a10:50c0::ad1:ff]:53".parse().unwrap()]
        );
    }
}
