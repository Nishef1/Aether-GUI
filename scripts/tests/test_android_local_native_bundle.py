#!/usr/bin/env python3

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BASE_PREPARE_SCRIPT = ROOT / "scripts/prepare-android-native.ps1"
FINAL_PREPARE_SCRIPT = ROOT / "scripts/prepare-android-native-final.ps1"
DEV_SCRIPT = ROOT / "scripts/android-dev.ps1"
BUILD_SCRIPT = ROOT / "scripts/build-android-arm64.ps1"
PACKAGE_JSON = ROOT / "package.json"
PACKAGING_PATCHER = ROOT / "scripts/ci/patch-android-packaging.py"


class AndroidLocalNativeBundleTest(unittest.TestCase):
    def test_android_dev_prepares_final_payload_before_tauri_launch(self) -> None:
        source = DEV_SCRIPT.read_text(encoding="utf-8")
        prepare_index = source.index("prepare-android-native-final.ps1")
        launch_index = source.index("pnpm tauri android dev")
        self.assertLess(prepare_index, launch_index)

        for native_name in (
            "libaether_exec.so",
            "libhev-socks5-tunnel.so",
            "libaethertun.so",
        ):
            self.assertIn(native_name, source)

    def test_apk_build_uses_transactional_wrapper(self) -> None:
        package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
        scripts = package["scripts"]
        self.assertIn("prepare:android:arm64", scripts)
        self.assertIn("prepare-android-native-final.ps1", scripts["prepare:android:arm64"])
        self.assertIn("build-android-arm64.ps1", scripts["build:android:arm64"])
        self.assertIn("-Debug", scripts["build:android:arm64:debug"])

        build = BUILD_SCRIPT.read_text(encoding="utf-8")
        prepare_index = build.index("prepare-android-native-final.ps1")
        patch_index = build.index("patch-android-mobile-efficiency.py")
        launch_index = build.index("& pnpm @buildArguments")
        restore_index = build.index("WriteAllBytes($serviceSource, $serviceBackup)")
        self.assertLess(prepare_index, launch_index)
        self.assertLess(patch_index, launch_index)
        self.assertGreater(restore_index, launch_index)
        self.assertIn('"--debug"', build)

    def test_base_preparer_builds_and_copies_all_runtime_components(self) -> None:
        source = BASE_PREPARE_SCRIPT.read_text(encoding="utf-8")
        required_tokens = (
            '"ndk"',
            '"--target"',
            '"arm64-v8a"',
            "patch-aether-wg-fresh-session.py",
            "patch-hev-idempotent-stop.py",
            "patch-android-packaging.py",
            "src-tauri\\gen\\android\\app\\src\\main\\jniLibs",
            "libaether_exec.so",
            "libhev-socks5-tunnel.so",
            "libaethertun.so",
        )
        for token in required_tokens:
            self.assertIn(token, source)

    def test_final_preparer_removes_duplicate_core_readiness_before_rebuild(self) -> None:
        source = FINAL_PREPARE_SCRIPT.read_text(encoding="utf-8")
        ordered = (
            "patch-aether-wg-real-egress.py",
            "patch-aether-wg-runtime-resolver.py",
            "remove-aether-wg-core-readiness-gate.py",
            "patch-aether-mobile-network-policy.py",
            "Rebuilding final patched Aether core",
        )
        positions = [source.index(token) for token in ordered]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn("patch-aether-wg-runtime-egress.py", source)
        self.assertNotIn("patch-aether-wg-runtime-supervision.py", source)
        self.assertNotIn("patch-android-mobile-efficiency.py", source)

    def test_packaging_patcher_accepts_windows_crlf(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gradle = root / "src-tauri/gen/android/app/build.gradle.kts"
            gradle.parent.mkdir(parents=True)
            gradle.write_bytes(
                b'plugins {\r\n    id("com.android.application")\r\n}\r\n\r\n'
                b'android {\r\n    namespace = "example"\r\n}\r\n'
            )

            result = subprocess.run(
                [sys.executable, str(PACKAGING_PATCHER)],
                cwd=root,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(
                result.returncode,
                0,
                f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
            )
            updated = gradle.read_text(encoding="utf-8")
            self.assertIn("useLegacyPackaging = true", updated)


if __name__ == "__main__":
    unittest.main(verbosity=2)
