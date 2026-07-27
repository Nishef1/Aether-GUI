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
    / "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
)
RUNTIME_SOURCE = (
    ROOT
    / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt"
)
EGRESS_PROBE = (
    ROOT
    / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt"
)
SESSION_GATE = (
    ROOT
    / "src-tauri/plugins/aether-vpn/android/src/main/java/ServiceSessionGate.kt"
)
SESSION_GATE_TEST = (
    ROOT
    / "src-tauri/plugins/aether-vpn/android/src/test/java/ServiceSessionGateTest.kt"
)
PLUGIN_MANIFEST = (
    ROOT
    / "src-tauri/plugins/aether-vpn/android/src/main/AndroidManifest.xml"
)
PLUGIN_RUST_BRIDGE = ROOT / "src-tauri/plugins/aether-vpn/src/lib.rs"
ANDROID_RUST_BRIDGE = ROOT / "src-tauri/src/android.rs"
CONNECTION_STORE = ROOT / "src/state/connectionStore.ts"
CONNECT_BUTTON = ROOT / "src/components/ConnectButton.tsx"
HEV_BRIDGE = (
    ROOT
    / "src-tauri/plugins/aether-vpn/android/src/main/java/HevTun2Socks.kt"
)
HEV_NATIVE_BRIDGE = ROOT / "scripts/native/aethertun-jni.c"
HEV_BUILD_SCRIPT = ROOT / "scripts/ci/build-hev-android.sh"
NATIVE_BUNDLE_SCRIPT = ROOT / "scripts/ci/bundle-android-native.sh"
KOTLIN_PREFLIGHT_SCRIPT = ROOT / "scripts/ci/test-android-plugin-kotlin.sh"
WORKFLOW = ROOT / ".github/workflows/build-android-arm64.yml"


