#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


DEFAULT_ROOT = Path(__file__).resolve().parents[2]
SESSION_MARKER = "validated with disposable probe session; starting fresh runtime session"
READY_MARKER = "fresh WireGuard runtime data-plane ready"


def required_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: expected source block was not found")
    return text.replace(old, new, 1)


def target_file(argument: str | None) -> Path:
    root = Path(argument).resolve() if argument else DEFAULT_ROOT
    if root.is_file():
        return root
    return root / "vendor/aether/aether/src/main.rs"


main_rs = target_file(sys.argv[1] if len(sys.argv) > 1 else None)
if not main_rs.is_file():
    raise SystemExit(f"Aether main.rs was not found at {main_rs}")

source = main_rs.read_text(encoding="utf-8")

# The endpoint validation session deliberately carries probe traffic and state.
# Build a clean runtime session instead of handing that consumed session to the
# reusable netstack/SOCKS path.
if SESSION_MARKER not in source:
    source = required_replace(
        source,
        "use std::net::{IpAddr, Ipv4Addr, SocketAddr};",
        "use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};",
        "IPv6 import",
    )

    v4_parser = '''fn parse_local_v4(value: &str) -> Result<Ipv4Addr> {
    let raw = value.split('/').next().unwrap_or(value).trim();
    let address: Ipv4Addr = raw
        .parse()
        .map_err(|_| AetherError::Other(format!("invalid IPv4 identity address '{value}'")))?;
    if address.is_unspecified() {
        return Err(AetherError::Other(format!(
            "unspecified IPv4 identity address '{value}'"
        )));
    }
    Ok(address)
}
'''

    v6_parser = v4_parser + '''
fn parse_local_v6(value: &str) -> Result<Ipv6Addr> {
    let raw = value.split('/').next().unwrap_or(value).trim();
    let address: Ipv6Addr = raw
        .parse()
        .map_err(|_| AetherError::Other(format!("invalid IPv6 identity address '{value}'")))?;
    if address.is_unspecified() {
        return Err(AetherError::Other(format!(
            "unspecified IPv6 identity address '{value}'"
        )));
    }
    Ok(address)
}
'''
    source = required_replace(source, v4_parser, v6_parser, "IPv6 identity parser")

    old_runtime_validation = '''    let private_key = identity.private_key_bytes()?;
    let peer_public_key = identity.peer_public_key_bytes()?;
    let local_ipv4 = parse_local_v4(&identity.ipv4)?;

    log::info!(
        "[*] validating WireGuard tunnel with {peer} (handshake + data-plane) before exposing socks5..."
    );
    let (_, session) = wireguard::verify_endpoint_keep_session(
        peer,
        private_key,
        peer_public_key,
        identity.client_id,
        local_ipv4,
        &aethernoize,
        wg_tunnel_validate_timeout(),
        Some(wg_keepalive_secs()),
    )
    .await
    .map_err(|error| AetherError::Other(format!("tunnel failed validation: {error}")))?;
    log::info!("[+] wireguard tunnel validated (end-to-end data confirmed); exposing socks5");
'''
    new_runtime_validation = '''    let private_key = identity.private_key_bytes()?;
    let peer_public_key = identity.peer_public_key_bytes()?;
    let local_ipv4 = parse_local_v4(&identity.ipv4)?;
    let local_ipv6 = parse_local_v6(&identity.ipv6)?;

    log::info!(
        "[*] validating WireGuard endpoint with a disposable probe session before exposing socks5..."
    );
    wireguard::verify_endpoint(
        peer,
        private_key,
        peer_public_key,
        identity.client_id,
        local_ipv4,
        &aethernoize,
        wg_tunnel_validate_timeout(),
        Some(wg_keepalive_secs()),
    )
    .await
    .map_err(|error| AetherError::Other(format!("tunnel failed validation: {error}")))?;
    log::info!("[+] wireguard endpoint {SESSION_MARKER}");

    let runtime_config = wireguard::WgConfig {
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
'''.replace("{SESSION_MARKER}", SESSION_MARKER)
    source = required_replace(
        source,
        old_runtime_validation,
        new_runtime_validation,
        "WireGuard runtime validation handoff",
    )

    old_runtime_tunnel = '''    let tunnel = wireguard::WgTunnel::from_established(
        session,
        std::sync::Arc::new(aethernoize),
        inbound_tx,
        local_ipv4,
    );
'''
    new_runtime_tunnel = '''    let tunnel = wireguard::WgTunnel::new(runtime_config, inbound_tx).await?;
'''
    source = required_replace(
        source,
        old_runtime_tunnel,
        new_runtime_tunnel,
        "WireGuard fresh runtime tunnel",
    )

    old_nested_validation = '''    let private_key = identity.private_key_bytes()?;
    let peer_public_key = identity.peer_public_key_bytes()?;
    let local_ipv4 = parse_local_v4(&identity.ipv4)?;

    let profile = if obfuscate {
        aethernoize_config()
    } else {
        aethernoize::from_profile("off")
    };

    log::info!(
        "[*] [{label}] validating WireGuard tunnel with {peer} (handshake + data-plane)..."
    );
    let (_, session) = wireguard::verify_endpoint_keep_session(
        peer,
        private_key,
        peer_public_key,
        identity.client_id,
        local_ipv4,
        &profile,
        wg_tunnel_validate_timeout(),
        Some(keepalive.clamp(1, 120)),
    )
    .await
    .map_err(|error| {
        AetherError::Other(format!("[{label}] tunnel failed validation: {error}"))
    })?;
    log::info!("[+] [{label}] wireguard tunnel validated (end-to-end data confirmed)");
'''
    new_nested_validation = '''    let private_key = identity.private_key_bytes()?;
    let peer_public_key = identity.peer_public_key_bytes()?;
    let local_ipv4 = parse_local_v4(&identity.ipv4)?;
    let local_ipv6 = parse_local_v6(&identity.ipv6)?;

    let profile = if obfuscate {
        aethernoize_config()
    } else {
        aethernoize::from_profile("off")
    };

    log::info!(
        "[*] [{label}] validating WireGuard endpoint with a disposable probe session..."
    );
    wireguard::verify_endpoint(
        peer,
        private_key,
        peer_public_key,
        identity.client_id,
        local_ipv4,
        &profile,
        wg_tunnel_validate_timeout(),
        Some(keepalive.clamp(1, 120)),
    )
    .await
    .map_err(|error| {
        AetherError::Other(format!("[{label}] tunnel failed validation: {error}"))
    })?;
    log::info!("[+] [{label}] wireguard endpoint {SESSION_MARKER}");

    let runtime_config = wireguard::WgConfig {
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
'''.replace("{SESSION_MARKER}", SESSION_MARKER)
    source = required_replace(
        source,
        old_nested_validation,
        new_nested_validation,
        "nested WireGuard validation handoff",
    )

    old_nested_tunnel = '''    let tunnel = wireguard::WgTunnel::from_established(
        session,
        std::sync::Arc::new(profile),
        inbound_tx,
        local_ipv4,
    );
'''
    new_nested_tunnel = '''    let tunnel = wireguard::WgTunnel::new(runtime_config, inbound_tx).await?;
'''
    source = required_replace(
        source,
        old_nested_tunnel,
        new_nested_tunnel,
        "nested WireGuard fresh runtime tunnel",
    )

