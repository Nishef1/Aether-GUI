package com.cluvexstudio.aethergui.vpn

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
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
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
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
            invoke.resolve(JSObject().apply { put("prepared", true) })
            return
        }
        startActivityForResult(invoke, permissionIntent, "vpnPermissionResult")
    }

    @ActivityCallback
    private fun vpnPermissionResult(invoke: Invoke, result: ActivityResult) {
        invoke.resolve(
            JSObject().apply { put("prepared", result.resultCode == Activity.RESULT_OK) }
        )
    }

    @Command
    fun start(invoke: Invoke) {
        val profile = invoke.parseArgs(VpnProfileArgs::class.java)
        if (profile.connectionMode != "proxy" && VpnService.prepare(activity) != null) {
            invoke.reject(
                "Android VPN permission is required before starting Tunnel or Both mode.",
                "vpnPermissionRequired"
            )
            return
        }

        val intent = Intent(activity, AetherVpnService::class.java).apply {
            action = AetherVpnService.ACTION_START
            putExtra(AetherVpnService.EXTRA_PROTOCOL, profile.protocol)
            putExtra(AetherVpnService.EXTRA_SCAN_MODE, profile.scanMode)
            putExtra(AetherVpnService.EXTRA_IP_VERSION, profile.ipVersion)
            putExtra(AetherVpnService.EXTRA_CONNECTION_MODE, profile.connectionMode)
            putExtra(AetherVpnService.EXTRA_BIND_ADDRESS, profile.bindAddress)
            putExtra(AetherVpnService.EXTRA_DNS_SERVER, profile.dnsServer)
            putExtra(AetherVpnService.EXTRA_QUICK_RECONNECT, profile.quickReconnect)
            putExtra(AetherVpnService.EXTRA_MASQUE_HTTP2, profile.masqueHttp2)
            putExtra(AetherVpnService.EXTRA_MASQUE_NOIZE, profile.masqueNoize)
            putExtra(AetherVpnService.EXTRA_WG_NOIZE, profile.wgNoize)
        }
        ContextCompat.startForegroundService(activity, intent)

        executor.execute {
            val deadline = System.currentTimeMillis() + START_TIMEOUT_MS
            var snapshot = AetherVpnService.snapshot()
            while (
                System.currentTimeMillis() < deadline &&
                snapshot.state in setOf("Idle", "Launching", "StartingTunnel")
            ) {
                Thread.sleep(150L)
                snapshot = AetherVpnService.snapshot()
            }

            activity.runOnUiThread {
                when (snapshot.state) {
                    "Error" -> invoke.reject(
                        snapshot.message ?: "Aether failed to start",
                        "aetherStartFailed"
                    )
                    "Idle", "Launching", "StartingTunnel" -> invoke.reject(
                        "Aether did not become ready before the startup deadline",
                        "aetherStartTimeout"
                    )
                    else -> invoke.resolve(snapshot.toJsObject())
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
        val traffic = AetherVpnService.trafficSnapshot()
        invoke.resolve(
            JSObject().apply {
                put("receivedBytes", traffic.receivedBytes)
                put("sentBytes", traffic.sentBytes)
            }
        )
    }

    @Command
    fun diagnostics(invoke: Invoke) {
        invoke.resolve(
            JSObject().apply { put("path", AetherVpnService.diagnosticsPath(activity)) }
        )
    }

    companion object {
        private const val START_TIMEOUT_MS = 60_000L
    }
}

data class ServiceSnapshot(
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

data class NativeTraffic(
    val receivedBytes: Long = 0L,
    val sentBytes: Long = 0L,
)

class AetherVpnService : VpnService() {
    private var coreProcess: Process? = null
    private var vpnInterface: ParcelFileDescriptor? = null
    private var tun2Socks: HevTun2Socks? = null
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
        val connectionMode = intent.getStringExtra(EXTRA_CONNECTION_MODE) ?: "proxy"
        val bindAddress = sanitizeBindAddress(
            intent.getStringExtra(EXTRA_BIND_ADDRESS) ?: DEFAULT_SOCKS_ADDRESS
        )
        val dnsServer = sanitizeDnsServer(
            intent.getStringExtra(EXTRA_DNS_SERVER) ?: DEFAULT_DNS_SERVER
        )
        val quickReconnect = intent.getBooleanExtra(EXTRA_QUICK_RECONNECT, true)
        val masqueHttp2 = intent.getBooleanExtra(EXTRA_MASQUE_HTTP2, false)
        val masqueNoize = intent.getStringExtra(EXTRA_MASQUE_NOIZE) ?: "firewall"
        val wgNoize = intent.getStringExtra(EXTRA_WG_NOIZE) ?: "balanced"

        worker.execute {
            try {
                val executable = File(applicationInfo.nativeLibraryDir, "libaether_exec.so")
                if (!executable.isFile) {
                    error("Bundled ARM64 Aether core was not found at ${executable.absolutePath}")
                }

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
                val environment = processBuilder.environment()
                environment["AETHER_CONFIG"] = File(filesDir, "aether.toml").absolutePath
                environment["AETHER_MASQUE_HTTP2"] = if (masqueHttp2) "1" else "0"
                environment["AETHER_LOG_LEVEL"] = "info"

                appendLog("Starting Aether; args=${command.drop(1).joinToString(" ")}")
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

                if (!waitForSocks(bindAddress, process, CORE_START_TIMEOUT_MS)) {
                    val exit = if (process.isAlive) null else process.exitValue()
                    error(
                        "Aether SOCKS endpoint did not become ready" +
                            (exit?.let { "; exit=$it" } ?: "")
                    )
                }

                val connectedAt = System.currentTimeMillis()
                if (connectionMode == "proxy") {
                    updateSnapshot(
                        ServiceSnapshot(
                            state = "Connected",
                            socksAddr = bindAddress,
                            connectedAtMs = connectedAt,
                        )
                    )
                    updateNotification("Connected · SOCKS $bindAddress")
                    appendLog("SOCKS endpoint ready at $bindAddress")
                } else {
                    updateSnapshot(
                        ServiceSnapshot(
                            state = "StartingTunnel",
                            socksAddr = bindAddress,
                        )
                    )
                    startSystemTunnel(bindAddress, dnsServer)
                    updateSnapshot(
                        ServiceSnapshot(
                            state = "Tunneling",
                            socksAddr = bindAddress,
                            tunAddr = TUN_IPV4_ADDRESS,
                            connectedAtMs = connectedAt,
                        )
                    )
                    updateNotification("Protected · device tunnel active")
                    appendLog("Android TUN is routing through Aether SOCKS at $bindAddress")
                }

                val exitCode = process.waitFor()
                if (!stopping) {
                    stopSystemTunnel()
                    error("Aether core exited unexpectedly with code $exitCode")
                }
            } catch (error: Throwable) {
                stopSystemTunnel()
                appendLog("ERROR: ${error.message}")
                if (!stopping) {
                    updateSnapshot(ServiceSnapshot("Error", error.message ?: error.toString()))
                    updateNotification("Connection failed")
                }
            }
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

        when (protocol) {
            "masque" -> command += "--masque"
            "wireguard" -> command += "--wg"
            "gool" -> command += "--gool"
        }

        command += when (scanMode) {
            "turbo" -> "--turbo"
            "thorough" -> "--thorough"
            "stealth" -> "--stealth"
            "ironclad" -> "--ironclad"
            else -> "--balanced"
        }

        command += when (ipVersion) {
            "v6" -> "-6"
            "both" -> "--dual"
            else -> "-4"
        }

        command += if (quickReconnect) "--quick-reconnect" else "--no-quick-reconnect"
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

    private fun startSystemTunnel(bindAddress: String, dnsServer: String) {
        if (VpnService.prepare(this) != null) {
            error("Android VPN permission was revoked before the tunnel started")
        }

        val (socksHost, socksPort) = splitHostPort(bindAddress)
        val builder = Builder()
            .setSession("Aether")
            .setMtu(TUN_MTU)
            .addAddress(TUN_IPV4_ADDRESS, 32)
            .addAddress(TUN_IPV6_ADDRESS, 128)
            .addRoute("0.0.0.0", 0)
            .addRoute("::", 0)
            .addDnsServer(dnsServer)
            .setBlocking(false)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setMetered(false)
        }

        // The Aether child process has the same UID as this app. Excluding the
        // package keeps its gateway sockets outside the VPN and prevents a route
        // loop, while traffic from every other application enters this TUN.
        builder.addDisallowedApplication(packageName)

        val descriptor = builder.establish()
            ?: error("Android refused to establish the Aether VPN interface")
        vpnInterface = descriptor

        val configFile = writeTun2SocksConfig(socksHost, socksPort)
        val bridge = HevTun2Socks()
        tun2Socks = bridge
        activeTunBridge.set(bridge)
        bridge.TProxyStartService(configFile.absolutePath, descriptor.fd)
    }

    private fun writeTun2SocksConfig(socksHost: String, socksPort: Int): File {
        val config = File(filesDir, "hev-socks5-tunnel.yml")
        val nativeLog = File(filesDir, "diagnostics/hev-socks5-tunnel.log")
        nativeLog.parentFile?.mkdirs()

        config.writeText(
            """
            tunnel:
              name: tun0
              mtu: $TUN_MTU
              multi-queue: false
              ipv4: $TUN_IPV4_ADDRESS
              ipv6: '$TUN_IPV6_ADDRESS'

            socks5:
              port: $socksPort
              address: '${yamlQuote(socksHost)}'
              udp: 'udp'
              pipeline: true

            misc:
              task-stack-size: 86016
              tcp-buffer-size: 65536
              udp-recv-buffer-size: 524288
              udp-copy-buffer-nums: 32
              max-session-count: 2048
              connect-timeout: 15000
              tcp-read-write-timeout: 300000
              udp-read-write-timeout: 60000
              log-file: '${yamlQuote(nativeLog.absolutePath)}'
              log-level: info
              limit-nofile: 8192
            """.trimIndent() + "\n"
        )
        return config
    }

    private fun stopSystemTunnel() {
        activeTunBridge.getAndSet(null)?.let { bridge ->
            runCatching { bridge.TProxyStopService() }
                .onFailure { appendLog("tun2socks stop warning: ${it.message}") }
        }
        tun2Socks = null
        vpnInterface?.let { descriptor ->
            runCatching { descriptor.close() }
        }
        vpnInterface = null
    }

    private fun stopCore() {
        if (stopping && coreProcess == null && vpnInterface == null) return
        stopping = true
        updateSnapshot(ServiceSnapshot("Disconnecting"))
        stopSystemTunnel()
        coreProcess?.let { process ->
            process.destroy()
            try {
                if (!process.waitFor(2, TimeUnit.SECONDS)) {
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
        val (host, port) = splitHostPort(bindAddress)
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

    private fun splitHostPort(value: String): Pair<String, Int> {
        val separator = value.lastIndexOf(':')
        if (separator <= 0) return "127.0.0.1" to 1819
        val host = value.substring(0, separator).removePrefix("[").removeSuffix("]")
        val port = value.substring(separator + 1).toIntOrNull() ?: 1819
        return host to port
    }

    private fun sanitizeBindAddress(value: String): String {
        val (host, port) = splitHostPort(value)
        val safeHost = when (host) {
            "localhost", "127.0.0.1", "::1" -> host
            else -> "127.0.0.1"
        }
        return if (safeHost.contains(':')) "[$safeHost]:$port" else "$safeHost:$port"
    }

    private fun sanitizeDnsServer(value: String): String {
        return runCatching {
            val parsed = InetAddress.getByName(value.trim())
            if (parsed.isAnyLocalAddress || parsed.isMulticastAddress) {
                DEFAULT_DNS_SERVER
            } else {
                parsed.hostAddress ?: DEFAULT_DNS_SERVER
            }
        }.getOrDefault(DEFAULT_DNS_SERVER)
    }

    private fun yamlQuote(value: String): String = value.replace("'", "''")

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
            val stamped = "${System.currentTimeMillis()} $line"
            if (logLines.size >= MAX_LOG_LINES) logLines.removeFirst()
            logLines.addLast(stamped)

            val file = File(diagnosticsPath(this))
            file.parentFile?.mkdirs()
            if (file.length() >= MAX_DIAGNOSTICS_BYTES) {
                file.writeText("${System.currentTimeMillis()} [android] diagnostics truncated\n")
            }
            file.appendText("$stamped\n")
        }
    }

    companion object {
        const val ACTION_START = "com.cluvexstudio.aethergui.vpn.START"
        const val ACTION_STOP = "com.cluvexstudio.aethergui.vpn.STOP"
        const val EXTRA_PROTOCOL = "protocol"
        const val EXTRA_SCAN_MODE = "scanMode"
        const val EXTRA_IP_VERSION = "ipVersion"
        const val EXTRA_CONNECTION_MODE = "connectionMode"
        const val EXTRA_BIND_ADDRESS = "bindAddress"
        const val EXTRA_DNS_SERVER = "dnsServer"
        const val EXTRA_QUICK_RECONNECT = "quickReconnect"
        const val EXTRA_MASQUE_HTTP2 = "masqueHttp2"
        const val EXTRA_MASQUE_NOIZE = "masqueNoize"
        const val EXTRA_WG_NOIZE = "wgNoize"

        private const val CHANNEL_ID = "aether_connection"
        private const val NOTIFICATION_ID = 1819
        private const val CORE_START_TIMEOUT_MS = 50_000L
        private const val TUN_MTU = 8500
        private const val TUN_IPV4_ADDRESS = "198.18.0.1"
        private const val TUN_IPV6_ADDRESS = "fc00::1"
        private const val DEFAULT_SOCKS_ADDRESS = "127.0.0.1:1819"
        private const val DEFAULT_DNS_SERVER = "1.1.1.1"
        private const val MAX_LOG_LINES = 500
        private const val MAX_DIAGNOSTICS_BYTES = 1_048_576L
        private val status = AtomicReference(idleSnapshot())
        private val logLines = ArrayDeque<String>()
        private val activeTunBridge = AtomicReference<HevTun2Socks?>(null)

        fun snapshot(): ServiceSnapshot = status.get()
        fun idleSnapshot() = ServiceSnapshot("Idle")
        fun diagnosticsPath(context: Context): String =
            File(context.filesDir, "diagnostics/aether-mobile.log").absolutePath

        fun trafficSnapshot(): NativeTraffic {
            val stats = runCatching { activeTunBridge.get()?.TProxyGetStats() }.getOrNull()
            if (stats == null || stats.size < 4) return NativeTraffic()
            return NativeTraffic(
                receivedBytes = stats[3].coerceAtLeast(0L),
                sentBytes = stats[1].coerceAtLeast(0L),
            )
        }

        private fun updateSnapshot(snapshot: ServiceSnapshot) {
            status.set(snapshot)
        }
    }
}
