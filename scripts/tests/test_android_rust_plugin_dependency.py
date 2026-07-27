#!/usr/bin/env python3

from __future__ import annotations

import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
APP_MANIFEST = ROOT / "src-tauri/Cargo.toml"
PLUGIN_MANIFEST = ROOT / "src-tauri/plugins/aether-vpn/Cargo.toml"


class AndroidRustPluginDependencyTest(unittest.TestCase):
    def test_android_target_links_the_local_vpn_plugin_crate(self) -> None:
        with APP_MANIFEST.open("rb") as manifest_file:
            app = tomllib.load(manifest_file)
        with PLUGIN_MANIFEST.open("rb") as manifest_file:
            plugin = tomllib.load(manifest_file)

        android = app["target"]['cfg(target_os = "android")']["dependencies"]
        dependency = android["tauri-plugin-aether-vpn"]
        self.assertEqual(dependency["path"], "plugins/aether-vpn")
        self.assertEqual(plugin["package"]["name"], "tauri-plugin-aether-vpn")


if __name__ == "__main__":
    unittest.main(verbosity=2)
