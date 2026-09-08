package com.cluvexstudio.aethergui.vpn

import java.io.File
import java.net.InetSocketAddress

internal data class AndroidPathSelection(
    val transport: String,
    val endpoint: String,
)

/**
 * Reads Aether v1.9's own last-connection cache after SOCKS egress succeeds.
 * This keeps path learning independent from verbose core logging and therefore
 * avoids turning diagnostics on just to discover the selected edge.
 */
internal object AndroidPathSelectionReader {
    fun resolve(
        filesDir: File,
        protocol: String,
        masqueHttp2: Boolean,
        peer: String,
        wgPeer: String,
        wiwOuter: String,
        wiwInner: String,
        h2Peer: String,
    ): AndroidPathSelection? = when (protocol) {
        "wireguard" -> {
            val endpoint = firstValidEndpoint(
                peer,
                wgPeer,
                readLastConnectionPeer(File(filesDir, "aether-wg-lastconn.toml")),
            ) ?: return null
            AndroidPathSelection("wg", endpoint)
        }
        "gool" -> {
            val outer = validEndpoint(wiwOuter) ?: validEndpoint(wgPeer)
            val inner = validEndpoint(wiwInner)
            if (outer == null || inner == null) null
            else AndroidPathSelection("gool", "$outer>$inner")
        }
        else -> {
            val transport = if (masqueHttp2) "h2" else "h3"
            val explicit = if (masqueHttp2) h2Peer.ifBlank { peer } else peer
            val endpoint = firstValidEndpoint(
                explicit,
                readLastConnectionPeer(File(filesDir, "aether-masque-lastconn.toml")),
            ) ?: return null
            AndroidPathSelection(transport, endpoint)
        }
    }

    private fun firstValidEndpoint(vararg candidates: String?): String? =
        candidates.firstNotNullOfOrNull { candidate -> validEndpoint(candidate.orEmpty()) }

    private fun readLastConnectionPeer(file: File): String? = runCatching {
        if (!file.isFile || file.length() > 16 * 1024) return@runCatching null
        val body = file.readText(Charsets.UTF_8)
        Regex("(?m)^\\s*peer\\s*=\\s*\"([^\"\\r\\n]+)\"\\s*$")
            .find(body)
            ?.groupValues
            ?.getOrNull(1)
    }.getOrNull()

    private fun validEndpoint(value: String): String? {
        val trimmed = value.trim()
        if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null

        val (host, portText) = if (trimmed.startsWith("[")) {
            val end = trimmed.indexOf(']')
            if (end <= 1 || end + 2 >= trimmed.length || trimmed[end + 1] != ':') return null
            trimmed.substring(1, end) to trimmed.substring(end + 2)
        } else {
            val colon = trimmed.lastIndexOf(':')
            if (colon <= 0 || colon == trimmed.lastIndex) return null
            trimmed.substring(0, colon) to trimmed.substring(colon + 1)
        }

        val port = portText.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
        return runCatching {
            InetSocketAddress.createUnresolved(host, port)
            trimmed
        }.getOrNull()
    }
}
