package com.cluvexstudio.aethergui.vpn

import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTransportPolicyTest {
    @Test
    fun enforcesSafeDualStackMtuRange() {
        assertEquals(1280, AndroidTransportPolicy.DEFAULT_MTU)
        assertTrue(AndroidTransportPolicy.isValidMtu(1280))
        assertTrue(AndroidTransportPolicy.isValidMtu(1500))
        assertFalse(AndroidTransportPolicy.isValidMtu(1279))
        assertFalse(AndroidTransportPolicy.isValidMtu(1501))
        assertEquals(1280, AndroidTransportPolicy.sanitizeMtu(900))
        assertEquals(1500, AndroidTransportPolicy.sanitizeMtu(9000))
    }

    @Test
    fun ipFamilySelectionIsARealAllowList() {
        val ipv4 = AndroidTransportPolicy.ipFamilyPolicy("v4")
        assertTrue(ipv4.ipv4)
        assertFalse(ipv4.ipv6)
        assertTrue(ipv4.allows(InetAddress.getByName("1.1.1.1")))
        assertFalse(ipv4.allows(InetAddress.getByName("2606:4700:4700::1111")))

        val ipv6 = AndroidTransportPolicy.ipFamilyPolicy("v6")
        assertFalse(ipv6.ipv4)
        assertTrue(ipv6.ipv6)
        assertFalse(ipv6.allows(InetAddress.getByName("1.1.1.1")))
        assertTrue(ipv6.allows(InetAddress.getByName("2606:4700:4700::1111")))

        val both = AndroidTransportPolicy.ipFamilyPolicy("both")
        assertTrue(both.ipv4)
        assertTrue(both.ipv6)
        assertTrue(AndroidTransportPolicy.isValidIpVersion("v4"))
        assertTrue(AndroidTransportPolicy.isValidIpVersion("v6"))
        assertTrue(AndroidTransportPolicy.isValidIpVersion("both"))
        assertFalse(AndroidTransportPolicy.isValidIpVersion("preferred"))
    }

    @Test
    fun turboFailsOverBeforeDeeperModes() {
        assertEquals(60_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "turbo"))
        assertEquals(70_000L, AndroidTransportPolicy.startupTimeoutMs("wireguard", "turbo"))
        assertEquals(90_000L, AndroidTransportPolicy.startupTimeoutMs("gool", "turbo"))
        assertTrue(
            AndroidTransportPolicy.startupTimeoutMs("masque", "turbo") <
                AndroidTransportPolicy.startupTimeoutMs("masque", "balanced"),
        )
    }

    @Test
    fun startupBudgetsCoverEveryScanFamilyAndTransportCost() {
        assertEquals(120_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "balanced"))
        assertEquals(135_000L, AndroidTransportPolicy.startupTimeoutMs("wireguard", "balanced"))
        assertEquals(165_000L, AndroidTransportPolicy.startupTimeoutMs("gool", "balanced"))
        assertEquals(300_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "thorough"))
        assertEquals(210_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "stealth"))
        assertEquals(240_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "ironclad"))
    }
}
