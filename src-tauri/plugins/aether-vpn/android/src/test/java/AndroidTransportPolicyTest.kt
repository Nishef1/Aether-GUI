package com.cluvexstudio.aethergui.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTransportPolicyTest {
    @Test
    fun masqueTimeoutsExceedCoreScannerBudgets() {
        assertEquals(75_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "turbo"))
        assertEquals(120_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "balanced"))
        assertEquals(180_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "thorough"))
        assertEquals(210_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "stealth"))
        assertEquals(240_000L, AndroidTransportPolicy.startupTimeoutMs("masque", "ironclad"))
    }

    @Test
    fun wireGuardTimeoutsExceedCoreScannerBudgets() {
        assertEquals(210_000L, AndroidTransportPolicy.startupTimeoutMs("wireguard", "turbo"))
        assertEquals(300_000L, AndroidTransportPolicy.startupTimeoutMs("wireguard", "balanced"))
        assertEquals(390_000L, AndroidTransportPolicy.startupTimeoutMs("wireguard", "stealth"))
        assertEquals(450_000L, AndroidTransportPolicy.startupTimeoutMs("wireguard", "thorough"))
        assertEquals(510_000L, AndroidTransportPolicy.startupTimeoutMs("wireguard", "ironclad"))
    }

    @Test
    fun goolAllowsForOuterAndInnerWireGuardValidation() {
        assertEquals(150_000L, AndroidTransportPolicy.startupTimeoutMs("gool", "turbo"))
        assertEquals(270_000L, AndroidTransportPolicy.startupTimeoutMs("gool", "balanced"))
        assertEquals(360_000L, AndroidTransportPolicy.startupTimeoutMs("gool", "stealth"))
        assertEquals(450_000L, AndroidTransportPolicy.startupTimeoutMs("gool", "thorough"))
        assertEquals(510_000L, AndroidTransportPolicy.startupTimeoutMs("gool", "ironclad"))
    }

    @Test
    fun androidWireGuardHonorsRequestedNoize() {
        assertEquals("balanced", AndroidTransportPolicy.effectiveWireGuardNoize("balanced"))
        assertEquals("aggressive", AndroidTransportPolicy.effectiveWireGuardNoize("aggressive"))
        assertEquals("aggressive", AndroidTransportPolicy.effectiveWireGuardNoize("heavy"))
        assertEquals("light", AndroidTransportPolicy.effectiveWireGuardNoize(" light "))
        assertEquals("off", AndroidTransportPolicy.effectiveWireGuardNoize("off"))
        assertEquals("off", AndroidTransportPolicy.effectiveWireGuardNoize("none"))
        assertEquals("balanced", AndroidTransportPolicy.effectiveWireGuardNoize("unknown"))
    }

    @Test
    fun masqueTransportHonorsTheExplicitUserChoice() {
        assertTrue(AndroidTransportPolicy.useMasqueHttp2(forceHttp2 = true, udpAvailable = true))
        assertFalse(AndroidTransportPolicy.useMasqueHttp2(forceHttp2 = false, udpAvailable = false))
        assertFalse(AndroidTransportPolicy.useMasqueHttp2(forceHttp2 = false, udpAvailable = true))
    }

    @Test
    fun runtimeArgsCoverMasqueAndWireGuardFamilies() {
        val masque = mutableListOf("aether", "--masque")
        AndroidTransportPolicy.appendCoreArgs(masque, "masque", useMasqueHttp2 = true)
        assertTrue(masque.contains("--fragment"))
        assertTrue(masque.windowed(2).contains(listOf("--validate-secs", "12")))
        assertTrue(masque.windowed(2).contains(listOf("--health-interval", "20")))
        assertTrue(masque.windowed(2).contains(listOf("--reconnect-secs", "2")))

        val wireGuard = mutableListOf("aether", "--wg")
        AndroidTransportPolicy.appendCoreArgs(wireGuard, "wireguard", useMasqueHttp2 = false)
        assertTrue(wireGuard.windowed(2).contains(listOf("--keepalive", "5")))
        assertTrue(wireGuard.windowed(2).contains(listOf("--wg-validate-secs", "12")))
        assertTrue(wireGuard.windowed(2).contains(listOf("--wg-health-interval", "15")))

        val gool = mutableListOf("aether", "--gool")
        AndroidTransportPolicy.appendCoreArgs(gool, "gool", useMasqueHttp2 = false)
        assertTrue(gool.windowed(2).contains(listOf("--wg-validate-secs", "25")))
        assertTrue(gool.windowed(2).contains(listOf("--wg-startup-secs", "45")))
        assertTrue(gool.windowed(2).contains(listOf("--wg-reconnect-secs", "2")))
        assertEquals(1280, AndroidTransportPolicy.TUN_MTU)
    }
}
