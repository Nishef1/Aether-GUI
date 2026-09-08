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
    /**
     * Timestamp of the last egress-probe outcome, not of a cheap traffic sample.
     * Keeping these separate lets Path Intelligence distinguish a new probe
     * failure from a routine foreground telemetry refresh.
     */
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
 * Diagnostics are opt-in and memory-only. A separate tiny control queue stays
 * available while diagnostics are off so the WebView can receive interaction
 * and path-selection metadata without enabling verbose core logging.
 */
internal object AndroidVpnRuntime {
    private const val MAX_VISIBLE_LOG_LINES = 400
    private const val MAX_CONTROL_LOG_LINES = 24
    private const val MAX_INTERNAL_TAIL_LINES = 32
    private const val MAX_PARTIAL_CHARS = 16 * 1024

    private val status = AtomicReference(idleSnapshot())
    private val activeTunBridge = AtomicReference<HevTun2Socks?>(null)
    private val telemetry = AtomicReference(FinalRuntimeTelemetry())
    private val loggingEnabled = AtomicBoolean(false)
    private val logSequence = AtomicLong(0L)
    private val processInput = AtomicReference<BufferedWriter?>(null)
    private val visibleLogs = ArrayDeque<FinalNativeLogEntry>()
    private val controlLogs = ArrayDeque<FinalNativeLogEntry>()
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

    /**
     * Safety faults never silently downgrade to a direct/proxy-only path.
     * The VPN descriptor remains installed until service cleanup/reconnect, so
     * other apps are blackholed rather than leaked if the native TUN dies.
     */
    fun reportSafetyFailure(message: String) {
        appendInternal("[safety] $message")
        val current = status.get()
        updateSnapshot(
            FinalServiceSnapshot(
                state = "Error",
                message = message,
                socksAddr = current.socksAddr,
                tunAddr = current.tunAddr,
                connectedAtMs = current.connectedAtMs,
            ),
        )
        publishProbeFailure()
    }

    fun setLoggingEnabled(enabled: Boolean) {
        loggingEnabled.set(enabled)
        if (!enabled) {
            synchronized(visibleLogs) { visibleLogs.clear() }
        }
    }

    fun isLoggingEnabled(): Boolean = loggingEnabled.get()

    fun logsAfter(afterId: Long): List<FinalNativeLogEntry> {
        val controls = synchronized(controlLogs) { controlLogs.filter { it.id > afterId } }
        if (!loggingEnabled.get()) return controls
        val diagnostics = synchronized(visibleLogs) { visibleLogs.filter { it.id > afterId } }
        return (controls + diagnostics).sortedBy { it.id }
    }

    private fun newLogEntry(line: String) = FinalNativeLogEntry(
        id = logSequence.incrementAndGet(),
        timestamp = System.currentTimeMillis(),
        line = line,
    )

    private fun appendVisible(line: String) {
        if (!loggingEnabled.get()) return
        val entry = newLogEntry(line)
        synchronized(visibleLogs) {
            if (visibleLogs.size >= MAX_VISIBLE_LOG_LINES) visibleLogs.removeFirst()
            visibleLogs.addLast(entry)
        }
    }

    fun appendControlLine(line: String) {
        if (line.isBlank()) return
        val entry = newLogEntry(line)
        synchronized(controlLogs) {
            if (controlLogs.size >= MAX_CONTROL_LOG_LINES) controlLogs.removeFirst()
            controlLogs.addLast(entry)
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
                    ),
                )
                appendControlLine("[gui] Zero Trust access code required")
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
        synchronized(parserLock) {
            accessCodePromptVisible = false
            partialOutput = ""
        }
        val current = status.get()
        updateSnapshot(
            FinalServiceSnapshot(
                state = "Connecting",
                socksAddr = current.socksAddr,
                tunAddr = current.tunAddr,
                connectedAtMs = current.connectedAtMs,
            ),
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
        synchronized(controlLogs) { controlLogs.clear() }
    }

    fun trafficSnapshot(): FinalNativeTraffic {
        val bridge = activeTunBridge.get()
        if (bridge != null && !bridge.isRunning()) {
            reportSafetyFailure("Android device tunnel is no longer running; traffic remains blocked to prevent an IP leak")
        }
        val stats = runCatching { bridge?.TProxyGetStats() }.getOrNull()
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

    /**
     * A failed end-to-end probe invalidates old identity/latency immediately.
     * Keeping the previous successful IP here made a dead path look healthy to
     * the WebView until a later successful probe happened to overwrite it.
     */
    fun publishProbeFailure() {
        telemetry.updateAndGet { current ->
            current.copy(
                publicIp = null,
                countryCode = null,
                latencyMs = null,
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
