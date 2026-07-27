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
import java.net.Socket
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import org.json.JSONArray

@InvokeArg
class FinalVpnProfileArgs {
    var protocol: String = "auto"
    var scanMode: String = "balanced"
    var ipVersion: String = "v4"
    var connectionMode: String = "proxy"
    var tunEngine: String = "xray"
    var quickReconnect: Boolean = true
    var masqueHttp2: Boolean = true
    var masqueNoize: String = "firewall"
    var wgNoize: String = "balanced"
    var dnsServer: String = "1.1.1.1"
    var bindAddress: String = "127.0.0.1:1819"
    var webrtcLeakProtection: Boolean = true
}

@InvokeArg
class FinalNativeLogArgs {
    var afterId: Long = 0L
}

@TauriPlugin
class FinalAetherVpnPlugin(private val activity: Activity) : Plugin(activity) {
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
        val profile = invoke.parseArgs(FinalVpnProfileArgs::class.java)
        if (profile.connectionMode != "proxy" && VpnService.prepare(activity) != null) {
            invoke.reject(
                "Android VPN permission is required before starting Tunnel or Both mode.",
                "vpnPermissionRequired"
            )
            return
        }

        FinalAetherVpnService.markStartRequested()
        val intent = Intent(activity, FinalAetherVpnService::class.java).apply {
            action = FinalAetherVpnService.ACTION_START
            putExtra(FinalAetherVpnService.EXTRA_PROTOCOL, profile.protocol)
            putExtra(FinalAetherVpnService.EXTRA_SCAN_MODE, profile.scanMode)
            putExtra(FinalAetherVpnService.EXTRA_IP_VERSION, profile.ipVersion)
            putExtra(FinalAetherVpnService.EXTRA_CONNECTION_MODE, profile.connectionMode)
            putExtra(FinalAetherVpnService.EXTRA_BIND_ADDRESS, profile.bindAddress)
            putExtra(FinalAetherVpnService.EXTRA_DNS_SERVER, profile.dnsServer)
            putExtra(FinalAetherVpnService.EXTRA_QUICK_RECONNECT, profile.quickReconnect)
            putExtra(FinalAetherVpnService.EXTRA_MASQUE_HTTP2, profile.masqueHttp2)
            putExtra(FinalAetherVpnService.EXTRA_MASQUE_NOIZE, profile.masqueNoize)
            putExtra(FinalAetherVpnService.EXTRA_WG_NOIZE, profile.wgNoize)
            putExtra(
                FinalAetherVpnService.EXTRA_WEBRTC_LEAK_PROTECTION,
                profile.webrtcLeakProtection
            )
        }

        try {
            ContextCompat.startForegroundService(activity, intent)
            // Native readiness is reconciled through Android status polling. Return
            // immediately so Disconnect can cancel a still-starting session.
            invoke.resolve(FinalAetherVpnService.snapshot().toJsObject())
        } catch (error: Throwable) {
            FinalAetherVpnService.markStartFailed(error)
            invoke.reject(
                error.message ?: "Android refused to start the Aether VPN service",
                "aetherServiceStartFailed"
            )
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        FinalAetherVpnService.markStopRequested()
        val intent = Intent(activity, FinalAetherVpnService::class.java).apply {
            action = FinalAetherVpnService.ACTION_STOP
        }
        try {
            activity.startService(intent)
            invoke.resolve(FinalAetherVpnService.snapshot().toJsObject())
        } catch (error: Throwable) {
            invoke.reject(
                error.message ?: "Android refused to stop the Aether VPN service",
                "aetherServiceStopFailed"
            )
        }
    }

    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(FinalAetherVpnService.snapshot().toJsObject())
    }

    @Command
    fun traffic(invoke: Invoke) {
        val traffic = FinalAetherVpnService.trafficSnapshot()
        invoke.resolve(
            JSObject().apply {
                put("receivedBytes", traffic.receivedBytes)
                put("sentBytes", traffic.sentBytes)
            }
        )
    }

    @Command
    fun telemetry(invoke: Invoke) {
        invoke.resolve(FinalAetherVpnService.telemetrySnapshot().toJsObject())
    }

    @Command
    fun logs(invoke: Invoke) {
        val args = invoke.parseArgs(FinalNativeLogArgs::class.java)
        val entries = FinalAetherVpnService.logsAfter(args.afterId)
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
            JSObject().apply { put("path", FinalAetherVpnService.diagnosticsPath(activity)) }
        )
    }
}

