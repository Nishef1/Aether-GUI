#!/usr/bin/env python3

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCH = ROOT / "scripts/ci/patch-android-mobile-efficiency.py"
SERVICE_RELATIVE = Path(
    "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
)
RUNTIME_RELATIVE = Path(
    "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt"
)
MANIFEST = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/AndroidManifest.xml"
CONNECTION_STORE = ROOT / "src/state/connectionStore.ts"
ANDROID_BACKEND = ROOT / "src-tauri/src/android.rs"
COMMON_PROFILE = ROOT / "src-tauri/src/aether/profiles.rs"
TRANSPORT_POLICY = (
    ROOT
    / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidTransportPolicy.kt"
)


class AndroidRuntimeResilienceTest(unittest.TestCase):
    def apply_policy(self) -> str:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        workspace = Path(temporary.name)

        for relative in (SERVICE_RELATIVE, RUNTIME_RELATIVE):
            source = ROOT / relative
            destination = workspace / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

        subprocess.run(
            [sys.executable, str(PATCH), str(workspace)],
            check=True,
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        first = (workspace / SERVICE_RELATIVE).read_bytes()
        # A second pass must be a byte-for-byte no-op instead of duplicating
        # or retargeting a replacement block.
        subprocess.run(
            [sys.executable, str(PATCH), str(workspace)],
            check=True,
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(first, (workspace / SERVICE_RELATIVE).read_bytes())
        return first.decode("utf-8")

    def test_foreground_vpn_is_redelivered_after_process_recreation(self) -> None:
        service = self.apply_policy()
        self.assertIn("Android runtime resilience policy", service)
        self.assertIn("return Service.START_REDELIVER_INTENT", service)
        self.assertNotIn("return Service.START_NOT_STICKY", service)

    def test_task_removal_does_not_request_service_shutdown(self) -> None:
        manifest = MANIFEST.read_text(encoding="utf-8")
        self.assertIn('android:stopWithTask="false"', manifest)

    def test_quick_reconnect_and_udp_in_tcp_are_disabled_by_default(self) -> None:
        service = self.apply_policy()
        store = CONNECTION_STORE.read_text(encoding="utf-8")
        android = ANDROID_BACKEND.read_text(encoding="utf-8")
        common = COMMON_PROFILE.read_text(encoding="utf-8")

        self.assertIn("var quickReconnect: Boolean = false", service)
        self.assertIn("var webrtcLeakProtection: Boolean = false", service)
        self.assertIn("getBooleanExtra(EXTRA_QUICK_RECONNECT, false)", service)
        self.assertIn(
            "EXTRA_WEBRTC_LEAK_PROTECTION,\n            false",
            service,
        )
        self.assertRegex(store, r"quick_reconnect:\s*false")
        self.assertRegex(store, r"webrtc_leak_protection:\s*false")
        self.assertRegex(android, r"quick_reconnect:\s*false")
        self.assertRegex(android, r"webrtc_leak_protection:\s*false")
        self.assertRegex(common, r"quick_reconnect:\s*false")

    def test_android_auto_does_not_override_quick_reconnect(self) -> None:
        store = CONNECTION_STORE.read_text(encoding="utf-8")
        auto_profile = store.split("function androidAutoProfile", 1)[1].split(
            "interface ConnectionState", 1
        )[0]
        self.assertIn("masque_http2: true", auto_profile)
        self.assertNotIn("quick_reconnect", auto_profile)

        policy = TRANSPORT_POLICY.read_text(encoding="utf-8")
        auto_policy = policy.split("if (isFastAuto(protocol))", 1)[1].split(
            "command += listOf", 1
        )[0]
        self.assertNotIn("--quick-reconnect", auto_policy)
        self.assertNotIn("--no-quick-reconnect", auto_policy)

    def test_webrtc_option_remains_an_explicit_opt_in(self) -> None:
        service = self.apply_policy()
        tunnel_call = service.split("tunnel = createSystemTunnel(", 1)[1].split(")", 1)[0]
        self.assertIn("webrtcLeakProtection", tunnel_call)
        self.assertIn('val udpRelayMode = if (webrtcLeakProtection) "tcp" else "udp"', service)
        self.assertIn("udp: '$udpRelayMode'", service)

    def test_webrtc_patch_targets_only_its_named_fallback(self) -> None:
        patch = PATCH.read_text(encoding="utf-8")
        self.assertIn(
            "val webrtcLeakProtection = intent.getBooleanExtra(",
            patch,
        )
        self.assertNotIn(
            '("            true\\n        )", "            false\\n        )"',
            patch,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
