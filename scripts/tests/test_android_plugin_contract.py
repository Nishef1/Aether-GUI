#!/usr/bin/env python3

from __future__ import annotations

import os
import re
import subprocess
import tempfile
import textwrap
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

    def test_kotlin_preflight_bootstraps_tauri_android_environment(self) -> None:
        preflight = KOTLIN_PREFLIGHT_SCRIPT.read_text(encoding="utf-8")

        self.assertIn('export TAURI_ANDROID_PROJECT_PATH="$android_dir"', preflight)
        self.assertIn('export TAURI_ANDROID_PACKAGE_UNESCAPED="$app_package"', preflight)
        self.assertIn('export WRY_ANDROID_PACKAGE="$app_package"', preflight)
        self.assertIn('export WRY_ANDROID_LIBRARY="$app_library"', preflight)
        self.assertIn('export WRY_ANDROID_KOTLIN_FILES_OUT_DIR="$kotlin_out_dir"', preflight)
        self.assertIn('export ANDROID_NDK_ROOT="$NDK_HOME"', preflight)
        self.assertRegex(
            preflight,
            re.compile(
                r"cargo ndk\s+\\\n\s+--target arm64-v8a\s+\\\n"
                r"\s+--platform \"\$ANDROID_MIN_API\"\s+\\\n\s+check\s+\\\n\s+--lib",
                re.MULTILINE,
            ),
        )
        self.assertIn('gradle_settings="$android_dir/tauri.settings.gradle"', preflight)
        self.assertIn(
            'gradle_dependencies="$android_dir/app/tauri.build.gradle.kts"',
            preflight,
        )
        self.assertIn("include ':tauri-plugin-aether-vpn'", preflight)
        self.assertIn('implementation(project(\":tauri-plugin-aether-vpn\"))', preflight)

    def test_kotlin_preflight_executes_bootstrap_before_gradle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            tauri_dir = workspace / "src-tauri"
            android_dir = tauri_dir / "gen/android"
            app_dir = android_dir / "app"
            bin_dir = workspace / "mock-bin"
            app_dir.mkdir(parents=True)
            bin_dir.mkdir()

            (tauri_dir / "tauri.conf.json").write_text(
                '{"identifier":"com.cluvexstudio.aethergui"}\n',
                encoding="utf-8",
            )
            (tauri_dir / "Cargo.toml").write_text(
                textwrap.dedent(
                    """\
                    [package]
                    name = "aether-gui"
                    version = "0.5.2"
                    edition = "2021"

                    [lib]
                    name = "aether_gui_lib"
                    crate-type = ["staticlib", "cdylib", "rlib"]
                    """
                ),
                encoding="utf-8",
            )
            (android_dir / "settings.gradle").write_text(
                "apply from: 'tauri.settings.gradle'\n",
                encoding="utf-8",
            )

            cargo = bin_dir / "cargo"
            cargo.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env bash
                    set -euo pipefail
                    test "$WRY_ANDROID_PACKAGE" = "com.cluvexstudio.aethergui"
                    test "$TAURI_ANDROID_PACKAGE_UNESCAPED" = "com.cluvexstudio.aethergui"
                    test "$WRY_ANDROID_LIBRARY" = "aether_gui_lib"
                    test "$WRY_ANDROID_KOTLIN_FILES_OUT_DIR" = \
                      "$GITHUB_WORKSPACE/src-tauri/gen/android/app/src/main/java/com/cluvexstudio/aethergui/generated"
                    test -d "$WRY_ANDROID_KOTLIN_FILES_OUT_DIR"
                    test "$ANDROID_NDK_HOME" = "/opt/android/ndk"
                    test "$ANDROID_NDK_ROOT" = "/opt/android/ndk"
                    printf '%s\n' "$@" > "$GITHUB_WORKSPACE/cargo-args.txt"
                    {
                      printf 'WRY_ANDROID_PACKAGE=%s\n' "$WRY_ANDROID_PACKAGE"
                      printf 'WRY_ANDROID_LIBRARY=%s\n' "$WRY_ANDROID_LIBRARY"
                      printf 'WRY_ANDROID_KOTLIN_FILES_OUT_DIR=%s\n' "$WRY_ANDROID_KOTLIN_FILES_OUT_DIR"
                    } > "$GITHUB_WORKSPACE/android-env.txt"
                    mkdir -p "$TAURI_ANDROID_PROJECT_PATH/app"
                    printf "%s\n" \
                      "include ':tauri-plugin-aether-vpn'" \
                      > "$TAURI_ANDROID_PROJECT_PATH/tauri.settings.gradle"
                    printf "%s\n" \
                      'implementation(project(\":tauri-plugin-aether-vpn\"))' \
                      > "$TAURI_ANDROID_PROJECT_PATH/app/tauri.build.gradle.kts"
                    """
                ),
                encoding="utf-8",
            )
            cargo.chmod(0o755)

            gradlew = android_dir / "gradlew"
            gradlew.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env bash
                    set -euo pipefail
                    test -s "$GITHUB_WORKSPACE/src-tauri/gen/android/tauri.settings.gradle"
                    test -s "$GITHUB_WORKSPACE/src-tauri/gen/android/app/tauri.build.gradle.kts"
                    test -d "$GITHUB_WORKSPACE/src-tauri/gen/android/app/src/main/java/com/cluvexstudio/aethergui/generated"
                    printf '%s\n' "$@" > "$GITHUB_WORKSPACE/gradle-args.txt"
                    """
                ),
                encoding="utf-8",
            )
            gradlew.chmod(0o755)

            env = os.environ.copy()
            env.update(
                {
                    "ANDROID_MIN_API": "29",
                    "GITHUB_WORKSPACE": str(workspace),
                    "NDK_HOME": "/opt/android/ndk",
                    "PATH": f"{bin_dir}{os.pathsep}{env.get('PATH', '')}",
                }
            )
            result = subprocess.run(
                ["bash", str(KOTLIN_PREFLIGHT_SCRIPT)],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(
                result.returncode,
                0,
                f"preflight failed\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}",
            )
            cargo_args = (workspace / "cargo-args.txt").read_text(encoding="utf-8")
            gradle_args = (workspace / "gradle-args.txt").read_text(encoding="utf-8")
            android_env = (workspace / "android-env.txt").read_text(encoding="utf-8")
            self.assertIn("ndk", cargo_args)
            self.assertIn("arm64-v8a", cargo_args)
            self.assertIn("29", cargo_args)
            self.assertIn("check", cargo_args)
            self.assertIn("--lib", cargo_args)
            self.assertIn("WRY_ANDROID_PACKAGE=com.cluvexstudio.aethergui", android_env)
            self.assertIn("WRY_ANDROID_LIBRARY=aether_gui_lib", android_env)
            self.assertIn(":tauri-plugin-aether-vpn:compileDebugKotlin", gradle_args)
            self.assertIn("--stacktrace", gradle_args)

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