class FinalAetherVpnService : VpnService() {
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
            ACTION_START -> startCore(intent)
            ACTION_STOP -> requestStop("user request")
        }
        return Service.START_NOT_STICKY
    }

    override fun onRevoke() {
        requestStop("VPN permission revoked")
        super.onRevoke()
    }

    override fun onDestroy() {
        sessionGate.cancel()
        AndroidVpnRuntime.updateSnapshot(AndroidVpnRuntime.idleSnapshot())
        AndroidVpnRuntime.resetTelemetry()
        val resources = detachAllResources()
        runCatching {
            cleanupExecutor.submit { cleanupResources(resources, "service destroy") }
        }
        startExecutor.shutdownNow()
        probeExecutor.shutdownNow()
        cleanupExecutor.shutdown()
        super.onDestroy()
    }

    private fun startCore(intent: Intent) {
        val token = sessionGate.begin()
        val previousCleanup = pendingCleanup
        val staleResources = detachAllResources()
        val cleanupFuture = cleanupExecutor.submit {
            runCatching {
                previousCleanup?.get(CLEANUP_WAIT_SECONDS, TimeUnit.SECONDS)
            }.onFailure {
                log("Previous cleanup wait warning: ${it.message}")
            }
            cleanupResources(staleResources, "replace stale session")
        }
        pendingCleanup = cleanupFuture

        AndroidVpnRuntime.resetTelemetry()
        AndroidVpnRuntime.updateSnapshot(FinalServiceSnapshot("Launching"))
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
        val masqueHttp2 = intent.getBooleanExtra(EXTRA_MASQUE_HTTP2, true)
        val masqueNoize = intent.getStringExtra(EXTRA_MASQUE_NOIZE) ?: "firewall"
        val wgNoize = intent.getStringExtra(EXTRA_WG_NOIZE) ?: "balanced"
        val webrtcLeakProtection = intent.getBooleanExtra(
            EXTRA_WEBRTC_LEAK_PROTECTION,
            true
        )

        startExecutor.execute {
            runCatching {
                cleanupFuture.get(CLEANUP_WAIT_SECONDS, TimeUnit.SECONDS)
            }.onFailure {
                log("Cleanup barrier warning: ${it.message}")
            }
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
        var processAttached = false
        var tunnel: TunnelResources? = null
        var tunnelAttached = false

        try {
            ensureActive(token)
            val executable = File(applicationInfo.nativeLibraryDir, "libaether_exec.so")
            if (!executable.isFile) {
                error("Bundled ARM64 Aether core was not found at ${executable.absolutePath}")
            }

            val useMasqueHttp2 = AndroidTransportPolicy.isMasque(protocol) &&
                AndroidTransportPolicy.useMasqueHttp2(masqueHttp2, false)
            if (AndroidTransportPolicy.isMasque(protocol)) {
                log(
                    "MASQUE transport selected: HTTP/2 (TCP); Android safe auto; " +
                        "requestedH2=$masqueHttp2"
                )
            }
            val effectiveWgNoize = if (AndroidTransportPolicy.isWireGuardFamily(protocol)) {
                AndroidTransportPolicy.effectiveWireGuardNoize(wgNoize)
            } else {
                wgNoize
            }
            if (effectiveWgNoize != wgNoize) {
                log("Android stable dataplane pass: WireGuard noize $wgNoize -> $effectiveWgNoize")
            }

            val command = buildCoreCommand(
                executable = executable,
                protocol = protocol,
                scanMode = scanMode,
                ipVersion = ipVersion,
                bindAddress = bindAddress,
                quickReconnect = quickReconnect,
                masqueNoize = masqueNoize,
                wgNoize = effectiveWgNoize,
                useMasqueHttp2 = useMasqueHttp2,
            )
            val processBuilder = ProcessBuilder(command).redirectErrorStream(true)
            processBuilder.environment().apply {
                put("AETHER_CONFIG", File(filesDir, "aether.toml").absolutePath)
                remove("AETHER_MASQUE_HTTP2")
                if (AndroidTransportPolicy.isMasque(protocol) && useMasqueHttp2) {
                    put("AETHER_MASQUE_HTTP2", "1")
                }
                put("AETHER_LOG_LEVEL", "info")
                put("RUST_BACKTRACE", "1")
            }

            log("Starting Aether; args=${command.drop(1).joinToString(" ")}")
            process = processBuilder.start()
            if (!attachProcess(token, process)) {
                cleanupResources(RuntimeResources(process = process), "cancel before core attach")
                process = null
                throw CancellationException("Connection cancelled before core attachment")
            }
            processAttached = true
            startCoreLogReader(process)

            val startupTimeoutMs = AndroidTransportPolicy.startupTimeoutMs(protocol, scanMode)
            log("Waiting up to ${startupTimeoutMs / 1000}s for $protocol SOCKS readiness")
            if (!waitForSocks(token, bindAddress, process, startupTimeoutMs)) {
                ensureActive(token)
                val exit = if (process.isAlive) null else process.exitValue()
                val tail = AndroidVpnRuntime.recentLogTail(8)
                error(
                    "Aether SOCKS endpoint did not become ready" +
                        (exit?.let { "; exit=$it" } ?: "; process still running") +
                        (if (tail.isBlank()) "" else "; recent logs: $tail")
                )
            }

            ensureActive(token)
            updateSnapshotIfActive(
                token,
                FinalServiceSnapshot(
                    state = "Verifying",
                    socksAddr = bindAddress,
                )
            )
            updateNotification("Verifying tunnel egress…")
            val initialProbe = AndroidEgressProbe.probe(bindAddress)
            ensureActive(token)
            AndroidVpnRuntime.publishProbe(
                initialProbe.publicIp,
                initialProbe.countryCode,
                initialProbe.latencyMs,
            )
            log(
                "SOCKS egress verified via ${initialProbe.provider}: ${initialProbe.publicIp}" +
                    (initialProbe.countryCode?.let { " · $it" } ?: "") +
                    " · ${initialProbe.latencyMs} ms"
            )
            val connectedAt = System.currentTimeMillis()
            if (connectionMode == "proxy") {
                updateSnapshotIfActive(
                    token,
                    FinalServiceSnapshot(
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
                    FinalServiceSnapshot(
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
                    cleanupResources(
                        RuntimeResources(
                            descriptor = tunnel.descriptor,
                            bridge = tunnel.bridge,
                        ),
                        "cancel before TUN attach",
                    )
                    tunnel = null
                    throw CancellationException("Connection cancelled before TUN attachment")
                }
                tunnelAttached = true
                updateSnapshotIfActive(
                    token,
                    FinalServiceSnapshot(
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
                AndroidVpnRuntime.updateSnapshot(
                    FinalServiceSnapshot("Error", error.message ?: error.toString())
                )
                updateNotification("Connection failed")
            }
        } finally {
            val owned = takeOwnedResources(process, tunnel)
            val finalResources = RuntimeResources(
                process = owned.process ?: if (!processAttached) process else null,
                descriptor = owned.descriptor ?: if (!tunnelAttached) tunnel?.descriptor else null,
                bridge = owned.bridge ?: if (!tunnelAttached) tunnel?.bridge else null,
            )
            cleanupResources(finalResources, "session finalizer")
            if (sessionGate.isActive(token) && snapshot().state == "Error") {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    private fun requestStop(reason: String) {
        val stopToken = sessionGate.cancel()
        AndroidVpnRuntime.updateSnapshot(FinalServiceSnapshot("Disconnecting"))
        updateNotification("Disconnecting…")
        log("Stopping Aether: $reason")

        val resources = detachAllResources()
        val future = cleanupExecutor.submit {
            cleanupResources(resources, reason)
            AndroidVpnRuntime.resetTelemetry()
            if (sessionGate.isCurrent(stopToken) && sessionGate.isCancelled()) {
                AndroidVpnRuntime.updateSnapshot(AndroidVpnRuntime.idleSnapshot())
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
                AndroidVpnRuntime.setActiveTunBridge(tunnel.bridge)
                true
            }
        }

    private fun detachAllResources(): RuntimeResources = synchronized(resourceLock) {
        val resources = RuntimeResources(coreProcess, vpnInterface, tun2Socks)
        coreProcess = null
        vpnInterface = null
        tun2Socks = null
        AndroidVpnRuntime.clearActiveTunBridge()
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
            AndroidVpnRuntime.clearActiveTunBridge(tunnel.bridge)
            tunnel.bridge
        } else {
            null
        }
        RuntimeResources(ownedProcess, ownedDescriptor, ownedBridge)
    }

    private fun cleanupResources(resources: RuntimeResources, reason: String) {
        resources.bridge?.let { bridge ->
            runCatching { bridge.TProxyStopService() }
                .onFailure { log("tun2socks stop warning: ${it.message}") }
        }
        resources.descriptor?.let { descriptor ->
            runCatching { descriptor.close() }
                .onFailure { log("TUN descriptor close warning: ${it.message}") }
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
        useMasqueHttp2: Boolean,
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
        AndroidTransportPolicy.appendCoreArgs(command, protocol, useMasqueHttp2)
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

        // Only this app is excluded to avoid a loop in the bundled core. Browser
        // and WebRTC traffic from every other package stays inside the full VPN.
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
                val result = runCatching { AndroidEgressProbe.probe(bindAddress) }
                if (sessionGate.isActive(token)) {
                    if (result.isSuccess) {
                        val probe = result.getOrThrow()
                        AndroidVpnRuntime.publishProbe(
                            probe.publicIp,
                            probe.countryCode,
                            probe.latencyMs,
                        )
                        log(
                            "Exit probe: ${probe.publicIp}" +
                                (probe.countryCode?.let { " · $it" } ?: "") +
                                " · ${probe.latencyMs} ms"
                        )
                    } else {
                        AndroidVpnRuntime.publishProbe(null, null, null)
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

    private fun updateSnapshotIfActive(token: Long, snapshot: FinalServiceSnapshot) {
        if (sessionGate.isActive(token)) AndroidVpnRuntime.updateSnapshot(snapshot)
    }

    private fun log(line: String) {
        AndroidVpnRuntime.appendLog(this, line)
    }

    companion object {
        const val ACTION_START = "com.cluvexstudio.aethergui.vpn.FINAL_START"
        const val ACTION_STOP = "com.cluvexstudio.aethergui.vpn.FINAL_STOP"
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
        private const val TUN_MTU = AndroidTransportPolicy.TUN_MTU
        private const val TUN_IPV4_ADDRESS = "198.18.0.1"
        private const val TUN_IPV6_ADDRESS = "fc00::1"
        private const val DEFAULT_SOCKS_ADDRESS = "127.0.0.1:1819"
        private const val DEFAULT_DNS_SERVER = "1.1.1.1"
        private const val CLEANUP_WAIT_SECONDS = 4L
        private const val PROCESS_STOP_TIMEOUT_SECONDS = 2L
        private const val PROCESS_FORCE_TIMEOUT_SECONDS = 1L
        private const val SOCKS_POLL_CONNECT_TIMEOUT_MS = 300
        private const val SOCKS_POLL_INTERVAL_MS = 200L
        private const val EGRESS_PROBE_INTERVAL_MS = 60_000L

        fun markStartRequested() {
            AndroidVpnRuntime.updateSnapshot(FinalServiceSnapshot("Launching"))
        }

        fun markStopRequested() {
            AndroidVpnRuntime.updateSnapshot(FinalServiceSnapshot("Disconnecting"))
        }

        fun markStartFailed(error: Throwable) {
            AndroidVpnRuntime.updateSnapshot(
                FinalServiceSnapshot("Error", error.message ?: error.toString())
            )
        }

        fun snapshot(): FinalServiceSnapshot = AndroidVpnRuntime.snapshot()

        fun trafficSnapshot(): FinalNativeTraffic = AndroidVpnRuntime.trafficSnapshot()

        fun telemetrySnapshot(): FinalRuntimeTelemetry = AndroidVpnRuntime.telemetrySnapshot()

        fun logsAfter(afterId: Long): List<FinalNativeLogEntry> =
            AndroidVpnRuntime.logsAfter(afterId)

        fun diagnosticsPath(context: Context): String =
            AndroidVpnRuntime.diagnosticsPath(context)
    }
}
