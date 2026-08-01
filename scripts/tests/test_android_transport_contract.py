#!/usr/bin/env python3

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
POLICY = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidTransportPolicy.kt"
EGRESS_PROBE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt"
POLICY_TEST = ROOT / "src-tauri/plugins/aether-vpn/android/src/test/java/AndroidTransportPolicyTest.kt"
CORE_MAIN = ROOT / "vendor/aether/aether/src/main.rs"
CORE_PROBER = ROOT / "vendor/aether/aether/src/prober.rs"
MOBILE_NETWORK_PATCH = ROOT / "scripts/ci/patch-aether-mobile-network-policy.py"
H3_LIFECYCLE_PATCH = ROOT / "scripts/ci/patch-aether-h3-channel-lifecycle.py"
EFFICIENCY_PATCH = ROOT / "scripts/ci/patch-android-mobile-efficiency.py"
CORE_BUILD = ROOT / "scripts/ci/build-aether-android.sh"
FINAL_PREPARE = ROOT / "scripts/prepare-android-native-final.ps1"
ICON_PREPARE = ROOT / "scripts/prepare-android-icons.ps1"
ICON_MANIFEST = ROOT / "src-tauri/icons/android-icon-manifest.json"
NOTIFICATION_ICON = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/res/drawable/ic_stat_aether.xml"
CORE_PATCH_FILES = (
    Path("vendor/aether/aether/src/prober.rs"),
    Path("vendor/aether/aether/src/wg_prober.rs"),
    Path("vendor/aether/aether/src/wireguard.rs"),
)
QUIC_RELATIVE = Path("vendor/aether/aether/src/quic.rs")


