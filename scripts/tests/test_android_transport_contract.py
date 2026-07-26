#!/usr/bin/env python3

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
POLICY = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidTransportPolicy.kt"
UDP_PROBE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidUdpCapabilityProbe.kt"
POLICY_TEST = ROOT / "src-tauri/plugins/aether-vpn/android/src/test/java/AndroidTransportPolicyTest.kt"
CORE_MAIN = ROOT / "vendor/aether/aether/src/main.rs"
CORE_PROBER = ROOT / "vendor/aether/aether/src/prober.rs"
CORE_WG_PROBER = ROOT / "vendor/aether/aether/src/wg_prober.rs"


class AndroidTransportContractTest(unittest.TestCase):
    def test_protocol_specific_startup_deadlines_are_wired(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        self.assertIn("AndroidTransportPolicy.startupTimeoutMs(protocol, scanMode)", service)
        self.assertIn("waitForSocks(token, bindAddress, process, startupTimeoutMs)", service)
        self.assertNotIn("CORE_START_TIMEOUT_MS", service)
        for timeout in (
            "75_000L", "120_000L", "180_000L", "210_000L", "240_000L",
            "90_000L", "270_000L", "330_000L", "390_000L",
            "150_000L", "360_000L", "450_000L", "510_000L",
        ):
            self.assertIn(timeout, policy)

    def test_deadlines_exceed_the_core_scanner_budgets(self) -> None:
        masque = CORE_PROBER.read_text(encoding="utf-8")
        wireguard = CORE_WG_PROBER.read_text(encoding="utf-8")
        tests = POLICY_TEST.read_text(encoding="utf-8")
        self.assertIn("overall_deadline: Duration::from_secs(140)", masque)
        self.assertIn("overall_deadline: Duration::from_secs(150)", wireguard)
        self.assertIn("masqueTimeoutsExceedCoreScannerBudgets", tests)
        self.assertIn("wireGuardTimeoutsExceedCoreScannerBudgets", tests)
        self.assertIn("goolAllowsForOuterAndInnerWireGuardValidation", tests)

    def test_masque_auto_does_not_force_h3_when_udp_is_unavailable(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        probe = UDP_PROBE.read_text(encoding="utf-8")
        self.assertIn("AndroidUdpCapabilityProbe.hasUsableUdp()", service)
        self.assertIn("AndroidTransportPolicy.useMasqueHttp2", service)
        self.assertIn('environment.remove("AETHER_MASQUE_HTTP2")', service)
        self.assertIn('put("AETHER_MASQUE_HTTP2", "1")', service)
        self.assertNotIn('put("AETHER_MASQUE_HTTP2", if (masqueHttp2) "1" else "0")', service)
        self.assertIn("forceHttp2 || !udpAvailable", policy)
        self.assertIn("DatagramSocket", probe)
        self.assertIn('listOf("1.1.1.1", "8.8.8.8")', probe)

    def test_runtime_health_flags_cover_all_three_protocols(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        self.assertIn(
            "AndroidTransportPolicy.appendCoreArgs(command, protocol, useMasqueHttp2)",
            service,
        )
        for flag in (
            "--validate-secs",
            "--health-interval",
            "--health-timeout",
            "--health-failures",
            "--reconnect-secs",
            "--keepalive",
            "--wg-validate-secs",
            "--wg-health-interval",
            "--wg-stale-secs",
            "--wg-startup-secs",
            "--wg-reconnect-secs",
        ):
            self.assertIn(f'"{flag}"', policy)

    def test_android_outer_tun_mtu_matches_the_core_and_gool_inner_is_lower(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        core = CORE_MAIN.read_text(encoding="utf-8")
        self.assertIn("private const val TUN_MTU = AndroidTransportPolicy.TUN_MTU", service)
        self.assertIn("const val TUN_MTU = 1280", policy)
        self.assertIn("const TUNNEL_MTU: usize = 1280;", core)
        self.assertIn("const INNER_MTU: usize = 1200;", core)
        self.assertIn("assert!(INNER_MTU < TUNNEL_MTU)", core)


if __name__ == "__main__":
    unittest.main(verbosity=2)
