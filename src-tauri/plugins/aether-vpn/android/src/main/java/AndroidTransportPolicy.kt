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

    /**
     * Native SOCKS-readiness watchdog matched to the GUI Automatic watchdog.
     *
     * Turbo is deliberately fail-fast: a carrier that cannot produce a real
     * SOCKS endpoint inside the bounded window should yield to the next carrier
     * rather than monopolize the recovery ladder. Deeper modes preserve the
     * larger windows needed for broad, quiet, or data-plane-heavy scans.
     */
    fun startupTimeoutMs(protocol: String, scanMode: String): Long {
        val family = protocol.lowercase()
        return when (scanMode.lowercase()) {
            "turbo" -> when (family) {
                "gool" -> 90_000L
                "wireguard" -> 70_000L
                else -> 60_000L
            }
            "balanced" -> when (family) {
                "gool" -> 165_000L
                "wireguard" -> 135_000L
                else -> 120_000L
            }
            "thorough" -> when (family) {
                "gool" -> 360_000L
                "wireguard" -> 330_000L
                else -> 300_000L
            }
            "stealth" -> when (family) {
                "gool" -> 270_000L
                "wireguard" -> 240_000L
                else -> 210_000L
            }
            "ironclad" -> when (family) {
                "gool" -> 300_000L
                "wireguard" -> 270_000L
                else -> 240_000L
            }
            else -> when (family) {
                "gool" -> 165_000L
                "wireguard" -> 135_000L
                else -> 120_000L
            }
        }
    }
}
