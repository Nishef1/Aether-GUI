package com.cluvexstudio.aethergui.vpn

/** Android guardrails shared by MASQUE, WireGuard, and WARP-in-WARP. */
internal object AndroidTransportPolicy {
    /** Matches the Aether core's outer TUNNEL_MTU; Gool keeps its inner MTU at 1200. */
    const val TUN_MTU = 1280

    fun isMasque(protocol: String): Boolean =
        protocol.equals("masque", ignoreCase = true) ||
            protocol.equals("auto", ignoreCase = true)

    fun isWireGuardFamily(protocol: String): Boolean =
        protocol.equals("wireguard", ignoreCase = true) ||
            protocol.equals("gool", ignoreCase = true)

    /**
     * Preserve the user's WireGuard obfuscation choice on Android. The previous
     * "stable dataplane" override forced every WireGuard and Gool attempt to plain
     * `off`, even when the UI requested `balanced`. That removed the very handshake
     * camouflage required on networks which permit an initial WARP exchange and then
     * classify or throttle the continuing plain-WireGuard flow.
     *
     * Android only normalizes aliases and unknown values; profile fallback remains
     * owned by the Aether core.
     */
    fun effectiveWireGuardNoize(requested: String): String =
        when (requested.trim().lowercase()) {
            "off", "none" -> "off"
            "light" -> "light"
            "aggressive", "heavy" -> "aggressive"
            "balanced" -> "balanced"
            else -> "balanced"
        }

    /**
     * Upper bound for the core to expose SOCKS. These values exceed each core
     * scanner budget plus account provisioning, finalist confirmation, and
     * end-to-end data-plane validation. Cancellation remains immediate.
     */
    fun startupTimeoutMs(protocol: String, scanMode: String): Long {
        val mode = scanMode.lowercase()
        return when {
            protocol.equals("gool", ignoreCase = true) -> when (mode) {
                "turbo" -> 150_000L
                "stealth" -> 360_000L
                "thorough" -> 450_000L
                "ironclad" -> 510_000L
                else -> 270_000L
            }
            protocol.equals("wireguard", ignoreCase = true) -> when (mode) {
                // Allow endpoint blacklisting, a fresh scan, and a replacement
                // runtime before Android cancels the still-healthy recovery loop.
                "turbo" -> 210_000L
                "stealth" -> 390_000L
                "thorough" -> 450_000L
                "ironclad" -> 510_000L
                else -> 300_000L
            }
            isMasque(protocol) -> when (mode) {
                "turbo" -> 75_000L
                "stealth" -> 210_000L
                "thorough" -> 180_000L
                "ironclad" -> 240_000L
                else -> 120_000L
            }
            else -> 120_000L
        }
    }

    /**
     * Honor the user's explicit MASQUE transport choice. HTTP/3 uses QUIC/UDP;
     * HTTP/2 uses TCP and is the fallback for networks that permit UDP but drop
     * MASQUE/QUIC data after the initial handshake.
     */
    @Suppress("UNUSED_PARAMETER")
    fun useMasqueHttp2(forceHttp2: Boolean, udpAvailable: Boolean): Boolean = forceHttp2

    fun appendCoreArgs(
        command: MutableList<String>,
        protocol: String,
        useMasqueHttp2: Boolean,
    ) {
        when {
            isMasque(protocol) -> {
                command += listOf(
                    "--validate-secs", "12",
                    "--health-interval", "20",
                    "--health-timeout", "20",
                    "--health-failures", "3",
                    "--reconnect-secs", "2",
                )
                if (useMasqueHttp2) command += "--fragment"
            }
            isWireGuardFamily(protocol) -> {
                val validateSeconds = if (protocol.equals("gool", ignoreCase = true)) "25" else "12"
                command += listOf(
                    "--keepalive", "5",
                    "--wg-validate-secs", validateSeconds,
                    "--wg-health-interval", "15",
                    "--wg-stale-secs", "60",
                    "--wg-startup-secs", "45",
                    "--wg-reconnect-secs", "2",
                )
            }
        }
    }
}
