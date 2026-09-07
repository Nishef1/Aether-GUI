package com.cluvexstudio.aethergui.vpn

import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Raised only when the exact public IP seen through Aether equals the underlay IP. */
internal class EgressIdentityLeakException(message: String) : IllegalStateException(message)

internal data class EgressIdentityCheck(
    val underlayIp: String?,
    val tunnelIp: String,
    val changed: Boolean?,
)

/**
 * Compares the device underlay with Aether using neutral public-IP endpoints.
 *
 * A Cloudflare/WARP address may legitimately geolocate to the same country as the
 * user. Country equality is therefore never treated as a leak. Only exact public
 * IP equality is fail-closed. If censorship blocks every direct baseline probe,
 * the result is inconclusive rather than a false failure.
 */
internal object AndroidEgressIdentityGuard {
    private const val CONNECT_TIMEOUT_MS = 4_000
    private const val READ_TIMEOUT_MS = 5_000

    private data class Provider(val label: String, val url: String)

    private val providers = listOf(
        Provider("aws-checkip", "https://checkip.amazonaws.com/"),
        Provider("ipify", "https://api.ipify.org/"),
    )

    fun underlayPublicIp(): String? {
        for (provider in providers) {
            val result = runCatching { directPublicIp(provider) }
            if (result.isSuccess) return result.getOrThrow()
        }
        return null
    }

    fun compare(underlayIp: String?, tunnelIp: String): EgressIdentityCheck {
        val changed = underlayIp?.let { !sameIp(it, tunnelIp) }
        if (changed == false) {
            throw EgressIdentityLeakException(
                "Aether egress is identical to the device underlay IP. Refusing to report a protected connection; check direct-routing rules or a failed tunnel path.",
            )
        }
        return EgressIdentityCheck(underlayIp, tunnelIp, changed)
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
