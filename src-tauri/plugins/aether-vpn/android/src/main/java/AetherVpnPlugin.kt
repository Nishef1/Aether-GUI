package com.cluvexstudio.aethergui.vpn

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.IBinder
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

@InvokeArg
class VpnProfileArgs {
    var protocol: String = "auto"
    var scanMode: String = "balanced"
    var ipVersion: String = "v4"
    var connectionMode: String = "proxy"
    var tunEngine: String = "xray"
    var quickReconnect: Boolean = true
    var masqueHttp2: Boolean = false
    var masqueNoize: String = "firewall"
    var wgNoize: String = "balanced"
    var dnsServer: String = "1.1.1.1"
    var bindAddress: String = "127.0.0.1:1819"
}

@TauriPlugin
class AetherVpnPlugin(private val activity: Activity) : Plugin(activity) {
    private val executor = Executors.newSingleThreadExecutor()

    @Command
    fun prepare(invoke: Invoke) {
        val permissionIntent = VpnService.prepare(activity)
        if (permissionIntent == null) {
            invoke.resolve(JSObject().put("prepared", true))
            return
        }
        startActivityForResult(invoke, permissionIntent, "vpnPermissionResult")
    }

    @ActivityCallback
    private fun vpnPermissionResult(invoke: Invoke, result: ActivityResult) {
        invoke.resolve(JSObject().put("prepared", result.resultCode == Activity.RESULT_OK))
    }

    @Command
    fun start(invoke: Invoke) {
        val profile = invoke.parseArgs(VpnProfileArgs::class.java)
        if (profile.connectionMode != "proxy") {
            invoke.reject(
                "Android full-device TUN routing is not enabled in this ARM64 alpha yet. Select Proxy mode.",
                "androidTunBridgeUnavailable"
            )
            return
        }

        val intent = Intent(activity, AetherVpnService::class.java).apply {
            action = AetherVpnService.ACTION_START
            putExtra(AetherVpnService.EXTRA_PROTOCOL, profile.protocol)
            putExtra(AetherVpnService.EXTRA_SCAN_MODE, profile.scanMode)
            putExtra(AetherVpnService.EXTRA_IP_VERSION, profile.ipVersion)
            putExtra(AetherVpnService.EXTRA_BIND_ADDRESS, profile.bindAddress)
            putExtra(AetherVpnService.EXTRA_MASQUE_HTTP2, profile.masqueHttp2)
            putExtra(AetherVpnService.EXTRA_MASQUE_NOIZE, profile.masqueNoize)
            putExtra(AetherVpnService.EXTRA_WG_NOIZE, profile.wgNoize)
        }
        ContextCompat.startForegroundService(activity, intent)

        executor.execute {
            val deadline = System.currentTimeMillis() + 45_000L
            var snapshot = AetherVpnService.snapshot()
            while (System.currentTimeMillis() < deadline && snapshot.state in setOf("Idle", "Launching")) {
                Thread.sleep(150L)
                snapshot = AetherVpnService.snapshot()
            }
            val result = snapshot.toJsObject()
            activity.runOnUiThread {
                if (snapshot.state == "Error") {
                    invoke.reject(snapshot.message ?: "Aether failed to start", "aetherStartFailed")
                } else {
                    invoke.resolve(result)
                }
            }
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        val intent = Intent(activity, AetherVpnService::class.java).apply {
            action = AetherVpnService.ACTION_STOP
        }
        activity.startService(intent)
        invoke.resolve(AetherVpnService.idleSnapshot().toJsObject())
    }

    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(AetherVpnService.snapshot().toJsObject())
    }

    @Command
    fun traffic(invoke: Invoke) {
        invoke.resolve(
            JSObject()
                .put("receivedBytes", 0L)
                .put("sentBytes", 0L)
        )
    }

    @Command
    fun diagnostics(invoke: Invoke) {
        invoke.resolve(JSObject().put("path", AetherVpnService.diagnosticsPath(activity)))
    }
}

data class ServiceSnapshot(
    val state: String,
    val message: String? = null,
    val socksAddr: String? = null,
    val connectedAtMs: Long? = null,
) {
    fun toJsObject(): JSObject = JSObject().apply {
        put("state", state)
        message?.let { put("message", it) }
        socksAddr?.let { put("socksAddr", it) }
        connectedAtMs?.let { put("connectedAtMs", it) }
    }
}

