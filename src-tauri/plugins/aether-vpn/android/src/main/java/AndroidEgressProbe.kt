package com.cluvexstudio.aethergui.vpn

import android.os.SystemClock
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket

internal data class EgressProbeResult(
    val publicIp: String,
    val countryCode: String?,
    val latencyMs: Long,
)

internal object AndroidEgressProbe {
    private const val HOST = "www.cloudflare.com"
    private const val PORT = 443
    private const val PATH = "/cdn-cgi/trace"
    private const val CONNECT_TIMEOUT_MS = 5_000
    private const val READ_TIMEOUT_MS = 8_000

    fun probe(bindAddress: String): EgressProbeResult {
        val (proxyHost, proxyPort) = splitHostPort(bindAddress)
        val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress(proxyHost, proxyPort))
        val startedAt = SystemClock.elapsedRealtime()

        val rawSocket = Socket(proxy)
        rawSocket.connect(
            InetSocketAddress.createUnresolved(HOST, PORT),
            CONNECT_TIMEOUT_MS,
        )
        rawSocket.soTimeout = READ_TIMEOUT_MS

        val sslSocket = try {
            SSLContext.getDefault().socketFactory
                .createSocket(rawSocket, HOST, PORT, true) as SSLSocket
        } catch (error: Throwable) {
            runCatching { rawSocket.close() }
            throw error
        }
        sslSocket.use { socket ->
            socket.soTimeout = READ_TIMEOUT_MS
            socket.startHandshake()

            val writer = socket.outputStream.bufferedWriter()
            writer.write("GET $PATH HTTP/1.1\r\n")
            writer.write("Host: $HOST\r\n")
            writer.write("User-Agent: Aether-Android/1\r\n")
            writer.write("Connection: close\r\n\r\n")
            writer.flush()

            val response = socket.inputStream.bufferedReader().readText()
            var publicIp: String? = null
            var countryCode: String? = null
            response.lineSequence().forEach { line ->
                when {
                    line.startsWith("ip=") -> {
                        val value = line.substringAfter('=').trim()
                        if (runCatching { InetAddress.getByName(value) }.isSuccess) {
                            publicIp = value
                        }
                    }
                    line.startsWith("loc=") -> {
                        val value = line.substringAfter('=').trim().uppercase()
                        if (value.matches(Regex("^[A-Z]{2}$"))) countryCode = value
                    }
                }
            }

            return EgressProbeResult(
                publicIp = publicIp ?: error("Exit response did not contain a valid IP"),
                countryCode = countryCode,
                latencyMs = (SystemClock.elapsedRealtime() - startedAt).coerceAtLeast(1L),
            )
        }
    }

    private fun splitHostPort(value: String): Pair<String, Int> {
        val separator = value.lastIndexOf(':')
        if (separator <= 0) return "127.0.0.1" to 1819
        val host = value.substring(0, separator).removePrefix("[").removeSuffix("]")
        val port = value.substring(separator + 1).toIntOrNull() ?: 1819
        return host to port
    }
}
