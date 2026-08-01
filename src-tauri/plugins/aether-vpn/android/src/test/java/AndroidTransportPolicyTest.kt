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
    fun wireGuardUsesBoundedIroncladHttpVerification() {
        for (requested in listOf("turbo", "balanced", "stealth", "thorough", "ironclad")) {
            assertEquals("ironclad", AndroidTransportPolicy.effectiveWireGuardScanMode(requested))
            assertEquals(100_000L, AndroidTransportPolicy.startupTimeoutMs("wireguard", requested))
        }
    }

    @Test
    fun goolUsesBoundedIroncladOuterSelection() {
        for (requested in listOf("turbo", "balanced", "stealth", "thorough", "ironclad")) {
            assertEquals("ironclad", AndroidTransportPolicy.effectiveWireGuardScanMode(requested))
            assertEquals(110_000L, AndroidTransportPolicy.startupTimeoutMs("gool", requested))
        }
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
    fun autoUsesFastH2PolicyWithoutOverridingReconnect() {
        val disabled = mutableListOf("aether", "--balanced", "--no-quick-reconnect")
        AndroidTransportPolicy.appendCoreArgs(disabled, "auto", useMasqueHttp2 = true)
        assertEquals(1, disabled.count { it == "--masque" })
        assertFalse(disabled.contains("--balanced"))
        assertEquals(1, disabled.count { it == "--turbo" })
        assertEquals(1, disabled.count { it == "--no-quick-reconnect" })
        assertFalse(disabled.contains("--quick-reconnect"))
        assertTrue(disabled.contains("--fragment"))
        assertTrue(disabled.windowed(2).contains(listOf("--health-interval", "30")))
        assertTrue(AndroidTransportPolicy.isFastAuto("auto"))

        val enabled = mutableListOf("aether", "--balanced", "--quick-reconnect")
        AndroidTransportPolicy.appendCoreArgs(enabled, "auto", useMasqueHttp2 = true)
        assertEquals(1, enabled.count { it == "--quick-reconnect" })
        assertFalse(enabled.contains("--no-quick-reconnect"))
    }

    @Test
    fun runtimeArgsCoverExplicitMasqueAndWireGuardFamilies() {
        val masque = mutableListOf("aether", "--masque", "--turbo")
        AndroidTransportPolicy.appendCoreArgs(masque, "masque", useMasqueHttp2 = true)
        assertTrue(masque.contains("--turbo"))
        assertTrue(masque.contains("--fragment"))
        assertTrue(masque.windowed(2).contains(listOf("--validate-secs", "12")))
        assertTrue(masque.windowed(2).contains(listOf("--health-interval", "30")))
        assertTrue(masque.windowed(2).contains(listOf("--reconnect-secs", "2")))

        val wireGuard = mutableListOf("aether", "--wg", "--turbo")
        AndroidTransportPolicy.appendCoreArgs(wireGuard, "wireguard", useMasqueHttp2 = false)
        assertFalse(wireGuard.contains("--turbo"))
        assertEquals(1, wireGuard.count { it == "--ironclad" })
        assertTrue(wireGuard.contains("--no-profile-retry"))
        assertTrue(wireGuard.windowed(2).contains(listOf("--keepalive", "25")))
        assertTrue(wireGuard.windowed(2).contains(listOf("--wg-validate-secs", "12")))
        assertTrue(wireGuard.windowed(2).contains(listOf("--wg-health-interval", "30")))

        val gool = mutableListOf("aether", "--gool", "--balanced")
        AndroidTransportPolicy.appendCoreArgs(gool, "gool", useMasqueHttp2 = false)
        assertFalse(gool.contains("--balanced"))
        assertEquals(1, gool.count { it == "--ironclad" })
        assertTrue(gool.contains("--no-profile-retry"))
        assertTrue(gool.windowed(2).contains(listOf("--wg-validate-secs", "25")))
        assertTrue(gool.windowed(2).contains(listOf("--wg-startup-secs", "45")))
        assertTrue(gool.windowed(2).contains(listOf("--wg-reconnect-secs", "2")))
        assertEquals(1280, AndroidTransportPolicy.TUN_MTU)
    }
}