class AetherVpnService : VpnService() {
    private var coreProcess: Process? = null
    private var stopping = false
    private val worker = Executors.newSingleThreadExecutor()

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopCore()
            ACTION_START -> startCore(intent)
        }
        return Service.START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)

    override fun onRevoke() {
        stopCore()
        super.onRevoke()
    }

    override fun onDestroy() {
        stopCore()
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun startCore(intent: Intent) {
        if (coreProcess?.isAlive == true) return

        stopping = false
        updateSnapshot(ServiceSnapshot("Launching"))
        startForeground(NOTIFICATION_ID, buildNotification("Starting Aether…"))

        val protocol = intent.getStringExtra(EXTRA_PROTOCOL) ?: "auto"
        val scanMode = intent.getStringExtra(EXTRA_SCAN_MODE) ?: "balanced"
        val ipVersion = intent.getStringExtra(EXTRA_IP_VERSION) ?: "v4"
        val bindAddress = intent.getStringExtra(EXTRA_BIND_ADDRESS) ?: "127.0.0.1:1819"
        val masqueHttp2 = intent.getBooleanExtra(EXTRA_MASQUE_HTTP2, false)
        val masqueNoize = intent.getStringExtra(EXTRA_MASQUE_NOIZE) ?: "firewall"
        val wgNoize = intent.getStringExtra(EXTRA_WG_NOIZE) ?: "balanced"

        worker.execute {
            try {
                val executable = File(applicationInfo.nativeLibraryDir, "libaether_exec.so")
                if (!executable.isFile) {
                    error("Bundled ARM64 Aether core was not found at ${executable.absolutePath}")
                }

                val processBuilder = ProcessBuilder(executable.absolutePath)
                    .redirectErrorStream(true)
                val environment = processBuilder.environment()
                environment["AETHER_CONFIG"] = File(filesDir, "aether.toml").absolutePath
                environment["AETHER_SCAN_MODE"] = scanMode
                environment["AETHER_IP_VERSION"] = ipVersion
                environment["AETHER_SOCKS"] = bindAddress
                environment["AETHER_LOG_LEVEL"] = "info"
                environment["AETHER_NOIZE"] = if (protocol == "wireguard" || protocol == "gool") wgNoize else masqueNoize
                environment["AETHER_MASQUE_HTTP2"] = if (masqueHttp2) "1" else "0"
                if (protocol != "auto") environment["AETHER_PROTOCOL"] = protocol

                appendLog("Starting ${executable.name}; protocol=$protocol bind=$bindAddress")
                val process = processBuilder.start()
                coreProcess = process

                Thread {
                    process.inputStream.bufferedReader().useLines { lines ->
                        lines.forEach { appendLog(it) }
                    }
                }.apply {
                    name = "aether-mobile-log"
                    isDaemon = true
                    start()
                }

                if (!waitForSocks(bindAddress, process, 45_000L)) {
                    val exit = if (process.isAlive) null else process.exitValue()
                    error("Aether SOCKS endpoint did not become ready${exit?.let { "; exit=$it" } ?: ""}")
                }

                val connectedAt = System.currentTimeMillis()
                updateSnapshot(ServiceSnapshot("Connected", socksAddr = bindAddress, connectedAtMs = connectedAt))
                updateNotification("Connected · SOCKS $bindAddress")
                appendLog("SOCKS endpoint ready at $bindAddress")

                val exitCode = process.waitFor()
                if (!stopping) {
                    error("Aether core exited unexpectedly with code $exitCode")
                }
            } catch (error: Throwable) {
                appendLog("ERROR: ${error.message}")
                if (!stopping) {
                    updateSnapshot(ServiceSnapshot("Error", error.message ?: error.toString()))
                    updateNotification("Connection failed")
                }
            }
        }
    }

    private fun stopCore() {
        stopping = true
        updateSnapshot(ServiceSnapshot("Disconnecting"))
        coreProcess?.let { process ->
            process.destroy()
            try {
                if (!process.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) {
                    process.destroyForcibly()
                }
            } catch (_: InterruptedException) {
                process.destroyForcibly()
                Thread.currentThread().interrupt()
            }
        }
        coreProcess = null
        updateSnapshot(idleSnapshot())
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun waitForSocks(bindAddress: String, process: Process, timeoutMs: Long): Boolean {
        val separator = bindAddress.lastIndexOf(':')
        val host = if (separator > 0) bindAddress.substring(0, separator) else "127.0.0.1"
        val port = bindAddress.substringAfterLast(':', "1819").toIntOrNull() ?: 1819
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline && process.isAlive && !stopping) {
            try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(host, port), 300)
                    return true
                }
            } catch (_: Throwable) {
                Thread.sleep(200L)
            }
        }
        return false
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Aether connection",
                    NotificationManager.IMPORTANCE_LOW,
                )
            )
        }
    }

    private fun buildNotification(text: String) = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_download_done)
        .setContentTitle("Aether")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .build()

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun appendLog(line: String) {
        synchronized(logLines) {
            if (logLines.size >= MAX_LOG_LINES) logLines.removeFirst()
            logLines.addLast("${System.currentTimeMillis()} $line")
            val file = File(diagnosticsPath(this))
            file.parentFile?.mkdirs()
            file.appendText("${System.currentTimeMillis()} $line\n")
        }
    }

    companion object {
        const val ACTION_START = "com.cluvexstudio.aethergui.vpn.START"
        const val ACTION_STOP = "com.cluvexstudio.aethergui.vpn.STOP"
        const val EXTRA_PROTOCOL = "protocol"
        const val EXTRA_SCAN_MODE = "scanMode"
        const val EXTRA_IP_VERSION = "ipVersion"
        const val EXTRA_BIND_ADDRESS = "bindAddress"
        const val EXTRA_MASQUE_HTTP2 = "masqueHttp2"
        const val EXTRA_MASQUE_NOIZE = "masqueNoize"
        const val EXTRA_WG_NOIZE = "wgNoize"

        private const val CHANNEL_ID = "aether_connection"
        private const val NOTIFICATION_ID = 1819
        private const val MAX_LOG_LINES = 500
        private val status = AtomicReference(idleSnapshot())
        private val logLines = ArrayDeque<String>()

        fun snapshot(): ServiceSnapshot = status.get()
        fun idleSnapshot() = ServiceSnapshot("Idle")
        fun diagnosticsPath(context: Context): String =
            File(context.filesDir, "diagnostics/aether-mobile.log").absolutePath

        private fun updateSnapshot(snapshot: ServiceSnapshot) {
            status.set(snapshot)
        }
    }
}
