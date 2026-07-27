#!/usr/bin/env python3

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ANDROID_CONFIG = ROOT / "src-tauri/tauri.android.conf.json"
DESKTOP_CONFIG = ROOT / "src-tauri/tauri.conf.json"
NATIVE_BUNDLE = ROOT / "scripts/ci/bundle-android-native.sh"


class AndroidMobileConfigTest(unittest.TestCase):
    def test_android_overrides_desktop_sidecars_with_an_empty_list(self) -> None:
        desktop = json.loads(DESKTOP_CONFIG.read_text(encoding="utf-8"))
        android = json.loads(ANDROID_CONFIG.read_text(encoding="utf-8"))

        self.assertTrue(desktop["bundle"]["externalBin"])
        self.assertEqual(android["bundle"]["externalBin"], [])

    def test_android_core_is_packaged_as_a_native_library_instead(self) -> None:
        bundle_script = NATIVE_BUNDLE.read_text(encoding="utf-8")
        self.assertIn('cp "$core" "$destination/libaether_exec.so"', bundle_script)
        self.assertIn('chmod 755 "$destination/libaether_exec.so"', bundle_script)
        self.assertNotIn("aether-aarch64-linux-android", bundle_script)


if __name__ == "__main__":
    unittest.main(verbosity=2)
