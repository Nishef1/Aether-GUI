#!/usr/bin/env python3

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONNECTION = ROOT / "src/state/connectionStore.ts"
TELEMETRY = ROOT / "src/state/telemetryStore.ts"
CSS = ROOT / "src/index.css"
MAIN = ROOT / "src/main.tsx"
POLICY = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidTransportPolicy.kt"
PREPARE = ROOT / "scripts/prepare-android-native-final.ps1"
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
        prepare = PREPARE.read_text(encoding="utf-8")
        self.assertIn('"--health-interval", "30"', policy)
        self.assertIn('"--keepalive", "25"', policy)
        self.assertIn("EGRESS_PROBE_INTERVAL_MS = 300_000L", patch)
        self.assertIn("One long interruptible sleep", patch)
        self.assertIn("shouldPersistDiagnostic", patch)
        self.assertIn("patch-android-mobile-efficiency.py", prepare)


if __name__ == "__main__":
    unittest.main(verbosity=2)
