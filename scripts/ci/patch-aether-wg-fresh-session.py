#!/usr/bin/env python3

from __future__ import annotations

import re
import sys
from pathlib import Path


DEFAULT_ROOT = Path(__file__).resolve().parents[2]
# Keep the legacy filename because local and manual Android build scripts already
# invoke it. The policy is now the opposite of the original experiment: retain
# the session whose handshake and data plane were actually validated.
ESTABLISHED_MARKER = "validated session retained for runtime handoff"
FRESH_SESSION_MARKER = "validated with disposable probe session; starting fresh runtime session"
FRESH_READY_MARKER = "fresh WireGuard runtime data-plane ready"


def target_file(argument: str | None) -> Path:
    root = Path(argument).resolve() if argument else DEFAULT_ROOT
    if root.is_file():
        return root
    return root / "vendor/aether/aether/src/main.rs"


def function_span(source: str, signature: str) -> tuple[int, int]:
    start = source.find(signature)
    if start < 0:
        raise SystemExit(f"expected function was not found: {signature}")
    brace = source.find("{", start)
    if brace < 0:
        raise SystemExit(f"opening brace was not found for: {signature}")

    depth = 0
    for index in range(brace, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                while end < len(source) and source[end] in "\r\n":
                    end += 1
                return start, end
    raise SystemExit(f"closing brace was not found for: {signature}")


def replace_function(source: str, signature: str, transform) -> str:
    start, end = function_span(source, signature)
    block = source[start:end]
    updated = transform(block)
    return source[:start] + updated + source[end:]


def replace_between(block: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = block.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}: start marker was not found")
    end = block.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}: end marker was not found")
    return block[:start] + replacement + block[end:]


def transform_simple_runtime(block: str) -> str:
    validation = '''    let private_key = identity.private_key_bytes()?;
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
    log::info!(
        "[+] wireguard tunnel validated (end-to-end data confirmed); validated session retained for runtime handoff"
    );

'''
    block = replace_between(
        block,
        "    let private_key = identity.private_key_bytes()?;",
        "    let (outbound_tx, outbound_rx)",
        validation,
        "simple WireGuard validation handoff",
    )

    tunnel = '''    let tunnel = wireguard::WgTunnel::from_established(
        session,
        std::sync::Arc::new(aethernoize),
        inbound_tx,
        local_ipv4,
    );
'''
    block = replace_between(
        block,
        "    let tunnel =",
        "    let stack =",
        tunnel,
        "simple WireGuard established tunnel",
    )

    block = re.sub(
        r'(    let mut tunnel_task = tokio::spawn\(tunnel\.run\(outbound_rx\)\);\r?\n)'
        r'    if let Err\(error\) = warm_up_wg_stack\(&stack, "wireguard"\)\.await \{\r?\n'
        r'        tunnel_task\.abort\(\);\r?\n'
        r'        return Err\(error\);\r?\n'
        r'    \}\r?\n',
        r'\1',
        block,
        count=1,
    )
    return block


def transform_nested_runtime(block: str) -> str:
    validation = '''    let private_key = identity.private_key_bytes()?;
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
    log::info!(
        "[+] [{label}] wireguard tunnel validated (end-to-end data confirmed); validated session retained for runtime handoff"
    );

'''
    block = replace_between(
        block,
        "    let private_key = identity.private_key_bytes()?;",
        "    let (outbound_tx, outbound_rx)",
        validation,
        "nested WireGuard validation handoff",
    )

    tunnel = '''    let tunnel = wireguard::WgTunnel::from_established(
        session,
        std::sync::Arc::new(profile),
        inbound_tx,
        local_ipv4,
    );
'''
    block = replace_between(
        block,
        "    let tunnel =",
        "    let stack =",
        tunnel,
        "nested WireGuard established tunnel",
    )

    block = re.sub(
        r'(    let task = tokio::spawn\(tunnel\.run\(outbound_rx\)\);\r?\n)'
        r'    if let Err\(error\) = warm_up_wg_stack\(&stack, label\)\.await \{\r?\n'
        r'        task\.abort\(\);\r?\n'
        r'        return Err\(error\);\r?\n'
        r'    \}\r?\n',
        r'\1',
        block,
        count=1,
    )
    return block


main_rs = target_file(sys.argv[1] if len(sys.argv) > 1 else None)
if not main_rs.is_file():
    raise SystemExit(f"Aether main.rs was not found at {main_rs}")

source = main_rs.read_text(encoding="utf-8")
source = replace_function(source, "async fn run_wireguard_tunnel", transform_simple_runtime)
source = replace_function(source, "async fn establish_wg", transform_nested_runtime)

# Remove the failed fresh-session warm-up experiment when migrating a working
# tree that was already patched by an earlier Android build.
if "async fn warm_up_wg_stack" in source:
    start, end = function_span(source, "async fn warm_up_wg_stack")
    source = source[:start] + source[end:]

# The fresh-session patch introduced IPv6 parsing only to construct WgConfig.
# Remove that now-unused helper/import without touching unrelated IPv6 code.
if source.count("parse_local_v6") == 1 and "fn parse_local_v6" in source:
    start, end = function_span(source, "fn parse_local_v6")
    source = source[:start] + source[end:]
if source.count("Ipv6Addr") == 1:
    source = source.replace(
        "use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};",
        "use std::net::{IpAddr, Ipv4Addr, SocketAddr};",
        1,
    )

for name in ("run_wireguard_tunnel", "establish_wg"):
    start, end = function_span(source, f"async fn {name}")
    block = source[start:end]
    if "verify_endpoint_keep_session" not in block:
        raise SystemExit(f"{name}: validated session handoff is missing")
    if "WgTunnel::from_established" not in block:
        raise SystemExit(f"{name}: established session is not retained")
    if "WgTunnel::new(runtime_config" in block:
        raise SystemExit(f"{name}: failed fresh runtime construction still exists")
    if "warm_up_wg_stack" in block:
        raise SystemExit(f"{name}: failed fresh runtime warm-up still exists")

for forbidden in (FRESH_SESSION_MARKER, FRESH_READY_MARKER, "async fn warm_up_wg_stack"):
    if forbidden in source:
        raise SystemExit(f"failed fresh-session experiment remains: {forbidden}")
if source.count(ESTABLISHED_MARKER) < 2:
    raise SystemExit("validated-session runtime markers were not installed")

main_rs.write_text(source, encoding="utf-8")
print(f"Retained validated WireGuard sessions for runtime handoff in {main_rs}")
