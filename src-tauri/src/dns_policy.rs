use serde_json::Value;
use std::net::{IpAddr, SocketAddr};

pub const DEFAULT_DNS_V4: [&str; 2] = ["1.1.1.1", "1.0.0.1"];
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

pub fn effective_resolvers(raw: &str) -> Vec<SocketAddr> {
    let configured = parse_resolvers(raw);
    if !configured.is_empty() {
        return configured;
    }

    DEFAULT_DNS_V4
        .iter()
        .filter_map(|value| parse_resolver(value))
        .collect()
}

pub fn profile_dns(profile: Option<&Value>) -> Option<&str> {
    profile
        .and_then(|value| value.get("dns"))
        .and_then(Value::as_str)
}

pub fn profile_resolvers(profile: Option<&Value>, fallback_profile: Option<&Value>) -> Vec<SocketAddr> {
    let configured = profile_dns(profile)
        .or_else(|| profile_dns(fallback_profile))
        .unwrap_or_default();
    effective_resolvers(configured)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn empty_profile_uses_cloudflare_pair() {
        assert_eq!(
            effective_resolvers(""),
            vec![
                "1.1.1.1:53".parse().unwrap(),
                "1.0.0.1:53".parse().unwrap(),
            ]
        );
    }

    #[test]
    fn adguard_filtering_pair_is_preserved_in_order() {
        assert_eq!(
            effective_resolvers("94.140.14.14,94.140.15.15"),
            vec![
                "94.140.14.14:53".parse().unwrap(),
                "94.140.15.15:53".parse().unwrap(),
            ]
        );
    }

    #[test]
    fn custom_ports_ipv6_and_duplicates_are_normalized() {
        assert_eq!(
            effective_resolvers("9.9.9.9:5353;[2620:fe::fe]:53 9.9.9.9:5353"),
            vec![
                "9.9.9.9:5353".parse().unwrap(),
                "[2620:fe::fe]:53".parse().unwrap(),
            ]
        );
    }

    #[test]
    fn malformed_entries_do_not_replace_valid_resolvers() {
        assert_eq!(
            effective_resolvers("not-a-dns,94.140.14.14,0.0.0.0"),
            vec!["94.140.14.14:53".parse().unwrap()]
        );
    }

    #[test]
    fn attempt_profile_wins_over_saved_fallback() {
        let attempt = json!({ "dns": "94.140.14.14" });
        let saved = json!({ "dns": "1.1.1.1" });
        assert_eq!(
            profile_resolvers(Some(&attempt), Some(&saved)),
            vec!["94.140.14.14:53".parse().unwrap()]
        );
    }
}
