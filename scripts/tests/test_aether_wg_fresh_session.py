#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCHER = ROOT / "scripts/ci/patch-aether-wg-fresh-session.py"
CORE_MAIN = ROOT / "vendor/aether/aether/src/main.rs"
ESTABLISHED_MARKER = "validated session retained for runtime handoff"
FRESH_SESSION_MARKER = "validated with disposable probe session; starting fresh runtime session"
FRESH_READY_MARKER = "fresh WireGuard runtime data-plane ready"
GOOL_ROUTE_MARKER = "trying independent inner WARP endpoint"


class ValidatedWireGuardRuntimeSessionTest(unittest.TestCase):
    def test_patcher_is_idempotent_and_retains_validated_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "main.rs"
            shutil.copy2(CORE_MAIN, target)

            first = subprocess.run(
                ["python3", str(PATCHER), str(target)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(
                first.returncode,
                0,
                f"first patch failed\nstdout:\n{first.stdout}\nstderr:\n{first.stderr}",
            )
            first_bytes = target.read_bytes()
            first_hash = hashlib.sha256(first_bytes).hexdigest()

            second = subprocess.run(
                ["python3", str(PATCHER), str(target)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(
                second.returncode,
                0,
                f"second patch failed\nstdout:\n{second.stdout}\nstderr:\n{second.stderr}",
            )
            second_hash = hashlib.sha256(target.read_bytes()).hexdigest()
            self.assertEqual(first_hash, second_hash)

            source = first_bytes.decode("utf-8")
            self.assertGreaterEqual(source.count(ESTABLISHED_MARKER), 2)
            self.assertNotIn(FRESH_SESSION_MARKER, source)
            self.assertNotIn(FRESH_READY_MARKER, source)
            self.assertNotIn("async fn warm_up_wg_stack", source)

            simple = source.split("async fn run_wireguard_tunnel", 1)[1].split("\n}\n", 1)[0]
            nested = source.split("async fn establish_wg", 1)[1].split("\n}\n", 1)[0]

            for block in (simple, nested):
                self.assertIn("verify_endpoint_keep_session", block)
                self.assertIn("WgTunnel::from_established", block)
                self.assertNotIn("WgTunnel::new(runtime_config", block)
                self.assertNotIn("warm_up_wg_stack", block)

            self.assertIn("validate_timeout: Duration", nested)
            self.assertIn("validate_timeout,", nested)

            self.assertEqual(source.count("fn gool_inner_candidates"), 1)
            self.assertEqual(source.count(GOOL_ROUTE_MARKER), 1)
            helper = source.split("fn gool_inner_candidates", 1)[1].split("async fn run_warp_in_warp", 1)[0]
            self.assertIn("if ip == outer_ip", helper)
            self.assertIn("MAX_CANDIDATES: usize = 6", helper)
            self.assertIn("WG_SEEDS_V4", helper)
            self.assertIn("WG_PRIMARY_PORTS", helper)

            gool = source.split("async fn run_warp_in_warp", 1)[1].split("\n}\n", 1)[0]
            self.assertIn("const INNER_VALIDATE_TIMEOUT: Duration = Duration::from_secs(8)", gool)
            self.assertIn("spawn_udp_forwarder(&outer.stack, inner_peer)", gool)
            self.assertNotIn("spawn_udp_forwarder(&outer.stack, peer)", gool)
            self.assertIn("for (index, inner_peer) in candidates.into_iter().enumerate()", gool)
            self.assertIn("trying another endpoint", gool)
            self.assertLess(
                gool.index("let mut outer = establish_wg"),
                gool.index("for (index, inner_peer)"),
            )

    def test_android_core_build_applies_the_handoff_patch_before_cargo(self) -> None:
        build_script = (ROOT / "scripts/ci/build-aether-android.sh").read_text(encoding="utf-8")
        patch_index = build_script.index("patch-aether-wg-fresh-session.py")
        cargo_index = build_script.index("cargo metadata")
        self.assertLess(patch_index, cargo_index)


if __name__ == "__main__":
    unittest.main(verbosity=2)
