#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SUPERVISION_MARKER = "runtime readiness task supervision"


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
    return source[:start] + transform(block) + source[end:]


def transform_simple(block: str) -> str:
    if SUPERVISION_MARKER in block:
        return block

    old = '''    let mut tunnel_task = tokio::spawn(tunnel.run(outbound_rx));
    if let Err(error) = verify_wg_runtime_egress(&stack, "wireguard").await {
        tunnel_task.abort();
        return Err(error);
    }
'''
    new = '''    let mut tunnel_task = tokio::spawn(tunnel.run(outbound_rx));
    // runtime readiness task supervision: surface an early transport failure instead
    // of misreporting it as a DNS timeout from the readiness probe.
    {
        let readiness = verify_wg_runtime_egress(&stack, "wireguard");
        tokio::pin!(readiness);
        tokio::select! {
            result = &mut tunnel_task => {
                return flatten_runtime_task("WireGuard tunnel during readiness", result);
            }
            result = &mut readiness => {
                if let Err(error) = result {
                    tunnel_task.abort();
                    return Err(error);
                }
            }
        }
    }
'''
    if old not in block:
        raise SystemExit("simple WireGuard readiness gate was not found")
    return block.replace(old, new, 1)


def transform_nested(block: str) -> str:
    if SUPERVISION_MARKER in block:
        return block

    old = '''    let task = tokio::spawn(tunnel.run(outbound_rx));
    if let Err(error) = verify_wg_runtime_egress(&stack, label).await {
        task.abort();
        return Err(error);
    }
'''
    new = '''    let mut task = tokio::spawn(tunnel.run(outbound_rx));
    // runtime readiness task supervision: outer/inner failures must win the race
    // against the HTTP readiness timeout and retain their real error message.
    {
        let readiness = verify_wg_runtime_egress(&stack, label);
        tokio::pin!(readiness);
        tokio::select! {
            result = &mut task => {
                return flatten_runtime_task("WireGuard tunnel during readiness", result);
            }
            result = &mut readiness => {
                if let Err(error) = result {
                    task.abort();
                    return Err(error);
                }
            }
        }
    }
'''
    if old not in block:
        raise SystemExit("nested WireGuard readiness gate was not found")
    return block.replace(old, new, 1)


def target_root(argument: str | None) -> Path:
    return Path(argument).resolve() if argument else ROOT


root = target_root(sys.argv[1] if len(sys.argv) > 1 else None)
main_rs = root / "vendor/aether/aether/src/main.rs"
if not main_rs.is_file():
    raise SystemExit(f"Aether main.rs was not found at {main_rs}")

source = main_rs.read_text(encoding="utf-8")
source = replace_function(source, "async fn run_wireguard_tunnel", transform_simple)
source = replace_function(source, "async fn establish_wg", transform_nested)

simple_start, simple_end = function_span(source, "async fn run_wireguard_tunnel")
simple = source[simple_start:simple_end]
nested_start, nested_end = function_span(source, "async fn establish_wg")
nested = source[nested_start:nested_end]
for label, block in (("simple", simple), ("nested", nested)):
    if SUPERVISION_MARKER not in block:
        raise SystemExit(f"{label} WireGuard runtime supervision marker is missing")
    if "tokio::select!" not in block:
        raise SystemExit(f"{label} WireGuard readiness does not supervise the runtime task")
    if "WireGuard tunnel during readiness" not in block:
        raise SystemExit(f"{label} WireGuard readiness error propagation is missing")

main_rs.write_text(source, encoding="utf-8")
print(f"Supervised WireGuard runtimes during readiness checks in {main_rs}")
