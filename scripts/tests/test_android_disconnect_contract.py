#!/usr/bin/env python3

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BRIDGE = ROOT / "scripts/native/aethertun-jni.c"
KOTLIN = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/HevTun2Socks.kt"
SERVICE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt"
HEV_PATCH = ROOT / "scripts/ci/patch-hev-idempotent-stop.py"
HEV_BUILD = ROOT / "scripts/ci/build-hev-android.sh"


class AndroidDisconnectContractTest(unittest.TestCase):
    def test_bridge_uses_one_joinable_native_thread(self) -> None:
        source = BRIDGE.read_text(encoding="utf-8")
        self.assertIn("pthread_join(thread, NULL)", source)
        self.assertIn("thread_joinable", source)
        self.assertIn("join_in_progress", source)
        self.assertIn("TUN_STATE_STOPPING", source)
        self.assertNotIn("PTHREAD_CREATE_DETACHED", source)
        self.assertNotIn("pthread_cond_timedwait", source)
        self.assertNotIn("STOP_WAIT_MS", source)
        self.assertLess(source.index("pthread_join(thread, NULL)"), source.index("thread_joinable = false"))

    def test_kotlin_releases_ownership_only_after_join_succeeds(self) -> None:
        source = KOTLIN.read_text(encoding="utf-8")
        stop_call = source.index("val stopped = runCatching { AetherTunBridge.nativeStop() }")
        release = source.index("ownsSession = false", stop_call)
        success = source.index("if (stopped)", stop_call)
        self.assertGreater(release, success)
        self.assertIn("nativeRunning = false", source[success:])

    def test_pinned_hev_assert_is_replaced_by_pending_idempotent_stop(self) -> None:
        patch = HEV_PATCH.read_text(encoding="utf-8")
        build = HEV_BUILD.read_text(encoding="utf-8")
        self.assertIn("static int stop_requested;", patch)
        self.assertIn("WRITE_ONCE (stop_requested, 1);", patch)
        self.assertIn("socks5 tunnel pending stop event", patch)
        self.assertIn("errno != EAGAIN && errno != EWOULDBLOCK", patch)
        self.assertIn("patch-hev-idempotent-stop.py", build)
        self.assertIn("! grep -Fq", build)

    def test_service_stops_native_bridge_before_closing_tun_descriptor(self) -> None:
        source = SERVICE.read_text(encoding="utf-8")
        cleanup = source[source.index("private fun cleanupResources"):]
        self.assertLess(cleanup.index("TProxyStopService"), cleanup.index("descriptor.close()"))
        self.assertLess(cleanup.index("descriptor.close()"), cleanup.index("process.destroy()"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
