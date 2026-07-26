package com.cluvexstudio.aethergui.vpn

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import kotlin.random.Random

/** Fast direct-network UDP check used only to choose MASQUE H3 versus H2. */
internal object AndroidUdpCapabilityProbe {
    private val resolvers = listOf("1.1.1.1", "8.8.8.8")

    fun hasUsableUdp(timeoutMs: Int = 1_500): Boolean {
        return resolvers.any { resolver -> probeDns(resolver, timeoutMs) }
    }

    private fun probeDns(server: String, timeoutMs: Int): Boolean = runCatching {
        val id = Random.nextInt(0, 65_536)
        val query = buildQuery(id)
        DatagramSocket().use { socket ->
            socket.soTimeout = timeoutMs
            socket.connect(InetAddress.getByName(server), 53)
            socket.send(DatagramPacket(query, query.size))

            val response = ByteArray(512)
            val packet = DatagramPacket(response, response.size)
            socket.receive(packet)
            packet.length >= 12 &&
                response[0] == ((id ushr 8) and 0xff).toByte() &&
                response[1] == (id and 0xff).toByte() &&
                (response[2].toInt() and 0x80) != 0
        }
    }.getOrDefault(false)

    private fun buildQuery(id: Int): ByteArray {
        val bytes = ArrayList<Byte>(32)
        bytes += ((id ushr 8) and 0xff).toByte()
        bytes += (id and 0xff).toByte()
        bytes += 0x01
        bytes += 0x00
        bytes += 0x00
        bytes += 0x01
        repeat(6) { bytes += 0x00 }
        for (label in listOf("cloudflare", "com")) {
            bytes += label.length.toByte()
            label.encodeToByteArray().forEach { bytes += it }
        }
        bytes += 0x00
        bytes += 0x00
        bytes += 0x01
        bytes += 0x00
        bytes += 0x01
        return bytes.toByteArray()
    }
}