# A fresh WgTunnel has not authenticated yet. Gool must not start its inner
# forwarder on an outer stack that merely exists; drive and verify actual DNS
# traffic through each fresh runtime stack first. This is a real readiness gate,
# not a timing sleep.
if READY_MARKER not in source:
    running_drop = '''impl Drop for RunningWireGuard {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn establish_wg(
'''
    ready_helper = '''impl Drop for RunningWireGuard {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn warm_up_wg_stack(stack: &netstack::StackHandle, label: &str) -> Result<()> {
    const ATTEMPTS: usize = 3;
    let mut last_error = None;

    for attempt in 1..=ATTEMPTS {
        match socks::dns_resolve(stack, "www.cloudflare.com").await {
            Ok(address) => {
                log::info!(
                    "[+] [{label}] fresh WireGuard runtime data-plane ready via {address}"
                );
                return Ok(());
            }
            Err(error) => {
                log::warn!(
                    "[-] [{label}] fresh runtime warm-up attempt {attempt}/{ATTEMPTS} failed: {error}"
                );
                last_error = Some(error.to_string());
                if attempt < ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                }
            }
        }
    }

    Err(AetherError::Other(format!(
        "[{label}] fresh runtime data-plane warm-up failed: {}",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    )))
}

async fn establish_wg(
'''
    source = required_replace(
        source,
        running_drop,
        ready_helper,
        "fresh WireGuard runtime ready helper",
    )

    simple_spawn = '''    let mut tunnel_task = tokio::spawn(tunnel.run(outbound_rx));
    let socks_stack = stack.clone();
'''
    simple_ready = '''    let mut tunnel_task = tokio::spawn(tunnel.run(outbound_rx));
    if let Err(error) = warm_up_wg_stack(&stack, "wireguard").await {
        tunnel_task.abort();
        return Err(error);
    }
    let socks_stack = stack.clone();
'''
    source = required_replace(
        source,
        simple_spawn,
        simple_ready,
        "simple WireGuard runtime ready gate",
    )

    nested_spawn = '''    let task = tokio::spawn(tunnel.run(outbound_rx));

    Ok(RunningWireGuard { stack, task })
'''
    nested_ready = '''    let task = tokio::spawn(tunnel.run(outbound_rx));
    if let Err(error) = warm_up_wg_stack(&stack, label).await {
        task.abort();
        return Err(error);
    }

    Ok(RunningWireGuard { stack, task })
'''
    source = required_replace(
        source,
        nested_spawn,
        nested_ready,
        "nested WireGuard runtime ready gate",
    )

for name in ("run_wireguard_tunnel", "establish_wg"):
    block = source.split(f"async fn {name}", 1)[1].split("\n}\n", 1)[0]
    if "WgTunnel::from_established" in block:
        raise SystemExit(f"{name}: validation session reuse survived patching")
    if "WgTunnel::new" not in block:
        raise SystemExit(f"{name}: fresh runtime tunnel was not installed")

if "async fn warm_up_wg_stack" not in source:
    raise SystemExit("fresh WireGuard runtime ready helper is missing")
if 'warm_up_wg_stack(&stack, "wireguard")' not in source:
    raise SystemExit("simple WireGuard runtime ready gate is missing")
if "warm_up_wg_stack(&stack, label)" not in source:
    raise SystemExit("nested WireGuard runtime ready gate is missing")

main_rs.write_text(source, encoding="utf-8")
print(f"Patched and readiness-gated Aether WireGuard runtime sessions in {main_rs}")
