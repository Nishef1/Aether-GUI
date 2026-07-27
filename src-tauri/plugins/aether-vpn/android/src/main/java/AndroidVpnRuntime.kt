package com.cluvexstudio.aethergui.vpn

import android.content.Context
import app.tauri.plugin.JSObject
import java.io.File
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

data class FinalServiceSnapshot(
    val state: String,
    val message: String? = null,
    val socksAddr: String? = null,
    val tunAddr: String? = null,
    val connectedAtMs: Long? = null,
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put("state", state)
        message?.let { put("message", it) }
        socksAddr?.let { put("socksAddr", it) }
        tunAddr?.let { put("tunAddr", it) }
        connectedAtMs?.let { put("connectedAtMs", it) }
    }
}

data class FinalNativeTraffic(
    val receivedBytes: Long = 0L,
    val sentBytes: Long = 0L,
)

data class FinalNativeLogEntry(
    val id: Long,
    val timestamp: Long,
    val line: String,
)

data class FinalRuntimeTelemetry(
    val receivedBytes: Long = 0L,
    val sentBytes: Long = 0L,
    val publicIp: String? = null,
    val countryCode: String? = null,
    val latencyMs: Long? = null,
    val sampledAtMs: Long = 0L,
    val egressProbeComplete: Boolean = false,
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put("receivedBytes", receivedBytes)
        put("sentBytes", sentBytes)
        publicIp?.let { put("publicIp", it) }
        countryCode?.let { put("countryCode", it) }
        latencyMs?.let { put("latencyMs", it) }
        put("sampledAtMs", sampledAtMs)
        put("egressProbeComplete", egressProbeComplete)
    }
}

internal object AndroidVpnRuntime {
    private const val MAX_LOG_LINES = 800
    private const val MAX_DIAGNOSTICS_BYTES = 2_097_152L

    private val status = AtomicReference(idleSnapshot())
    private val activeTunBridge = AtomicReference<HevTun2Socks?>(null)
    private val telemetry = AtomicReference(FinalRuntimeTelemetry())
    private val logSequence = AtomicLong(0L)
    private val logLines = ArrayDeque<FinalNativeLogEntry>()

    fun snapshot(): FinalServiceSnapshot = status.get()

    fun updateSnapshot(snapshot: FinalServiceSnapshot) {
        status.updateAndGet { current ->
            // A delayed Service.onDestroy() must not erase a startup error or a
            // newer Launching session. Explicit stop always publishes
            // Disconnecting before it is allowed to transition to Idle.
            if (
                snapshot.state == "Idle" &&
                current.state != "Disconnecting" &&
                current.state != "Idle"
            ) {
                current
            } else {
                snapshot
            }
        }
    }

    fun idleSnapshot() = FinalServiceSnapshot("Idle")

    fun diagnosticsPath(context: Context): String =
        File(context.filesDir, "diagnostics/aether-mobile.log").absolutePath

    // Android mobile efficiency policy: retain the complete bounded log in
    // memory for the UI, but avoid flash writes for every scanner INFO line.
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
                file.writeText("$timestamp [android] diagnostics rotated\n")
            }
            file.appendText("$timestamp $line\n")
        }
    }

    fun logsAfter(afterId: Long): List<FinalNativeLogEntry> = synchronized(logLines) {
        logLines.filter { it.id > afterId }
    }

    fun recentLogTail(limit: Int): String = synchronized(logLines) {
        if (limit <= 0) {
            ""
        } else {
            logLines.toList().takeLast(limit).joinToString(" | ") { entry -> entry.line }
        }
    }

    fun setActiveTunBridge(bridge: HevTun2Socks) {
        activeTunBridge.set(bridge)
    }

    fun clearActiveTunBridge(expected: HevTun2Socks? = null) {
        if (expected == null) {
            activeTunBridge.set(null)
        } else {
            activeTunBridge.compareAndSet(expected, null)
        }
    }

    fun resetTelemetry() {
        telemetry.set(FinalRuntimeTelemetry(sampledAtMs = System.currentTimeMillis()))
    }

    fun trafficSnapshot(): FinalNativeTraffic {
        val stats = runCatching { activeTunBridge.get()?.TProxyGetStats() }.getOrNull()
        val traffic = if (stats == null || stats.size < 4) {
            FinalNativeTraffic()
        } else {
            // Pinned JNI contract: [tx packets, tx bytes, rx packets, rx bytes].
            FinalNativeTraffic(
                receivedBytes = stats[3].coerceAtLeast(0L),
                sentBytes = stats[1].coerceAtLeast(0L),
            )
        }
        telemetry.updateAndGet { current ->
            current.copy(
                receivedBytes = traffic.receivedBytes,
                sentBytes = traffic.sentBytes,
                sampledAtMs = System.currentTimeMillis(),
            )
        }
        return traffic
    }

    fun publishProbe(publicIp: String?, countryCode: String?, latencyMs: Long?) {
        telemetry.updateAndGet { current ->
            current.copy(
                publicIp = publicIp,
                countryCode = countryCode,
                latencyMs = latencyMs,
                sampledAtMs = System.currentTimeMillis(),
                egressProbeComplete = true,
            )
        }
    }

    fun telemetrySnapshot(): FinalRuntimeTelemetry {
        trafficSnapshot()
        return telemetry.get()
    }
}
