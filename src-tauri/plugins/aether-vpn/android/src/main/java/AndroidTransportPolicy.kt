package com.cluvexstudio.aethergui.vpn

/**
 * Mobile-only resource and timeout policy. It deliberately does not add
 * protocol flags that are absent from the official Aether 1.5 CLI.
 */
internal object AndroidTransportPolicy {
    const val TUN_MTU = 1280

    fun isMasque(protocol: String): Boolean =
        protocol.equals("masque", ignoreCase = true) ||
            protocol.equals("auto", ignoreCase = true)

    fun isWireGuardFamily(protocol: String): Boolean =
        protocol.equals("wireguard", ignoreCase = true) ||
            protocol.equals("gool", ignoreCase = true)

    fun effectiveWireGuardNoize(requested: String): String =
        when (requested.trim().lowercase()) {
            "off", "none" -> "off"
            "light" -> "light"
            "aggressive", "heavy" -> "aggressive"
            else -> "balanced"
        }

    fun startupTimeoutMs(protocol: String, scanMode: String): Long = when {
        protocol.equals("gool", ignoreCase = true) -> 180_000L
        protocol.equals("wireguard", ignoreCase = true) -> 150_000L
        else -> when (scanMode.lowercase()) {
            "turbo" -> 75_000L
            "stealth" -> 210_000L
            "thorough" -> 330_000L
            "ironclad" -> 210_000L
            else -> 150_000L
        }
    }

    @Suppress("UNUSED_PARAMETER")
    fun useMasqueHttp2(forceHttp2: Boolean, udpAvailable: Boolean): Boolean = forceHttp2

    /** Official Aether 1.5 receives every supported flag in buildCoreCommand. */
    @Suppress("UNUSED_PARAMETER")
    fun appendCoreArgs(
        command: MutableList<String>,
        protocol: String,
        useMasqueHttp2: Boolean,
    ) = Unit
}
