#!/usr/bin/env python3

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
POLICY = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidWireGuardPolicy.kt"
POLICY_TEST = ROOT / "src-tauri/plugins/aether-vpn/android/src/test/java/AndroidWireGuardPolicyTest.kt"
CORE_MAIN = ROOT / "vendor/aether/aether/src/main.rs"


class AndroidWireGuardContractTest(unittest.TestCase):
    def test_android_waits_for_the_wireguard_scanner_budget(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        self.assertIn("AndroidWireGuardPolicy.startupTimeoutMs(protocol, scanMode)", service)
        self.assertIn("waitForSocks(token, bindAddress, process, startupTimeoutMs)", service)
        self.assertNotIn("CORE_START_TIMEOUT_MS", service)
        for timeout in ("90_000L", "180_000L", "270_000L", "330_000L", "390_000L"):
            self.assertIn(timeout, policy)

    def test_android_and_core_use_the_same_safe_mtu(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        core = CORE_MAIN.read_text(encoding="utf-8")
        self.assertIn("private const val TUN_MTU = AndroidWireGuardPolicy.TUN_MTU", service)
        self.assertIn("const val TUN_MTU = 1280", policy)
        self.assertIn("const TUNNEL_MTU: usize = 1280;", core)

    def test_wireguard_health_arguments_are_wired_into_the_core_command(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        self.assertIn("AndroidWireGuardPolicy.appendCoreArgs(command, protocol)", service)
        for flag in (
            "--keepalive",
            "--wg-validate-secs",
            "--wg-health-interval",
            "--wg-stale-secs",
            "--wg-startup-secs",
            "--wg-reconnect-secs",
        ):
            self.assertIn(f'"{flag}"', policy)

    def test_unit_test_covers_direct_wireguard_and_gool(self) -> None:
        source = POLICY_TEST.read_text(encoding="utf-8")
        self.assertIn('startupTimeoutMs("wireguard", "balanced")', source)
        self.assertIn('startupTimeoutMs("gool", "balanced")', source)
        self.assertIn("wireGuardRuntimeArgsAreExplicitAndStable", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
