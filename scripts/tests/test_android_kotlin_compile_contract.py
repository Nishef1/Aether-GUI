#!/usr/bin/env python3

from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
PROBE = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt"
RUNTIME = ROOT / "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt"


class AndroidKotlinCompileContractTest(unittest.TestCase):
    def test_exit_probe_uses_explicit_ssl_socket_factory_type(self) -> None:
        source = PROBE.read_text(encoding="utf-8")
        self.assertIn("import javax.net.ssl.SSLSocketFactory", source)
        self.assertIn(
            "SSLContext.getDefault().socketFactory as SSLSocketFactory",
            source,
        )
        self.assertIn(
            "sslFactory.createSocket(rawSocket, HOST, PORT, true)",
            source,
        )
        self.assertNotIn(
            "SSLContext.getDefault().socketFactory\n                .createSocket",
            source,
        )
        self.assertIn("runCatching { rawSocket.close() }", source)

    def test_java_array_deque_is_converted_before_take_last(self) -> None:
        source = RUNTIME.read_text(encoding="utf-8")
        self.assertIn("logLines.toList().takeLast(limit)", source)
        self.assertNotIn("logLines.takeLast(limit)", source)

    def test_public_service_helpers_do_not_expose_internal_dtos(self) -> None:
        source = RUNTIME.read_text(encoding="utf-8")
        for type_name in (
            "FinalServiceSnapshot",
            "FinalNativeTraffic",
            "FinalNativeLogEntry",
            "FinalRuntimeTelemetry",
        ):
            self.assertIn(f"data class {type_name}", source)
            self.assertNotIn(f"internal data class {type_name}", source)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
