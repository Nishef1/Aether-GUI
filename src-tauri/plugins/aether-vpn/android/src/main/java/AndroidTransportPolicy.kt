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
     * Android uses a clean WireGuard first pass. The endpoint scanner already
     * performs authenticated handshake and data-plane validation; emitting junk
     * after that handshake has caused real devices to keep the UDP association
     * alive while dropping DNS/TCP carried by the reused session. The requested
     * profile remains visible in logs and can return as a second-pass strategy
     * after the clean path is proven on-device.
     */
    fun effectiveWireGuardNoize(requested: String): String = "off"

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
                "turbo" -> 90_000L
                "stealth" -> 270_000L
                "thorough" -> 330_000L
                "ironclad" -> 390_000L
                else -> 180_000L
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

    /** False means Auto, not "force H3". H2 is preferred when UDP probing fails. */
    fun useMasqueHttp2(forceHttp2: Boolean, udpAvailable: Boolean): Boolean =
        forceHttp2 || !udpAvailable

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
            isWireGuardFamily(protocol) -> command += listOf(
                "--keepalive", "5",
                "--wg-validate-secs", "12",
                "--wg-health-interval", "15",
                "--wg-stale-secs", "60",
                "--wg-startup-secs", "45",
                "--wg-reconnect-secs", "2",
            )
        }
    }
}
