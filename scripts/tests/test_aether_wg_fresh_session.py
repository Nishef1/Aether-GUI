#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SESSION_PATCHER = ROOT / "scripts/ci/patch-aether-wg-fresh-session.py"
EGRESS_PATCHER = ROOT / "scripts/ci/patch-aether-wg-real-egress.py"
RUNTIME_PATCHER = ROOT / "scripts/ci/patch-aether-wg-runtime-egress.py"
CORE_MAIN = ROOT / "vendor/aether/aether/src/main.rs"
CORE_WIREGUARD = ROOT / "vendor/aether/aether/src/wireguard.rs"
ESTABLISHED_MARKER = "validated session retained for runtime handoff"
FRESH_SESSION_MARKER = "validated with disposable probe session; starting fresh runtime session"
FRESH_READY_MARKER = "fresh WireGuard runtime data-plane ready"
REAL_EGRESS_MARKER = "independent resolver egress"
RUNTIME_READY_MARKER = "retained WireGuard runtime egress ready"
CANONICAL_GOOL_MARKER = "tunneled through outer warp via"


class ValidatedWireGuardRuntimeSessionTest(unittest.TestCase):
    def run_patch_pipeline(self, root: Path) -> subprocess.CompletedProcess[str]:
        outputs: list[str] = []
        errors: list[str] = []
        returncode = 0
        for patcher in (SESSION_PATCHER, EGRESS_PATCHER, RUNTIME_PATCHER):
            result = subprocess.run(
                ["python3", str(patcher), str(root)],
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
            args=[str(SESSION_PATCHER), str(EGRESS_PATCHER), str(RUNTIME_PATCHER)],
            returncode=returncode,
            stdout="".join(outputs),
            stderr="".join(errors),
        )

    def test_patch_pipeline_is_idempotent_and_uses_real_egress(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory)
            source_dir = temp_root / "vendor/aether/aether/src"
            source_dir.mkdir(parents=True)
            main_target = source_dir / "main.rs"
            wireguard_target = source_dir / "wireguard.rs"
            shutil.copy2(CORE_MAIN, main_target)
            shutil.copy2(CORE_WIREGUARD, wireguard_target)

            first = self.run_patch_pipeline(temp_root)
            self.assertEqual(
                first.returncode,
                0,
                f"first patch pipeline failed\nstdout:\n{first.stdout}\nstderr:\n{first.stderr}",
            )
            first_main = main_target.read_bytes()
            first_wireguard = wireguard_target.read_bytes()
            first_hash = hashlib.sha256(first_main + first_wireguard).hexdigest()

            second = self.run_patch_pipeline(temp_root)
            self.assertEqual(
                second.returncode,
                0,
                f"second patch pipeline failed\nstdout:\n{second.stdout}\nstderr:\n{second.stderr}",
            )
            second_hash = hashlib.sha256(
                main_target.read_bytes() + wireguard_target.read_bytes()
            ).hexdigest()
            self.assertEqual(first_hash, second_hash)

            main_source = first_main.decode("utf-8")
            wireguard_source = first_wireguard.decode("utf-8")

            self.assertGreaterEqual(main_source.count(ESTABLISHED_MARKER), 2)
            self.assertNotIn(FRESH_SESSION_MARKER, main_source)
            self.assertNotIn(FRESH_READY_MARKER, main_source)
            self.assertNotIn("async fn warm_up_wg_stack", main_source)

            simple = main_source.split("async fn run_wireguard_tunnel", 1)[1].split("\n}\n", 1)[0]
            nested = main_source.split("async fn establish_wg", 1)[1].split("\n}\n", 1)[0]
            for block in (simple, nested):
                self.assertIn("verify_endpoint_keep_session", block)
                self.assertIn("WgTunnel::from_established", block)
                self.assertNotIn("WgTunnel::new(runtime_config", block)
                self.assertNotIn("warm_up_wg_stack", block)

            self.assertIn("validate_timeout: Duration", nested)
            self.assertIn("validate_timeout,", nested)
            self.assertIn(RUNTIME_READY_MARKER, main_source)
            self.assertIn('verify_wg_runtime_egress(&stack, "wireguard")', simple)
            self.assertIn("verify_wg_runtime_egress(&stack, label)", nested)
            self.assertLess(
                simple.index('verify_wg_runtime_egress(&stack, "wireguard")'),
                simple.index("socks::serve"),
            )

            self.assertNotIn("fn gool_inner_candidates", main_source)
            self.assertNotIn("trying independent inner WARP endpoint", main_source)
            gool = main_source.split("async fn run_warp_in_warp", 1)[1].split("\n}\n", 1)[0]
            self.assertIn("spawn_udp_forwarder(&outer.stack, peer)", gool)
            self.assertIn(CANONICAL_GOOL_MARKER, gool)
            self.assertNotIn("spawn_udp_forwarder(&outer.stack, inner_peer)", gool)

            self.assertIn(REAL_EGRESS_MARKER, wireguard_source)
            self.assertIn("Ipv4Addr::new(8, 8, 8, 8)", wireguard_source)
            self.assertIn("Ipv4Addr::new(9, 9, 9, 9)", wireguard_source)
            self.assertNotIn(
                "const DATAPLANE_DNS: Ipv4Addr = Ipv4Addr::new(1, 1, 1, 1)",
                wireguard_source,
            )
            self.assertIn("for probe in &probes", wireguard_source)

    def test_local_android_entrypoints_use_finalized_native_pipeline(self) -> None:
        package = (ROOT / "package.json").read_text(encoding="utf-8")
        android_dev = (ROOT / "scripts/android-dev.ps1").read_text(encoding="utf-8")
        finalizer = (ROOT / "scripts/prepare-android-native-final.ps1").read_text(
            encoding="utf-8"
        )
        self.assertIn("prepare-android-native-final.ps1", package)
        self.assertIn("prepare-android-native-final.ps1", android_dev)
        self.assertIn("prepare-android-native.ps1", finalizer)
        self.assertIn("patch-aether-wg-real-egress.py", finalizer)
        self.assertIn("patch-aether-wg-runtime-egress.py", finalizer)
        self.assertLess(
            finalizer.index("prepare-android-native.ps1"),
            finalizer.index("patch-aether-wg-real-egress.py"),
        )
        self.assertLess(
            finalizer.index("patch-aether-wg-real-egress.py"),
            finalizer.index("patch-aether-wg-runtime-egress.py"),
        )
        self.assertIn("Rebuilding final patched Aether core", finalizer)


if __name__ == "__main__":
    unittest.main(verbosity=2)
