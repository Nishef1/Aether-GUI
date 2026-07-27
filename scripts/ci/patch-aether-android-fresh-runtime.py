#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FRESH_RUNTIME_MARKER = "Android fresh WireGuard runtime"
SETTLE_DELAY_MARKER = "fresh outer runtime settle"


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


def target_root(argument: str | None) -> Path:
    return Path(argument).resolve() if argument else ROOT


SIMPLE_RUNTIME = r'''async fn run_wireguard_tunnel(
    identity: account::Identity,
    peer: SocketAddr,
    aethernoize: aethernoize::AetherNoizeConfig,
    listen: SocketAddr,
) -> Result<()> {
    let private_key = identity.private_key_bytes()?;
    let peer_public_key = identity.peer_public_key_bytes()?;
    let local_ipv4 = parse_local_v4(&identity.ipv4)?;
    let local_ipv6: std::net::Ipv6Addr = identity
        .ipv6
        .parse()
        .map_err(|_| AetherError::Other("invalid ipv6".into()))?;

    // Android fresh WireGuard runtime: the scanner proves that the endpoint is
    // reachable, but its probe socket/session is deliberately not reused. The
    // first real SOCKS request drives a clean BoringTun handshake on this runtime.
    log::info!(
        "[*] starting fresh WireGuard runtime with {peer} (endpoint verified during scan)"
    );
    let config = wireguard::WgConfig {
        local_private_key: private_key,
        peer_public_key,
        peer_endpoint: peer,
        local_ipv4,
        local_ipv6,
        client_id: identity.client_id,
        preshared_key: None,
        persistent_keepalive: Some(wg_keepalive_secs()),
        aethernoize: std::sync::Arc::new(aethernoize),
    };

    let (outbound_tx, outbound_rx) =
        tokio::sync::mpsc::channel(sysprofile::channel_capacity());
    let (inbound_tx, inbound_rx) =
        tokio::sync::mpsc::channel(sysprofile::channel_capacity());
    let tunnel = wireguard::WgTunnel::new(config, inbound_tx).await?;
    let stack = netstack::spawn(
        &identity.ipv4,
        &identity.ipv6,
        TUNNEL_MTU,
        inbound_rx,
        outbound_tx,
    )?;

    let mut tunnel_task = tokio::spawn(tunnel.run(outbound_rx));
    let socks_stack = stack.clone();
    let mut socks_task = tokio::spawn(async move {
        log::info!("[+] socks5 server listening on {listen}");
        socks::serve(listen, socks_stack).await
    });

    let result = tokio::select! {
        tunnel = &mut tunnel_task => flatten_runtime_task("WireGuard tunnel", tunnel),
        socks = &mut socks_task => flatten_runtime_task("SOCKS server", socks),
    };
    tunnel_task.abort();
    socks_task.abort();
    result
}

'''


NESTED_RUNTIME = r'''async fn establish_wg(
    identity: &account::Identity,
    peer: SocketAddr,
    mtu: usize,
    obfuscate: bool,
    keepalive: u16,
    label: &'static str,
) -> Result<RunningWireGuard> {
    let private_key = identity.private_key_bytes()?;
    let peer_public_key = identity.peer_public_key_bytes()?;
    let local_ipv4 = parse_local_v4(&identity.ipv4)?;
    let local_ipv6: std::net::Ipv6Addr = identity
        .ipv6
        .parse()
        .map_err(|_| AetherError::Other("invalid ipv6".into()))?;

    let profile = if obfuscate {
        aethernoize_config()
    } else {
        aethernoize::from_profile("off")
    };

    // Android fresh WireGuard runtime: outer and inner Gool layers each own an
    // independent BoringTun state machine and UDP socket from their first packet.
    log::info!("[*] [{label}] starting fresh WireGuard runtime with {peer}");
    let config = wireguard::WgConfig {
        local_private_key: private_key,
        peer_public_key,
        peer_endpoint: peer,
        local_ipv4,
        local_ipv6,
        client_id: identity.client_id,
        preshared_key: None,
        persistent_keepalive: Some(keepalive.clamp(1, 120)),
        aethernoize: std::sync::Arc::new(profile),
    };

    let (outbound_tx, outbound_rx) =
        tokio::sync::mpsc::channel(sysprofile::channel_capacity());
    let (inbound_tx, inbound_rx) =
        tokio::sync::mpsc::channel(sysprofile::channel_capacity());
    let tunnel = wireguard::WgTunnel::new(config, inbound_tx).await?;
    let stack = netstack::spawn(
        &identity.ipv4,
        &identity.ipv6,
        mtu,
        inbound_rx,
        outbound_tx,
    )?;
    let task = tokio::spawn(tunnel.run(outbound_rx));

    Ok(RunningWireGuard { stack, task })
}

'''


