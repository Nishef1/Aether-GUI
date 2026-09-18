package com.cluvexstudio.aethergui.vpn

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

internal data class AndroidIpFamilyPolicy(
    val ipv4: Boolean,
    val ipv6: Boolean,
) {
    fun allows(address: InetAddress): Boolean = when (address) {
        is Inet4Address -> ipv4
        is Inet6Address -> ipv6
        else -> false
    }
}

/** Mobile-only limits shared by the permission bridge and VpnService. */
internal object AndroidTransportPolicy {
    const val DEFAULT_MTU = 1280
    const val MIN_MTU = 1280
    const val MAX_MTU = 1500

    fun isValidMtu(value: Int): Boolean = value in MIN_MTU..MAX_MTU

    fun sanitizeMtu(value: Int): Int = value.coerceIn(MIN_MTU, MAX_MTU)

    fun isValidIpVersion(value: String): Boolean =
        value.lowercase() in setOf("v4", "v6", "both")

    fun ipFamilyPolicy(value: String): AndroidIpFamilyPolicy = when (value.lowercase()) {
        "v4" -> AndroidIpFamilyPolicy(ipv4 = true, ipv6 = false)
        "v6" -> AndroidIpFamilyPolicy(ipv4 = false, ipv6 = true)
        "both" -> AndroidIpFamilyPolicy(ipv4 = true, ipv6 = true)
        else -> error("Unknown Android IP family: $value")
    }

    private const val ESTABLISHMENT_MARGIN_MS = 15_000L

    /**
     * Mirror the packaged core's scan ceilings, then add one Android service /
     * process-establishment margin. The core remains the route-selection
     * authority; this watchdog only catches a stuck child/service boundary.
     *
     * WARP-in-WARP uses the WireGuard prober to request distinct hops in one
     * bounded scan, so it does not get an invented second scan budget here.
     */
    private fun coreScanBudgetMs(protocol: String, scanMode: String): Long {
        val wireGuardFamily = when (protocol.lowercase()) {
            "wireguard", "gool" -> true
            else -> false
        }
        return if (wireGuardFamily) {
            when (scanMode.lowercase()) {
                "turbo" -> 30_000L
                "balanced" -> 80_000L
                "thorough" -> 250_000L
                "stealth" -> 150_000L
                "ironclad" -> 180_000L
                else -> 80_000L
            }
        } else {
            when (scanMode.lowercase()) {
                "turbo" -> 45_000L
                "balanced" -> 120_000L
                "thorough" -> 300_000L
                "stealth" -> 180_000L
                "ironclad" -> 180_000L
                else -> 120_000L
            }
        }
    }

    fun startupTimeoutMs(protocol: String, scanMode: String): Long =
        coreScanBudgetMs(protocol, scanMode) + ESTABLISHMENT_MARGIN_MS
}
