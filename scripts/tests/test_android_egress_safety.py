from __future__ import annotations

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class AndroidEgressSafetyTest(unittest.TestCase):
    def read(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_geo_policy_is_separate_from_exact_ip_safety(self) -> None:
        probe = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt"
        )
        guard = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressIdentityGuard.kt"
        )
        self.assertIn("api4.ipify.org", probe)
        self.assertIn("checkip.amazonaws.com", probe)
        self.assertIn('label = "cloudflare-geo"', probe)
        self.assertIn('path = "/cdn-cgi/trace"', probe)
        self.assertNotIn("ip-api.com", probe)
        self.assertIn("AndroidEgressIdentityGuard.assertChanged", probe)
        self.assertIn("GeoIP/country is intentionally absent from this class", guard)
        self.assertIn("underlayIps.any { sameIp(it, tunnelIp) }", guard)
        self.assertIn("reportSafetyFailure(message)", guard)
        self.assertIn("BASELINE_TTL_MS", guard)

    def test_location_never_blocks_a_healthy_low_latency_tunnel(self) -> None:
        probe = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt"
        )
        policy = self.read("src/lib/exitPolicy.ts")
        telemetry = self.read("src/state/telemetryStore.ts")
        control = self.read("src/components/ExitPreferenceControl.tsx")
        self.assertIn("low-latency mode is allowed to keep a nearby WARP", probe)
        self.assertIn('export type ExitPreference = "low-latency" | "privacy"', policy)
        self.assertIn("isPrivacyPreferredExit", telemetry)
        self.assertIn("markExhausted", telemetry)
        self.assertIn("quick_reconnect: false", telemetry)
        self.assertIn("EXIT_RETRY_LIMIT = 2", policy)
        self.assertIn("Keeps the first healthy route and ignores country. Best for gaming.", control)
        self.assertIn("WARP cannot guarantee a specific country", control)

    def test_privacy_mode_uses_allowlist_and_manual_retry_after_budget(self) -> None:
        policy = self.read("src/lib/exitPolicy.ts")
        status = self.read("src/components/ConnectionStatusLine.tsx")
        for preferred in ("DE", "NL", "FI", "FR", "GB", "US", "CA", "JP", "SG"):
            self.assertIn(f'"{preferred}"', policy)
        preferred_block = policy.split("PRIVACY_PREFERRED_COUNTRIES", 1)[1]
        for excluded in ("IR", "CN", "RU"):
            self.assertNotIn(f'"{excluded}"', preferred_block.split("]);", 1)[0])
        self.assertIn("Try another exit", status)
        self.assertIn("current connection kept", status)

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

    def test_automatic_recovery_preserves_full_device_kill_switch(self) -> None:
        automatic = self.read("src/lib/autoConnect.ts")
        desktop_engine = self.read("src-tauri/src/engine/mod.rs")
        mobile_rust = self.read("src-tauri/src/android.rs")
        mobile_bridge = self.read("src-tauri/plugins/aether-vpn/src/lib.rs")
        mobile_service = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
        )

        self.assertIn('invoke("disconnect_for_recovery")', automatic)
        self.assertNotIn('isAndroid ? "disconnect"', automatic)

        self.assertIn("had_active_tunnel", desktop_engine)
        self.assertIn("suspend_attempt_for_recovery", desktop_engine)
        self.assertIn("disconnect_for_recovery", desktop_engine)

        self.assertIn("async fn disconnect_for_recovery", mobile_rust)
        self.assertIn("stop_for_recovery()", mobile_rust)
        self.assertIn('run_mobile_plugin("stopForRecovery"', mobile_bridge)
        self.assertIn("fun stopForRecovery", mobile_service)
        self.assertIn("ACTION_RECOVER", mobile_service)
        self.assertIn("detachCoreResources()", mobile_service)
        self.assertIn("recoveryHold", mobile_service)
        self.assertIn("attachedTunnelResources()", mobile_service)
        self.assertIn(
            "Reusing protected Android VPN interface during transport recovery",
            mobile_service,
        )
        self.assertIn(
            "Traffic is blocked until the next secure route is ready",
            mobile_service,
        )

    def test_android_diagnostics_are_bounded_exportable_and_secret_free(self) -> None:
        exporter = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidDiagnosticsExporter.kt"
        )
        runtime = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt"
        )
        initializer = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AetherDiagnosticsInitializer.kt"
        )
        mobile_service = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
        )
        bridge = self.read("src-tauri/plugins/aether-vpn/src/lib.rs")
        mobile_rust = self.read("src-tauri/src/android.rs")
        ui = self.read("src/components/AdvancedPanel.tsx")
        manifest = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/AndroidManifest.xml"
        )

        self.assertIn("MediaStore.Downloads.EXTERNAL_CONTENT_URI", exporter)
        self.assertIn("Environment.DIRECTORY_DOWNLOADS", exporter)
        self.assertIn('"runtime.json"', exporter)
        self.assertIn('"network-capabilities.json"', exporter)
        self.assertIn('"runtime.log"', exporter)
        self.assertIn("connectivity.allNetworks", exporter)
        self.assertIn("lastFailureSnapshot", exporter)
        self.assertIn("getHistoricalProcessExitReasons", exporter)
        self.assertIn("ApplicationExitInfo.REASON_CRASH_NATIVE", exporter)
        self.assertIn('"historical_process_exits"', exporter)
        self.assertIn("exits.take(5)", exporter)
        for secret in (
            "AETHER_ACCESS_TOKEN",
            "AETHER_ACCESS_CLIENT_SECRET",
            "AETHER_UPSTREAM",
        ):
            self.assertNotIn(secret, exporter)

        self.assertIn("MAX_INTERNAL_TAIL_LINES = 160", runtime)
        self.assertIn("MAX_FAILURE_CHARS = 4 * 1024", runtime)
        self.assertIn("Thread.setDefaultUncaughtExceptionHandler", runtime)
        self.assertIn("getSharedPreferences(FAILURE_PREFS", runtime)
        self.assertIn("recordFailure(\"safety\"", runtime)
        self.assertIn("AndroidVpnRuntime.initialize", initializer)
        self.assertIn("fun exportDiagnostics", mobile_service)
        self.assertIn('recordFailure("session"', mobile_service)
        self.assertIn('recordFailure("service-start"', mobile_service)
        self.assertIn('run_mobile_plugin("exportDiagnostics"', bridge)
        self.assertIn("pub struct DiagnosticsExport", bridge)
        self.assertIn("fn export_android_diagnostics", mobile_rust)
        self.assertIn("export_android_diagnostics,", mobile_rust)
        self.assertIn('invoke<AndroidDiagnosticsExport>("export_android_diagnostics")', ui)
        self.assertIn("Export ZIP", ui)
        self.assertIn("Downloads/Aether", ui)

        self.assertIn("android.permission.ACCESS_NETWORK_STATE", manifest)
        self.assertIn("AetherDiagnosticsInitializer", manifest)
        self.assertIn('android:exported="false"', manifest)
        self.assertNotIn("WRITE_EXTERNAL_STORAGE", manifest)
        self.assertNotIn("MANAGE_EXTERNAL_STORAGE", manifest)

    def test_direct_routing_warns_about_original_ip_exposure(self) -> None:
        routing = self.read("src/components/RoutingSettings.tsx")
        self.assertIn("Direct rules intentionally bypass Aether", routing)
        self.assertIn("see your original network IP", routing)

    def test_android_connection_animation_uses_transform_only_css_loop(self) -> None:
        button = self.read("src/components/ConnectButton.tsx")
        status = self.read("src/components/ConnectionStatusLine.tsx")
        css = self.read("src/index.css")
        self.assertIn("android-connect-spin", button)
        self.assertIn("android-connect-ripple", button)
        self.assertIn("android-scan-indeterminate", status)
        self.assertIn("@keyframes android-connect-spin", css)
        self.assertIn("@keyframes android-scan-indeterminate", css)
        self.assertIn("Only transform/opacity are animated", css)


if __name__ == "__main__":
    unittest.main(verbosity=2)
