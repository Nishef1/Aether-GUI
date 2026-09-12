package com.cluvexstudio.aethergui.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Keeps the native VPN dataplane schedulable while the display is off.
 *
 * Aether deliberately avoids a permanent wake lock while the phone is in use.
 * The partial lock is acquired only after Android reports the display as
 * non-interactive and only while the VPN lifecycle is active. This preserves
 * H2/H3/WireGuard keepalives, tun2socks forwarding and push-notification
 * traffic without paying the wake-lock cost while the screen is on.
 *
 * This is process-local by design. The foreground VpnService remains the owner
 * of the connection and notification; this helper only prevents CPU suspend
 * from freezing that already-active native dataplane.
 */
internal object AndroidScreenOffKeepAlive {
    private const val STATE_RECHECK_MS = 15_000L

    private val lock = Any()
    private val monitorRunning = AtomicBoolean(false)

    @Volatile
    private var initialized = false

    private lateinit var appContext: Context
    private lateinit var powerManager: PowerManager
    private var wakeLock: PowerManager.WakeLock? = null

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            // The actual PowerManager state remains the source of truth. The
            // broadcast only asks us to re-evaluate immediately.
            refresh()
        }
    }

    fun initialize(context: Context) {
        synchronized(lock) {
            if (initialized) return

            appContext = context.applicationContext
            powerManager = appContext.getSystemService(PowerManager::class.java)
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "${appContext.packageName}:aether-vpn-screen-off",
            ).apply {
                setReferenceCounted(false)
            }

            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
            }
            ContextCompat.registerReceiver(
                appContext,
                screenReceiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            initialized = true
        }

        refresh()
    }

    private fun vpnLifecycleNeedsCpu(): Boolean = when (AndroidVpnRuntime.snapshot().state) {
        "Launching",
        "Connecting",
        "AwaitingAccessCode",
        "Verifying",
        "StartingTunnel",
        "Tunneling",
        "Connected",
        "Reconnecting" -> true
        else -> false
    }

    /**
     * While the display is off, keep a tiny process-local state watcher alive
     * even before the wake lock is needed. This closes the startup race where
     * the process can be created while the screen is already off and the VPN
     * transitions to an active state after ContentProvider initialization.
     *
     * The watcher exits as soon as the display becomes interactive, so normal
     * foreground use does not pay a periodic polling cost.
     */
    private fun ensureScreenOffMonitor() {
        if (!monitorRunning.compareAndSet(false, true)) return

        Thread {
            try {
                while (!powerManager.isInteractive) {
                    try {
                        Thread.sleep(STATE_RECHECK_MS)
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        break
                    }
                    refresh()
                }
            } finally {
                monitorRunning.set(false)
                // Cover a screen-off transition that raced with monitor exit.
                if (initialized && !powerManager.isInteractive) refresh()
            }
        }.apply {
            name = "aether-screen-off-keepalive"
            isDaemon = true
            start()
        }
    }

    private fun releaseLocked(current: PowerManager.WakeLock) {
        if (current.isHeld) runCatching { current.release() }
    }

    private fun refresh() {
        if (!initialized) return
        synchronized(lock) {
            val screenOff = !powerManager.isInteractive
            if (screenOff) ensureScreenOffMonitor()

            val shouldHold = screenOff && vpnLifecycleNeedsCpu()
            val current = wakeLock ?: return@synchronized

            if (shouldHold && !current.isHeld) {
                runCatching { current.acquire() }
                    .onSuccess {
                        AndroidVpnRuntime.appendServiceLine(
                            "Screen off while VPN is active; keeping native dataplane awake",
                        )
                    }
                    .onFailure { error ->
                        AndroidVpnRuntime.recordFailure(
                            "screen-off-wakelock",
                            error.message ?: error.toString(),
                        )
                    }
            } else if (!shouldHold && current.isHeld) {
                releaseLocked(current)
            }
        }
    }
}
