package com.cluvexstudio.aethergui.vpn

/**
 * Android-specific guardrails for the bundled WireGuard/Gool transports.
 *
 * The core does handshake and end-to-end data-plane verification before it
 * exposes SOCKS. Android must therefore wait longer than the core scanner's
 * own budget instead of killing a healthy scan at a fixed 50-second deadline.
 */
internal object AndroidWireGuardPolicy {
    /** Must stay aligned with the Aether core's TUNNEL_MTU. */
    const val TUN_MTU = 1280

    private const val NON_WIREGUARD_TIMEOUT_MS = 50_000L

    fun isWireGuardFamily(protocol: String): Boolean =
        protocol.equals("wireguard", ignoreCase = true) ||
            protocol.equals("gool", ignoreCase = true)

    fun startupTimeoutMs(protocol: String, scanMode: String): Long {
        if (!isWireGuardFamily(protocol)) return NON_WIREGUARD_TIMEOUT_MS

        // Scanner budget + account/config I/O + finalist confirmation + tunnel
        // validation. Cancel remains immediate, so a longer upper bound does not
        // trap the user on the Connecting screen.
        return when (scanMode.lowercase()) {
            "turbo" -> 90_000L
            "stealth" -> 270_000L
            "thorough" -> 330_000L
            "ironclad" -> 390_000L
            else -> 180_000L
        }
    }

    fun appendCoreArgs(command: MutableList<String>, protocol: String) {
        if (!isWireGuardFamily(protocol)) return

        command += listOf(
            "--keepalive", "5",
            "--wg-validate-secs", "12",
            "--wg-health-interval", "15",
            "--wg-stale-secs", "60",
            "--wg-startup-secs", "45",
            "--wg-reconnect-secs", "2",
        )
    }
}
