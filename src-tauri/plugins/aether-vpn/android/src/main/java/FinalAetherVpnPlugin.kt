package com.cluvexstudio.aethergui.vpn

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
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
import java.io.BufferedWriter
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
    var connectionMode: String = "tunnel"
    var tunEngine: String = "hev"
    var quickReconnect: Boolean = false
    var masqueHttp2: Boolean = false
    var masqueNoize: String = "firewall"
    var wgNoize: String = "balanced"
    var dnsServer: String = "1.1.1.1"
    var dns: String = ""
    var bindAddress: String = "127.0.0.1:1819"
    var webrtcLeakProtection: Boolean = false
    var mtu: Int = 1280
    var peer: String = ""
    var wgPeer: String = ""
    var h2Peer: String = ""
    var ech: String = ""
    var noDataCheck: Boolean = false
    var validateSecs: Int = 10
    var reconnectSecs: Int = 2
    var fragment: Boolean = false
    var fragmentSize: String = "16-32"
    var fragmentDelay: String = "2-10"
    var keepalive: Int = 5
    var noProfileRetry: Boolean = false
    var tlsGroups: String = ""
    var perfProfile: String = "auto"
    var zeroTrustTeam: String = ""
    var zeroTrustAuth: String = "email"
    var accessEmail: String = ""
    var accessClientId: String = ""
    var accessClientSecret: String = ""
    var accessToken: String = ""
    var zeroTrustGateway: Boolean = false
    var routeBlock: String = ""
    var routeDirect: String = ""
    var routesFile: String = ""
}

@InvokeArg
class FinalNativeLogArgs { var afterId: Long = 0L }

@InvokeArg
class FinalLoggingArgs { var enabled: Boolean = false }

