#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCHERS = (
    ROOT / "scripts/ci/patch-aether-wg-fresh-session.py",
    ROOT / "scripts/ci/patch-aether-wg-real-egress.py",
    ROOT / "scripts/ci/patch-aether-wg-runtime-resolver.py",
    ROOT / "scripts/ci/remove-aether-wg-core-readiness-gate.py",
)
CORE_SOURCE = ROOT / "vendor/aether/aether/src"
SERVICE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
POLICY = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidTransportPolicy.kt"


class WireGuardRuntimeReadinessTest(unittest.TestCase):
    def run_pipeline(self, root: Path) -> subprocess.CompletedProcess[str]:
        stdout: list[str] = []
        stderr: list[str] = []
        for patcher in PATCHERS:
            result = subprocess.run(
                [sys.executable, str(patcher), str(root)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            stdout.append(result.stdout)
            stderr.append(result.stderr)
            if result.returncode != 0:
                return subprocess.CompletedProcess(
                    args=[str(path) for path in PATCHERS],
                    returncode=result.returncode,
                    stdout="".join(stdout),
                    stderr="".join(stderr),
                )
        return subprocess.CompletedProcess(
            args=[str(path) for path in PATCHERS],
            returncode=0,
            stdout="".join(stdout),
            stderr="".join(stderr),
        )

    def test_pipeline_is_idempotent_and_removes_duplicate_core_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "vendor/aether/aether/src"
            target.mkdir(parents=True)
            for name in ("main.rs", "wireguard.rs", "socks.rs"):
                shutil.copy2(CORE_SOURCE / name, target / name)

            first = self.run_pipeline(root)
            self.assertEqual(
                first.returncode,
                0,
                f"first patch pipeline failed\nstdout:\n{first.stdout}\nstderr:\n{first.stderr}",
            )
            first_bytes = b"".join(
                (target / name).read_bytes()
                for name in ("main.rs", "wireguard.rs", "socks.rs")
            )
            first_hash = hashlib.sha256(first_bytes).hexdigest()

            second = self.run_pipeline(root)
            self.assertEqual(
                second.returncode,
                0,
                f"second patch pipeline failed\nstdout:\n{second.stdout}\nstderr:\n{second.stderr}",
            )
            second_bytes = b"".join(
                (target / name).read_bytes()
                for name in ("main.rs", "wireguard.rs", "socks.rs")
            )
            self.assertEqual(first_hash, hashlib.sha256(second_bytes).hexdigest())

            main = (target / "main.rs").read_text(encoding="utf-8")
            wireguard = (target / "wireguard.rs").read_text(encoding="utf-8")
            socks = (target / "socks.rs").read_text(encoding="utf-8")

            simple = main.split("async fn run_wireguard_tunnel", 1)[1].split("\n}\n", 1)[0]
            nested = main.split("async fn establish_wg", 1)[1].split("\n}\n", 1)[0]
            for block in (simple, nested):
                self.assertIn("Android owns final SOCKS egress readiness", block)
                self.assertNotIn("verify_wg_runtime_egress", block)
                self.assertNotIn("runtime readiness task supervision", block)
            self.assertNotIn("async fn verify_wg_runtime_egress", main)

            self.assertIn("const DATAPLANE_DNS_SERVERS", wireguard)
            self.assertIn("runtime DNS uses validated independent resolvers", socks)

    def test_android_honors_noize_and_gates_connected_on_socks_egress(self) -> None:
        service = SERVICE.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")

        self.assertIn("when (requested.trim().lowercase())", policy)
        self.assertIn('"balanced" -> "balanced"', policy)
        self.assertNotIn('fun effectiveWireGuardNoize(requested: String): String = "off"', policy)

        probe_index = service.index("val initialProbe = AndroidEgressProbe.probe(bindAddress)")
        connected_index = service.index("val connectedAt = System.currentTimeMillis()")
        tunnel_index = service.index("tunnel = createSystemTunnel(")
        self.assertLess(probe_index, connected_index)
        self.assertLess(probe_index, tunnel_index)
        self.assertIn("wgNoize = effectiveWgNoize", service)

    def test_android_finalizer_cleans_old_gate_before_rebuild(self) -> None:
        finalizer = (ROOT / "scripts/prepare-android-native-final.ps1").read_text(
            encoding="utf-8"
        )
        ordered = [
            "patch-aether-wg-real-egress.py",
            "patch-aether-wg-runtime-resolver.py",
            "remove-aether-wg-core-readiness-gate.py",
            "Rebuilding final patched Aether core",
        ]
        positions = [finalizer.index(value) for value in ordered]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("patch-aether-wg-runtime-egress.py", finalizer)
        self.assertNotIn("patch-aether-wg-runtime-supervision.py", finalizer)


if __name__ == "__main__":
    unittest.main(verbosity=2)
