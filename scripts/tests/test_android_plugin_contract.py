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
HEV_BRIDGE = (
    ROOT
    / "src-tauri/plugins/aether-vpn/android/src/main/java/HevTun2Socks.kt"
)
HEV_BUILD_SCRIPT = ROOT / "scripts/ci/build-hev-android.sh"
KOTLIN_PREFLIGHT_SCRIPT = ROOT / "scripts/ci/test-android-plugin-kotlin.sh"
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

    def test_pinned_tun2socks_jni_signatures_match(self) -> None:
        bridge = HEV_BRIDGE.read_text(encoding="utf-8")
        self.assertIn("external fun TProxyStartService(configPath: String, tunFd: Int)", bridge)
        self.assertIn("external fun TProxyStopService()", bridge)
        self.assertIn("external fun TProxyGetStats(): LongArray", bridge)
        self.assertIn('System.loadLibrary("hev-socks5-tunnel")', bridge)

    def test_tun2socks_native_registration_targets_bridge_class(self) -> None:
        build_script = HEV_BUILD_SCRIPT.read_text(encoding="utf-8")
        self.assertIn(
            "-DPKGNAME=com/cluvexstudio/aethergui/vpn -DCLSNAME=HevTun2Socks",
            build_script,
        )
        self.assertIn("APP_ABI := arm64-v8a", build_script)

    def test_workflow_runs_real_kotlin_compile_preflight(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        preflight = KOTLIN_PREFLIGHT_SCRIPT.read_text(encoding="utf-8")

        self.assertIn(
            "bash scripts/ci/test-android-plugin-kotlin.sh",
            workflow,
            "The workflow must execute the dedicated Kotlin compile preflight script.",
        )
        self.assertIn("android-plugin-kotlin-preflight.log", workflow)
        self.assertIn(
            ":tauri-plugin-aether-vpn:compileDebugKotlin",
            preflight,
            "The preflight script must compile the custom Android plugin module.",
        )
        self.assertIn("--stacktrace", preflight)
        self.assertIn("--warning-mode all", preflight)


if __name__ == "__main__":
    unittest.main(verbosity=2)
