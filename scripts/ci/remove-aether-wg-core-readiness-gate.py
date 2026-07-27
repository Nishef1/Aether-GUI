#!/usr/bin/env python3

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REMOVAL_MARKER = "Android owns final SOCKS egress readiness"


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


def remove_simple_gate(block: str) -> str:
    # Current supervised gate.
    supervised = re.compile(
        r"    let mut tunnel_task = tokio::spawn\(tunnel\.run\(outbound_rx\)\);\r?\n"
        r"    // runtime readiness task supervision:.*?"
        r"\r?\n    }\r?\n"
        r"(?=    let socks_stack = stack\.clone\(\);)",
        re.DOTALL,
    )
    replacement = (
        "    let mut tunnel_task = tokio::spawn(tunnel.run(outbound_rx));\n"
        f"    // {REMOVAL_MARKER}; AndroidEgressProbe runs before Connected/TUN.\n"
    )
    block, count = supervised.subn(replacement, block, count=1)
    if count:
        return block

    # Earlier unsupervised HTTP gate.
    legacy = re.compile(
        r"    let mut tunnel_task = tokio::spawn\(tunnel\.run\(outbound_rx\)\);\r?\n"
        r"    if let Err\(error\) = verify_wg_runtime_egress\(&stack, \"wireguard\"\)\.await \{\r?\n"
        r"        tunnel_task\.abort\(\);\r?\n"
        r"        return Err\(error\);\r?\n"
        r"    }\r?\n",
    )
    block, count = legacy.subn(replacement, block, count=1)
    if count:
        return block

    if REMOVAL_MARKER in block:
        return block
    if "verify_wg_runtime_egress" not in block:
        spawn = "    let mut tunnel_task = tokio::spawn(tunnel.run(outbound_rx));\n"
        if spawn not in block:
            raise SystemExit("simple WireGuard runtime spawn was not found")
        return block.replace(spawn, replacement, 1)
    raise SystemExit("unrecognized simple WireGuard readiness gate")


def remove_nested_gate(block: str) -> str:
    supervised = re.compile(
        r"    let mut task = tokio::spawn\(tunnel\.run\(outbound_rx\)\);\r?\n"
        r"    // runtime readiness task supervision:.*?"
        r"\r?\n    }\r?\n"
        r"(?=\r?\n?    Ok\(RunningWireGuard \{ stack, task \}\))",
        re.DOTALL,
    )
    replacement = (
        "    let task = tokio::spawn(tunnel.run(outbound_rx));\n"
        f"    // {REMOVAL_MARKER}; outer/inner readiness is verified through SOCKS.\n"
    )
    block, count = supervised.subn(replacement, block, count=1)
    if count:
        return block

    legacy = re.compile(
        r"    let task = tokio::spawn\(tunnel\.run\(outbound_rx\)\);\r?\n"
        r"    if let Err\(error\) = verify_wg_runtime_egress\(&stack, label\)\.await \{\r?\n"
        r"        task\.abort\(\);\r?\n"
        r"        return Err\(error\);\r?\n"
        r"    }\r?\n",
    )
    block, count = legacy.subn(replacement, block, count=1)
    if count:
        return block

    if REMOVAL_MARKER in block:
        return block
    if "verify_wg_runtime_egress" not in block:
        for spawn in (
            "    let task = tokio::spawn(tunnel.run(outbound_rx));\n",
            "    let mut task = tokio::spawn(tunnel.run(outbound_rx));\n",
        ):
            if spawn in block:
                return block.replace(spawn, replacement, 1)
        raise SystemExit("nested WireGuard runtime spawn was not found")
    raise SystemExit("unrecognized nested WireGuard readiness gate")


def target_root(argument: str | None) -> Path:
    return Path(argument).resolve() if argument else ROOT


root = target_root(sys.argv[1] if len(sys.argv) > 1 else None)
main_rs = root / "vendor/aether/aether/src/main.rs"
if not main_rs.is_file():
    raise SystemExit(f"Aether main.rs was not found at {main_rs}")

source = main_rs.read_text(encoding="utf-8")
source = replace_function(source, "async fn run_wireguard_tunnel", remove_simple_gate)
source = replace_function(source, "async fn establish_wg", remove_nested_gate)

if "async fn verify_wg_runtime_egress" in source:
    start, end = function_span(source, "async fn verify_wg_runtime_egress")
    source = source[:start] + source[end:]

simple_start, simple_end = function_span(source, "async fn run_wireguard_tunnel")
simple = source[simple_start:simple_end]
nested_start, nested_end = function_span(source, "async fn establish_wg")
nested = source[nested_start:nested_end]

for label, block in (("simple", simple), ("nested", nested)):
    if REMOVAL_MARKER not in block:
        raise SystemExit(f"{label} Android readiness delegation marker is missing")
    if "verify_wg_runtime_egress" in block:
        raise SystemExit(f"{label} still contains the duplicate core HTTP gate")
    if "runtime readiness task supervision" in block:
        raise SystemExit(f"{label} still contains obsolete readiness supervision")

if "async fn verify_wg_runtime_egress" in source:
    raise SystemExit("obsolete core runtime HTTP helper remains")

main_rs.write_text(source, encoding="utf-8")
print(f"Delegated final WireGuard/Gool SOCKS egress readiness to Android in {main_rs}")
