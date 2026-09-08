use std::net::UdpSocket;
use std::process::Command;

const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

fn stable_hash(input: &str) -> u64 {
    input
        .as_bytes()
        .iter()
        .fold(FNV_OFFSET, |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(FNV_PRIME))
}

fn routed_local_ip(target: &str, bind: &str) -> Option<String> {
    let socket = UdpSocket::bind(bind).ok()?;
    socket.connect(target).ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

fn local_route_material() -> Vec<String> {
    let mut out = Vec::new();
    if let Some(ip) = routed_local_ip("1.1.1.1:53", "0.0.0.0:0") {
        out.push(format!("src4={ip}"));
    }
    if let Some(ip) = routed_local_ip("[2606:4700:4700::1111]:53", "[::]:0") {
        out.push(format!("src6={ip}"));
    }
    out
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn platform_route_material() -> Vec<String> {
    let mut out = Vec::new();

    if let Ok(text) = std::fs::read_to_string("/proc/net/route") {
        for line in text.lines().skip(1) {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() >= 3 && fields[1] == "00000000" {
                out.push(format!("v4:{}:{}", fields[0], fields[2]));
            }
        }
    }

    if let Ok(text) = std::fs::read_to_string("/proc/net/ipv6_route") {
        for line in text.lines() {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() >= 10
                && fields[0] == "00000000000000000000000000000000"
                && fields[1] == "00"
            {
                out.push(format!("v6:{}:{}", fields[fields.len() - 1], fields[4]));
            }
        }
    }

    out
}

#[cfg(target_os = "macos")]
fn platform_route_material() -> Vec<String> {
    let Ok(output) = Command::new("route").args(["-n", "get", "default"]).output() else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut out = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("gateway:") {
            out.push(format!("gateway={}", value.trim()));
        } else if let Some(value) = line.strip_prefix("interface:") {
            out.push(format!("interface={}", value.trim()));
        }
    }
    out
}

#[cfg(windows)]
fn platform_route_material() -> Vec<String> {
    let Ok(output) = Command::new("route").args(["print", "-4"]).output() else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            (fields.len() >= 4 && fields[0] == "0.0.0.0" && fields[1] == "0.0.0.0")
                .then(|| format!("v4:{}:{}", fields[2], fields[3]))
        })
        .collect()
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    windows
)))]
fn platform_route_material() -> Vec<String> {
    Vec::new()
}

pub fn current_network_key() -> Option<String> {
    let mut material = platform_route_material();
    material.extend(local_route_material());
    material.sort();
    material.dedup();
    if material.is_empty() {
        return None;
    }

    Some(format!("route-v1:{:016x}", stable_hash(&material.join("|"))))
}

/// Keep the child Core's persisted path history scoped to the same underlay
/// fingerprint used by the GUI. If the underlay cannot be identified, remove
/// the variable so Core cannot accidentally replay another network's winners.
pub fn sync_process_environment() -> Option<String> {
    let key = current_network_key();
    match key.as_deref() {
        Some(value) => std::env::set_var("AETHER_NETWORK_KEY", value),
        None => std::env::remove_var("AETHER_NETWORK_KEY"),
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_stable_and_does_not_expose_route_material() {
        let material = "v4:wlan0:0101A8C0|src4=192.168.1.7";
        let fingerprint = format!("route-v1:{:016x}", stable_hash(material));
        assert_eq!(fingerprint, format!("route-v1:{:016x}", stable_hash(material)));
        assert!(!fingerprint.contains("192.168"));
        assert!(!fingerprint.contains("wlan0"));
    }
}
