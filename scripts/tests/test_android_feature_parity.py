from __future__ import annotations

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class AndroidFeatureParityTest(unittest.TestCase):
    def read(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_shared_profile_exposes_official_aether_15_controls(self) -> None:
        source = self.read("src/types/connection.ts")
        for field in (
            "mtu", "peer", "wg_peer", "h2_peer", "ech", "no_data_check",
            "validate_secs", "reconnect_secs", "fragment", "fragment_size",
            "fragment_delay", "keepalive", "no_profile_retry", "tls_groups",
            "perf_profile", "zero_trust_team", "zero_trust_auth", "access_email",
            "access_client_id", "access_client_secret", "access_token",
            "zero_trust_gateway", "route_block", "route_direct", "routes_file",
        ):
            self.assertIn(f"{field}:", source)

    def test_android_cli_mapping_covers_official_user_controls(self) -> None:
        source = self.read("src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt")
        for flag in (
            "--peer", "--wg-peer", "--h2-peer", "--ech", "--no-data-check",
            "--validate-secs", "--reconnect-secs", "--fragment", "--fragment-size",
            "--fragment-delay", "--keepalive", "--no-profile-retry", "--dns",
            "--team", "--gateway", "--route-block", "--route-direct", "--routes",
            "--tls-groups", "--perf", "--config", "--wg-config", "--masque-config",
        ):
            self.assertIn(f'"{flag}"', source)

    def test_zero_trust_secrets_use_environment_and_are_not_persisted(self) -> None:
        kotlin = self.read("src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt")
        rust = self.read("src-tauri/src/android.rs")
        for key in (
            "AETHER_ACCESS_EMAIL", "AETHER_ACCESS_CLIENT_ID",
            "AETHER_ACCESS_CLIENT_SECRET", "AETHER_ACCESS_TOKEN",
        ):
            self.assertIn(key, kotlin)
        self.assertIn("without_secrets", rust)
        self.assertIn("persisted.profile = persisted.profile.without_secrets()", rust)

    def test_android_logging_is_opt_in_memory_only(self) -> None:
        runtime = self.read("src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt")
        service = self.read("src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt")
        rust = self.read("src-tauri/src/android.rs")
        self.assertIn("AtomicBoolean(false)", runtime)
        self.assertNotIn("File(", runtime)
        self.assertNotIn("writeText", runtime)
        self.assertNotIn("appendText", runtime)
        self.assertNotIn("log-file:", service)
        self.assertIn("log-level: warn", service)
        self.assertIn("set_logging(false)", rust)

    def test_android_teardown_and_otp_parser_do_not_leave_stale_state(self) -> None:
        service = self.read("src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt")
        runtime = self.read("src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt")
        self.assertIn('FinalServiceSnapshot("Disconnecting")', service)
        self.assertIn('AndroidVpnRuntime.updateSnapshot(AndroidVpnRuntime.idleSnapshot())', service)
        self.assertIn('partialOutput = ""', runtime)
        self.assertIn('EGRESS_PROBE_INTERVAL_MS = 300_000L', service)

    def test_android_task_close_stops_service_and_preserves_icon_parity(self) -> None:
        manifest = self.read("src-tauri/plugins/aether-vpn/android/src/main/AndroidManifest.xml")
        package = self.read("package.json")
        branding = self.read("scripts/apply-android-branding.mjs")
        icon_source = self.read("scripts/prepare-app-icon.mjs")
        gitignore = self.read(".gitignore")
        self.assertIn('android:stopWithTask="true"', manifest)
        self.assertIn('"prepare:app-icon"', package)
        self.assertIn('"apply:android-branding"', package)
        self.assertIn("128x128@2x.png", icon_source)
        self.assertIn("mipmap-anydpi-v26", branding)
        self.assertIn("ic_launcher_round.xml", branding)
        self.assertIn("src-tauri/icons/icon.png", gitignore)

    def test_android_mtu_is_shared_by_vpn_and_hev(self) -> None:
        service = self.read("src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt")
        panel = self.read("src/components/AdvancedPanel.tsx")
        self.assertIn(".setMtu(profile.mtu)", service)
        self.assertIn("mtu: $mtu", service)
        self.assertIn("min={1280}", panel)
        self.assertIn("max={1500}", panel)

    def test_mobile_polling_and_animations_are_visibility_aware(self) -> None:
        connection_store = self.read("src/state/connectionStore.ts")
        telemetry_store = self.read("src/state/telemetryStore.ts")
        background = self.read("src/components/AmbientBackground.tsx")
        self.assertIn('document.visibilityState !== "visible"', connection_store)
        self.assertIn('document.visibilityState !== "visible"', telemetry_store)
        self.assertIn("if (isAndroid) return null", background)
        self.assertIn("2_000", telemetry_store)

    def test_build_workflow_is_single_artifact_pipeline_not_release_automation(self) -> None:
        workflow = self.read(".github/workflows/build.yml")
        self.assertIn("android-arm64", workflow)
        self.assertIn("macos-15-intel", workflow)
        self.assertNotIn("tauri-action", workflow)
        self.assertNotIn("releaseDraft", workflow)
        self.assertNotIn('tags: ["v*"]', workflow)


if __name__ == "__main__":
    unittest.main(verbosity=2)