class AndroidPluginContractTest(unittest.TestCase):
    def test_activity_result_dependency_is_explicit(self) -> None:
        gradle = PLUGIN_GRADLE.read_text(encoding="utf-8")
        self.assertIn(
            'implementation("androidx.activity:activity-ktx:1.10.1")',
            gradle,
        )
        self.assertIn('testImplementation("junit:junit:4.13.2")', gradle)

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
        )
        self.assertIn("result.resultCode == Activity.RESULT_OK", source)

    def test_plugin_returns_start_immediately_for_cancellation(self) -> None:
        source = PLUGIN_SOURCE.read_text(encoding="utf-8")
        start_command = source.split("fun start(invoke: Invoke)", 1)[1].split(
            "@Command", 1
        )[0]
        self.assertIn("markStartRequested()", start_command)
        self.assertIn("startForegroundService", start_command)
        self.assertIn("invoke.resolve", start_command)
        self.assertNotIn("START_TIMEOUT_MS", start_command)
        self.assertNotIn("Thread.sleep", start_command)

    def test_startup_failure_cannot_poison_future_attempts(self) -> None:
        source = PLUGIN_SOURCE.read_text(encoding="utf-8")
        self.assertNotIn("if (coreProcess?.isAlive == true) return", source)
        self.assertIn("val staleResources = detachAllResources()", source)
        self.assertIn('cleanupResources(staleResources, "replace stale session")', source)
        self.assertIn("finally {", source)
        self.assertIn('cleanupResources(finalResources, "session finalizer")', source)
        self.assertIn("process.destroyForcibly()", source)
        self.assertIn("recent logs:", source)

    def test_unattached_native_resources_are_cleaned(self) -> None:
        source = PLUGIN_SOURCE.read_text(encoding="utf-8")
        self.assertIn("cancel before core attach", source)
        self.assertIn("cancel before TUN attach", source)
        self.assertIn("if (!processAttached) process", source)
        self.assertIn("if (!tunnelAttached) tunnel?.descriptor", source)
        self.assertIn("if (!tunnelAttached) tunnel?.bridge", source)

    def test_stop_is_off_main_thread_and_session_scoped(self) -> None:
        source = PLUGIN_SOURCE.read_text(encoding="utf-8")
        gate = SESSION_GATE.read_text(encoding="utf-8")
        gate_test = SESSION_GATE_TEST.read_text(encoding="utf-8")
        self.assertIn("private val sessionGate = ServiceSessionGate()", source)
        self.assertIn("cleanupExecutor.submit", source)
        self.assertIn("val stopToken = sessionGate.cancel()", source)
        self.assertIn("sessionGate.isCurrent(stopToken)", source)
        self.assertIn("fun isCurrent(token: Long)", gate)
        self.assertIn("cancelInvalidatesAnInFlightStart", gate_test)
        self.assertIn("newerStartInvalidatesOlderWorker", gate_test)

    def test_egress_probe_worker_exits_cleanly_when_android_interrupts_it(self) -> None:
        source = PLUGIN_SOURCE.read_text(encoding="utf-8")
        probe_loop = source.split("private fun startEgressProbeLoop", 1)[1]
        self.assertIn("catch (_: InterruptedException)", probe_loop)
        self.assertIn("Thread.currentThread().interrupt()", probe_loop)
        self.assertIn("return@execute", probe_loop)

    def test_vpn_service_is_protected_and_final_service_is_registered(self) -> None:
        manifest = PLUGIN_MANIFEST.read_text(encoding="utf-8")
        self.assertIn("android.permission.BIND_VPN_SERVICE", manifest)
        self.assertIn('<action android:name="android.net.VpnService" />', manifest)
        self.assertIn('android:exported="false"', manifest)
        self.assertIn("FinalAetherVpnService", manifest)
        self.assertNotIn("HardenedAetherVpnService", manifest)

    def test_rust_bridge_registers_runtime_commands(self) -> None:
        plugin_bridge = PLUGIN_RUST_BRIDGE.read_text(encoding="utf-8")
        android_bridge = ANDROID_RUST_BRIDGE.read_text(encoding="utf-8")
        self.assertIn('"FinalAetherVpnPlugin"', plugin_bridge)
        self.assertIn('run_mobile_plugin("telemetry"', plugin_bridge)
        self.assertIn('run_mobile_plugin("logs"', plugin_bridge)
        self.assertIn("webrtc_leak_protection", plugin_bridge)
        self.assertIn("fn get_android_logs", android_bridge)
        self.assertIn("fn get_runtime_telemetry(app: AppHandle)", android_bridge)

    def test_native_logs_status_and_cancel_are_polled_on_android(self) -> None:
        store = CONNECTION_STORE.read_text(encoding="utf-8")
        button = CONNECT_BUTTON.read_text(encoding="utf-8")
        self.assertIn('invoke<AndroidNativeLogBatch>("get_android_logs"', store)
        self.assertIn('invoke<ConnectionStatus>("get_status")', store)
        self.assertIn("ANDROID_RUNTIME_POLL_MS", store)
        self.assertIn("++connectionOperationRevision", store)
        self.assertIn("(!isAndroid && preparingCores)", button)
        self.assertIn("Cancel connecting", button)

    def test_webrtc_protection_uses_supported_udp_in_tcp_mode(self) -> None:
        source = PLUGIN_SOURCE.read_text(encoding="utf-8")
        self.assertIn('val udpRelayMode = if (webrtcLeakProtection) "tcp" else "udp"', source)
        self.assertIn("udp: '$udpRelayMode'", source)
        self.assertIn("webrtcLeakProtection: Boolean = true", source)

    def test_exit_probe_keeps_socket_open_through_write_and_read(self) -> None:
        probe = EGRESS_PROBE.read_text(encoding="utf-8")
        use_index = probe.index("socket.use {")
        writer_index = probe.index(
            "val writer = it.outputStream.bufferedWriter(Charsets.US_ASCII)",
            use_index,
        )
        flush_index = probe.index("writer.flush()", writer_index)
        reader_index = probe.index(
            "it.inputStream.bufferedReader(Charsets.UTF_8).readText()",
            flush_index,
        )
        self.assertLess(use_index, writer_index)
        self.assertLess(writer_index, flush_index)
        self.assertLess(flush_index, reader_index)
        self.assertNotIn("bufferedWriter(Charsets.US_ASCII).use", probe)

    def test_tun_wrapper_is_idempotent_and_loads_only_our_bridge(self) -> None:
        bridge = HEV_BRIDGE.read_text(encoding="utf-8")
        runtime = RUNTIME_SOURCE.read_text(encoding="utf-8")
        self.assertIn("internal object AetherTunBridge", bridge)
        self.assertIn('System.loadLibrary("aethertun")', bridge)
        self.assertNotIn('System.loadLibrary("hev-socks5-tunnel")', bridge)
        self.assertIn("external fun nativeStart(configPath: String, tunFd: Int): Boolean", bridge)
        self.assertIn("external fun nativeStop(): Boolean", bridge)
        self.assertIn("external fun nativeStats(): LongArray?", bridge)
        self.assertIn("synchronized(nativeLock)", bridge)
        self.assertIn("private var nativeRunning = false", bridge)
        self.assertIn("fun TProxyStopService(): Boolean", bridge)
        self.assertIn("receivedBytes = stats[3]", runtime)
        self.assertIn("sentBytes = stats[1]", runtime)

    def test_native_bridge_owns_fd_and_joins_before_stop_acknowledgement(self) -> None:
        native = HEV_NATIVE_BRIDGE.read_text(encoding="utf-8")
        self.assertIn("pthread_create", native)
        self.assertIn("args->tun_fd = dup((int)tun_fd)", native)
        self.assertIn("close(args->tun_fd)", native)
        self.assertIn("static bool thread_joinable = false", native)
        self.assertIn("static bool join_in_progress = false", native)
        self.assertIn("TUN_STATE_STOPPING", native)
        self.assertIn("hev_socks5_tunnel_quit()", native)
        join_index = native.index("pthread_join(thread, NULL)")
        release_index = native.index("thread_joinable = false", join_index)
        self.assertLess(join_index, release_index)
        self.assertNotIn("PTHREAD_CREATE_DETACHED", native)
        self.assertNotIn("pthread_cond_timedwait", native)
        self.assertIn("JNI_OnLoad", native)
        for symbol in (
            "AetherTunBridge_nativeStart",
            "AetherTunBridge_nativeStop",
            "AetherTunBridge_nativeStats",
        ):
            self.assertIn(symbol, native)

    def test_hev_build_strips_unstable_jni_and_verifies_c_api(self) -> None:
        build_script = HEV_BUILD_SCRIPT.read_text(encoding="utf-8")
        bundle_script = NATIVE_BUNDLE_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("find \"$source_dir\" -name 'hev-jni.c' -delete", build_script)
        self.assertIn("hev core still exports JNI_OnLoad", build_script)
        self.assertNotIn("-DPKGNAME=", build_script)
        self.assertIn("hev_socks5_tunnel_main", build_script)
        self.assertIn("hev_socks5_tunnel_quit", build_script)
        self.assertIn("hev_socks5_tunnel_stats", build_script)
        self.assertIn("libaethertun.so", build_script)
        self.assertIn("-Wl,--no-undefined", build_script)
        self.assertIn("libaethertun.so", bundle_script)
        self.assertIn("libhev-socks5-tunnel.so", bundle_script)

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
        self.assertIn(":tauri-plugin-aether-vpn:compileDebugKotlin", preflight)
        self.assertIn(":tauri-plugin-aether-vpn:testDebugUnitTest", preflight)

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
                '{"identifier":"com.cluvexstudio.aethergui"}\n', encoding="utf-8"
            )
            (tauri_dir / "Cargo.toml").write_text(
                textwrap.dedent(
                    """\
                    [package]
                    name = "aether-gui"
                    version = "0.5.5"
                    edition = "2021"

                    [lib]
                    name = "aether_gui_lib"
                    crate-type = ["staticlib", "cdylib", "rlib"]
                    """
                ),
                encoding="utf-8",
            )
            (android_dir / "settings.gradle").write_text(
                "apply from: 'tauri.settings.gradle'\n", encoding="utf-8"
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
                    test -d "$WRY_ANDROID_KOTLIN_FILES_OUT_DIR"
                    test "$ANDROID_NDK_HOME" = "/opt/android/ndk"
                    test "$ANDROID_NDK_ROOT" = "/opt/android/ndk"
                    printf '%s\n' "$@" > "$GITHUB_WORKSPACE/cargo-args.txt"
                    mkdir -p "$TAURI_ANDROID_PROJECT_PATH/app"
                    printf "%s\n" "include ':tauri-plugin-aether-vpn'" > "$TAURI_ANDROID_PROJECT_PATH/tauri.settings.gradle"
                    printf "%s\n" 'implementation(project(\":tauri-plugin-aether-vpn\"))' > "$TAURI_ANDROID_PROJECT_PATH/app/tauri.build.gradle.kts"
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
            self.assertIn("ndk", cargo_args)
            self.assertIn("arm64-v8a", cargo_args)
            self.assertIn("29", cargo_args)
            self.assertIn("check", cargo_args)
            self.assertIn("--lib", cargo_args)
            self.assertIn(":tauri-plugin-aether-vpn:compileDebugKotlin", gradle_args)
            self.assertIn(":tauri-plugin-aether-vpn:testDebugUnitTest", gradle_args)
            self.assertIn("--stacktrace", gradle_args)

    def test_workflow_runs_real_kotlin_compile_preflight(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("bash scripts/ci/test-android-plugin-kotlin.sh", workflow)
        self.assertIn("android-plugin-kotlin-preflight.log", workflow)


if __name__ == "__main__":
    unittest.main(verbosity=2)
