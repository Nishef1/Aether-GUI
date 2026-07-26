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
import android.os.SystemClock
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
import java.net.Proxy
import java.net.Socket
import java.util.ArrayDeque
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import org.json.JSONArray

@InvokeArg
class HardenedVpnProfileArgs {
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
    var webrtcLeakProtection: Boolean = true
}

@InvokeArg
class NativeLogArgs {
    var afterId: Long = 0L
}

@TauriPlugin
class HardenedAetherVpnPlugin(private val activity: Activity) : Plugin(activity) {
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
        val profile = invoke.parseArgs(HardenedVpnProfileArgs::class.java)
        if (profile.connectionMode != "proxy" && VpnService.prepare(activity) != null) {
            invoke.reject(
                "Android VPN permission is required before starting Tunnel or Both mode.",
                "vpnPermissionRequired"
            )
            return
        }

        HardenedAetherVpnService.markStartRequested()
        val intent = Intent(activity, HardenedAetherVpnService::class.java).apply {
            action = HardenedAetherVpnService.ACTION_START
            putExtra(HardenedAetherVpnService.EXTRA_PROTOCOL, profile.protocol)
            putExtra(HardenedAetherVpnService.EXTRA_SCAN_MODE, profile.scanMode)
            putExtra(HardenedAetherVpnService.EXTRA_IP_VERSION, profile.ipVersion)
            putExtra(HardenedAetherVpnService.EXTRA_CONNECTION_MODE, profile.connectionMode)
            putExtra(HardenedAetherVpnService.EXTRA_BIND_ADDRESS, profile.bindAddress)
            putExtra(HardenedAetherVpnService.EXTRA_DNS_SERVER, profile.dnsServer)
            putExtra(HardenedAetherVpnService.EXTRA_QUICK_RECONNECT, profile.quickReconnect)
            putExtra(HardenedAetherVpnService.EXTRA_MASQUE_HTTP2, profile.masqueHttp2)
            putExtra(HardenedAetherVpnService.EXTRA_MASQUE_NOIZE, profile.masqueNoize)
            putExtra(HardenedAetherVpnService.EXTRA_WG_NOIZE, profile.wgNoize)
            putExtra(
                HardenedAetherVpnService.EXTRA_WEBRTC_LEAK_PROTECTION,
                profile.webrtcLeakProtection
            )
        }

        try {
            ContextCompat.startForegroundService(activity, intent)
            // Readiness is observed through status polling. Returning immediately is
            // what makes the Connect button cancellable during native startup.
            invoke.resolve(HardenedAetherVpnService.snapshot().toJsObject())
        } catch (error: Throwable) {
            HardenedAetherVpnService.markStartFailed(error)
            invoke.reject(
                error.message ?: "Android refused to start the Aether VPN service",
                "aetherServiceStartFailed"
            )
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        HardenedAetherVpnService.markStopRequested()
        val intent = Intent(activity, HardenedAetherVpnService::class.java).apply {
            action = HardenedAetherVpnService.ACTION_STOP
        }
        try {
            activity.startService(intent)
            invoke.resolve(HardenedAetherVpnService.snapshot().toJsObject())
        } catch (error: Throwable) {
            invoke.reject(
                error.message ?: "Android refused to stop the Aether VPN service",
                "aetherServiceStopFailed"
            )
        }
    }

    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(HardenedAetherVpnService.snapshot().toJsObject())
    }

    @Command
    fun traffic(invoke: Invoke) {
        val traffic = HardenedAetherVpnService.trafficSnapshot()
        invoke.resolve(
            JSObject().apply {
                put("receivedBytes", traffic.receivedBytes)
                put("sentBytes", traffic.sentBytes)
            }
        )
    }

    @Command
    fun telemetry(invoke: Invoke) {
        invoke.resolve(HardenedAetherVpnService.telemetrySnapshot().toJsObject())
    }

    @Command
    fun logs(invoke: Invoke) {
        val args = invoke.parseArgs(NativeLogArgs::class.java)
        val entries = HardenedAetherVpnService.logsAfter(args.afterId)
        val payload = JSONArray()
        entries.forEach { entry ->
            payload.put(
                JSObject().apply {
                    put("id", entry.id)
                    put("timestamp", entry.timestamp)
                    put("line", entry.line)
                }
            )
        }
        invoke.resolve(
            JSObject().apply {
                put("entries", payload)
                put("lastId", entries.lastOrNull()?.id ?: args.afterId)
            }
        )
    }

    @Command
    fun diagnostics(invoke: Invoke) {
        invoke.resolve(
            JSObject().apply { put("path", HardenedAetherVpnService.diagnosticsPath(activity)) }
        )
    }
}

