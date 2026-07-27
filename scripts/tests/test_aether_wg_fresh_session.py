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
MARKER = "validated with disposable probe session; starting fresh runtime session"


class FreshWireGuardRuntimeSessionTest(unittest.TestCase):
    def test_patcher_is_idempotent_and_removes_runtime_session_reuse(self) -> None:
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
            self.assertIn(MARKER, source)
            self.assertIn("fn parse_local_v6", source)

            for name in ("run_wireguard_tunnel", "establish_wg"):
                block = source.split(f"async fn {name}", 1)[1].split("\n}\n", 1)[0]
                self.assertNotIn("WgTunnel::from_established", block)
                self.assertNotIn("verify_endpoint_keep_session", block)
                self.assertIn("wireguard::verify_endpoint(", block)
                self.assertIn("wireguard::WgTunnel::new(runtime_config, inbound_tx).await?", block)

    def test_android_core_build_applies_the_patcher_before_cargo(self) -> None:
        build_script = (ROOT / "scripts/ci/build-aether-android.sh").read_text(encoding="utf-8")
        patch_index = build_script.index("patch-aether-wg-fresh-session.py")
        cargo_index = build_script.index("cargo metadata")
        self.assertLess(patch_index, cargo_index)


if __name__ == "__main__":
    unittest.main(verbosity=2)
