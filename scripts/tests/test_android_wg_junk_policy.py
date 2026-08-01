#!/usr/bin/env python3

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
NETWORK_PATCH = ROOT / "scripts/ci/patch-aether-mobile-network-policy.py"
JUNK_PATCH = ROOT / "scripts/ci/patch-aether-wg-post-handshake-junk.py"
CI_BUILD = ROOT / "scripts/ci/build-aether-android.sh"
LOCAL_BUILD = ROOT / "scripts/prepare-android-native-final.ps1"
WIREGUARD_RELATIVE = Path("vendor/aether/aether/src/wireguard.rs")
PROBER_RELATIVE = Path("vendor/aether/aether/src/prober.rs")
WG_PROBER_RELATIVE = Path("vendor/aether/aether/src/wg_prober.rs")


class AndroidWireGuardJunkPolicyTest(unittest.TestCase):
    def test_post_handshake_junk_is_transactional_and_one_shot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            for relative in (
                WIREGUARD_RELATIVE,
                PROBER_RELATIVE,
                WG_PROBER_RELATIVE,
            ):
                destination = workspace / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, destination)

            subprocess.run(
                [sys.executable, str(NETWORK_PATCH), str(workspace)],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            command = [sys.executable, str(JUNK_PATCH), str(workspace)]
            subprocess.run(
                command,
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            first = (workspace / WIREGUARD_RELATIVE).read_bytes()
            subprocess.run(
                command,
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(first, (workspace / WIREGUARD_RELATIVE).read_bytes())

            source = first.decode("utf-8")
            self.assertIn("Android WireGuard one-shot post-handshake junk", source)
            self.assertIn("AtomicBool::new(self.established)", source)
            self.assertIn(
                "post_handshake_junk_sent_r.swap(true, Ordering::SeqCst)",
                source,
            )
            self.assertEqual(source.count("send_post_handshake_junk("), 1)

    def test_ci_and_local_build_apply_junk_patch_at_the_same_position(self) -> None:
        ci = CI_BUILD.read_text(encoding="utf-8")
        local = LOCAL_BUILD.read_text(encoding="utf-8")
        previous = "patch-aether-mobile-network-policy.py"
        target = "patch-aether-wg-post-handshake-junk.py"
        following = "patch-aether-h3-channel-lifecycle.py"

        for source in (ci, local):
            self.assertEqual(source.count(target), 1)
            self.assertLess(source.index(previous), source.index(target))
            self.assertLess(source.index(target), source.index(following))


if __name__ == "__main__":
    unittest.main(verbosity=2)
