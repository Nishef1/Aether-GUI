package com.cluvexstudio.aethergui.vpn

import app.tauri.plugin.JSObject
import java.io.BufferedWriter
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicBoolean
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

/**
 * Process-local Android runtime state.
 *
 * Logs are opt-in, memory-only and cleared as soon as logging is disabled.
 * No diagnostic or traffic log is ever written to app storage.
 */
internal object AndroidVpnRuntime {
    private const val MAX_VISIBLE_LOG_LINES = 400
    private const val MAX_INTERNAL_TAIL_LINES = 32
    private const val MAX_PARTIAL_CHARS = 16 * 1024

    private val status = AtomicReference(idleSnapshot())
    private val activeTunBridge = AtomicReference<HevTun2Socks?>(null)
    private val telemetry = AtomicReference(FinalRuntimeTelemetry())
    private val loggingEnabled = AtomicBoolean(false)
    private val logSequence = AtomicLong(0L)
    private val processInput = AtomicReference<BufferedWriter?>(null)
    private val visibleLogs = ArrayDeque<FinalNativeLogEntry>()
    private val internalTail = ArrayDeque<String>()
    private val parserLock = Any()
    private var partialOutput = ""
    private var accessCodePromptVisible = false

    fun snapshot(): FinalServiceSnapshot = status.get()

    fun updateSnapshot(snapshot: FinalServiceSnapshot) {
        status.updateAndGet { current ->
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

    fun setLoggingEnabled(enabled: Boolean) {
        loggingEnabled.set(enabled)
        if (!enabled) {
            synchronized(visibleLogs) { visibleLogs.clear() }
        }
    }

    fun isLoggingEnabled(): Boolean = loggingEnabled.get()

    fun logsAfter(afterId: Long): List<FinalNativeLogEntry> = synchronized(visibleLogs) {
        if (!loggingEnabled.get()) emptyList() else visibleLogs.filter { it.id > afterId }
    }

    private fun appendVisible(line: String) {
        if (!loggingEnabled.get()) return
        val entry = FinalNativeLogEntry(
            id = logSequence.incrementAndGet(),
            timestamp = System.currentTimeMillis(),
            line = line,
        )
        synchronized(visibleLogs) {
            if (visibleLogs.size >= MAX_VISIBLE_LOG_LINES) visibleLogs.removeFirst()
            visibleLogs.addLast(entry)
        }
    }

    private fun appendInternal(line: String) {
        if (line.isBlank()) return
        synchronized(internalTail) {
            if (internalTail.size >= MAX_INTERNAL_TAIL_LINES) internalTail.removeFirst()
            internalTail.addLast(line)
        }
        appendVisible(line)
    }

    fun appendServiceLine(line: String) {
        appendInternal("[android] $line")
    }

    fun appendCoreChunk(chunk: String) {
        synchronized(parserLock) {
            partialOutput += chunk
            if (partialOutput.length > MAX_PARTIAL_CHARS) {
                partialOutput = partialOutput.takeLast(MAX_PARTIAL_CHARS)
            }

            val normalized = partialOutput.replace("\r\n", "\n").replace('\r', '\n')
            val lines = normalized.split('\n')
            partialOutput = lines.lastOrNull().orEmpty()
            lines.dropLast(1).forEach { raw ->
                val line = stripAnsi(raw).trim()
                if (line.isNotEmpty()) appendInternal("[core] $line")
            }

            val prompt = stripAnsi(partialOutput).contains("Enter the code:")
            if (prompt && !accessCodePromptVisible) {
                val current = status.get()
                updateSnapshot(
                    FinalServiceSnapshot(
                        state = "AwaitingAccessCode",
                        socksAddr = current.socksAddr,
                        tunAddr = current.tunAddr,
                        connectedAtMs = current.connectedAtMs,
                    )
                )
                appendVisible("[gui] Zero Trust access code required")
            }
            accessCodePromptVisible = prompt
        }
    }

    fun recentLogTail(limit: Int): String = synchronized(internalTail) {
        if (limit <= 0) "" else internalTail.toList().takeLast(limit).joinToString(" | ")
    }

    fun attachProcessInput(writer: BufferedWriter) {
        processInput.set(writer)
    }

    fun clearProcessInput(writer: BufferedWriter? = null) {
        if (writer == null) processInput.set(null) else processInput.compareAndSet(writer, null)
    }

    fun submitAccessCode(code: String) {
        val normalized = code.trim()
        require(normalized.isNotEmpty() && normalized.length <= 512) {
            "Invalid Zero Trust access code"
        }
        require(!normalized.contains('\r') && !normalized.contains('\n')) {
            "Invalid Zero Trust access code"
        }
        val writer = processInput.get() ?: error("Aether is not waiting for an access code")
        synchronized(writer) {
            writer.write(normalized)
            writer.write("\n")
            writer.flush()
        }
        synchronized(parserLock) { accessCodePromptVisible = false }
        val current = status.get()
        updateSnapshot(
            FinalServiceSnapshot(
                state = "Connecting",
                socksAddr = current.socksAddr,
                tunAddr = current.tunAddr,
                connectedAtMs = current.connectedAtMs,
            )
        )
    }

    fun setActiveTunBridge(bridge: HevTun2Socks) {
        activeTunBridge.set(bridge)
    }

    fun clearActiveTunBridge(expected: HevTun2Socks? = null) {
        if (expected == null) activeTunBridge.set(null)
        else activeTunBridge.compareAndSet(expected, null)
    }

    fun resetTelemetry() {
        telemetry.set(FinalRuntimeTelemetry(sampledAtMs = System.currentTimeMillis()))
    }

    fun trafficSnapshot(): FinalNativeTraffic {
        val stats = runCatching { activeTunBridge.get()?.TProxyGetStats() }.getOrNull()
        val traffic = if (stats == null || stats.size < 4) {
            FinalNativeTraffic()
        } else {
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

    private fun stripAnsi(value: String): String =
        value.replace(Regex("\\u001B\\[[;\\d]*[ -/]*[@-~]"), "")
}
