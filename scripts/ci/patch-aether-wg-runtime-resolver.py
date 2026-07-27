#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RESOLVER_MARKER = "runtime DNS uses validated independent resolvers"


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


root = target_root(sys.argv[1] if len(sys.argv) > 1 else None)
socks_rs = root / "vendor/aether/aether/src/socks.rs"
if not socks_rs.is_file():
    raise SystemExit(f"Aether socks.rs was not found at {socks_rs}")

source = socks_rs.read_text(encoding="utf-8")
replacement = '''pub(crate) async fn dns_resolve(stack: &StackHandle, name: &str) -> Result<IpAddr> {
    // runtime DNS uses validated independent resolvers. The WireGuard dataplane
    // validator already proved that at least one independent destination is reachable;
    // 1.1.1.1 remains only as a compatibility fallback so the working MASQUE path
    // is preserved without making WARP runtime readiness depend on it exclusively.
    const TIMEOUT: Duration = Duration::from_secs(6);
    let servers = [
        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)), 53),
        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(9, 9, 9, 9)), 53),
        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)), 53),
    ];

    let udp = stack.open_udp().await?;
    let query = build_dns_query(name, 1);
    let mut sent = 0usize;
    for server in servers {
        if udp.send_to(server, query.clone()).await.is_ok() {
            sent += 1;
        }
    }
    if sent == 0 {
        udp.close().await;
        return Err(AetherError::Other(
            "dns query could not be sent to any resolver".into(),
        ));
    }

    let (sender, mut from_stack) = udp.into_split();
    let deadline = tokio::time::Instant::now() + TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            sender.close().await;
            return Err(AetherError::Other(
                "dns timeout across resolver race".into(),
            ));
        }

        let response = match tokio::time::timeout(remaining, from_stack.recv()).await {
            Ok(Some(response)) => response,
            Ok(None) => {
                sender.close().await;
                return Err(AetherError::Other("dns channel closed".into()));
            }
            Err(_) => {
                sender.close().await;
                return Err(AetherError::Other(
                    "dns timeout across resolver race".into(),
                ));
            }
        };

        if !servers.contains(&response.0) {
            continue;
        }
        if let Some(address) = parse_dns_a(&response.1) {
            sender.close().await;
            return Ok(address);
        }
    }
}

'''
source = replace_function(source, "pub(crate) async fn dns_resolve", replacement)

start, end = function_span(source, "pub(crate) async fn dns_resolve")
block = source[start:end]
if RESOLVER_MARKER not in block:
    raise SystemExit("runtime resolver marker is missing")
if "Ipv4Addr::new(8, 8, 8, 8)" not in block or "Ipv4Addr::new(9, 9, 9, 9)" not in block:
    raise SystemExit("validated independent runtime resolvers are missing")
if "Ipv4Addr::new(1, 1, 1, 1)" not in block:
    raise SystemExit("MASQUE-compatible Cloudflare DNS fallback is missing")
if 'let servers = [\n        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))' in block:
    raise SystemExit("Cloudflare DNS must not be the first runtime resolver")
if "sender.close().await" not in block:
    raise SystemExit("runtime DNS socket cleanup is missing")

socks_rs.write_text(source, encoding="utf-8")
print(f"Aligned runtime DNS with validated resolver race in {socks_rs}")
