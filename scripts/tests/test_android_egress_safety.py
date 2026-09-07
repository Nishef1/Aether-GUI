from __future__ import annotations

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class AndroidEgressSafetyTest(unittest.TestCase):
    def read(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_neutral_identity_providers_precede_any_cloudflare_diagnostic(self) -> None:
        probe = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt"
        )
        guard = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressIdentityGuard.kt"
        )
        self.assertIn("api4.ipify.org", probe)
        self.assertIn("api6.ipify.org", probe)
        self.assertIn("checkip.amazonaws.com", probe)
        self.assertIn("api4.ipify.org", guard)
        self.assertIn("api6.ipify.org", guard)
        self.assertNotIn("www.cloudflare.com/cdn-cgi/trace", probe)

    def test_exact_underlay_ip_equality_is_fail_closed_not_country_based(self) -> None:
        guard = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressIdentityGuard.kt"
        )
        self.assertIn("underlayIps.none { sameIp(it, tunnelIp) }", guard)
        self.assertIn("EgressIdentityLeakException", guard)
        self.assertIn("reportSafetyFailure(message)", guard)
        self.assertIn("Country equality is therefore never treated as a leak", guard)

    def test_android_vpn_captures_both_address_families_without_allow_bypass(self) -> None:
        service = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
        )
        self.assertIn('.addRoute("0.0.0.0", 0)', service)
        self.assertIn('.addRoute("::", 0)', service)
        self.assertNotIn("allowBypass()", service)
        self.assertIn("builder.addDisallowedApplication(packageName)", service)

    def test_native_tun_must_survive_startup_and_exposes_running_state(self) -> None:
        facade = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/HevTun2Socks.kt"
        )
        native = self.read("scripts/native/aethertun-jni.c")
        runtime = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt"
        )
        self.assertIn("nativeIsRunning", facade)
        self.assertIn("Thread.sleep(150)", facade)
        self.assertIn("exited during startup", facade)
        self.assertIn("aether-hev-health", facade)
        self.assertIn("nativeIsRunning", native)
        self.assertIn("reportSafetyFailure", runtime)
        self.assertIn("traffic remains blocked to prevent an IP leak", runtime)

    def test_direct_routing_warns_about_original_ip_exposure(self) -> None:
        routing = self.read("src/components/RoutingSettings.tsx")
        self.assertIn("Direct rules intentionally bypass Aether", routing)
        self.assertIn("see your original network IP", routing)


if __name__ == "__main__":
    unittest.main(verbosity=2)