@InvokeArg
class FinalAccessCodeArgs { var code: String = "" }

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
        invoke.resolve(JSObject().apply { put("prepared", result.resultCode == Activity.RESULT_OK) })
    }

    @Command
    fun start(invoke: Invoke) {
        val profile = invoke.parseArgs(FinalVpnProfileArgs::class.java)
        val validationError = validateProfile(profile)
        if (validationError != null) {
            invoke.reject(validationError, "invalidVpnProfile")
            return
        }
        if (profile.connectionMode != "proxy" && VpnService.prepare(activity) != null) {
            invoke.reject("Android VPN permission is required", "vpnPermissionRequired")
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
            putExtra(FinalAetherVpnService.EXTRA_DNS, profile.dns)
            putExtra(FinalAetherVpnService.EXTRA_QUICK_RECONNECT, profile.quickReconnect)
            putExtra(FinalAetherVpnService.EXTRA_MASQUE_HTTP2, profile.masqueHttp2)
            putExtra(FinalAetherVpnService.EXTRA_MASQUE_NOIZE, profile.masqueNoize)
            putExtra(FinalAetherVpnService.EXTRA_WG_NOIZE, profile.wgNoize)
            putExtra(FinalAetherVpnService.EXTRA_WEBRTC_LEAK_PROTECTION, profile.webrtcLeakProtection)
            putExtra(FinalAetherVpnService.EXTRA_MTU, profile.mtu)
            putExtra(FinalAetherVpnService.EXTRA_PEER, profile.peer)
            putExtra(FinalAetherVpnService.EXTRA_WG_PEER, profile.wgPeer)
            putExtra(FinalAetherVpnService.EXTRA_H2_PEER, profile.h2Peer)
            putExtra(FinalAetherVpnService.EXTRA_ECH, profile.ech)
            putExtra(FinalAetherVpnService.EXTRA_NO_DATA_CHECK, profile.noDataCheck)
            putExtra(FinalAetherVpnService.EXTRA_VALIDATE_SECS, profile.validateSecs)
            putExtra(FinalAetherVpnService.EXTRA_RECONNECT_SECS, profile.reconnectSecs)
            putExtra(FinalAetherVpnService.EXTRA_FRAGMENT, profile.fragment)
            putExtra(FinalAetherVpnService.EXTRA_FRAGMENT_SIZE, profile.fragmentSize)
            putExtra(FinalAetherVpnService.EXTRA_FRAGMENT_DELAY, profile.fragmentDelay)
            putExtra(FinalAetherVpnService.EXTRA_KEEPALIVE, profile.keepalive)
            putExtra(FinalAetherVpnService.EXTRA_NO_PROFILE_RETRY, profile.noProfileRetry)
            putExtra(FinalAetherVpnService.EXTRA_TLS_GROUPS, profile.tlsGroups)
            putExtra(FinalAetherVpnService.EXTRA_PERF_PROFILE, profile.perfProfile)
            putExtra(FinalAetherVpnService.EXTRA_ZERO_TRUST_TEAM, profile.zeroTrustTeam)
            putExtra(FinalAetherVpnService.EXTRA_ZERO_TRUST_AUTH, profile.zeroTrustAuth)
            putExtra(FinalAetherVpnService.EXTRA_ACCESS_EMAIL, profile.accessEmail)
            putExtra(FinalAetherVpnService.EXTRA_ACCESS_CLIENT_ID, profile.accessClientId)
            putExtra(FinalAetherVpnService.EXTRA_ACCESS_CLIENT_SECRET, profile.accessClientSecret)
            putExtra(FinalAetherVpnService.EXTRA_ACCESS_TOKEN, profile.accessToken)
            putExtra(FinalAetherVpnService.EXTRA_ZERO_TRUST_GATEWAY, profile.zeroTrustGateway)
            putExtra(FinalAetherVpnService.EXTRA_ROUTE_BLOCK, profile.routeBlock)
            putExtra(FinalAetherVpnService.EXTRA_ROUTE_DIRECT, profile.routeDirect)
            putExtra(FinalAetherVpnService.EXTRA_ROUTES_FILE, profile.routesFile)
        }

        try {
            ContextCompat.startForegroundService(activity, intent)
            invoke.resolve(FinalAetherVpnService.snapshot().toJsObject())
        } catch (error: Throwable) {
            FinalAetherVpnService.markStartFailed(error)
            invoke.reject(error.message ?: "Android refused to start the VPN service", "aetherServiceStartFailed")
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
            invoke.reject(error.message ?: "Android refused to stop the VPN service", "aetherServiceStopFailed")
        }
    }

    @Command
    fun status(invoke: Invoke) = invoke.resolve(FinalAetherVpnService.snapshot().toJsObject())

    @Command
    fun traffic(invoke: Invoke) {
        val traffic = FinalAetherVpnService.trafficSnapshot()
        invoke.resolve(JSObject().apply {
            put("receivedBytes", traffic.receivedBytes)
            put("sentBytes", traffic.sentBytes)
        })
    }

    @Command
    fun telemetry(invoke: Invoke) =
        invoke.resolve(FinalAetherVpnService.telemetrySnapshot().toJsObject())

    @Command
    fun logs(invoke: Invoke) {
        val args = invoke.parseArgs(FinalNativeLogArgs::class.java)
        val entries = FinalAetherVpnService.logsAfter(args.afterId)
        val payload = JSONArray()
        entries.forEach { entry ->
            payload.put(JSObject().apply {
                put("id", entry.id)
                put("timestamp", entry.timestamp)
                put("line", entry.line)
            })
        }
        invoke.resolve(JSObject().apply {
            put("entries", payload)
            put("lastId", entries.lastOrNull()?.id ?: args.afterId)
        })
    }

    @Command
    fun setLogging(invoke: Invoke) {
        val args = invoke.parseArgs(FinalLoggingArgs::class.java)
        FinalAetherVpnService.setLoggingEnabled(args.enabled)
        invoke.resolve(JSObject().apply { put("enabled", FinalAetherVpnService.isLoggingEnabled()) })
    }

    @Command
    fun submitAccessCode(invoke: Invoke) {
        val args = invoke.parseArgs(FinalAccessCodeArgs::class.java)
        runCatching { FinalAetherVpnService.submitAccessCode(args.code) }
            .onSuccess { invoke.resolve(JSObject()) }
            .onFailure { invoke.reject(it.message ?: "Access code could not be submitted", "accessCodeFailed") }
    }

    @Command
    fun diagnostics(invoke: Invoke) {
        invoke.resolve(JSObject().apply {
            put("path", "")
            put("persistent", false)
        })
    }

    private fun validateProfile(profile: FinalVpnProfileArgs): String? {
        if (!AndroidTransportPolicy.isValidMtu(profile.mtu)) {
            return "MTU must be between ${AndroidTransportPolicy.MIN_MTU} and ${AndroidTransportPolicy.MAX_MTU}"
        }
        if (profile.validateSecs !in 1..120) return "Validation timeout must be between 1 and 120 seconds"
        if (profile.reconnectSecs !in 1..60) return "Reconnect delay must be between 1 and 60 seconds"
        if (profile.keepalive !in 1..120) return "WireGuard keepalive must be between 1 and 120 seconds"
        if (profile.perfProfile !in setOf("auto", "low", "medium", "high")) return "Unknown performance profile"
        if (profile.zeroTrustTeam.isBlank()) return null
        return when (profile.zeroTrustAuth.lowercase()) {
            "email" -> if (profile.accessEmail.isBlank()) "Zero Trust email is required" else null
            "service" -> if (profile.accessClientId.isBlank() || profile.accessClientSecret.isBlank()) {
                "Zero Trust service-token id and secret are required"
            } else null
            "token" -> if (profile.accessToken.isBlank()) "Zero Trust access token is required" else null
            else -> "Unknown Zero Trust authentication method"
        }
    }
}

