package com.cluvexstudio.aethergui.vpn

/** Android guardrails shared by MASQUE, WireGuard, and WARP-in-WARP. */
internal object AndroidTransportPolicy {
    /** Matches the Aether core's outer TUNNEL_MTU; Gool keeps its inner MTU at 1200. */
    const val TUN_MTU = 1280
    private const val VERIFIED_WG_SCAN_MODE = "ironclad"

    private val scanFlags = setOf(
        "--turbo",
        "--balanced",
        "--thorough",
        "--stealth",
        "--ironclad",
    )

    fun isMasque(protocol: String): Boolean =
        protocol.equals("masque", ignoreCase = true) ||
            protocol.equals("auto", ignoreCase = true)

    fun isFastAuto(protocol: String): Boolean = protocol.equals("auto", ignoreCase = true)

    fun isWireGuardFamily(protocol: String): Boolean =
        protocol.equals("wireguard", ignoreCase = true) ||
            protocol.equals("gool", ignoreCase = true)

    /**
     * Explicit WireGuard/Gool still uses real HTTP validation. That prevents a
     * false-positive connection where handshake/probe UDP passes but useful TCP
     * traffic inside WARP is blocked by the current network.
     */
    @Suppress("UNUSED_PARAMETER")
    fun effectiveWireGuardScanMode(requested: String): String = VERIFIED_WG_SCAN_MODE

    /** Preserve the user's explicit WireGuard obfuscation profile. */
    fun effectiveWireGuardNoize(requested: String): String =
        when (requested.trim().lowercase()) {
            "off", "none" -> "off"
            "light" -> "light"
            "aggressive", "heavy" -> "aggressive"
            "balanced" -> "balanced"
            else -> "balanced"
        }

    /**
     * Auto is deliberately short and predictable. Explicit WireGuard modes are
     * bounded because the mobile core scans only official consumer WARP ranges
     * and ports, uses the selected noize profile once, and requires real HTTP.
     */
    fun startupTimeoutMs(protocol: String, scanMode: String): Long {
        val mode = if (isWireGuardFamily(protocol)) {
            effectiveWireGuardScanMode(scanMode)
        } else {
            scanMode.lowercase()
        }
        return when {
            protocol.equals("gool", ignoreCase = true) -> 110_000L
            protocol.equals("wireguard", ignoreCase = true) -> 100_000L
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

    /** Honor explicit MASQUE choice; Auto is forced to H2 by the service. */
    @Suppress("UNUSED_PARAMETER")
    fun useMasqueHttp2(forceHttp2: Boolean, udpAvailable: Boolean): Boolean = forceHttp2

    fun appendCoreArgs(
        command: MutableList<String>,
        protocol: String,
        useMasqueHttp2: Boolean,
    ) {
        when {
            isMasque(protocol) -> {
                if (isFastAuto(protocol)) {
                    // Do not leave the core in interactive protocol selection:
                    // Android Auto is an explicit MASQUE route. The reconnect
                    // flag already present in `command` remains user-controlled.
                    if (!command.contains("--masque")) command += "--masque"
                    command.removeAll { it in scanFlags }
                    command += "--turbo"
                }
                command += listOf(
                    "--validate-secs", "12",
                    "--health-interval", "30",
                    "--health-timeout", "20",
                    "--health-failures", "3",
                    "--reconnect-secs", "2",
                )
                if (useMasqueHttp2) command += "--fragment"
            }
            isWireGuardFamily(protocol) -> {
                command.removeAll { it in scanFlags }
                command += "--$VERIFIED_WG_SCAN_MODE"
                // Do not burn minutes cycling through four noize profiles on a
                // network where real WARP egress is currently blocked.
                command += "--no-profile-retry"

                val validateSeconds = if (protocol.equals("gool", ignoreCase = true)) "25" else "12"
                command += listOf(
                    "--keepalive", "25",
                    "--wg-validate-secs", validateSeconds,
                    "--wg-health-interval", "30",
                    "--wg-stale-secs", "90",
                    "--wg-startup-secs", "45",
                    "--wg-reconnect-secs", "2",
                )
            }
        }
    }
}
