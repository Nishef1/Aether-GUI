#!/usr/bin/env python3

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PLUGIN_GRADLE = ROOT / "src-tauri/plugins/aether-vpn/android/build.gradle.kts"
PLUGIN_SOURCE = (
    ROOT
    / "src-tauri/plugins/aether-vpn/android/src/main/java/AetherVpnPlugin.kt"
)
PLUGIN_MANIFEST = (
    ROOT
    / "src-tauri/plugins/aether-vpn/android/src/main/AndroidManifest.xml"
)
WORKFLOW = ROOT / ".github/workflows/build-android-arm64.yml"


class AndroidPluginContractTest(unittest.TestCase):
    def test_activity_result_dependency_is_explicit(self) -> None:
        gradle = PLUGIN_GRADLE.read_text(encoding="utf-8")
        self.assertIn(
            'implementation("androidx.activity:activity-ktx:1.10.1")',
            gradle,
            "The plugin directly imports ActivityResult, so androidx.activity must be "
            "on the plugin compile classpath instead of relying on a transitive dependency.",
        )

    def test_tauri_activity_callback_signature_is_preserved(self) -> None:
        source = PLUGIN_SOURCE.read_text(encoding="utf-8")
        self.assertIn("import androidx.activity.result.ActivityResult", source)
        self.assertRegex(
            source,
            re.compile(
                r"@ActivityCallback\s+private fun vpnPermissionResult\("
                r"invoke: Invoke, result: ActivityResult\)",
                re.MULTILINE,
            ),
            "Tauri invokes @ActivityCallback methods reflectively with Invoke and "
            "androidx.activity.result.ActivityResult.",
        )
        self.assertIn("result.resultCode == Activity.RESULT_OK", source)

    def test_vpn_service_is_protected_by_android(self) -> None:
        manifest = PLUGIN_MANIFEST.read_text(encoding="utf-8")
        self.assertIn("android.permission.BIND_VPN_SERVICE", manifest)
        self.assertIn('<action android:name="android.net.VpnService" />', manifest)
        self.assertIn('android:exported="false"', manifest)

    def test_workflow_has_real_kotlin_compile_preflight(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(":tauri-plugin-aether-vpn:compileDebugKotlin", workflow)
        self.assertIn("android-plugin-kotlin-preflight.log", workflow)


if __name__ == "__main__":
    unittest.main(verbosity=2)