GOOL_RUNTIME = r'''async fn run_warp_in_warp(
    primary: account::Identity,
    secondary: account::Identity,
    peer: SocketAddr,
    listen: SocketAddr,
) -> Result<()> {
    log::info!("[*] establishing fresh outer WARP runtime to {peer}...");
    let mut outer = establish_wg(
        &primary,
        peer,
        TUNNEL_MTU,
        true,
        wg_keepalive_secs(),
        "outer",
    )
    .await?;

    // fresh outer runtime settle: retain the proven v1.3/Android startup order
    // before routing the inner handshake through the outer userspace stack.
    tokio::time::sleep(Duration::from_millis(1_500)).await;

    let mut forwarder = spawn_udp_forwarder(&outer.stack, peer).await?;
    log::info!(
        "[+] inner endpoint {peer} tunneled through outer warp via {}",
        forwarder.local_address
    );

    log::info!("[*] establishing fresh inner WARP runtime (warp-in-warp)...");
    let mut inner = establish_wg(
        &secondary,
        forwarder.local_address,
        INNER_MTU,
        false,
        20,
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


root = target_root(sys.argv[1] if len(sys.argv) > 1 else None)
main_rs = root / "vendor/aether/aether/src/main.rs"
if not main_rs.is_file():
    raise SystemExit(f"Aether main.rs was not found at {main_rs}")

source = main_rs.read_text(encoding="utf-8")
for required in (
    "struct RunningWireGuard",
    "struct UdpForwarder",
    "async fn spawn_udp_forwarder",
    "fn flatten_runtime_task",
):
    if required not in source:
        raise SystemExit(f"fresh runtime support is missing: {required}")

# Replace whole functions so this migrates pristine v1.4 sources as well as a
# local submodule already modified by any earlier retained/fresh-session patch.
source = replace_function(source, "async fn run_wireguard_tunnel", SIMPLE_RUNTIME)
source = replace_function(source, "async fn establish_wg", NESTED_RUNTIME)
source = replace_function(source, "async fn run_warp_in_warp", GOOL_RUNTIME)

# Remove a stale candidate helper from the abandoned independent-inner experiment.
if "fn gool_inner_candidates" in source:
    start, end = function_span(source, "fn gool_inner_candidates")
    source = source[:start] + source[end:]

for signature in ("async fn run_wireguard_tunnel", "async fn establish_wg"):
    start, end = function_span(source, signature)
    block = source[start:end]
    if FRESH_RUNTIME_MARKER not in block:
        raise SystemExit(f"{signature}: fresh Android runtime marker is missing")
    if "WgTunnel::new" not in block:
        raise SystemExit(f"{signature}: fresh WgTunnel construction is missing")
    if "verify_endpoint_keep_session" in block or "WgTunnel::from_established" in block:
        raise SystemExit(f"{signature}: retained probe session still reaches runtime")

start, end = function_span(source, "async fn run_warp_in_warp")
gool = source[start:end]
if SETTLE_DELAY_MARKER not in gool or "Duration::from_millis(1_500)" not in gool:
    raise SystemExit("Gool fresh outer settle delay is missing")
if "spawn_udp_forwarder(&outer.stack, peer)" not in gool:
    raise SystemExit("Gool does not use the canonical same-peer outer forwarder")
if "trying independent inner WARP endpoint" in gool:
    raise SystemExit("abandoned independent Gool endpoint experiment remains")

main_rs.write_text(source, encoding="utf-8")
print(f"Restored fresh Android WireGuard and Gool runtimes in {main_rs}")
