#!/usr/bin/env python3

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONNECTION = ROOT / "src/state/connectionStore.ts"
TELEMETRY = ROOT / "src/state/telemetryStore.ts"
SETTINGS = ROOT / "src/components/SettingsPanel.tsx"
MODE_TOGGLE = ROOT / "src/components/ConnectionModeToggle.tsx"
CSS = ROOT / "src/index.css"
MAIN = ROOT / "src/main.tsx"
POLICY = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidTransportPolicy.kt"
RUNTIME = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt"
ANDROID_BRIDGE = ROOT / "src-tauri/src/android.rs"
PLUGIN = ROOT / "src-tauri/plugins/aether-vpn/src/lib.rs"
NATIVE_PREPARE = ROOT / "scripts/prepare-android-native-final.ps1"
DEV_RUNNER = ROOT / "scripts/android-dev.ps1"
BUILD_RUNNER = ROOT / "scripts/build-android-arm64.ps1"
EFFICIENCY_PATCH = ROOT / "scripts/ci/patch-android-mobile-efficiency.py"


class AndroidMobileEfficiencyTest(unittest.TestCase):
    def test_runtime_polling_is_visibility_and_state_aware(self) -> None:
        source = CONNECTION.read_text(encoding="utf-8")
        self.assertNotIn("ANDROID_RUNTIME_POLL_MS = 450", source)
        self.assertIn("ANDROID_RUNTIME_POLL_CONNECTING_MS = 750", source)
        self.assertIn("ANDROID_RUNTIME_POLL_ACTIVE_MS = 1_500", source)
        self.assertIn("ANDROID_RUNTIME_POLL_HIDDEN_MS = 15_000", source)
        self.assertIn("document.hidden", source)
        self.assertIn("scheduleAndroidPoll", source)
        self.assertNotIn("setInterval(\n      () => void pollAndroidRuntime()", source)

    def test_telemetry_stops_when_hidden_or_disconnected(self) -> None:
        source = TELEMETRY.read_text(encoding="utf-8")
        self.assertIn("ANDROID_TELEMETRY_VISIBLE_MS = 2_500", source)
        self.assertIn("androidConnected", source)
        self.assertIn("document.hidden", source)
        self.assertIn("clearAndroidTimer", source)
        self.assertNotIn("ANDROID_TELEMETRY_POLL_MS = 1000", source)

    def test_android_visuals_keep_feedback_not_decoration(self) -> None:
        css = CSS.read_text(encoding="utf-8")
        main = MAIN.read_text(encoding="utf-8")
        self.assertIn('dataset.platform = isAndroid ? "android" : "desktop"', main)
        self.assertIn('html[data-platform="android"] .anim-orb-a', css)
        self.assertIn('html[data-platform="android"] .anim-glow-fast', css)
        self.assertIn("animation: none", css)
        self.assertIn("animation-duration: 4s", css)

    def test_transport_keepalives_and_optional_probes_are_spaced(self) -> None:
        policy = POLICY.read_text(encoding="utf-8")
        patch = EFFICIENCY_PATCH.read_text(encoding="utf-8")
        self.assertIn('"--health-interval", "30"', policy)
        self.assertIn('"--keepalive", "25"', policy)
        self.assertIn("EGRESS_PROBE_INTERVAL_MS = 300_000L", patch)
        self.assertIn("One long interruptible sleep", patch)
        self.assertIn("shouldPersistDiagnostic", patch)

    def test_live_logs_are_explicitly_opt_in(self) -> None:
        connection = CONNECTION.read_text(encoding="utf-8")
        settings = SETTINGS.read_text(encoding="utf-8")
        runtime = RUNTIME.read_text(encoding="utf-8")
        bridge = ANDROID_BRIDGE.read_text(encoding="utf-8")
        plugin = PLUGIN.read_text(encoding="utf-8")
        patch = EFFICIENCY_PATCH.read_text(encoding="utf-8")

        self.assertIn('LOGGING_PREFERENCE_KEY = "aether.live-logs.enabled"', connection)
        self.assertIn("loggingEnabled: readLoggingPreference()", connection)
        self.assertIn('invoke<boolean>("set_android_logging_enabled"', connection)
        self.assertIn("loggingEnabled && <LiveLogViewer />", settings)
        self.assertIn("AtomicBoolean(false)", runtime)
        self.assertIn("if (!loggingEnabled.get()) return", runtime)
        self.assertIn("set_android_logging_enabled", bridge)
        self.assertIn('run_mobile_plugin("setLogging"', plugin)
        self.assertIn("Android opt-in diagnostics", patch)

    def test_connection_mode_selector_has_no_visible_helper_copy(self) -> None:
        source = MODE_TOGGLE.read_text(encoding="utf-8")
        self.assertNotIn("Local SOCKS5 only", source)
        self.assertNotIn("System-wide TUN", source)
        self.assertNotIn("TUN + local SOCKS5", source)
        self.assertNotIn("Android asks for VPN permission", source)
        self.assertNotIn("description", source)

    def test_efficiency_source_patch_is_transactional(self) -> None:
        native_prepare = NATIVE_PREPARE.read_text(encoding="utf-8")
        dev = DEV_RUNNER.read_text(encoding="utf-8")
        build = BUILD_RUNNER.read_text(encoding="utf-8")
        self.assertNotIn("patch-android-mobile-efficiency.py", native_prepare)
        for runner in (dev, build):
            self.assertIn("patch-android-mobile-efficiency.py", runner)
            self.assertIn("ReadAllBytes($serviceSource)", runner)
            self.assertIn("WriteAllBytes($serviceSource, $serviceBackup)", runner)
            self.assertIn("finally", runner)


if __name__ == "__main__":
    unittest.main(verbosity=2)
