package com.cluvexstudio.aethergui.vpn

import java.util.concurrent.atomic.AtomicLong

/**
 * Generates monotonic session tokens so an older Android VPN startup can never
 * publish state or create native resources after the user has cancelled it.
 */
internal class ServiceSessionGate {
    private val generation = AtomicLong(0L)

    @Volatile
    private var cancelled = true

    @Synchronized
    fun begin(): Long {
        cancelled = false
        return generation.incrementAndGet()
    }

    @Synchronized
    fun cancel(): Long {
        cancelled = true
        return generation.incrementAndGet()
    }

    fun isActive(token: Long): Boolean = !cancelled && generation.get() == token

    fun isCancelled(): Boolean = cancelled
}
