#!/usr/bin/env python3

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCH = ROOT / "scripts/ci/patch-android-mobile-efficiency.py"
SERVICE_RELATIVE = Path(
    "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
)
RUNTIME_RELATIVE = Path(
    "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt"
)
MANIFEST = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/AndroidManifest.xml"


class AndroidRuntimeResilienceTest(unittest.TestCase):
    def apply_policy(self) -> str:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        workspace = Path(temporary.name)

        for relative in (SERVICE_RELATIVE, RUNTIME_RELATIVE):
            source = ROOT / relative
            destination = workspace / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

        subprocess.run(
            [sys.executable, str(PATCH), str(workspace)],
            check=True,
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        # A second pass must be a no-op instead of duplicating source blocks.
        subprocess.run(
            [sys.executable, str(PATCH), str(workspace)],
            check=True,
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        return (workspace / SERVICE_RELATIVE).read_text(encoding="utf-8")

    def test_foreground_vpn_is_redelivered_after_process_recreation(self) -> None:
        service = self.apply_policy()
        self.assertIn("Android runtime resilience policy", service)
        self.assertIn("return Service.START_REDELIVER_INTENT", service)
        self.assertNotIn("return Service.START_NOT_STICKY", service)

    def test_task_removal_does_not_request_service_shutdown(self) -> None:
        manifest = MANIFEST.read_text(encoding="utf-8")
        self.assertIn('android:stopWithTask="false"', manifest)

    def test_system_tunnel_keeps_quic_on_socks_udp_associate(self) -> None:
        service = self.apply_policy()
        tunnel_call = service.split("tunnel = createSystemTunnel(", 1)[1].split(")", 1)[0]
        self.assertIn("false", tunnel_call)
        self.assertNotIn("webrtcLeakProtection", tunnel_call)
        self.assertIn("UDP/QUIC relayed through SOCKS5", service)
        self.assertIn("udp: '$udpRelayMode'", service)


if __name__ == "__main__":
    unittest.main(verbosity=2)
