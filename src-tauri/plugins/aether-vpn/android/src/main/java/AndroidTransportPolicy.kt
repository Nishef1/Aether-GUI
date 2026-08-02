package com.cluvexstudio.aethergui.vpn

/** Mobile-only limits shared by the permission bridge and VpnService. */
internal object AndroidTransportPolicy {
    const val DEFAULT_MTU = 1280
    const val MIN_MTU = 1280
    const val MAX_MTU = 1500

    fun isValidMtu(value: Int): Boolean = value in MIN_MTU..MAX_MTU

    fun sanitizeMtu(value: Int): Int = value.coerceIn(MIN_MTU, MAX_MTU)

    fun startupTimeoutMs(protocol: String, scanMode: String): Long = when {
        protocol.equals("gool", ignoreCase = true) -> 180_000L
        protocol.equals("wireguard", ignoreCase = true) -> 150_000L
        else -> when (scanMode.lowercase()) {
            "turbo" -> 75_000L
            "stealth" -> 210_000L
            "thorough" -> 330_000L
            "ironclad" -> 240_000L
            else -> 150_000L
        }
    }
}
