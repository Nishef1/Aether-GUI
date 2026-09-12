package com.cluvexstudio.aethergui.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import androidx.core.content.ContextCompat

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
    private val lock = Any()

    @Volatile
    private var initialized = false

    private lateinit var appContext: Context
    private lateinit var powerManager: PowerManager
    private var wakeLock: PowerManager.WakeLock? = null

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            // Do not trust a broadcast alone: exported/system delivery details
            // vary across Android releases. The real interactive state is the
            // source of truth, so spoofed broadcasts cannot hold the CPU awake.
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
                ContextCompat.RECEIVER_EXPORTED,
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

    private fun refresh() {
        if (!initialized) return
        synchronized(lock) {
            val shouldHold = !powerManager.isInteractive && vpnLifecycleNeedsCpu()
            val current = wakeLock ?: return

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
                runCatching { current.release() }
            }
        }
    }
}
