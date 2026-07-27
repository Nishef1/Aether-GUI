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
    ROOT / "scripts/ci/patch-aether-wg-runtime-egress.py",
    ROOT / "scripts/ci/patch-aether-wg-runtime-supervision.py",
)
CORE_SOURCE = ROOT / "vendor/aether/aether/src"


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

    def test_pipeline_is_idempotent_and_runtime_matches_validation(self) -> None:
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

            resolver = socks.split("pub(crate) async fn dns_resolve", 1)[1].split(
                "\n}\n", 1
            )[0]
            self.assertIn("runtime DNS uses validated independent resolvers", resolver)
            self.assertIn("Ipv4Addr::new(8, 8, 8, 8)", resolver)
            self.assertIn("Ipv4Addr::new(9, 9, 9, 9)", resolver)
            self.assertIn("Ipv4Addr::new(1, 1, 1, 1)", resolver)
            self.assertLess(
                resolver.index("Ipv4Addr::new(8, 8, 8, 8)"),
                resolver.index("Ipv4Addr::new(1, 1, 1, 1)"),
            )
            self.assertIn("sender.close().await", resolver)
            self.assertIn("servers.contains(&response.0)", resolver)

            self.assertIn("const DATAPLANE_DNS_SERVERS", wireguard)
            self.assertNotIn(
                "const DATAPLANE_DNS: Ipv4Addr = Ipv4Addr::new(1, 1, 1, 1)",
                wireguard,
            )

            simple = main.split("async fn run_wireguard_tunnel", 1)[1].split(
                "\n}\n", 1
            )[0]
            nested = main.split("async fn establish_wg", 1)[1].split("\n}\n", 1)[0]
            for block in (simple, nested):
                self.assertIn("runtime readiness task supervision", block)
                self.assertIn("tokio::select!", block)
                self.assertIn("WireGuard tunnel during readiness", block)
                self.assertIn("verify_wg_runtime_egress", block)

            # run_wireguard_tunnel returns Result<()>, but establish_wg returns
            # Result<RunningWireGuard>. The nested branch must convert the task's
            # Result<()> into an AetherError instead of returning it directly.
            self.assertNotIn(
                'return flatten_runtime_task("WireGuard tunnel during readiness", result);',
                nested,
            )
            self.assertIn("let error = match flatten_runtime_task(", nested)
            self.assertIn("return Err(error);", nested)

            gool = main.split("async fn run_warp_in_warp", 1)[1].split("\n}\n", 1)[0]
            self.assertIn("spawn_udp_forwarder(&outer.stack, peer)", gool)
            self.assertNotIn("trying independent inner WARP endpoint", gool)

    def test_android_finalizer_orders_runtime_patches_before_rebuild(self) -> None:
        finalizer = (ROOT / "scripts/prepare-android-native-final.ps1").read_text(
            encoding="utf-8"
        )
        ordered = [
            "patch-aether-wg-real-egress.py",
            "patch-aether-wg-runtime-resolver.py",
            "patch-aether-wg-runtime-egress.py",
            "patch-aether-wg-runtime-supervision.py",
            "Rebuilding final patched Aether core",
        ]
        positions = [finalizer.index(value) for value in ordered]
        self.assertEqual(positions, sorted(positions))


if __name__ == "__main__":
    unittest.main(verbosity=2)
