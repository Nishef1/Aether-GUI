package com.cluvexstudio.aethergui.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTransportPolicyTest {
    @Test
    fun usesOnlyOfficialAetherTransportFamilies() {
        assertTrue(AndroidTransportPolicy.isMasque("auto"))
        assertTrue(AndroidTransportPolicy.isMasque("masque"))
        assertTrue(AndroidTransportPolicy.isWireGuardFamily("wireguard"))
        assertTrue(AndroidTransportPolicy.isWireGuardFamily("gool"))
        assertFalse(AndroidTransportPolicy.isWireGuardFamily("masque"))
    }

    @Test
    fun normalizesWireGuardNoizeWithoutAddingCustomFlags() {
        assertEquals("off", AndroidTransportPolicy.effectiveWireGuardNoize("none"))
        assertEquals("light", AndroidTransportPolicy.effectiveWireGuardNoize("light"))
        assertEquals("aggressive", AndroidTransportPolicy.effectiveWireGuardNoize("heavy"))
        assertEquals("balanced", AndroidTransportPolicy.effectiveWireGuardNoize("unknown"))

        val args = mutableListOf<String>()
        AndroidTransportPolicy.appendCoreArgs(args, "masque", false)
        assertTrue(args.isEmpty())
    }

    @Test
    fun respectsExplicitHttp2Selection() {
        assertTrue(AndroidTransportPolicy.useMasqueHttp2(true, true))
        assertFalse(AndroidTransportPolicy.useMasqueHttp2(false, false))
    }
}
