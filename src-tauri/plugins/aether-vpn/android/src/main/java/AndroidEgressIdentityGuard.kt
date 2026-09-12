package com.cluvexstudio.aethergui.vpn

import android.os.SystemClock
import java.net.InetAddress
import java.net.URL
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.HttpsURLConnection

/** Raised only when Aether exposes the exact public address of the underlay. */
internal class EgressIdentityLeakException(message: String) : IllegalStateException(message)

/**
 * Supplemental exact-IP safety baseline.
 *
 * GeoIP/country is intentionally absent from this class. A nearby Cloudflare
 * address that geolocates to Iran can be a valid low-latency exit. The only
 * fail-closed identity condition here is exact public-IP equality, which means
 * the protected path has not changed the network identity at all.
 *
 * Direct public-IP lookups are cached because the normal telemetry probe runs
 * periodically. Native TUN/HEV health remains the primary continuous safety
 * contract, so repeatedly waking the radio for an underlay lookup adds little
 * value while costing battery.
 */
internal object AndroidEgressIdentityGuard {
    private const val CONNECT_TIMEOUT_MS = 2_500
    private const val READ_TIMEOUT_MS = 3_000
    private const val BASELINE_TTL_MS = 15 * 60 * 1_000L

    private data class Provider(val url: String)
    private data class CachedBaseline(val capturedAtMs: Long, val addresses: Set<String>)

    private val ipv4Primary = Provider("https://api4.ipify.org/")
    private val ipv4Fallback = Provider("https://checkip.amazonaws.com/")
    private val ipv6Provider = Provider("https://api6.ipify.org/")
    private val cachedBaseline = AtomicReference<CachedBaseline?>(null)

    fun underlayPublicIps(): Set<String> {
        val now = SystemClock.elapsedRealtime()
        cachedBaseline.get()?.let { cached ->
            if (now - cached.capturedAtMs < BASELINE_TTL_MS) return cached.addresses
        }

        val addresses = buildSet {
            val ipv4 = runCatching { directPublicIp(ipv4Primary) }.getOrNull()
                ?: runCatching { directPublicIp(ipv4Fallback) }.getOrNull()
            ipv4?.let(::add)
            runCatching { directPublicIp(ipv6Provider) }.getOrNull()?.let(::add)
        }
        cachedBaseline.set(CachedBaseline(now, addresses))
        return addresses
    }

    fun assertChanged(underlayIps: Collection<String>, tunnelIp: String) {
        if (underlayIps.isEmpty()) return
        if (underlayIps.any { sameIp(it, tunnelIp) }) {
            val message =
                "Aether egress is identical to the device public IP. Refusing to expose an unprotected network identity."
            AndroidVpnRuntime.reportSafetyFailure(message)
            throw EgressIdentityLeakException(message)
        }
    }

    private fun directPublicIp(provider: Provider): String {
        val connection = URL(provider.url).openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.instanceFollowRedirects = false
            connection.requestMethod = "GET"
            // This request intentionally runs on the underlay to establish the
            // exact-IP safety baseline. Never attach a product-specific header:
            // the provider only needs to return the public address.
            val status = connection.responseCode
            if (status !in 200..299) error("identity endpoint returned HTTP $status")
            val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            return parseIp(body) ?: error("identity endpoint returned no public IP")
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
