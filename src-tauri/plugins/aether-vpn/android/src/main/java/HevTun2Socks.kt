package com.cluvexstudio.aethergui.vpn

/** JNI entry points owned by Aether-GUI. */
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
 * Idempotent lifecycle facade around hev's process-global native tunnel.
 *
 * Ownership is released only after nativeStop has joined the pthread. The old
 * code cleared ownsSession before nativeStop and, on a timeout, permanently left
 * a running thread with no owner; Java then closed the TUN descriptor underneath
 * it and Disconnect could abort the entire app.
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

    /** Requests quit once and waits off the main thread until pthread_join ends. */
    fun TProxyStopService(): Boolean = synchronized(nativeLock) {
        if (!ownsSession) return@synchronized !nativeRunning
        if (!nativeRunning || !AetherTunBridge.available) {
            ownsSession = false
            nativeRunning = false
            return@synchronized true
        }

        val stopped = runCatching { AetherTunBridge.nativeStop() }.getOrDefault(false)
        if (stopped) {
            ownsSession = false
            nativeRunning = false
        }
        stopped
    }

    fun TProxyGetStats(): LongArray = synchronized(nativeLock) {
        if (!nativeRunning || !AetherTunBridge.available) {
            return@synchronized LongArray(0)
        }

        val stats = runCatching { AetherTunBridge.nativeStats() }.getOrNull()
        if (stats == null) {
            // A naturally exited native loop still has a joinable pthread. Keep
            // ownership so cleanup can reap it instead of orphaning the session.
            LongArray(0)
        } else {
            stats
        }
    }

    private companion object {
        private val nativeLock = Any()

        @Volatile
        private var nativeRunning = false
    }
}