data class HardenedServiceSnapshot(
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

data class HardenedNativeTraffic(
    val receivedBytes: Long = 0L,
    val sentBytes: Long = 0L,
)

data class NativeLogEntry(
    val id: Long,
    val timestamp: Long,
    val line: String,
)

data class AndroidRuntimeTelemetry(
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

class HardenedAetherVpnService : VpnService() {
    private data class RuntimeResources(
        val process: Process? = null,
        val descriptor: ParcelFileDescriptor? = null,
        val bridge: HevTun2Socks? = null,
    )

    private data class TunnelResources(
        val descriptor: ParcelFileDescriptor,
        val bridge: HevTun2Socks,
    )

    private val sessionGate = ServiceSessionGate()
    private val resourceLock = Any()
    private val startExecutor = Executors.newSingleThreadExecutor()
    private val cleanupExecutor = Executors.newSingleThreadExecutor()
    private val probeExecutor = Executors.newSingleThreadExecutor()

    @Volatile
    private var pendingCleanup: Future<*>? = null

    private var coreProcess: Process? = null
    private var vpnInterface: ParcelFileDescriptor? = null
    private var tun2Socks: HevTun2Socks? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        log("Android VPN service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> requestStop("user request")
            ACTION_START -> startCore(intent)
        }
        return Service.START_NOT_STICKY
    }

    override fun onRevoke() {
        requestStop("VPN permission revoked")
        super.onRevoke()
    }

    override fun onDestroy() {
        sessionGate.cancel()
        val resources = detachAllResources()
        cleanupExecutor.execute { cleanupResources(resources, "service destroy") }
        startExecutor.shutdownNow()
        probeExecutor.shutdownNow()
        cleanupExecutor.shutdown()
        super.onDestroy()
    }

    private fun startCore(intent: Intent) {
        val token = sessionGate.begin()
        val staleResources = detachAllResources()
        val cleanupFuture = cleanupExecutor.submit {
            cleanupResources(staleResources, "replace stale session")
        }
        pendingCleanup = cleanupFuture

        resetTelemetry()
        updateSnapshot(HardenedServiceSnapshot("Launching"))
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
        val webrtcLeakProtection = intent.getBooleanExtra(
            EXTRA_WEBRTC_LEAK_PROTECTION,
            true
        )

        startExecutor.execute {
            runCatching { cleanupFuture.get(CLEANUP_WAIT_SECONDS, TimeUnit.SECONDS) }
                .onFailure { log("Previous session cleanup warning: ${it.message}") }
            runSession(
                token = token,
                protocol = protocol,
                scanMode = scanMode,
                ipVersion = ipVersion,
                connectionMode = connectionMode,
                bindAddress = bindAddress,
                dnsServer = dnsServer,
                quickReconnect = quickReconnect,
                masqueHttp2 = masqueHttp2,
                masqueNoize = masqueNoize,
                wgNoize = wgNoize,
                webrtcLeakProtection = webrtcLeakProtection,
            )
        }
    }

    private fun runSession(
        token: Long,
        protocol: String,
        scanMode: String,
        ipVersion: String,
        connectionMode: String,
        bindAddress: String,
        dnsServer: String,
        quickReconnect: Boolean,
        masqueHttp2: Boolean,
        masqueNoize: String,
        wgNoize: String,
        webrtcLeakProtection: Boolean,
    ) {
        var process: Process? = null
        var tunnel: TunnelResources? = null
        try {
            ensureActive(token)
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
            processBuilder.environment().apply {
                put("AETHER_CONFIG", File(filesDir, "aether.toml").absolutePath)
                put("AETHER_MASQUE_HTTP2", if (masqueHttp2) "1" else "0")
                put("AETHER_LOG_LEVEL", "info")
                put("RUST_BACKTRACE", "1")
            }

            log("Starting Aether; args=${command.drop(1).joinToString(" ")}")
            process = processBuilder.start()
            if (!attachProcess(token, process)) {
                throw CancellationException("Connection was cancelled before core attachment")
            }
            startCoreLogReader(process)

            if (!waitForSocks(token, bindAddress, process, CORE_START_TIMEOUT_MS)) {
                ensureActive(token)
                val exit = if (process.isAlive) null else process.exitValue()
                val tail = recentLogTail(8)
                error(
                    "Aether SOCKS endpoint did not become ready" +
                        (exit?.let { "; exit=$it" } ?: "; process still running") +
                        (if (tail.isBlank()) "" else "; recent logs: $tail")
                )
            }

            ensureActive(token)
            val connectedAt = System.currentTimeMillis()
            if (connectionMode == "proxy") {
                updateSnapshotIfActive(
                    token,
                    HardenedServiceSnapshot(
                        state = "Connected",
                        socksAddr = bindAddress,
                        connectedAtMs = connectedAt,
                    )
                )
                updateNotification("Connected · SOCKS $bindAddress")
                log("SOCKS endpoint ready at $bindAddress")
            } else {
                updateSnapshotIfActive(
                    token,
                    HardenedServiceSnapshot(
                        state = "StartingTunnel",
                        socksAddr = bindAddress,
                    )
                )
                tunnel = createSystemTunnel(
                    bindAddress,
                    dnsServer,
                    webrtcLeakProtection,
                )
                if (!attachTunnel(token, tunnel)) {
                    throw CancellationException("Connection was cancelled before TUN attachment")
                }
                updateSnapshotIfActive(
                    token,
                    HardenedServiceSnapshot(
                        state = "Tunneling",
                        socksAddr = bindAddress,
                        tunAddr = TUN_IPV4_ADDRESS,
                        connectedAtMs = connectedAt,
                    )
                )
                updateNotification("Protected · device tunnel active")
                log(
                    "Android TUN active; SOCKS=$bindAddress; WebRTC protection=" +
                        if (webrtcLeakProtection) "UDP-in-TCP" else "standard UDP relay"
                )
            }

            startEgressProbeLoop(token, bindAddress)
            val exitCode = process.waitFor()
            if (sessionGate.isActive(token)) {
                error("Aether core exited unexpectedly with code $exitCode")
            }
        } catch (_: CancellationException) {
            log("Connection session cancelled")
        } catch (error: Throwable) {
            log("ERROR: ${error.message ?: error}")
            if (sessionGate.isActive(token)) {
                updateSnapshot(
                    HardenedServiceSnapshot("Error", error.message ?: error.toString())
                )
                updateNotification("Connection failed")
            }
        } finally {
            val owned = takeOwnedResources(process, tunnel)
            cleanupResources(owned, "session finalizer")
            if (sessionGate.isActive(token) && snapshot().state == "Error") {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    private fun requestStop(reason: String) {
        val stopToken = sessionGate.cancel()
        updateSnapshot(HardenedServiceSnapshot("Disconnecting"))
        updateNotification("Disconnecting…")
        log("Stopping Aether: $reason")
        val resources = detachAllResources()
        val future = cleanupExecutor.submit {
            cleanupResources(resources, reason)
            resetTelemetry()
            if (sessionGate.isCurrent(stopToken) && sessionGate.isCancelled()) {
                updateSnapshot(idleSnapshot())
                log("Aether core and Android TUN stopped")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        pendingCleanup = future
    }

    private fun attachProcess(token: Long, process: Process): Boolean =
        synchronized(resourceLock) {
            if (!sessionGate.isActive(token)) {
                false
            } else {
                coreProcess = process
                true
            }
        }

    private fun attachTunnel(token: Long, tunnel: TunnelResources): Boolean =
        synchronized(resourceLock) {
            if (!sessionGate.isActive(token)) {
                false
            } else {
                vpnInterface = tunnel.descriptor
                tun2Socks = tunnel.bridge
                activeTunBridge.set(tunnel.bridge)
                true
            }
        }

    private fun detachAllResources(): RuntimeResources = synchronized(resourceLock) {
        val resources = RuntimeResources(coreProcess, vpnInterface, tun2Socks)
        coreProcess = null
        vpnInterface = null
        tun2Socks = null
        activeTunBridge.set(null)
        resources
    }

    private fun takeOwnedResources(
        process: Process?,
        tunnel: TunnelResources?,
    ): RuntimeResources = synchronized(resourceLock) {
        val ownedProcess = if (process != null && coreProcess === process) {
            coreProcess = null
            process
        } else {
            null
        }
        val ownedDescriptor = if (
            tunnel != null && vpnInterface === tunnel.descriptor
        ) {
            vpnInterface = null
            tunnel.descriptor
        } else {
            null
        }
        val ownedBridge = if (tunnel != null && tun2Socks === tunnel.bridge) {
            tun2Socks = null
            activeTunBridge.compareAndSet(tunnel.bridge, null)
            tunnel.bridge
        } else {
            null
        }
        RuntimeResources(ownedProcess, ownedDescriptor, ownedBridge)
    }

    private fun cleanupResources(resources: RuntimeResources, reason: String) {
        resources.descriptor?.let { descriptor ->
            runCatching { descriptor.close() }
                .onFailure { log("TUN descriptor close warning: ${it.message}") }
        }
        resources.bridge?.let { bridge ->
            runCatching { bridge.TProxyStopService() }
                .onFailure { log("tun2socks stop warning: ${it.message}") }
        }
        resources.process?.let { process ->
            runCatching {
                if (process.isAlive) process.destroy()
                if (!process.waitFor(PROCESS_STOP_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                    process.destroyForcibly()
                    process.waitFor(PROCESS_FORCE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                }
            }.onFailure {
                runCatching { process.destroyForcibly() }
                log("Aether process cleanup warning: ${it.message}")
            }
        }
        if (
            resources.process != null ||
            resources.descriptor != null ||
            resources.bridge != null
        ) {
            log("Native resources released: $reason")
        }
    }

    private fun ensureActive(token: Long) {
        if (!sessionGate.isActive(token)) {
            throw CancellationException("VPN session is no longer active")
        }
    }

    private fun startCoreLogReader(process: Process) {
        Thread {
            runCatching {
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line -> log("[core] $line") }
                }
            }.onFailure { log("Core log reader warning: ${it.message}") }
        }.apply {
            name = "aether-mobile-log"
            isDaemon = true
            start()
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

    private fun createSystemTunnel(
        bindAddress: String,
        dnsServer: String,
        webrtcLeakProtection: Boolean,
    ): TunnelResources {
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

        // The child core shares this app UID. Excluding only Aether prevents a
        // routing loop while every browser/application remains inside the VPN.
        builder.addDisallowedApplication(packageName)

        val descriptor = builder.establish()
            ?: error("Android refused to establish the Aether VPN interface")
        try {
            val configFile = writeTun2SocksConfig(
                socksHost,
                socksPort,
                webrtcLeakProtection,
            )
            val bridge = HevTun2Socks()
            bridge.TProxyStartService(configFile.absolutePath, descriptor.fd)
            return TunnelResources(descriptor, bridge)
        } catch (error: Throwable) {
            runCatching { descriptor.close() }
            throw error
        }
    }

    private fun writeTun2SocksConfig(
        socksHost: String,
        socksPort: Int,
        webrtcLeakProtection: Boolean,
    ): File {
        val config = File(filesDir, "hev-socks5-tunnel.yml")
        val nativeLog = File(filesDir, "diagnostics/hev-socks5-tunnel.log")
        nativeLog.parentFile?.mkdirs()
        val udpRelayMode = if (webrtcLeakProtection) "tcp" else "udp"

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
              udp: '$udpRelayMode'
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

    private fun waitForSocks(
        token: Long,
        bindAddress: String,
        process: Process,
        timeoutMs: Long,
    ): Boolean {
        val (host, port) = splitHostPort(bindAddress)
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (
            SystemClock.elapsedRealtime() < deadline &&
            process.isAlive &&
            sessionGate.isActive(token)
        ) {
            try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(host, port), SOCKS_POLL_CONNECT_TIMEOUT_MS)
                    return true
                }
            } catch (_: Throwable) {
                Thread.sleep(SOCKS_POLL_INTERVAL_MS)
            }
        }
        return false
    }

    private fun startEgressProbeLoop(token: Long, bindAddress: String) {
        probeExecutor.execute {
            while (sessionGate.isActive(token)) {
                val startedAt = SystemClock.elapsedRealtime()
                val result = runCatching { probeEgress(bindAddress) }
                if (sessionGate.isActive(token)) {
                    if (result.isSuccess) {
                        val probe = result.getOrThrow()
                        publishProbe(
                            publicIp = probe.first,
                            countryCode = probe.second,
                            latencyMs = (SystemClock.elapsedRealtime() - startedAt).coerceAtLeast(1L),
                        )
                        log("Exit probe: ${probe.first}${probe.second?.let { " · $it" } ?: ""}")
                    } else {
                        publishProbe(null, null, null)
                        log("Exit probe unavailable: ${result.exceptionOrNull()?.message}")
                    }
                }

                var remaining = EGRESS_PROBE_INTERVAL_MS
                while (remaining > 0 && sessionGate.isActive(token)) {
                    val sleep = minOf(remaining, 1_000L)
                    Thread.sleep(sleep)
                    remaining -= sleep
                }
            }
        }
    }

    private fun probeEgress(bindAddress: String): Pair<String, String?> {
        val (proxyHost, proxyPort) = splitHostPort(bindAddress)
        val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress(proxyHost, proxyPort))
        val rawSocket = Socket(proxy)
        rawSocket.connect(
            InetSocketAddress.createUnresolved(EGRESS_HOST, EGRESS_PORT),
            EGRESS_CONNECT_TIMEOUT_MS,
        )
        rawSocket.soTimeout = EGRESS_READ_TIMEOUT_MS

        val sslSocket = SSLSocketFactory.getDefault()
            .createSocket(rawSocket, EGRESS_HOST, EGRESS_PORT, true) as SSLSocket
        sslSocket.use { socket ->
            socket.soTimeout = EGRESS_READ_TIMEOUT_MS
            socket.startHandshake()
            socket.outputStream.bufferedWriter().use { writer ->
                writer.write("GET $EGRESS_PATH HTTP/1.1\r\n")
                writer.write("Host: $EGRESS_HOST\r\n")
                writer.write("User-Agent: Aether-Android/1\r\n")
                writer.write("Connection: close\r\n\r\n")
                writer.flush()
            }
            val response = socket.inputStream.bufferedReader().readText()
            var publicIp: String? = null
            var countryCode: String? = null
            response.lineSequence().forEach { line ->
                when {
                    line.startsWith("ip=") -> {
                        val value = line.substringAfter('=').trim()
                        if (runCatching { InetAddress.getByName(value) }.isSuccess) {
                            publicIp = value
                        }
                    }
                    line.startsWith("loc=") -> {
                        val value = line.substringAfter('=').trim().uppercase()
                        if (value.matches(Regex("^[A-Z]{2}$"))) countryCode = value
                    }
                }
            }
            return (publicIp ?: error("Exit response did not contain a valid IP")) to countryCode
        }
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
            getSystemService(NotificationManager::class.java).createNotificationChannel(
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

    private fun updateSnapshotIfActive(token: Long, snapshot: HardenedServiceSnapshot) {
        if (sessionGate.isActive(token)) updateSnapshot(snapshot)
    }

    private fun log(line: String) {
        appendLog(this, line)
    }

    companion object {
        const val ACTION_START = "com.cluvexstudio.aethergui.vpn.HARDENED_START"
        const val ACTION_STOP = "com.cluvexstudio.aethergui.vpn.HARDENED_STOP"
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
        const val EXTRA_WEBRTC_LEAK_PROTECTION = "webrtcLeakProtection"

        private const val CHANNEL_ID = "aether_connection"
        private const val NOTIFICATION_ID = 1819
        private const val CORE_START_TIMEOUT_MS = 50_000L
        private const val TUN_MTU = 8500
        private const val TUN_IPV4_ADDRESS = "198.18.0.1"
        private const val TUN_IPV6_ADDRESS = "fc00::1"
        private const val DEFAULT_SOCKS_ADDRESS = "127.0.0.1:1819"
        private const val DEFAULT_DNS_SERVER = "1.1.1.1"
        private const val MAX_LOG_LINES = 800
        private const val MAX_DIAGNOSTICS_BYTES = 2_097_152L
        private const val CLEANUP_WAIT_SECONDS = 4L
        private const val PROCESS_STOP_TIMEOUT_SECONDS = 2L
        private const val PROCESS_FORCE_TIMEOUT_SECONDS = 1L
        private const val SOCKS_POLL_CONNECT_TIMEOUT_MS = 300
        private const val SOCKS_POLL_INTERVAL_MS = 200L
        private const val EGRESS_HOST = "www.cloudflare.com"
        private const val EGRESS_PORT = 443
        private const val EGRESS_PATH = "/cdn-cgi/trace"
        private const val EGRESS_CONNECT_TIMEOUT_MS = 5_000
        private const val EGRESS_READ_TIMEOUT_MS = 8_000
        private const val EGRESS_PROBE_INTERVAL_MS = 60_000L

        private val status = AtomicReference(idleSnapshot())
        private val activeTunBridge = AtomicReference<HevTun2Socks?>(null)
        private val telemetry = AtomicReference(AndroidRuntimeTelemetry())
        private val logSequence = AtomicLong(0L)
        private val logLines = ArrayDeque<NativeLogEntry>()

        fun markStartRequested() {
            updateSnapshot(HardenedServiceSnapshot("Launching"))
        }

        fun markStopRequested() {
            updateSnapshot(HardenedServiceSnapshot("Disconnecting"))
        }

        fun markStartFailed(error: Throwable) {
            updateSnapshot(
                HardenedServiceSnapshot(
                    "Error",
                    error.message ?: error.toString(),
                )
            )
        }

        fun snapshot(): HardenedServiceSnapshot = status.get()

        fun idleSnapshot() = HardenedServiceSnapshot("Idle")

        fun diagnosticsPath(context: Context): String =
            File(context.filesDir, "diagnostics/aether-mobile.log").absolutePath

        fun logsAfter(afterId: Long): List<NativeLogEntry> = synchronized(logLines) {
            logLines.filter { it.id > afterId }
        }

        fun trafficSnapshot(): HardenedNativeTraffic {
            val stats = runCatching { activeTunBridge.get()?.TProxyGetStats() }.getOrNull()
            val traffic = if (stats == null || stats.size < 4) {
                HardenedNativeTraffic()
            } else {
                // JNI contract: [tx packets, tx bytes, rx packets, rx bytes].
                HardenedNativeTraffic(
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

        fun telemetrySnapshot(): AndroidRuntimeTelemetry {
            trafficSnapshot()
            return telemetry.get()
        }

        private fun resetTelemetry() {
            telemetry.set(
                AndroidRuntimeTelemetry(sampledAtMs = System.currentTimeMillis())
            )
        }

        private fun publishProbe(
            publicIp: String?,
            countryCode: String?,
            latencyMs: Long?,
        ) {
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

        private fun updateSnapshot(snapshot: HardenedServiceSnapshot) {
            status.set(snapshot)
        }

        private fun appendLog(context: Context, line: String) {
            val timestamp = System.currentTimeMillis()
            val entry = NativeLogEntry(logSequence.incrementAndGet(), timestamp, line)
            synchronized(logLines) {
                if (logLines.size >= MAX_LOG_LINES) logLines.removeFirst()
                logLines.addLast(entry)

                val file = File(diagnosticsPath(context))
                file.parentFile?.mkdirs()
                if (file.length() >= MAX_DIAGNOSTICS_BYTES) {
                    file.writeText("$timestamp [android] diagnostics rotated\n")
                }
                file.appendText("$timestamp $line\n")
            }
        }

        private fun recentLogTail(limit: Int): String = synchronized(logLines) {
            logLines.takeLast(limit).joinToString(" | ") { it.line }
        }
    }
}
