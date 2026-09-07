package com.cluvexstudio.aethergui.vpn

import java.net.InetAddress
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Raised only when a public IP seen through Aether equals an underlay IP. */
internal class EgressIdentityLeakException(message: String) : IllegalStateException(message)

internal data class EgressIdentityCheck(
    val tunnelIp: String,
    val changed: Boolean?,
)

/**
 * Compares device underlay identities with Aether using neutral public-IP endpoints.
 *
 * A Cloudflare/WARP address may legitimately geolocate to the same country as the
 * user. Country equality is therefore never treated as a leak. Only exact public
 * IP equality is fail-closed. IPv4 and IPv6 baselines are gathered separately
 * when the current network supports them. If censorship blocks every direct
 * baseline probe, the result is inconclusive rather than a false failure.
 */
internal object AndroidEgressIdentityGuard {
    private const val CONNECT_TIMEOUT_MS = 4_000
    private const val READ_TIMEOUT_MS = 5_000

    private data class Provider(val label: String, val url: String)

    private val providers = listOf(
        Provider("ipify-v4", "https://api4.ipify.org/"),
        Provider("ipify-v6", "https://api6.ipify.org/"),
        Provider("aws-checkip", "https://checkip.amazonaws.com/"),
    )

    fun underlayPublicIps(): Set<String> = buildSet {
        for (provider in providers) {
            runCatching { directPublicIp(provider) }.getOrNull()?.let(::add)
        }
    }

    fun compare(underlayIps: Collection<String>, tunnelIp: String): EgressIdentityCheck {
        val changed = if (underlayIps.isEmpty()) {
            null
        } else {
            underlayIps.none { sameIp(it, tunnelIp) }
        }
        if (changed == false) {
            val message =
                "Aether egress is identical to the device underlay IP. Refusing to report a protected connection; check direct-routing rules or a failed tunnel path."
            AndroidVpnRuntime.reportSafetyFailure(message)
            throw EgressIdentityLeakException(message)
        }
        return EgressIdentityCheck(tunnelIp, changed)
    }

    private fun directPublicIp(provider: Provider): String {
        val connection = URL(provider.url).openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.instanceFollowRedirects = false
            connection.requestMethod = "GET"
            connection.setRequestProperty("User-Agent", "Aether-Android/3")
            val status = connection.responseCode
            if (status !in 200..299) error("${provider.label} returned HTTP $status")
            val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            return parseIp(body) ?: error("${provider.label} returned no public IP")
        } finally {
            connection.disconnect()
        }
    }

    internal fun parseIp(value: String): String? {
        val candidate = value.trim().lineSequence().firstOrNull()?.trim().orEmpty()
        if (candidate.isEmpty() || (!candidate.contains('.') && !candidate.contains(':'))) return null
        return runCatching { InetAddress.getByName(candidate).hostAddress }.getOrNull()
    }

    internal fun sameIp(first: String, second: String): Boolean = runCatching {
        InetAddress.getByName(first).address.contentEquals(InetAddress.getByName(second).address)
    }.getOrDefault(false)
}
