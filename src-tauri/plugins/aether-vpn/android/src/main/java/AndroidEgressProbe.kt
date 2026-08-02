package com.cluvexstudio.aethergui.vpn

import java.io.EOFException
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

internal data class EgressProbeResult(
    val publicIp: String,
    val countryCode: String?,
    val latencyMs: Long,
    val provider: String = "unknown",
)

/**
 * End-to-end SOCKS verification used as the definition of Connected.
 *
 * A local listening port is not enough: WireGuard can finish its direct raw-DNS
 * validation while the reusable netstack behind SOCKS is still unable to resolve
 * a domain or establish TCP. This probe talks SOCKS5 manually so failures can be
 * classified as proxy handshake, remote DNS, TCP, TLS, or HTTP instead of being
 * flattened into Java's generic "Connect timed out" message.
 */
internal object AndroidEgressProbe {
    private const val CONNECT_TIMEOUT_MS = 6_000
    private const val READ_TIMEOUT_MS = 8_000
    private const val LITERAL_TCP_LABEL = "cloudflare-literal-tcp"

    private data class Provider(
        val label: String,
        val host: String,
        val port: Int,
        val path: String,
        val tls: Boolean,
        val useDomainAddress: Boolean,
        val hostHeader: String = host,
    )

    private val domainProviders = listOf(
        Provider(
            label = "cloudflare-domain-tls",
            host = "www.cloudflare.com",
            port = 443,
            path = "/cdn-cgi/trace",
            tls = true,
            useDomainAddress = true,
        ),
        Provider(
            label = "ip-api-domain-http",
            host = "ip-api.com",
            port = 80,
            path = "/json/?fields=status,query,countryCode",
            tls = false,
            useDomainAddress = true,
        ),
    )

    fun probe(bindAddress: String): EgressProbeResult {
        val (proxyHost, proxyPort) = splitHostPort(bindAddress)
        val failures = mutableListOf<String>()

        for (provider in domainProviders) {
            val result = runCatching { probeProvider(proxyHost, proxyPort, provider) }
            if (result.isSuccess) return result.getOrThrow()
            failures += "${provider.label}: ${result.exceptionOrNull()?.message ?: "unknown error"}"
        }

        val literal = runCatching {
            socks5Connect(
                proxyHost = proxyHost,
                proxyPort = proxyPort,
                targetHost = "1.1.1.1",
                targetPort = 80,
                useDomain = false,
            ).use { Unit }
        }
        if (literal.isSuccess) {
            error(
                "SOCKS TCP works through $LITERAL_TCP_LABEL, but remote DNS/domain " +
                    "egress failed (${failures.joinToString(" | ")})"
            )
        }

        failures += "$LITERAL_TCP_LABEL: ${literal.exceptionOrNull()?.message ?: "unknown error"}"
        error("SOCKS end-to-end egress failed (${failures.joinToString(" | ")})")
    }

    private fun probeProvider(
        proxyHost: String,
        proxyPort: Int,
        provider: Provider,
    ): EgressProbeResult {
        val startedAt = System.nanoTime()
        val raw = socks5Connect(
            proxyHost = proxyHost,
            proxyPort = proxyPort,
            targetHost = provider.host,
            targetPort = provider.port,
            useDomain = provider.useDomainAddress,
        )

        val socket = if (provider.tls) tlsWrap(raw, provider.host, provider.port) else raw
        socket.use {
            it.soTimeout = READ_TIMEOUT_MS
            val writer = it.outputStream.bufferedWriter(Charsets.US_ASCII)
            writer.write("GET ${provider.path} HTTP/1.1\r\n")
            writer.write("Host: ${provider.hostHeader}\r\n")
            writer.write("User-Agent: Aether-Android/2\r\n")
            writer.write("Connection: close\r\n\r\n")
            writer.flush()

            val response = it.inputStream.bufferedReader(Charsets.UTF_8).readText()
            val status = Regex("^HTTP/\\d(?:\\.\\d)?\\s+(\\d{3})", RegexOption.MULTILINE)
                .find(response)
                ?.groupValues
                ?.getOrNull(1)
                ?.toIntOrNull()
            if (status == null || status !in 200..399) {
                error("HTTP response was not successful (status=${status ?: "missing"})")
            }

            val ip = parsePublicIp(response)
                ?: error("HTTP response did not contain a public IP")
            val country = parseCountry(response)
            return EgressProbeResult(
                publicIp = ip,
                countryCode = country,
                latencyMs = elapsedMillis(startedAt),
                provider = provider.label,
            )
        }
    }

