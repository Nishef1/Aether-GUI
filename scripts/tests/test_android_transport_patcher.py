#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCHER = ROOT / "scripts/ci/apply-android-wireguard-policy.py"


SERVICE_FIXTURE = textwrap.dedent(
    """\
    package com.cluvexstudio.aethergui.vpn

    class FinalAetherVpnService {
        private fun runSession(
            protocol: String,
            scanMode: String,
            masqueHttp2: Boolean,
            wgNoize: String,
        ) {
            val executable = java.io.File("a")
            val ipVersion = "v4"
            val bindAddress = "127.0.0.1:1819"
            val quickReconnect = true
            val masqueNoize = "firewall"
            val process = ProcessBuilder("true").start()
            val token = 1L
            val command = buildCoreCommand(
                executable = executable,
                protocol = protocol,
                scanMode = scanMode,
                ipVersion = ipVersion,
                bindAddress = bindAddress,
                quickReconnect = quickReconnect,
                masqueNoize = masqueNoize,
                wgNoize = wgNoize,
            )
            val processBuilder = ProcessBuilder(command).redirectErrorStream(true)
            processBuilder.environment().apply {
                put("AETHER_CONFIG", File(filesDir, "aether.toml").absolutePath)
                put("AETHER_MASQUE_HTTP2", if (masqueHttp2) "1" else "0")
                put("AETHER_LOG_LEVEL", "info")
                put("RUST_BACKTRACE", "1")
            }
            if (!waitForSocks(token, bindAddress, process, CORE_START_TIMEOUT_MS)) {
                error("timeout")
            }
        }

        private fun buildCoreCommand(
            executable: File,
            protocol: String,
            scanMode: String,
            ipVersion: String,
            bindAddress: String,
            quickReconnect: Boolean,
            masqueNoize: String,
            wgNoize: String,
        ): List<String> {
            val command = mutableListOf(executable.absolutePath)
            command += listOf(
                "--noize",
                if (protocol == "wireguard" || protocol == "gool") wgNoize else masqueNoize,
                "--bind",
                bindAddress,
                "--log-level",
                "info",
            )
            return command
        }

        companion object {
            private const val CORE_START_TIMEOUT_MS = 50_000L
            private const val TUN_MTU = 8500
        }
    }
    """
)


class AndroidTransportPatcherTest(unittest.TestCase):
    def test_patcher_is_idempotent_and_replaces_all_legacy_wiring(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            source = (
                workspace
                / "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
            )
            source.parent.mkdir(parents=True)
            source.write_text(SERVICE_FIXTURE, encoding="utf-8")

            first = subprocess.run(
                [sys.executable, str(PATCHER), str(workspace)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            first_bytes = source.read_bytes()
            first_hash = hashlib.sha256(first_bytes).hexdigest()

            second = subprocess.run(
                [sys.executable, str(PATCHER), str(workspace)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            second_bytes = source.read_bytes()
            second_hash = hashlib.sha256(second_bytes).hexdigest()

            self.assertEqual(first_hash, second_hash)
            result = second_bytes.decode("utf-8")
            self.assertEqual(result.count("val udpAvailable = if (AndroidTransportPolicy"), 1)
            self.assertIn('remove("AETHER_MASQUE_HTTP2")', result)
            self.assertNotIn('if (masqueHttp2) "1" else "0"', result)
            self.assertIn("AndroidTransportPolicy.startupTimeoutMs", result)
            self.assertIn("AndroidTransportPolicy.appendCoreArgs", result)
            self.assertIn("AndroidTransportPolicy.TUN_MTU", result)
            self.assertNotIn("CORE_START_TIMEOUT_MS", result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