class AndroidTransportContractTest(unittest.TestCase):
    def test_protocol_specific_startup_deadlines_are_bounded(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        self.assertIn("AndroidTransportPolicy.startupTimeoutMs(protocol, scanMode)", service)
        self.assertIn("waitForSocks(token, bindAddress, process, startupTimeoutMs)", service)
        self.assertNotIn("CORE_START_TIMEOUT_MS", service)
        for timeout in (
            "75_000L",
            "100_000L",
            "110_000L",
            "120_000L",
            "180_000L",
            "210_000L",
            "240_000L",
        ):
            self.assertIn(timeout, policy)
        self.assertNotIn("510_000L", policy)

    def test_mobile_scanners_are_fast_http_verified_and_correctly_ordered(self) -> None:
        masque = CORE_PROBER.read_text(encoding="utf-8")
        patch = MOBILE_NETWORK_PATCH.read_text(encoding="utf-8")
        tests = POLICY_TEST.read_text(encoding="utf-8")
        self.assertIn("overall_deadline: Duration::from_secs(140)", masque)
        self.assertIn("Android auto H2 latency window", patch)
        self.assertIn("Duration::from_millis(650)", patch)
        self.assertIn("Android documented MASQUE ingress order", patch)
        self.assertIn('"162.159.197.0/24"', patch)
        self.assertIn('"162.159.197.3"', patch)
        self.assertIn("Android bounded official WARP scan", patch)
        self.assertIn("Android WireGuard transient receive policy", patch)
        self.assertIn("overall_deadline: Duration::from_secs(60)", patch)
        self.assertIn("pub const WG_PORTS: &[u16] = &[2408, 500, 1701, 4500]", patch)
        self.assertIn("wireGuardUsesBoundedIroncladHttpVerification", tests)
        self.assertIn("goolUsesBoundedIroncladOuterSelection", tests)

    def test_mobile_core_patch_is_transactional_on_the_pinned_core(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            for relative in CORE_PATCH_FILES:
                source = ROOT / relative
                destination = workspace / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)

            command = [sys.executable, str(MOBILE_NETWORK_PATCH), str(workspace)]
            subprocess.run(
                command,
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            first = {
                relative: (workspace / relative).read_bytes()
                for relative in CORE_PATCH_FILES
            }
            subprocess.run(
                command,
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            second = {
                relative: (workspace / relative).read_bytes()
                for relative in CORE_PATCH_FILES
            }
            self.assertEqual(first, second)

            prober = first[CORE_PATCH_FILES[0]].decode("utf-8")
            wireguard = first[CORE_PATCH_FILES[2]].decode("utf-8")
            cidrs = prober.split("pub const MASQUE_CIDRS_V4", 1)[1].split("];", 1)[0]
            seeds = prober.split("pub const MASQUE_SEEDS", 1)[1].split("];", 1)[0]
            self.assertLess(cidrs.index("162.159.197.0/24"), cidrs.index("162.159.198.0/24"))
            self.assertLess(seeds.index("162.159.197.3"), seeds.index("162.159.198.2"))
            self.assertIn("is_transient_socket_error", wireguard)
            self.assertIn("TaskGuard(vec![", wireguard)
            self.assertIn("transient_udp_errors_do_not_end_the_runtime", wireguard)

    def test_h3_channel_patch_is_transactional_on_the_pinned_core(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            source = ROOT / QUIC_RELATIVE
            destination = workspace / QUIC_RELATIVE
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

            command = [sys.executable, str(H3_LIFECYCLE_PATCH), str(workspace)]
            subprocess.run(
                command,
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            first = destination.read_bytes()
            subprocess.run(
                command,
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(first, destination.read_bytes())

            quic = first.decode("utf-8")
            self.assertIn("Android MASQUE H3 channel lifecycle", quic)
            self.assertIn("ctrl = internals.ctrl_rx.recv(), if ctrl_open", quic)
            self.assertIn("packet = internals.outbound_rx.recv(), if outbound_open", quic)
            self.assertIn("ctrl_open = false", quic)
            self.assertIn("outbound_open = false", quic)

    def test_auto_prefers_h2_without_overriding_reconnect(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        patch = EFFICIENCY_PATCH.read_text(encoding="utf-8")
        tests = POLICY_TEST.read_text(encoding="utf-8")
        self.assertIn("var masqueHttp2: Boolean = true", service)
        self.assertIn("getBooleanExtra(EXTRA_MASQUE_HTTP2, true)", service)
        self.assertIn("fun isFastAuto", policy)
        self.assertIn('command += "--turbo"', policy)
        auto_block = policy.split("if (isFastAuto(protocol))", 1)[1].split(
            "command += listOf", 1
        )[0]
        self.assertNotIn('command += "--quick-reconnect"', auto_block)
        self.assertNotIn('command += "--no-quick-reconnect"', auto_block)
        self.assertIn('"--health-interval", "30"', policy)
        self.assertIn("Auto route: MASQUE HTTP/2", patch)
        self.assertIn("autoUsesFastH2PolicyWithoutOverridingReconnect", tests)

    def test_wireguard_is_bounded_and_honors_noize(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        tests = POLICY_TEST.read_text(encoding="utf-8")
        self.assertIn("AndroidTransportPolicy.effectiveWireGuardNoize(wgNoize)", service)
        self.assertIn("wgNoize = effectiveWgNoize", service)
        self.assertIn('private const val VERIFIED_WG_SCAN_MODE = "ironclad"', policy)
        self.assertIn("command.removeAll { it in scanFlags }", policy)
        self.assertIn('command += "--$VERIFIED_WG_SCAN_MODE"', policy)
        self.assertIn('command += "--no-profile-retry"', policy)
        self.assertIn('"--keepalive", "25"', policy)
        self.assertIn('"balanced" -> "balanced"', policy)
        self.assertIn('"aggressive", "heavy" -> "aggressive"', policy)
        self.assertIn("androidWireGuardHonorsRequestedNoize", tests)

    def test_ci_and_local_build_apply_the_same_final_core_patches(self) -> None:
        ci = CORE_BUILD.read_text(encoding="utf-8")
        local = FINAL_PREPARE.read_text(encoding="utf-8")
        final_patches = (
            "patch-aether-wg-real-egress.py",
            "patch-aether-wg-runtime-resolver.py",
            "remove-aether-wg-core-readiness-gate.py",
            "patch-aether-mobile-network-policy.py",
            "patch-aether-h3-channel-lifecycle.py",
            "patch-aether-android-fresh-runtime.py",
        )
        previous_ci = -1
        previous_local = -1
        for patch in final_patches:
            self.assertEqual(ci.count(patch), 1, patch)
            self.assertEqual(local.count(patch), 1, patch)
            ci_index = ci.index(patch)
            local_index = local.index(patch)
            self.assertGreater(ci_index, previous_ci, patch)
            self.assertGreater(local_index, previous_local, patch)
            previous_ci = ci_index
            previous_local = local_index

    def test_connected_is_gated_on_real_socks_dns_tcp_and_http(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        probe = EGRESS_PROBE.read_text(encoding="utf-8")
        verify_index = service.index("val initialProbe = AndroidEgressProbe.probe(bindAddress)")
        connected_index = service.index("val connectedAt = System.currentTimeMillis()")
        tunnel_index = service.index("tunnel = createSystemTunnel(")
        self.assertLess(verify_index, connected_index)
        self.assertLess(verify_index, tunnel_index)
        self.assertIn('state = "Verifying"', service)
        self.assertIn("SOCKS egress verified via", service)
        self.assertIn("private fun socks5Connect", probe)
        self.assertIn("cloudflare-domain-tls", probe)
        self.assertIn("ip-api-domain-http", probe)
        self.assertIn("cloudflare-literal-tcp", probe)
        self.assertIn('targetHost = "1.1.1.1"', probe)
        self.assertIn("remote DNS/domain ", probe)
        self.assertIn("egress failed", probe)
        self.assertIn("getDefaultHostnameVerifier", probe)

    def test_mobile_efficiency_and_brand_assets_are_wired(self) -> None:
        prepare = ICON_PREPARE.read_text(encoding="utf-8")
        manifest = ICON_MANIFEST.read_text(encoding="utf-8")
        notification = NOTIFICATION_ICON.read_text(encoding="utf-8")
        efficiency = EFFICIENCY_PATCH.read_text(encoding="utf-8")
        self.assertIn("pnpm tauri icon", prepare)
        self.assertIn('"default": "icon.png"', manifest)
        self.assertIn('"android_monochrome"', manifest)
        self.assertIn("android:pathData", notification)
        self.assertIn("EGRESS_PROBE_INTERVAL_MS = 300_000L", efficiency)
        self.assertIn("SOCKS_POLL_MAX_INTERVAL_MS", efficiency)
        self.assertIn("setSmallIcon(R.drawable.ic_stat_aether)", efficiency)
        self.assertIn("log-level: warn", efficiency)

    def test_android_outer_tun_mtu_matches_the_core_and_gool_inner_is_lower(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        core = CORE_MAIN.read_text(encoding="utf-8")
        self.assertIn("private const val TUN_MTU = AndroidTransportPolicy.TUN_MTU", service)
        self.assertIn("const val TUN_MTU = 1280", policy)
        self.assertIn("const TUNNEL_MTU: usize = 1280;", core)
        self.assertIn("const INNER_MTU: usize = 1200;", core)
        self.assertIn("assert!(INNER_MTU < TUNNEL_MTU)", core)


if __name__ == "__main__":
    unittest.main(verbosity=2)
