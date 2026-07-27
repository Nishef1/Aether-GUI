#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
INDEPENDENT_EGRESS_MARKER = "independent resolver egress"
CANONICAL_GOOL_MARKER = "tunneled through outer warp via"


def function_span(source: str, signature: str) -> tuple[int, int]:
    start = source.find(signature)
    if start < 0:
        raise SystemExit(f"expected function was not found: {signature}")
    brace = source.find("{", start)
    if brace < 0:
        raise SystemExit(f"opening brace was not found for: {signature}")

    depth = 0
    for index in range(brace, len(source)):
        character = source[index]
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                while end < len(source) and source[end] in "\r\n":
                    end += 1
                return start, end
    raise SystemExit(f"closing brace was not found for: {signature}")


def replace_function(source: str, signature: str, replacement: str) -> str:
    start, end = function_span(source, signature)
    return source[:start] + replacement + source[end:]


def required_replace(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise SystemExit(f"{label}: expected source was not found")
    return source.replace(old, new, 1)


def target_root(argument: str | None) -> Path:
    return Path(argument).resolve() if argument else ROOT


root = target_root(sys.argv[1] if len(sys.argv) > 1 else None)
main_rs = root / "vendor/aether/aether/src/main.rs"
wireguard_rs = root / "vendor/aether/aether/src/wireguard.rs"

for path in (main_rs, wireguard_rs):
    if not path.is_file():
        raise SystemExit(f"required Aether source was not found: {path}")

wireguard = wireguard_rs.read_text(encoding="utf-8")

old_constant = "const DATAPLANE_DNS: Ipv4Addr = Ipv4Addr::new(1, 1, 1, 1);"
new_constant = '''// Validate real internet egress rather than Cloudflare's own 1.1.1.1 service.
// Some edge addresses answer the internal DNS probe while dropping general traffic.
const DATAPLANE_DNS_SERVERS: [Ipv4Addr; 2] = [
    Ipv4Addr::new(8, 8, 8, 8),
    Ipv4Addr::new(9, 9, 9, 9),
];'''
if old_constant in wireguard:
    wireguard = wireguard.replace(old_constant, new_constant, 1)
elif "const DATAPLANE_DNS_SERVERS" not in wireguard:
    raise SystemExit("WireGuard independent resolver constants were not found")

old_probe_struct = '''struct DataplaneProbe {
    packet: Vec<u8>,
    dns_id: u16,
    source_port: u16,
    source_ip: Ipv4Addr,
}'''
new_probe_struct = '''struct DataplaneProbe {
    packet: Vec<u8>,
    dns_id: u16,
    source_port: u16,
    source_ip: Ipv4Addr,
    dns_server: Ipv4Addr,
}'''
if old_probe_struct in wireguard:
    wireguard = wireguard.replace(old_probe_struct, new_probe_struct, 1)
elif "dns_server: Ipv4Addr" not in wireguard:
    raise SystemExit("WireGuard dataplane probe server field was not installed")

build_probe = '''fn build_dataplane_probe(source: Ipv4Addr, dns_server: Ipv4Addr) -> DataplaneProbe {
    let dns_id: u16 = rand::random();
    let source_port: u16 = rand::thread_rng().gen_range(20_000..60_000);
    let dns = build_dns_query(dns_id);
    let udp_len = 8 + dns.len();
    let total_len = 20 + udp_len;
    let mut packet = Vec::with_capacity(total_len);
    packet.push(0x45);
    packet.push(0x00);
    packet.extend_from_slice(&(total_len as u16).to_be_bytes());
    let ip_id: u16 = rand::random();
    packet.extend_from_slice(&ip_id.to_be_bytes());
    packet.extend_from_slice(&[0x00, 0x00]);
    packet.push(64);
    packet.push(17);
    packet.extend_from_slice(&[0x00, 0x00]);
    packet.extend_from_slice(&source.octets());
    packet.extend_from_slice(&dns_server.octets());
    let checksum = ipv4_checksum(&packet[0..20]);
    packet[10..12].copy_from_slice(&checksum.to_be_bytes());
    packet.extend_from_slice(&source_port.to_be_bytes());
    packet.extend_from_slice(&53u16.to_be_bytes());
    packet.extend_from_slice(&(udp_len as u16).to_be_bytes());
    packet.extend_from_slice(&[0x00, 0x00]);
    packet.extend_from_slice(&dns);

    DataplaneProbe {
        packet,
        dns_id,
        source_port,
        source_ip: source,
        dns_server,
    }
}

'''
wireguard = replace_function(wireguard, "fn build_dataplane_probe", build_probe)

match_probe = '''fn is_matching_dataplane_response(packet: &[u8], probe: &DataplaneProbe) -> bool {
    if packet.len() < 20 || packet[0] >> 4 != 4 {
        return false;
    }
    let header_len = usize::from(packet[0] & 0x0f) * 4;
    if header_len < 20 || packet.len() < header_len + 8 + 12 || packet[9] != 17 {
        return false;
    }
    if packet[12..16] != probe.dns_server.octets()
        || packet[16..20] != probe.source_ip.octets()
    {
        return false;
    }

    let udp = &packet[header_len..];
    let source_port = u16::from_be_bytes([udp[0], udp[1]]);
    let destination_port = u16::from_be_bytes([udp[2], udp[3]]);
    if source_port != 53 || destination_port != probe.source_port {
        return false;
    }

    let dns = &udp[8..];
    let dns_id = u16::from_be_bytes([dns[0], dns[1]]);
    let flags = u16::from_be_bytes([dns[2], dns[3]]);
    dns_id == probe.dns_id && flags & 0x8000 != 0
}

'''
wireguard = replace_function(wireguard, "fn is_matching_dataplane_response", match_probe)

verify_dataplane = '''async fn verify_dataplane(
    sock: &UdpSocket,
    tunn: &mut Tunn,
    client_id: &[u8; 3],
    local_ipv4: Ipv4Addr,
    start: Instant,
    deadline: Instant,
) -> Result<Duration> {
    let probes = DATAPLANE_DNS_SERVERS
        .iter()
        .copied()
        .map(|server| build_dataplane_probe(local_ipv4, server))
        .collect::<Vec<_>>();
    let mut output = vec![0u8; MAX_PACKET];
    let mut recv_buffer = vec![0u8; MAX_PACKET];
    let mut temporary = vec![0u8; MAX_PACKET];

    for probe in &probes {
        send_dataplane_probe(sock, tunn, client_id, probe, &mut output).await?;
    }
    let mut resend_at = Instant::now() + DATAPLANE_RESEND_INTERVAL;

    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(AetherError::Other(
                "independent resolver egress timeout".into(),
            ));
        }
        if now >= resend_at {
            for probe in &probes {
                send_dataplane_probe(sock, tunn, client_id, probe, &mut output).await?;
            }
            resend_at = now + DATAPLANE_RESEND_INTERVAL;
        }
        let wait = deadline
            .saturating_duration_since(now)
            .min(resend_at.saturating_duration_since(now));

        tokio::select! {
            result = sock.recv(&mut recv_buffer) => {
                let read = result?;
                strip_client_id(&mut recv_buffer[..read]);
                let batch = decapsulate_batch(tunn, &recv_buffer[..read], &mut temporary);
                send_network_packets(sock, client_id, batch.network_packets).await?;
                if batch
                    .tunnel_packets
                    .iter()
                    .any(|packet| probes.iter().any(|probe| is_matching_dataplane_response(packet, probe)))
                {
                    return Ok(start.elapsed());
                }
            }
            _ = tokio::time::sleep(wait) => {}
        }
    }
}

'''
wireguard = replace_function(wireguard, "async fn verify_dataplane", verify_dataplane)

old_health_probe = "            let probe = build_dataplane_probe(local_ipv4);"
new_health_probe = '''            let probes = DATAPLANE_DNS_SERVERS
                .iter()
                .copied()
                .map(|server| build_dataplane_probe(local_ipv4, server))
                .collect::<Vec<_>>();'''
if old_health_probe in wireguard:
    wireguard = wireguard.replace(old_health_probe, new_health_probe, 1)
elif "let probes = DATAPLANE_DNS_SERVERS" not in wireguard:
    raise SystemExit("WireGuard health probes were not converted to independent resolvers")

old_health_send = '''                let mut tunn = tunn_h.lock().await;
                send_dataplane_probe(
                    &sock_h,
                    &mut tunn,
                    &client_id_h,
                    &probe,
                    &mut output,
                )
                .await?;'''
new_health_send = '''                let mut tunn = tunn_h.lock().await;
                for probe in &probes {
                    send_dataplane_probe(
                        &sock_h,
                        &mut tunn,
                        &client_id_h,
                        probe,
                        &mut output,
                    )
                    .await?;
                }'''
if old_health_send in wireguard:
    wireguard = wireguard.replace(old_health_send, new_health_send, 1)
elif "for probe in &probes" not in wireguard:
    raise SystemExit("WireGuard health probe fan-out was not installed")

wireguard = wireguard.replace(
    "let probe = build_dataplane_probe(Ipv4Addr::new(172, 16, 0, 2));",
    "let probe = build_dataplane_probe(\n            Ipv4Addr::new(172, 16, 0, 2),\n            DATAPLANE_DNS_SERVERS[0],\n        );",
    1,
)

if "dataplane_probes_use_independent_resolvers" not in wireguard:
    test_insert = '''
    #[test]
    fn dataplane_probes_use_independent_resolvers() {
        assert!(!DATAPLANE_DNS_SERVERS.contains(&Ipv4Addr::new(1, 1, 1, 1)));
        assert!(DATAPLANE_DNS_SERVERS.contains(&Ipv4Addr::new(8, 8, 8, 8)));
        assert!(DATAPLANE_DNS_SERVERS.contains(&Ipv4Addr::new(9, 9, 9, 9)));
    }
'''
    tests_start, tests_end = function_span(wireguard, "mod tests")
    closing = wireguard.rfind("}", tests_start, tests_end)
    wireguard = wireguard[:closing] + test_insert + wireguard[closing:]

if INDEPENDENT_EGRESS_MARKER not in wireguard:
    raise SystemExit("WireGuard independent egress validation marker is missing")
if "DATAPLANE_DNS" in wireguard.replace("DATAPLANE_DNS_SERVERS", ""):
    raise SystemExit("legacy Cloudflare-only dataplane resolver remains")

wireguard_rs.write_text(wireguard, encoding="utf-8")

main = main_rs.read_text(encoding="utf-8")

if "fn gool_inner_candidates" in main:
    start, end = function_span(main, "fn gool_inner_candidates")
    main = main[:start] + main[end:]

canonical_gool = '''async fn run_warp_in_warp(
    primary: account::Identity,
    secondary: account::Identity,
    peer: SocketAddr,
    listen: SocketAddr,
) -> Result<()> {
    log::info!("[*] establishing outer WARP tunnel to {peer}...");
    let mut outer = establish_wg(
        &primary,
        peer,
        TUNNEL_MTU,
        true,
        wg_keepalive_secs(),
        wg_tunnel_validate_timeout(),
        "outer",
    )
    .await?;

    // Canonical Gool routing: the inner WireGuard peer is reached through the
    // validated outer stack. The independent-endpoint experiment caused every
    // inner candidate to fail and diverged from the proven reference design.
    let mut forwarder = spawn_udp_forwarder(&outer.stack, peer).await?;
    log::info!(
        "[+] inner endpoint {peer} tunneled through outer warp via {}",
        forwarder.local_address
    );

    log::info!("[*] establishing inner WARP tunnel (warp-in-warp)...");
    let mut inner = establish_wg(
        &secondary,
        forwarder.local_address,
        INNER_MTU,
        false,
        20,
        wg_tunnel_validate_timeout(),
        "inner",
    )
    .await?;

    let socks_stack = inner.stack.clone();
    let mut socks_task = tokio::spawn(async move {
        log::info!("[+] socks5 server listening on {listen}");
        socks::serve(listen, socks_stack).await
    });

    let result = tokio::select! {
        outer_result = &mut outer.task => {
            flatten_runtime_task("gool outer tunnel", outer_result)
        }
        upload_result = &mut forwarder.upload_task => {
            flatten_runtime_task("gool forwarder upload", upload_result)
        }
        download_result = &mut forwarder.download_task => {
            flatten_runtime_task("gool forwarder download", download_result)
        }
        inner_result = &mut inner.task => {
            flatten_runtime_task("gool inner tunnel", inner_result)
        }
        socks_result = &mut socks_task => {
            flatten_runtime_task("gool SOCKS server", socks_result)
        }
    };

    socks_task.abort();
    result
}

'''
main = replace_function(main, "async fn run_warp_in_warp", canonical_gool)

for forbidden in (
    "trying independent inner WARP endpoint",
    "spawn_udp_forwarder(&outer.stack, inner_peer)",
    "fn gool_inner_candidates",
):
    if forbidden in main:
        raise SystemExit(f"failed independent Gool routing remains: {forbidden}")
if CANONICAL_GOOL_MARKER not in main:
    raise SystemExit("canonical same-peer Gool routing marker is missing")
if "spawn_udp_forwarder(&outer.stack, peer)" not in main:
    raise SystemExit("canonical Gool forwarder target is missing")

main_rs.write_text(main, encoding="utf-8")
print(f"Patched real WireGuard egress validation and canonical Gool routing in {root}")
