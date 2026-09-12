package com.cluvexstudio.aethergui.vpn

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
