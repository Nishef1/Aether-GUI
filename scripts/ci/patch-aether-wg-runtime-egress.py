#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
READY_MARKER = "retained WireGuard runtime egress ready"


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


def replace_function(source: str, signature: str, transform) -> str:
    start, end = function_span(source, signature)
    block = source[start:end]
    updated = transform(block)
    return source[:start] + updated + source[end:]


def transform_simple(block: str) -> str:
    marker = 'verify_wg_runtime_egress(&stack, "wireguard")'
    if marker in block:
        return block

    old = "    let mut tunnel_task = tokio::spawn(tunnel.run(outbound_rx));\n"
    new = '''    let mut tunnel_task = tokio::spawn(tunnel.run(outbound_rx));
    if let Err(error) = verify_wg_runtime_egress(&stack, "wireguard").await {
        tunnel_task.abort();
        return Err(error);
    }
'''
    if old not in block:
        raise SystemExit("simple WireGuard runtime spawn was not found")
    return block.replace(old, new, 1)


def transform_nested(block: str) -> str:
    marker = "verify_wg_runtime_egress(&stack, label)"
    if marker in block:
        return block

    old = "    let task = tokio::spawn(tunnel.run(outbound_rx));\n"
    new = '''    let task = tokio::spawn(tunnel.run(outbound_rx));
    if let Err(error) = verify_wg_runtime_egress(&stack, label).await {
        task.abort();
        return Err(error);
    }
'''
    if old not in block:
        raise SystemExit("nested WireGuard runtime spawn was not found")
    return block.replace(old, new, 1)


def target_main(argument: str | None) -> Path:
    root = Path(argument).resolve() if argument else ROOT
    return root / "vendor/aether/aether/src/main.rs"


main_rs = target_main(sys.argv[1] if len(sys.argv) > 1 else None)
if not main_rs.is_file():
    raise SystemExit(f"Aether main.rs was not found at {main_rs}")

source = main_rs.read_text(encoding="utf-8")
source = replace_function(source, "async fn run_wireguard_tunnel", transform_simple)
source = replace_function(source, "async fn establish_wg", transform_nested)

if "async fn verify_wg_runtime_egress" not in source:
    helper = '''async fn verify_wg_runtime_egress(
    stack: &netstack::StackHandle,
    label: &str,
) -> Result<()> {
    const TIMEOUT: Duration = Duration::from_secs(10);
    const HOST: &str = "www.gstatic.com";

    let attempt = async {
        let address = socks::dns_resolve(stack, HOST).await?;
        let target = SocketAddr::new(address, 80);
        let connection = stack.open_tcp(target).await?;
        let (sender, mut receiver) = connection.into_split();
        sender
            .send(
                format!(
                    "GET /generate_204 HTTP/1.1\\r\\nHost: {HOST}\\r\\nConnection: close\\r\\nUser-Agent: aether-runtime-check\\r\\n\\r\\n"
                )
                .into_bytes(),
            )
            .await?;

        let mut response = Vec::with_capacity(256);
        while response.len() < 2048 {
            match receiver.recv().await {
                Some(chunk) => {
                    response.extend_from_slice(&chunk);
                    if response.windows(4).any(|window| window == b"\\r\\n\\r\\n") {
                        break;
                    }
                }
                None => break,
            }
        }
        sender.close().await;

        let status = String::from_utf8_lossy(&response);
        let first_line = status.lines().next().unwrap_or("").trim();
        if first_line.starts_with("HTTP/") && first_line.contains(" 204") {
            Ok::<SocketAddr, AetherError>(target)
        } else {
            Err(AetherError::Other(format!(
                "runtime HTTP egress returned '{first_line}'"
            )))
        }
    };

    match tokio::time::timeout(TIMEOUT, attempt).await {
        Ok(Ok(target)) => {
            log::info!(
                "[+] [{label}] retained WireGuard runtime egress ready via {target}"
            );
            Ok(())
        }
        Ok(Err(error)) => Err(AetherError::Other(format!(
            "[{label}] retained runtime HTTP egress failed: {error}"
        ))),
        Err(_) => Err(AetherError::Other(format!(
            "[{label}] retained runtime HTTP egress timed out after {TIMEOUT:?}"
        ))),
    }
}

'''
    position = source.find("async fn establish_wg")
    if position < 0:
        raise SystemExit("nested WireGuard function was not found for helper insertion")
    source = source[:position] + helper + source[position:]

simple_start, simple_end = function_span(source, "async fn run_wireguard_tunnel")
simple = source[simple_start:simple_end]
nested_start, nested_end = function_span(source, "async fn establish_wg")
nested = source[nested_start:nested_end]

if 'verify_wg_runtime_egress(&stack, "wireguard")' not in simple:
    raise SystemExit("simple WireGuard runtime HTTP gate is missing")
if "verify_wg_runtime_egress(&stack, label)" not in nested:
    raise SystemExit("nested WireGuard runtime HTTP gate is missing")
if simple.index('verify_wg_runtime_egress(&stack, "wireguard")') > simple.index("socks::serve"):
    raise SystemExit("simple WireGuard SOCKS starts before runtime HTTP validation")
if READY_MARKER not in source:
    raise SystemExit("retained WireGuard runtime egress marker is missing")

main_rs.write_text(source, encoding="utf-8")
print(f"Gated retained WireGuard runtimes on real HTTP egress in {main_rs}")
