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
    fun startupBudgetsCoverEveryScanFamily() {
        assertEquals(75_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "turbo"))
        assertEquals(330_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "thorough"))
        assertEquals(240_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "ironclad"))
        assertEquals(150_000L, AndroidTransportPolicy.startupTimeoutMs("wireguard", "balanced"))
        assertEquals(180_000L, AndroidTransportPolicy.startupTimeoutMs("gool", "balanced"))
    }
}
