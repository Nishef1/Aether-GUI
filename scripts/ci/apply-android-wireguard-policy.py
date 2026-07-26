#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
PREFLIGHT = ROOT / "scripts/ci/test-android-plugin-kotlin.sh"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


service = SERVICE.read_text(encoding="utf-8")
service = replace_once(
    service,
    """            if (!waitForSocks(token, bindAddress, process, CORE_START_TIMEOUT_MS)) {\n""",
    """            val startupTimeoutMs = AndroidWireGuardPolicy.startupTimeoutMs(protocol, scanMode)\n            log(\"Waiting up to ${startupTimeoutMs / 1000}s for $protocol SOCKS readiness\")\n            if (!waitForSocks(token, bindAddress, process, startupTimeoutMs)) {\n""",
    "WireGuard startup timeout wiring",
)
service = replace_once(
    service,
    """        command += listOf(\n            \"--noize\",\n            if (protocol == \"wireguard\" || protocol == \"gool\") wgNoize else masqueNoize,\n            \"--bind\",\n            bindAddress,\n            \"--log-level\",\n            \"info\",\n        )\n        return command\n""",
    """        command += listOf(\n            \"--noize\",\n            if (protocol == \"wireguard\" || protocol == \"gool\") wgNoize else masqueNoize,\n            \"--bind\",\n            bindAddress,\n            \"--log-level\",\n            \"info\",\n        )\n        AndroidWireGuardPolicy.appendCoreArgs(command, protocol)\n        return command\n""",
    "WireGuard runtime argument wiring",
)
service = replace_once(
    service,
    """        private const val CORE_START_TIMEOUT_MS = 50_000L\n        private const val TUN_MTU = 8500\n""",
    """        private const val TUN_MTU = AndroidWireGuardPolicy.TUN_MTU\n""",
    "WireGuard MTU alignment",
)
SERVICE.write_text(service, encoding="utf-8")

preflight = PREFLIGHT.read_text(encoding="utf-8")
needle = '  python3 "$script_dir/../tests/test_android_kotlin_compile_contract.py" "$workspace"\n'
if needle not in preflight:
    raise SystemExit("Kotlin compile contract invocation not found")
if "test_android_wireguard_contract.py" not in preflight:
    preflight = preflight.replace(
        needle,
        needle + '  python3 "$script_dir/../tests/test_android_wireguard_contract.py"\n',
        1,
    )
PREFLIGHT.write_text(preflight, encoding="utf-8")

print("Android WireGuard policy applied successfully")