class FinalAetherVpnService : VpnService() {
    private data class RuntimeResources(
        val process: Process? = null,
        val writer: BufferedWriter? = null,
        val descriptor: ParcelFileDescriptor? = null,
        val bridge: HevTun2Socks? = null,
    )

    private data class TunnelResources(
        val descriptor: ParcelFileDescriptor,
        val bridge: HevTun2Socks,
    )

    private data class RuntimeProfile(
        val protocol: String,
        val scanMode: String,
        val ipVersion: String,
        val connectionMode: String,
        val bindAddress: String,
        val dnsServer: String,
        val dns: String,
        val quickReconnect: Boolean,
        val masqueHttp2: Boolean,
        val masqueNoize: String,
        val wgNoize: String,
        val webrtcLeakProtection: Boolean,
        val mtu: Int,
        val peer: String,
        val wgPeer: String,
        val h2Peer: String,
        val ech: String,
        val noDataCheck: Boolean,
        val validateSecs: Int,
        val reconnectSecs: Int,
        val fragment: Boolean,
        val fragmentSize: String,
        val fragmentDelay: String,
        val keepalive: Int,
        val noProfileRetry: Boolean,
        val tlsGroups: String,
        val perfProfile: String,
        val zeroTrustTeam: String,
        val zeroTrustAuth: String,
        val accessEmail: String,
        val accessClientId: String,
        val accessClientSecret: String,
        val accessToken: String,
        val zeroTrustGateway: Boolean,
        val routeBlock: String,
        val routeDirect: String,
        val routesFile: String,
    )

    private val sessionGate = ServiceSessionGate()
    private val resourceLock = Any()
    private val startExecutor = Executors.newSingleThreadExecutor()
    private val cleanupExecutor = Executors.newSingleThreadExecutor()
    private val probeExecutor = Executors.newSingleThreadExecutor()

