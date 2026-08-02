from __future__ import annotations

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DesktopLifecycleContractTest(unittest.TestCase):
    def read(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_windows_shutdown_terminates_descendant_processes(self) -> None:
        orphan = self.read("src-tauri/src/aether/orphan.rs")
        pty = self.read("src-tauri/src/aether/pty.rs")
        sing_box = self.read("src-tauri/src/system_tunnel/sing_box/process.rs")
        self.assertIn('"/T"', orphan)
        self.assertIn('"/F"', orphan)
        self.assertIn("terminate_process_tree(self.pid())", pty)
        self.assertIn("terminate_process_tree(child.id())", sing_box)

    def test_disconnect_owns_and_drains_the_session(self) -> None:
        manager = self.read("src-tauri/src/aether/mod.rs")
        self.assertIn("manager.session.take()", manager)
        self.assertIn("stop_session_blocking", manager)
        self.assertIn("orphan::reap_orphan", manager)
        self.assertNotIn("return Err(AetherError::NotConnected);", manager)

    def test_exit_requested_runs_cleanup_once(self) -> None:
        main = self.read("src-tauri/src/main.rs")
        state = self.read("src-tauri/src/state.rs")
        self.assertIn("RunEvent::ExitRequested", main)
        self.assertIn("RunEvent::Exit", main)
        self.assertIn("begin_shutdown", main)
        self.assertIn("shutdown_started.swap(true", state)


if __name__ == "__main__":
    unittest.main(verbosity=2)
