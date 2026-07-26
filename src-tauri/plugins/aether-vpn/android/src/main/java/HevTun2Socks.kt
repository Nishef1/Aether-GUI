package com.cluvexstudio.aethergui.vpn

/**
 * JNI entry points owned by Aether-GUI.
 *
 * libaethertun links against hev-socks5-tunnel's stable public C API. It also
 * creates the native pthread that runs hev's blocking event loop, so the loop
 * never performs stack switching on an ART-managed Java thread.
 */
internal object AetherTunBridge {
    @Volatile
    var loadFailure: Throwable? = null
        private set

    val available: Boolean
        get() = loadFailure == null

    init {
        loadFailure = runCatching { System.loadLibrary("aethertun") }.exceptionOrNull()
    }

    external fun nativeStart(configPath: String, tunFd: Int): Boolean
    external fun nativeStop(): Boolean
    external fun nativeStats(): LongArray?
}

/**
 * Idempotent lifecycle facade around the process-global native tunnel.
 *
 * The upstream native core is process-global, even if Kotlin creates multiple
 * wrapper instances. All calls are therefore serialized through one lock and a
 * session can be stopped only by the instance that successfully started it.
 */
class HevTun2Socks {
    @Volatile
    private var ownsSession = false

    fun TProxyStartService(configPath: String, tunFd: Int) {
        synchronized(nativeLock) {
            val loadError = AetherTunBridge.loadFailure
            if (loadError != null) {
                throw IllegalStateException(
                    "Aether TUN bridge could not be loaded: ${loadError.message ?: loadError}",
                    loadError,
                )
            }
            if (nativeRunning) {
                if (ownsSession) return
                error("A previous native tunnel is still running")
            }
            if (!AetherTunBridge.nativeStart(configPath, tunFd)) {
                error("hev-socks5-tunnel refused to start")
            }
            nativeRunning = true
            ownsSession = true
        }
    }

    /**
     * Requests quit and waits in the native bridge until the tunnel pthread has
     * actually exited. Safe to call repeatedly from stop/finally/onDestroy.
     */
    fun TProxyStopService(): Boolean = synchronized(nativeLock) {
        if (!ownsSession) return@synchronized !nativeRunning
        ownsSession = false
        if (!nativeRunning || !AetherTunBridge.available) {
            nativeRunning = false
            return@synchronized true
        }

        val stopped = runCatching { AetherTunBridge.nativeStop() }.getOrDefault(false)
        if (stopped) nativeRunning = false
        stopped
    }

    fun TProxyGetStats(): LongArray = synchronized(nativeLock) {
        if (!nativeRunning || !AetherTunBridge.available) {
            LongArray(0)
        } else {
            runCatching { AetherTunBridge.nativeStats() }
                .getOrNull()
                ?: LongArray(0)
        }
    }

    private companion object {
        private val nativeLock = Any()

        @Volatile
        private var nativeRunning = false
    }
}