    @Volatile private var pendingCleanup: Future<*>? = null
    private var coreProcess: Process? = null
    private var coreWriter: BufferedWriter? = null
    private var vpnInterface: ParcelFileDescriptor? = null
    private var tun2Socks: HevTun2Socks? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        log("VPN service created")
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
        runCatching { cleanupExecutor.submit { cleanupResources(resources, "service destroy") } }
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
            runCatching { previousCleanup?.get(CLEANUP_WAIT_SECONDS, TimeUnit.SECONDS) }
                .onFailure { log("Previous cleanup wait warning: ${it.message}") }
            cleanupResources(staleResources, "replace stale session")
        }
        pendingCleanup = cleanupFuture

        AndroidVpnRuntime.resetTelemetry()
        AndroidVpnRuntime.updateSnapshot(FinalServiceSnapshot("Launching"))
        startForeground(NOTIFICATION_ID, buildNotification("Starting Aether…"))

        val profile = RuntimeProfile(
            protocol = intent.getStringExtra(EXTRA_PROTOCOL) ?: "auto",
            scanMode = intent.getStringExtra(EXTRA_SCAN_MODE) ?: "balanced",
            ipVersion = intent.getStringExtra(EXTRA_IP_VERSION) ?: "v4",
            connectionMode = intent.getStringExtra(EXTRA_CONNECTION_MODE) ?: "tunnel",
            bindAddress = sanitizeBindAddress(intent.getStringExtra(EXTRA_BIND_ADDRESS) ?: DEFAULT_SOCKS_ADDRESS),
            dnsServer = sanitizeDnsServer(intent.getStringExtra(EXTRA_DNS_SERVER) ?: DEFAULT_DNS_SERVER),
            dns = intent.getStringExtra(EXTRA_DNS).orEmpty(),
            quickReconnect = intent.getBooleanExtra(EXTRA_QUICK_RECONNECT, false),
            masqueHttp2 = intent.getBooleanExtra(EXTRA_MASQUE_HTTP2, false),
            masqueNoize = intent.getStringExtra(EXTRA_MASQUE_NOIZE) ?: "firewall",
            wgNoize = intent.getStringExtra(EXTRA_WG_NOIZE) ?: "balanced",
            webrtcLeakProtection = intent.getBooleanExtra(EXTRA_WEBRTC_LEAK_PROTECTION, false),
            mtu = AndroidTransportPolicy.sanitizeMtu(
                intent.getIntExtra(EXTRA_MTU, AndroidTransportPolicy.DEFAULT_MTU)
            ),
            peer = intent.getStringExtra(EXTRA_PEER).orEmpty(),
            wgPeer = intent.getStringExtra(EXTRA_WG_PEER).orEmpty(),
            h2Peer = intent.getStringExtra(EXTRA_H2_PEER).orEmpty(),
            ech = intent.getStringExtra(EXTRA_ECH).orEmpty(),
            noDataCheck = intent.getBooleanExtra(EXTRA_NO_DATA_CHECK, false),
            validateSecs = intent.getIntExtra(EXTRA_VALIDATE_SECS, 10).coerceIn(1, 120),
            reconnectSecs = intent.getIntExtra(EXTRA_RECONNECT_SECS, 2).coerceIn(1, 60),
            fragment = intent.getBooleanExtra(EXTRA_FRAGMENT, false),
            fragmentSize = intent.getStringExtra(EXTRA_FRAGMENT_SIZE) ?: "16-32",
            fragmentDelay = intent.getStringExtra(EXTRA_FRAGMENT_DELAY) ?: "2-10",
            keepalive = intent.getIntExtra(EXTRA_KEEPALIVE, 5).coerceIn(1, 120),
            noProfileRetry = intent.getBooleanExtra(EXTRA_NO_PROFILE_RETRY, false),
            tlsGroups = intent.getStringExtra(EXTRA_TLS_GROUPS).orEmpty(),
            perfProfile = intent.getStringExtra(EXTRA_PERF_PROFILE) ?: "auto",
            zeroTrustTeam = intent.getStringExtra(EXTRA_ZERO_TRUST_TEAM).orEmpty(),
            zeroTrustAuth = intent.getStringExtra(EXTRA_ZERO_TRUST_AUTH) ?: "email",
            accessEmail = intent.getStringExtra(EXTRA_ACCESS_EMAIL).orEmpty(),
            accessClientId = intent.getStringExtra(EXTRA_ACCESS_CLIENT_ID).orEmpty(),
            accessClientSecret = intent.getStringExtra(EXTRA_ACCESS_CLIENT_SECRET).orEmpty(),
            accessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN).orEmpty(),
            zeroTrustGateway = intent.getBooleanExtra(EXTRA_ZERO_TRUST_GATEWAY, false),
            routeBlock = intent.getStringExtra(EXTRA_ROUTE_BLOCK).orEmpty(),
            routeDirect = intent.getStringExtra(EXTRA_ROUTE_DIRECT).orEmpty(),
            routesFile = intent.getStringExtra(EXTRA_ROUTES_FILE).orEmpty(),
        )

        startExecutor.execute {
            runCatching { cleanupFuture.get(CLEANUP_WAIT_SECONDS, TimeUnit.SECONDS) }
                .onFailure { log("Cleanup barrier warning: ${it.message}") }
            runSession(token, profile)
        }
    }

    private fun runSession(token: Long, profile: RuntimeProfile) {
        var process: Process? = null
        var writer: BufferedWriter? = null
        var processAttached = false
        var tunnel: TunnelResources? = null
        var tunnelAttached = false

        try {
            ensureActive(token)
            val executable = File(applicationInfo.nativeLibraryDir, "libaether_exec.so")
            if (!executable.isFile) error("Bundled ARM64 Aether core was not found")

            val command = buildCoreCommand(executable, profile)
            val processBuilder = ProcessBuilder(command)
                .directory(filesDir)
                .redirectErrorStream(true)
            configureEnvironment(processBuilder, profile)

            log("Starting Aether ${profile.protocol}/${profile.scanMode}")
            process = processBuilder.start()
            writer = process.outputStream.bufferedWriter(Charsets.UTF_8)
            if (!attachProcess(token, process, writer)) {
                cleanupResources(RuntimeResources(process = process, writer = writer), "cancel before core attach")
                process = null
                writer = null
                throw CancellationException("Connection cancelled before core attachment")
            }
            processAttached = true
            AndroidVpnRuntime.attachProcessInput(writer)
            startCoreLogReader(process)
            updateSnapshotIfActive(
                token,
                FinalServiceSnapshot("Connecting", socksAddr = profile.bindAddress),
            )
            updateNotification("Finding a working route…")

            val startupTimeoutMs = AndroidTransportPolicy.startupTimeoutMs(profile.protocol, profile.scanMode)
            log("Waiting up to ${startupTimeoutMs / 1000}s for SOCKS readiness")
            if (!waitForSocks(token, profile.bindAddress, process, startupTimeoutMs)) {
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
            updateSnapshotIfActive(token, FinalServiceSnapshot("Verifying", socksAddr = profile.bindAddress))
            updateNotification("Verifying tunnel egress…")
            val initialProbe = AndroidEgressProbe.probe(profile.bindAddress)
            ensureActive(token)
            AndroidVpnRuntime.publishProbe(initialProbe.publicIp, initialProbe.countryCode, initialProbe.latencyMs)
            val connectedAt = System.currentTimeMillis()

            if (profile.connectionMode == "proxy") {
                updateSnapshotIfActive(
                    token,
                    FinalServiceSnapshot("Connected", socksAddr = profile.bindAddress, connectedAtMs = connectedAt)
                )
                updateNotification("Connected · SOCKS ${profile.bindAddress}")
            } else {
                updateSnapshotIfActive(token, FinalServiceSnapshot("StartingTunnel", socksAddr = profile.bindAddress))
                tunnel = createSystemTunnel(profile)
                if (!attachTunnel(token, tunnel)) {
                    cleanupResources(
                        RuntimeResources(descriptor = tunnel.descriptor, bridge = tunnel.bridge),
                        "cancel before TUN attach"
                    )
                    tunnel = null
                    throw CancellationException("Connection cancelled before TUN attachment")
                }
                tunnelAttached = true
                updateSnapshotIfActive(
                    token,
                    FinalServiceSnapshot(
                        state = "Tunneling",
                        socksAddr = profile.bindAddress,
                        tunAddr = TUN_IPV4_ADDRESS,
                        connectedAtMs = connectedAt,
                    )
                )
                updateNotification("Protected · device tunnel active")
            }

            startEgressProbeLoop(token, profile.bindAddress)
            val exitCode = process.waitFor()
            if (sessionGate.isActive(token)) error("Aether core exited unexpectedly with code $exitCode")
        } catch (_: CancellationException) {
            log("Connection session cancelled")
        } catch (error: Throwable) {
            log("ERROR: ${error.message ?: error}")
            if (sessionGate.isActive(token)) {
                AndroidVpnRuntime.updateSnapshot(FinalServiceSnapshot("Error", error.message ?: error.toString()))
                updateNotification("Connection failed")
            }
        } finally {
            val owned = takeOwnedResources(process, writer, tunnel)
            val finalResources = RuntimeResources(
                process = owned.process ?: if (!processAttached) process else null,
                writer = owned.writer ?: if (!processAttached) writer else null,
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

    private fun buildCoreCommand(executable: File, profile: RuntimeProfile): List<String> {
        val command = mutableListOf(executable.absolutePath)
        when (profile.protocol) {
            "masque" -> command += "--masque"
            "wireguard" -> command += "--wg"
            "gool" -> command += "--gool"
        }
        command += when (profile.scanMode) {
            "turbo" -> "--turbo"
            "thorough" -> "--thorough"
            "stealth" -> "--stealth"
            "ironclad" -> "--ironclad"
            else -> "--balanced"
        }
        command += when (profile.ipVersion) {
            "v6" -> "-6"
            "both" -> "--dual"
            else -> "-4"
        }
        command += if (profile.quickReconnect) "--quick-reconnect" else "--no-quick-reconnect"
        command += listOf(
            "--noize",
            if (profile.protocol == "wireguard" || profile.protocol == "gool") profile.wgNoize else profile.masqueNoize,
            "--bind", profile.bindAddress,
            "--validate-secs", profile.validateSecs.toString(),
            "--reconnect-secs", profile.reconnectSecs.toString(),
            "--config", File(filesDir, "aether.toml").absolutePath,
            "--wg-config", File(filesDir, "aether-wg.toml").absolutePath,
            "--masque-config", File(filesDir, "aether-masque.toml").absolutePath,
        )
        addOption(command, "--peer", profile.peer)
        addOption(command, "--wg-peer", profile.wgPeer)
        if (profile.masqueHttp2) command += "--h2"
        addOption(command, "--h2-peer", profile.h2Peer)
        addOption(command, "--ech", profile.ech)
        if (profile.noDataCheck) command += "--no-data-check"
        addOption(command, "--dns", profile.dns)
        if (profile.fragment) {
            command += "--fragment"
            addOption(command, "--fragment-size", profile.fragmentSize)
            addOption(command, "--fragment-delay", profile.fragmentDelay)
        }
        command += listOf("--keepalive", profile.keepalive.toString())
        if (profile.noProfileRetry) command += "--no-profile-retry"
        if (profile.zeroTrustTeam.isNotBlank()) {
            command += listOf("--team", profile.zeroTrustTeam.trim())
            if (profile.zeroTrustGateway) command += "--gateway"
        }
        addOption(command, "--route-block", profile.routeBlock)
        addOption(command, "--route-direct", profile.routeDirect)
        addOption(command, "--routes", profile.routesFile)
        addOption(command, "--tls-groups", profile.tlsGroups)
        if (profile.perfProfile != "auto") command += listOf("--perf", profile.perfProfile)
        command += listOf("--log-level", if (AndroidVpnRuntime.isLoggingEnabled()) "info" else "warn")
        return command
    }

    private fun addOption(command: MutableList<String>, flag: String, value: String) {
        if (value.trim().isNotEmpty()) command += listOf(flag, value.trim())
    }

    private fun configureEnvironment(builder: ProcessBuilder, profile: RuntimeProfile) {
        builder.environment().apply {
            put("RUST_BACKTRACE", "0")
            when (profile.zeroTrustAuth.lowercase()) {
                "email" -> if (profile.accessEmail.isNotBlank()) put("AETHER_ACCESS_EMAIL", profile.accessEmail.trim())
                "service" -> {
                    if (profile.accessClientId.isNotBlank()) put("AETHER_ACCESS_CLIENT_ID", profile.accessClientId.trim())
                    if (profile.accessClientSecret.isNotBlank()) put("AETHER_ACCESS_CLIENT_SECRET", profile.accessClientSecret.trim())
                }
                "token" -> if (profile.accessToken.isNotBlank()) put("AETHER_ACCESS_TOKEN", profile.accessToken.trim())
            }
        }
    }

    private fun createSystemTunnel(profile: RuntimeProfile): TunnelResources {
        if (VpnService.prepare(this) != null) error("Android VPN permission was revoked")
        val (socksHost, socksPort) = splitHostPort(profile.bindAddress)
        val builder = Builder()
            .setSession("Aether")
            .setMtu(profile.mtu)
            .addAddress(TUN_IPV4_ADDRESS, 32)
            .addAddress(TUN_IPV6_ADDRESS, 128)
            .addRoute("0.0.0.0", 0)
            .addRoute("::", 0)
            .addDnsServer(profile.dnsServer)
            .setBlocking(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)
        builder.addDisallowedApplication(packageName)
        val descriptor = builder.establish() ?: error("Android refused to establish the VPN interface")
        try {
            val configFile = writeTun2SocksConfig(
                socksHost = socksHost,
                socksPort = socksPort,
                mtu = profile.mtu,
                webrtcLeakProtection = profile.webrtcLeakProtection,
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
        mtu: Int,
        webrtcLeakProtection: Boolean,
    ): File {
        val config = File(cacheDir, "hev-socks5-tunnel.yml")
        val udpRelayMode = if (webrtcLeakProtection) "tcp" else "udp"
        config.writeText(
            """
            tunnel:
              name: tun0
              mtu: $mtu
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
              log-level: warn
              limit-nofile: 8192
            """.trimIndent() + "\n"
        )
        return config
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
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        pendingCleanup = future
    }

    private fun attachProcess(token: Long, process: Process, writer: BufferedWriter): Boolean =
        synchronized(resourceLock) {
            if (!sessionGate.isActive(token)) false
            else {
                coreProcess = process
                coreWriter = writer
                true
            }
        }

    private fun attachTunnel(token: Long, tunnel: TunnelResources): Boolean =
        synchronized(resourceLock) {
            if (!sessionGate.isActive(token)) false
            else {
                vpnInterface = tunnel.descriptor
                tun2Socks = tunnel.bridge
                AndroidVpnRuntime.setActiveTunBridge(tunnel.bridge)
                true
            }
        }

    private fun detachAllResources(): RuntimeResources = synchronized(resourceLock) {
        val resources = RuntimeResources(coreProcess, coreWriter, vpnInterface, tun2Socks)
        coreProcess = null
        coreWriter = null
        vpnInterface = null
        tun2Socks = null
        AndroidVpnRuntime.clearProcessInput()
        AndroidVpnRuntime.clearActiveTunBridge()
        resources
    }

    private fun takeOwnedResources(
        process: Process?,
        writer: BufferedWriter?,
        tunnel: TunnelResources?,
    ): RuntimeResources = synchronized(resourceLock) {
        val ownedProcess = if (process != null && coreProcess === process) {
            coreProcess = null
            process
        } else null
        val ownedWriter = if (writer != null && coreWriter === writer) {
            coreWriter = null
            writer
        } else null
        val ownedDescriptor = if (tunnel != null && vpnInterface === tunnel.descriptor) {
            vpnInterface = null
            tunnel.descriptor
        } else null
        val ownedBridge = if (tunnel != null && tun2Socks === tunnel.bridge) {
            tun2Socks = null
            AndroidVpnRuntime.clearActiveTunBridge(tunnel.bridge)
            tunnel.bridge
        } else null
        ownedWriter?.let(AndroidVpnRuntime::clearProcessInput)
        RuntimeResources(ownedProcess, ownedWriter, ownedDescriptor, ownedBridge)
    }

    private fun cleanupResources(resources: RuntimeResources, reason: String) {
        resources.bridge?.let { bridge ->
            runCatching { bridge.TProxyStopService() }
                .onFailure { log("tun2socks stop warning: ${it.message}") }
        }
        resources.descriptor?.let { descriptor -> runCatching { descriptor.close() } }
        resources.writer?.let { writer -> runCatching { writer.close() } }
        resources.process?.let { process ->
            runCatching {
                if (process.isAlive) process.destroy()
                if (!process.waitFor(PROCESS_STOP_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                    process.destroyForcibly()
                    process.waitFor(PROCESS_FORCE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                }
            }.onFailure { runCatching { process.destroyForcibly() } }
        }
        if (resources.process != null || resources.descriptor != null || resources.bridge != null) {
            log("Native resources released: $reason")
        }
    }

    private fun ensureActive(token: Long) {
        if (!sessionGate.isActive(token)) throw CancellationException("VPN session is no longer active")
    }

    private fun startCoreLogReader(process: Process) {
        Thread {
            runCatching {
                process.inputStream.reader(Charsets.UTF_8).use { reader ->
                    val buffer = CharArray(2048)
                    while (true) {
                        val read = reader.read(buffer)
                        if (read < 0) break
                        AndroidVpnRuntime.appendCoreChunk(String(buffer, 0, read))
                    }
                }
            }.onFailure { log("Core log reader warning: ${it.message}") }
        }.apply {
            name = "aether-mobile-log"
            isDaemon = true
            start()
        }
    }

    private fun waitForSocks(
        token: Long,
        bindAddress: String,
        process: Process,
        timeoutMs: Long,
    ): Boolean {
        val (host, port) = splitHostPort(bindAddress)
        var deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline && process.isAlive && sessionGate.isActive(token)) {
            if (AndroidVpnRuntime.snapshot().state == "AwaitingAccessCode") {
                Thread.sleep(SOCKS_POLL_INTERVAL_MS)
                deadline += SOCKS_POLL_INTERVAL_MS
                continue
            }
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
                if (sessionGate.isActive(token) && result.isSuccess) {
                    val probe = result.getOrThrow()
                    AndroidVpnRuntime.publishProbe(probe.publicIp, probe.countryCode, probe.latencyMs)
                }
                var remaining = EGRESS_PROBE_INTERVAL_MS
                while (remaining > 0 && sessionGate.isActive(token)) {
                    val sleep = minOf(remaining, 1_000L)
                    try {
                        Thread.sleep(sleep)
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        return@execute
                    }
                    remaining -= sleep
                }
            }
        }
    }

    private fun splitHostPort(value: String): Pair<String, Int> {
        val separator = value.lastIndexOf(':')
        if (separator <= 0) return "127.0.0.1" to 1819
        val host = value.substring(0, separator).removePrefix("[").removeSuffix("]")
        val port = value.substring(separator + 1).toIntOrNull()?.coerceIn(1, 65535) ?: 1819
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

    private fun sanitizeDnsServer(value: String): String = runCatching {
        val parsed = InetAddress.getByName(value.trim())
        if (parsed.isAnyLocalAddress || parsed.isMulticastAddress) DEFAULT_DNS_SERVER
        else parsed.hostAddress ?: DEFAULT_DNS_SERVER
    }.getOrDefault(DEFAULT_DNS_SERVER)

    private fun yamlQuote(value: String): String = value.replace("'", "''")

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Aether connection", NotificationManager.IMPORTANCE_LOW)
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
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun updateSnapshotIfActive(token: Long, snapshot: FinalServiceSnapshot) {
        if (sessionGate.isActive(token)) AndroidVpnRuntime.updateSnapshot(snapshot)
    }

    private fun log(line: String) = AndroidVpnRuntime.appendServiceLine(line)

    companion object {
        const val ACTION_START = "com.cluvexstudio.aethergui.vpn.FINAL_START"
        const val ACTION_STOP = "com.cluvexstudio.aethergui.vpn.FINAL_STOP"
        const val EXTRA_PROTOCOL = "protocol"
        const val EXTRA_SCAN_MODE = "scanMode"
        const val EXTRA_IP_VERSION = "ipVersion"
        const val EXTRA_CONNECTION_MODE = "connectionMode"
        const val EXTRA_BIND_ADDRESS = "bindAddress"
        const val EXTRA_DNS_SERVER = "dnsServer"
        const val EXTRA_DNS = "dns"
        const val EXTRA_QUICK_RECONNECT = "quickReconnect"
        const val EXTRA_MASQUE_HTTP2 = "masqueHttp2"
        const val EXTRA_MASQUE_NOIZE = "masqueNoize"
        const val EXTRA_WG_NOIZE = "wgNoize"
        const val EXTRA_WEBRTC_LEAK_PROTECTION = "webrtcLeakProtection"
        const val EXTRA_MTU = "mtu"
        const val EXTRA_PEER = "peer"
        const val EXTRA_WG_PEER = "wgPeer"
        const val EXTRA_H2_PEER = "h2Peer"
        const val EXTRA_ECH = "ech"
        const val EXTRA_NO_DATA_CHECK = "noDataCheck"
        const val EXTRA_VALIDATE_SECS = "validateSecs"
        const val EXTRA_RECONNECT_SECS = "reconnectSecs"
        const val EXTRA_FRAGMENT = "fragment"
        const val EXTRA_FRAGMENT_SIZE = "fragmentSize"
        const val EXTRA_FRAGMENT_DELAY = "fragmentDelay"
        const val EXTRA_KEEPALIVE = "keepalive"
        const val EXTRA_NO_PROFILE_RETRY = "noProfileRetry"
        const val EXTRA_TLS_GROUPS = "tlsGroups"
        const val EXTRA_PERF_PROFILE = "perfProfile"
        const val EXTRA_ZERO_TRUST_TEAM = "zeroTrustTeam"
        const val EXTRA_ZERO_TRUST_AUTH = "zeroTrustAuth"
        const val EXTRA_ACCESS_EMAIL = "accessEmail"
        const val EXTRA_ACCESS_CLIENT_ID = "accessClientId"
        const val EXTRA_ACCESS_CLIENT_SECRET = "accessClientSecret"
        const val EXTRA_ACCESS_TOKEN = "accessToken"
        const val EXTRA_ZERO_TRUST_GATEWAY = "zeroTrustGateway"
        const val EXTRA_ROUTE_BLOCK = "routeBlock"
        const val EXTRA_ROUTE_DIRECT = "routeDirect"
        const val EXTRA_ROUTES_FILE = "routesFile"

        private const val CHANNEL_ID = "aether_connection"
        private const val NOTIFICATION_ID = 1819
        private const val TUN_IPV4_ADDRESS = "198.18.0.1"
        private const val TUN_IPV6_ADDRESS = "fc00::1"
        private const val DEFAULT_SOCKS_ADDRESS = "127.0.0.1:1819"
        private const val DEFAULT_DNS_SERVER = "1.1.1.1"
        private const val CLEANUP_WAIT_SECONDS = 4L
        private const val PROCESS_STOP_TIMEOUT_SECONDS = 2L
        private const val PROCESS_FORCE_TIMEOUT_SECONDS = 1L
        private const val SOCKS_POLL_CONNECT_TIMEOUT_MS = 300
        private const val SOCKS_POLL_INTERVAL_MS = 200L
        private const val EGRESS_PROBE_INTERVAL_MS = 120_000L

        fun markStartRequested() = AndroidVpnRuntime.updateSnapshot(FinalServiceSnapshot("Launching"))
        fun markStopRequested() = AndroidVpnRuntime.updateSnapshot(FinalServiceSnapshot("Disconnecting"))
        fun markStartFailed(error: Throwable) = AndroidVpnRuntime.updateSnapshot(
            FinalServiceSnapshot("Error", error.message ?: error.toString())
        )
        fun snapshot(): FinalServiceSnapshot = AndroidVpnRuntime.snapshot()
        fun trafficSnapshot(): FinalNativeTraffic = AndroidVpnRuntime.trafficSnapshot()
        fun telemetrySnapshot(): FinalRuntimeTelemetry = AndroidVpnRuntime.telemetrySnapshot()
        fun logsAfter(afterId: Long): List<FinalNativeLogEntry> = AndroidVpnRuntime.logsAfter(afterId)
        fun setLoggingEnabled(enabled: Boolean) = AndroidVpnRuntime.setLoggingEnabled(enabled)
        fun isLoggingEnabled(): Boolean = AndroidVpnRuntime.isLoggingEnabled()
        fun submitAccessCode(code: String) = AndroidVpnRuntime.submitAccessCode(code)
    }
}
