#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MARKER = "Android mobile efficiency policy"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block, found {count}")
    return source.replace(old, new, 1)


root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT
java_dir = root / "src-tauri/plugins/aether-vpn/android/src/main/java"
service_path = java_dir / "FinalAetherVpnPlugin.kt"
runtime_path = java_dir / "AndroidVpnRuntime.kt"

service = service_path.read_text(encoding="utf-8")
if MARKER not in service:
    service = replace_once(
        service,
        '''            val useMasqueHttp2 = AndroidTransportPolicy.isMasque(protocol) &&
                AndroidTransportPolicy.useMasqueHttp2(masqueHttp2, false)
            if (AndroidTransportPolicy.isMasque(protocol)) {''',
        '''            // Android mobile efficiency policy: Auto always takes the
            // proven H2/TCP route; explicit MASQUE still honors the user choice.
            val useMasqueHttp2 = AndroidTransportPolicy.isMasque(protocol) &&
                (AndroidTransportPolicy.isFastAuto(protocol) ||
                    AndroidTransportPolicy.useMasqueHttp2(masqueHttp2, false))
            if (AndroidTransportPolicy.isFastAuto(protocol)) {
                log("Auto route: MASQUE HTTP/2 with brief lowest-latency gateway selection")
            }
            if (AndroidTransportPolicy.isMasque(protocol)) {''',
        "Auto H2 route",
    )
    service = replace_once(
        service,
        '''            }.onFailure { log("Core log reader warning: ${it.message}") }
''',
        '''            }.onFailure {
                // Closing the process stream during Disconnect is expected and
                // should not create a diagnostic write or a misleading warning.
                if (process.isAlive) log("Core log reader warning: ${it.message}")
            }
''',
        "expected log-reader close suppression",
    )
    service = replace_once(
        service,
        '''        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (
''',
        '''        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        var pollDelayMs = SOCKS_POLL_INTERVAL_MS
        while (
''',
        "SOCKS adaptive poll declaration",
    )
    service = replace_once(
        service,
        '''            } catch (_: Throwable) {
                Thread.sleep(SOCKS_POLL_INTERVAL_MS)
            }
''',
        '''            } catch (_: Throwable) {
                Thread.sleep(pollDelayMs)
                pollDelayMs = minOf(pollDelayMs * 2, SOCKS_POLL_MAX_INTERVAL_MS)
            }
''',
        "SOCKS adaptive polling",
    )
    service = replace_once(
        service,
        '''                var remaining = EGRESS_PROBE_INTERVAL_MS
                while (remaining > 0 && sessionGate.isActive(token)) {
                    val sleep = minOf(remaining, 1_000L)
                    try {
                        Thread.sleep(sleep)
                    } catch (_: InterruptedException) {
                        // onDestroy shuts this executor down with interrupt. This
                        // is normal teardown, not an uncaught worker failure.
                        Thread.currentThread().interrupt()
                        return@execute
                    }
                    remaining -= sleep
                }
''',
        '''                if (!sessionGate.isActive(token)) return@execute
                try {
                    // One long interruptible sleep avoids waking the process every
                    // second merely to count down to the next optional exit sample.
                    Thread.sleep(EGRESS_PROBE_INTERVAL_MS)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return@execute
                }
''',
        "egress probe sleep",
    )
    for old, new, label in (
        ("              udp-recv-buffer-size: 524288", "              udp-recv-buffer-size: 262144", "UDP receive buffer"),
        ("              udp-copy-buffer-nums: 32", "              udp-copy-buffer-nums: 16", "UDP copy buffers"),
        ("              max-session-count: 2048", "              max-session-count: 1024", "session cap"),
        ("              log-level: info", "              log-level: warn", "native log level"),
        ("        .setSmallIcon(android.R.drawable.stat_sys_download_done)", "        .setSmallIcon(R.drawable.ic_stat_aether)", "notification icon"),
        ("        private const val SOCKS_POLL_INTERVAL_MS = 200L", "        private const val SOCKS_POLL_INTERVAL_MS = 250L\n        private const val SOCKS_POLL_MAX_INTERVAL_MS = 1_000L", "SOCKS poll constants"),
        ("        private const val EGRESS_PROBE_INTERVAL_MS = 60_000L", "        private const val EGRESS_PROBE_INTERVAL_MS = 300_000L", "egress interval"),
    ):
        service = replace_once(service, old, new, label)

runtime = runtime_path.read_text(encoding="utf-8")
if MARKER not in runtime:
    runtime = replace_once(
        runtime,
        '''    fun appendLog(context: Context, line: String) {
        val timestamp = System.currentTimeMillis()
        val entry = FinalNativeLogEntry(logSequence.incrementAndGet(), timestamp, line)
        synchronized(logLines) {
            if (logLines.size >= MAX_LOG_LINES) logLines.removeFirst()
            logLines.addLast(entry)

            val file = File(diagnosticsPath(context))
            file.parentFile?.mkdirs()
            if (file.length() >= MAX_DIAGNOSTICS_BYTES) {
                file.writeText("$timestamp [android] diagnostics rotated\\n")
            }
            file.appendText("$timestamp $line\\n")
        }
    }
''',
        '''    // Android mobile efficiency policy: retain the complete bounded log
    // in memory for the UI, but avoid opening and appending to flash storage for
    // every scanner INFO line. Only durable lifecycle and failure evidence is
    // persisted; the file remains bounded and useful for post-mortem diagnosis.
    private fun shouldPersistDiagnostic(line: String): Boolean {
        val normalized = line.lowercase()
        return normalized.contains("error") ||
            normalized.contains("warn") ||
            normalized.contains("starting aether") ||
            normalized.contains("selected ") ||
            normalized.contains("socks5 server listening") ||
            normalized.contains("socks egress verified") ||
            normalized.contains("android tun active") ||
            normalized.contains("transport selected") ||
            normalized.contains("stopped") ||
            normalized.contains("native resources released")
    }

    fun appendLog(context: Context, line: String) {
        val timestamp = System.currentTimeMillis()
        val entry = FinalNativeLogEntry(logSequence.incrementAndGet(), timestamp, line)
        synchronized(logLines) {
            if (logLines.size >= MAX_LOG_LINES) logLines.removeFirst()
            logLines.addLast(entry)

            if (!shouldPersistDiagnostic(line)) return@synchronized
            val file = File(diagnosticsPath(context))
            file.parentFile?.mkdirs()
            if (file.length() >= MAX_DIAGNOSTICS_BYTES) {
                file.writeText("$timestamp [android] diagnostics rotated\\n")
            }
            file.appendText("$timestamp $line\\n")
        }
    }
''',
        "diagnostic write filtering",
    )

for path, source in ((service_path, service), (runtime_path, runtime)):
    if MARKER not in source:
        raise SystemExit(f"{path.name}: efficiency marker is missing")
    path.write_text(source, encoding="utf-8")

print(f"Applied Android mobile efficiency policy in {java_dir}")
