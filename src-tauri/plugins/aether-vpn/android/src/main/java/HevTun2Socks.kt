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
    external fun nativeIsRunning(): Boolean
    external fun nativeStats(): LongArray?
}

/**
 * Idempotent lifecycle facade around hev's process-global native tunnel.
 *
 * Ownership is released only after nativeStop has joined the pthread. A short
 * startup stability check prevents a native loop that exits immediately from
 * being advertised as Tunneling. A lightweight watcher reports later native
 * death so the Android runtime never keeps showing a healthy device tunnel.
 */
class HevTun2Socks(
    private val onUnexpectedStop: ((String) -> Unit)? = null,
) {
    @Volatile
    private var ownsSession = false

    @Volatile
    private var stopRequested = false

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
            stopRequested = false
            if (!AetherTunBridge.nativeStart(configPath, tunFd)) {
                error("hev-socks5-tunnel refused to start")
            }
            nativeRunning = true
            ownsSession = true
        }

        // nativeStart means the pthread was created, not that hev survived its
        // own initialization. Give immediate init failures a chance to surface.
        Thread.sleep(150)
        if (!isRunning()) {
            TProxyStopService()
            error("hev-socks5-tunnel exited during startup")
        }
        startHealthWatcher()
    }

    fun isRunning(): Boolean = synchronized(nativeLock) {
        ownsSession &&
            nativeRunning &&
            AetherTunBridge.available &&
            runCatching { AetherTunBridge.nativeIsRunning() }.getOrDefault(false)
    }

    /** Requests quit once and waits off the main thread until pthread_join ends. */
    fun TProxyStopService(): Boolean = synchronized(nativeLock) {
        if (!ownsSession) return@synchronized !nativeRunning
        stopRequested = true
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
        if (!ownsSession || !nativeRunning || !AetherTunBridge.available) {
            return@synchronized LongArray(0)
        }
        if (!runCatching { AetherTunBridge.nativeIsRunning() }.getOrDefault(false)) {
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

    private fun startHealthWatcher() {
        Thread {
            while (true) {
                try {
                    Thread.sleep(1_000)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return@Thread
                }

                val shouldWatch = synchronized(nativeLock) { ownsSession && !stopRequested }
                if (!shouldWatch) return@Thread
                if (isRunning()) continue

                val shouldReport = synchronized(nativeLock) { ownsSession && !stopRequested }
                if (shouldReport) {
                    onUnexpectedStop?.invoke("Android device tunnel stopped unexpectedly")
                }
                return@Thread
            }
        }.apply {
            name = "aether-hev-health"
            isDaemon = true
            start()
        }
    }

    private companion object {
        private val nativeLock = Any()

        @Volatile
        private var nativeRunning = false
    }
}
