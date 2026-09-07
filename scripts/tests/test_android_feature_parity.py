from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class Aether19ParityTest(unittest.TestCase):
    def read(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_runtime_manifest_pins_official_aether_19(self) -> None:
        versions = json.loads(self.read("scripts/runtime-versions.json"))
        self.assertEqual(versions["aether"]["version"], "v1.9.0")
        self.assertEqual(
            versions["aether"]["commit"],
            "311b573352bb67e494895ff67d20b002d075116a",
        )

    def test_shared_profile_exposes_aether_19_user_controls(self) -> None:
        source = self.read("src/types/connection.ts")
        for field in (
            "http_proxy", "upstream", "mtu", "peer", "wg_peer", "wiw_outer",
            "wiw_inner", "wiw_scan", "h2_peer", "ech", "no_data_check",
            "validate_secs", "reconnect_secs", "fragment", "fragment_size",
            "fragment_delay", "keepalive", "no_profile_retry", "tls_groups",
            "perf_profile", "route_sniff", "route_sniff_ms", "auto_reprovision",
            "zero_trust_team", "zero_trust_auth", "access_email", "access_client_id",
            "access_client_secret", "access_token", "zero_trust_gateway",
            "route_block", "route_direct", "routes_file",
        ):
            self.assertIn(f"{field}:", source)
        self.assertIn('"light"', source)
        self.assertIn('"aggressive"', source)

    def test_desktop_cli_contract_scopes_transport_specific_options(self) -> None:
        source = self.read("src-tauri/src/aether/profiles.rs")
        self.assertIn("match self.protocol", source)
        self.assertIn("Protocol::Auto | Protocol::Masque", source)
        self.assertIn("Protocol::Wireguard", source)
        self.assertIn("Protocol::Gool", source)
        self.assertIn("stale_gool_values_never_leak_into_masque", source)
        self.assertIn("stale_masque_values_never_leak_into_wireguard", source)
        self.assertIn("wiw_scan_ignores_manual_and_legacy_endpoints", source)
        for flag in (
            "--http-proxy", "--peer", "--wg-peer", "--wiw-outer", "--wiw-inner",
            "--wiw-scan", "--h2", "--h2-peer", "--ech", "--no-data-check",
            "--validate-secs", "--reconnect-secs", "--fragment", "--keepalive",
            "--no-profile-retry", "--dns", "--team", "--gateway", "--route-block",
            "--route-direct", "--routes", "--tls-groups", "--perf",
        ):
            self.assertIn(f'"{flag}"', source)

    def test_android_scopes_profile_before_kotlin_process_launch(self) -> None:
        rust = self.read("src-tauri/src/android.rs")
        kotlin = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
        )
        self.assertIn("fn for_runtime(mut self) -> Self", rust)
        self.assertIn('"wireguard" =>', rust)
        self.assertIn('"gool" =>', rust)
        self.assertIn("let profile = profile.for_runtime();", rust)
        self.assertIn("self.peer.clear();", rust)
        self.assertIn("self.h2_peer.clear();", rust)
        self.assertIn("self.wiw_outer.clear();", rust)
        for flag in (
            "--http-proxy", "--peer", "--wg-peer", "--wiw-outer", "--wiw-inner",
            "--wiw-scan", "--h2-peer", "--ech", "--validate-secs", "--reconnect-secs",
            "--keepalive", "--route-block", "--route-direct", "--routes", "--perf",
        ):
            self.assertIn(f'"{flag}"', kotlin)

    def test_sensitive_values_are_environment_only_and_not_persisted(self) -> None:
        desktop_pty = self.read("src-tauri/src/aether/pty.rs")
        desktop_profile = self.read("src-tauri/src/aether/profiles.rs")
        android_rust = self.read("src-tauri/src/android.rs")
        android_kotlin = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
        )
        for key in (
            "AETHER_ACCESS_EMAIL", "AETHER_ACCESS_CLIENT_ID",
            "AETHER_ACCESS_CLIENT_SECRET", "AETHER_ACCESS_TOKEN", "AETHER_UPSTREAM",
        ):
            self.assertTrue(key in desktop_pty or key in android_kotlin)
        self.assertIn("persisted.upstream.clear()", desktop_profile)
        self.assertIn("persisted.profile = persisted.profile.without_secrets()", android_rust)
        self.assertIn("sanitized.upstream.clear()", android_rust)
        self.assertNotIn('args.push("--upstream"', desktop_profile)

    def test_route_sniff_and_identity_repair_are_forwarded_by_environment(self) -> None:
        desktop = self.read("src-tauri/src/aether/pty.rs")
        android = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
        )
        for key in ("AETHER_ROUTE_SNIFF", "AETHER_ROUTE_SNIFF_MS", "AETHER_REPROVISION"):
            self.assertIn(key, desktop)
            self.assertIn(key, android)

    def test_desktop_launch_state_does_not_wait_for_obsolete_interactive_prompts(self) -> None:
        pty = self.read("src-tauri/src/aether/pty.rs")
        manager = self.read("src-tauri/src/aether/mod.rs")
        self.assertIn("AtomicBool::new(true)", pty)
        self.assertIn("Interactive setup menus are a compatibility fallback only", pty)
        self.assertIn("session.prompts_done()", manager)

    def test_zero_trust_otp_is_control_plane_state_not_live_log_state(self) -> None:
        store = self.read("src/state/connectionStore.ts")
        prompt = self.read("src/components/AccessCodePrompt.tsx")
        self.assertIn("ACCESS_CODE_MARKER", store)
        self.assertIn("accessCodeRequired", store)
        self.assertIn("clearAccessCodeRequirement", store)
        self.assertIn("event.payload.line.includes(ACCESS_CODE_MARKER)", store)
        self.assertIn("accessCodeRequired", prompt)
        self.assertNotIn("logs.some", prompt)
        self.assertIn('min-h-12', prompt)
        self.assertIn('safe-area-inset-bottom', prompt)

    def test_android_logging_is_opt_in_memory_only(self) -> None:
        runtime = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt"
        )
        service = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
        )
        rust = self.read("src-tauri/src/android.rs")
        self.assertIn("AtomicBoolean(false)", runtime)
        self.assertNotIn("writeText", runtime)
        self.assertNotIn("appendText", runtime)
        self.assertIn("log-level: warn", service)
        self.assertIn("set_logging(false)", rust)

    def test_android_lifecycle_and_tun_use_one_mtu(self) -> None:
        manifest = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/AndroidManifest.xml"
        )
        service = self.read(
            "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
        )
        config = json.loads(self.read("src-tauri/tauri.android.conf.json"))
        self.assertIn('android:stopWithTask="true"', manifest)
        self.assertIn(".setMtu(profile.mtu)", service)
        self.assertIn("mtu: $mtu", service)
        self.assertEqual(config["bundle"]["android"]["minSdkVersion"], 29)

    def test_mobile_first_shell_owns_safe_area_and_touch_geometry(self) -> None:
        app = self.read("src/App.tsx")
        css = self.read("src/index.css")
        connect = self.read("src/components/ConnectButton.tsx")
        protocol = self.read("src/components/ProtocolSelect.tsx")
        routing = self.read("src/components/RoutingSettings.tsx")
        zero_trust = self.read("src/components/ZeroTrustSettings.tsx")
        bind = self.read("src/components/BindAddressField.tsx")
        self.assertIn("MobileHeader", app)
        self.assertIn("QuickConnectionCard", app)
        self.assertIn("connection-hero", app)
        self.assertIn("app-scroll", app)
        self.assertIn("safe-area-inset-top", css)
        self.assertIn("safe-area-inset-bottom", css)
        self.assertIn("size-[8.5rem]", connect)
        self.assertIn("min-h-12", protocol)
        self.assertNotIn('"h-8 ', routing)
        self.assertNotIn('"h-8 ', zero_trust)
        self.assertIn("App-local listener", bind)

    def test_desktop_tunnel_default_is_native_ssot_not_local_storage(self) -> None:
        native = self.read("src-tauri/src/system_tunnel/mod.rs")
        store = self.read("src/state/systemTunnelStore.ts")
        self.assertIn("selection: Mutex::new(SystemTunnelSelection::Singbox)", native)
        self.assertIn("unwrap_or(SystemTunnelSelection::Singbox)", native)
        self.assertIn('selection: isAndroid ? "native" : "singbox"', store)
        self.assertNotIn("localStorage", store)
        self.assertIn("inFlightLoad", store)

    def test_build_workflow_is_manual_only_and_never_publishes_releases(self) -> None:
        workflow = self.read(".github/workflows/build.yml")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotIn("push:", workflow)
        self.assertIn("android-arm64", workflow)
        self.assertIn("macos-15-intel", workflow)
        self.assertNotIn("tauri-action", workflow)
        self.assertNotIn("gh release upload", workflow)
        self.assertNotIn("gh release create", workflow)

    def test_runtime_manifest_is_the_single_runtime_version_source(self) -> None:
        verifier = self.read("scripts/ci/verify-runtime-manifest.mjs")
        for consumer in (
            "scripts/prepare-sidecars.mjs",
            "scripts/prepare-android-native.sh",
            "src-tauri/binaries/fetch-aether.sh",
            "src-tauri/binaries/fetch-aether.ps1",
        ):
            self.assertIn(consumer, verifier)
        self.assertIn("runtime-versions.json", verifier)


if __name__ == "__main__":
    unittest.main(verbosity=2)
