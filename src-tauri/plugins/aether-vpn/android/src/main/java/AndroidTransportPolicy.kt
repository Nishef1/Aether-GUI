package com.cluvexstudio.aethergui.vpn

/** Mobile-only limits shared by the permission bridge and VpnService. */
internal object AndroidTransportPolicy {
    const val DEFAULT_MTU = 1280
    const val MIN_MTU = 1280
    const val MAX_MTU = 1500

    fun isValidMtu(value: Int): Boolean = value in MIN_MTU..MAX_MTU

    fun sanitizeMtu(value: Int): Int = value.coerceIn(MIN_MTU, MAX_MTU)

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