    private fun socks5Connect(
        proxyHost: String,
        proxyPort: Int,
        targetHost: String,
        targetPort: Int,
        useDomain: Boolean,
    ): Socket {
        val socket = Socket()
        try {
            socket.connect(InetSocketAddress(proxyHost, proxyPort), CONNECT_TIMEOUT_MS)
            socket.soTimeout = READ_TIMEOUT_MS
            val input = socket.inputStream
            val output = socket.outputStream

            output.write(byteArrayOf(0x05, 0x01, 0x00))
            output.flush()
            val greeting = readExact(input, 2)
            if (greeting[0].toInt() != 0x05 || greeting[1].toInt() != 0x00) {
                error("SOCKS greeting rejected (version=${greeting[0]}, method=${greeting[1]})")
            }

            val request = ArrayList<Byte>()
            request += 0x05.toByte()
            request += 0x01.toByte()
            request += 0x00.toByte()
            if (useDomain) {
                val encoded = targetHost.toByteArray(Charsets.US_ASCII)
                require(encoded.size in 1..255) { "SOCKS target domain has invalid length" }
                request += 0x03.toByte()
                request += encoded.size.toByte()
                encoded.forEach { request += it }
            } else {
                val address = InetAddress.getByName(targetHost)
                require(address is Inet4Address) { "Literal SOCKS fallback must be IPv4" }
                request += 0x01.toByte()
                address.address.forEach { request += it }
            }
            request += ((targetPort ushr 8) and 0xff).toByte()
            request += (targetPort and 0xff).toByte()
            output.write(request.toByteArray())
            output.flush()

            val header = readExact(input, 4)
            if (header[0].toInt() != 0x05) error("Invalid SOCKS reply version")
            val reply = header[1].toInt() and 0xff
            if (reply != 0x00) error("SOCKS CONNECT failed with reply 0x${reply.toString(16)}")
            when (header[3].toInt() and 0xff) {
                0x01 -> readExact(input, 4)
                0x03 -> readExact(input, readExact(input, 1)[0].toInt() and 0xff)
                0x04 -> readExact(input, 16)
                else -> error("SOCKS reply used an unknown address type")
            }
            readExact(input, 2)
            return socket
        } catch (error: Throwable) {
            runCatching { socket.close() }
            throw error
        }
    }

    private fun tlsWrap(raw: Socket, host: String, port: Int): SSLSocket {
        val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
        val ssl = factory.createSocket(raw, host, port, true) as SSLSocket
        try {
            ssl.soTimeout = READ_TIMEOUT_MS
            ssl.startHandshake()
            if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, ssl.session)) {
                throw SSLPeerUnverifiedException("TLS certificate does not match $host")
            }
            return ssl
        } catch (error: Throwable) {
            runCatching { ssl.close() }
            throw error
        }
    }

    private fun readExact(input: InputStream, size: Int): ByteArray {
        val result = ByteArray(size)
        var offset = 0
        while (offset < size) {
            val read = input.read(result, offset, size - offset)
            if (read < 0) throw EOFException("SOCKS peer closed while reading $size bytes")
            offset += read
        }
        return result
    }

    private fun elapsedMillis(startedAt: Long): Long =
        ((System.nanoTime() - startedAt) / 1_000_000L).coerceAtLeast(1L)

    private fun parsePublicIp(response: String): String? {
        val trace = Regex("(?m)^ip=([^\\r\\n]+)$").find(response)?.groupValues?.getOrNull(1)?.trim()
        val json = Regex("\\\"query\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"")
            .find(response)
            ?.groupValues
            ?.getOrNull(1)
            ?.trim()
        return listOfNotNull(trace, json).firstOrNull { value ->
            (value.contains('.') || value.contains(':')) &&
                runCatching { InetAddress.getByName(value) }.isSuccess
        }
    }

    private fun parseCountry(response: String): String? {
        val trace = Regex("(?m)^loc=([A-Za-z]{2})$").find(response)?.groupValues?.getOrNull(1)
        val json = Regex("\\\"countryCode\\\"\\s*:\\s*\\\"([A-Za-z]{2})\\\"")
            .find(response)
            ?.groupValues
            ?.getOrNull(1)
        return (trace ?: json)?.uppercase()
    }

    private fun splitHostPort(value: String): Pair<String, Int> {
        val separator = value.lastIndexOf(':')
        if (separator <= 0) return "127.0.0.1" to 1819
        val host = value.substring(0, separator).removePrefix("[").removeSuffix("]")
        val port = value.substring(separator + 1).toIntOrNull() ?: 1819
        return host to port
    }
}
