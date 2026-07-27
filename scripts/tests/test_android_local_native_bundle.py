#!/usr/bin/env python3

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PREPARE_SCRIPT = ROOT / "scripts/prepare-android-native.ps1"
DEV_SCRIPT = ROOT / "scripts/android-dev.ps1"
PACKAGE_JSON = ROOT / "package.json"
PACKAGING_PATCHER = ROOT / "scripts/ci/patch-android-packaging.py"


class AndroidLocalNativeBundleTest(unittest.TestCase):
    def test_android_dev_prepares_payload_before_tauri_launch(self) -> None:
        source = DEV_SCRIPT.read_text(encoding="utf-8")
        prepare_index = source.index('prepare-android-native.ps1')
        launch_index = source.index('pnpm tauri android dev')
        self.assertLess(prepare_index, launch_index)

        for native_name in (
            "libaether_exec.so",
            "libhev-socks5-tunnel.so",
            "libaethertun.so",
        ):
            self.assertIn(native_name, source)

    def test_apk_build_runs_native_preparation_first(self) -> None:
        package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
        scripts = package["scripts"]
        self.assertIn("prepare:android:arm64", scripts)
        self.assertTrue(
            scripts["build:android:arm64"].startswith(
                "pnpm prepare:android:arm64 &&"
            )
        )

    def test_preparer_builds_and_copies_all_runtime_components(self) -> None:
        source = PREPARE_SCRIPT.read_text(encoding="utf-8")
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
