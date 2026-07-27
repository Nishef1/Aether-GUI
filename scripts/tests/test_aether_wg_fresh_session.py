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
SESSION_PATCHER = ROOT / "scripts/ci/patch-aether-wg-fresh-session.py"
EGRESS_PATCHER = ROOT / "scripts/ci/patch-aether-wg-real-egress.py"
RESOLVER_PATCHER = ROOT / "scripts/ci/patch-aether-wg-runtime-resolver.py"
READINESS_CLEANUP = ROOT / "scripts/ci/remove-aether-wg-core-readiness-gate.py"
ANDROID_FRESH_RUNTIME = ROOT / "scripts/ci/patch-aether-android-fresh-runtime.py"
CORE_SOURCE = ROOT / "vendor/aether/aether/src"
FRESH_RUNTIME_MARKER = "Android fresh WireGuard runtime"
REAL_EGRESS_MARKER = "independent resolver egress"
CANONICAL_GOOL_MARKER = "tunneled through outer warp via"


class AndroidFreshWireGuardRuntimeTest(unittest.TestCase):
    def run_patch_pipeline(self, root: Path) -> subprocess.CompletedProcess[str]:
        outputs: list[str] = []
        errors: list[str] = []
        returncode = 0
        patchers = (
            SESSION_PATCHER,
            EGRESS_PATCHER,
            RESOLVER_PATCHER,
            READINESS_CLEANUP,
            ANDROID_FRESH_RUNTIME,
        )
        for patcher in patchers:
            result = subprocess.run(
                [sys.executable, str(patcher), str(root)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            outputs.append(result.stdout)
            errors.append(result.stderr)
            if result.returncode != 0:
                returncode = result.returncode
                break
        return subprocess.CompletedProcess(
            args=[str(patcher) for patcher in patchers],
            returncode=returncode,
            stdout="".join(outputs),
            stderr="".join(errors),
        )

    def test_pipeline_is_idempotent_and_restores_fresh_android_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory)
            source_dir = temp_root / "vendor/aether/aether/src"
            source_dir.mkdir(parents=True)
            for name in ("main.rs", "wireguard.rs", "socks.rs"):
                shutil.copy2(CORE_SOURCE / name, source_dir / name)

            first = self.run_patch_pipeline(temp_root)
            self.assertEqual(
                first.returncode,
                0,
                f"first patch pipeline failed\nstdout:\n{first.stdout}\nstderr:\n{first.stderr}",
            )
            first_bytes = b"".join(
                (source_dir / name).read_bytes()
                for name in ("main.rs", "wireguard.rs", "socks.rs")
            )
            first_hash = hashlib.sha256(first_bytes).hexdigest()

            second = self.run_patch_pipeline(temp_root)
            self.assertEqual(
                second.returncode,
                0,
                f"second patch pipeline failed\nstdout:\n{second.stdout}\nstderr:\n{second.stderr}",
            )
            second_bytes = b"".join(
                (source_dir / name).read_bytes()
                for name in ("main.rs", "wireguard.rs", "socks.rs")
            )
            self.assertEqual(first_hash, hashlib.sha256(second_bytes).hexdigest())

            main_source = (source_dir / "main.rs").read_text(encoding="utf-8")
            wireguard_source = (source_dir / "wireguard.rs").read_text(encoding="utf-8")
            socks_source = (source_dir / "socks.rs").read_text(encoding="utf-8")

            simple = main_source.split("async fn run_wireguard_tunnel", 1)[1].split(
                "\n}\n", 1
            )[0]
            nested = main_source.split("async fn establish_wg", 1)[1].split("\n}\n", 1)[0]
            for block in (simple, nested):
                self.assertIn(FRESH_RUNTIME_MARKER, block)
                self.assertIn("WgTunnel::new", block)
                self.assertNotIn("verify_endpoint_keep_session", block)
                self.assertNotIn("WgTunnel::from_established", block)
                self.assertNotIn("verify_wg_runtime_egress", block)
                self.assertNotIn("runtime readiness task supervision", block)

            self.assertLess(
                simple.index("tokio::spawn(tunnel.run(outbound_rx))"),
                simple.index("socks::serve"),
            )
            self.assertNotIn("validated session retained for runtime handoff", simple)
            self.assertNotIn("validated session retained for runtime handoff", nested)

            gool = main_source.split("async fn run_warp_in_warp", 1)[1].split(
                "\n}\n", 1
            )[0]
            self.assertIn("Duration::from_millis(1_500)", gool)
            self.assertIn("fresh outer runtime settle", gool)
            self.assertIn("spawn_udp_forwarder(&outer.stack, peer)", gool)
            self.assertIn(CANONICAL_GOOL_MARKER, gool)
            self.assertNotIn("trying independent inner WARP endpoint", gool)
            self.assertNotIn("fn gool_inner_candidates", main_source)

            self.assertIn(REAL_EGRESS_MARKER, wireguard_source)
            self.assertIn("Ipv4Addr::new(8, 8, 8, 8)", wireguard_source)
            self.assertIn("Ipv4Addr::new(9, 9, 9, 9)", wireguard_source)
            self.assertIn("runtime DNS uses validated independent resolvers", socks_source)

    def test_local_android_entrypoints_apply_fresh_runtime_last(self) -> None:
        package = (ROOT / "package.json").read_text(encoding="utf-8")
        android_dev = (ROOT / "scripts/android-dev.ps1").read_text(encoding="utf-8")
        finalizer = (ROOT / "scripts/prepare-android-native-final.ps1").read_text(
            encoding="utf-8"
        )
        self.assertIn("prepare-android-native-final.ps1", package)
        self.assertIn("prepare-android-native-final.ps1", android_dev)
        self.assertIn("prepare-android-native.ps1", finalizer)
        ordered = [
            "patch-aether-wg-real-egress.py",
            "patch-aether-wg-runtime-resolver.py",
            "remove-aether-wg-core-readiness-gate.py",
            "patch-aether-android-fresh-runtime.py",
            "Rebuilding final patched Aether core",
        ]
        positions = [finalizer.index(value) for value in ordered]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("patch-aether-wg-runtime-egress.py", finalizer)
        self.assertNotIn("patch-aether-wg-runtime-supervision.py", finalizer)


if __name__ == "__main__":
    unittest.main(verbosity=2)
