from __future__ import annotations

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class AndroidEgressSafetyTest(unittest.TestCase):
    def read(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_neutral_identity_probe_is_separate_from_geo_policy(self) -> None:
        probe = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt"
        )
        self.assertIn("api4.ipify.org", probe)
        self.assertIn("checkip.amazonaws.com", probe)
        self.assertIn('label = "ip-api-geo"', probe)
        self.assertIn("Public identity and GeoIP are observational data", probe)
        self.assertNotIn("AndroidEgressIdentityGuard", probe)
        self.assertNotIn("EgressIdentityLeakException", probe)
        self.assertNotIn("reportSafetyFailure", probe)

    def test_location_never_blocks_a_healthy_low_latency_tunnel(self) -> None:
        probe = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt"
        )
        policy = self.read("src/lib/exitPolicy.ts")
        telemetry = self.read("src/state/telemetryStore.ts")
        self.assertIn("low-latency mode is allowed to keep a nearby WARP", probe)
        self.assertIn('export type ExitPreference = "low-latency" | "privacy"', policy)
        self.assertIn("isPrivacyPreferredExit", telemetry)
        self.assertIn("markExhausted", telemetry)
        self.assertIn("EXIT_RETRY_LIMIT = 4", policy)

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

    def test_android_connection_animation_uses_transform_only_css_loop(self) -> None:
        button = self.read("src/components/ConnectButton.tsx")
        css = self.read("src/index.css")
        self.assertIn("android-connect-spin", button)
        self.assertIn("android-connect-ripple", button)
        self.assertIn("@keyframes android-connect-spin", css)
        self.assertIn("@keyframes android-scan-indeterminate", css)
        self.assertIn("Only transform/opacity are animated", css)


if __name__ == "__main__":
    unittest.main(verbosity=2)
