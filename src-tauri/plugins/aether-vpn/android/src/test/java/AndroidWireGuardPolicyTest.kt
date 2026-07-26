package com.cluvexstudio.aethergui.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidWireGuardPolicyTest {
    @Test
    fun wireGuardTimeoutsExceedCoreScannerBudgets() {
        assertEquals(90_000L, AndroidWireGuardPolicy.startupTimeoutMs("wireguard", "turbo"))
        assertEquals(180_000L, AndroidWireGuardPolicy.startupTimeoutMs("wireguard", "balanced"))
        assertEquals(270_000L, AndroidWireGuardPolicy.startupTimeoutMs("wireguard", "stealth"))
        assertEquals(330_000L, AndroidWireGuardPolicy.startupTimeoutMs("wireguard", "thorough"))
        assertEquals(390_000L, AndroidWireGuardPolicy.startupTimeoutMs("wireguard", "ironclad"))
    }

    @Test
    fun goolUsesTheSameOuterWireGuardGuardrails() {
        assertTrue(AndroidWireGuardPolicy.isWireGuardFamily("gool"))
        assertEquals(180_000L, AndroidWireGuardPolicy.startupTimeoutMs("gool", "balanced"))
    }

    @Test
    fun masqueKeepsItsExistingStartupDeadline() {
        assertFalse(AndroidWireGuardPolicy.isWireGuardFamily("masque"))
        assertEquals(50_000L, AndroidWireGuardPolicy.startupTimeoutMs("masque", "balanced"))
    }

    @Test
    fun wireGuardRuntimeArgsAreExplicitAndStable() {
        val command = mutableListOf("aether", "--wg")
        AndroidWireGuardPolicy.appendCoreArgs(command, "wireguard")

        assertTrue(command.windowed(2).contains(listOf("--keepalive", "5")))
        assertTrue(command.windowed(2).contains(listOf("--wg-validate-secs", "12")))
        assertTrue(command.windowed(2).contains(listOf("--wg-health-interval", "15")))
        assertTrue(command.windowed(2).contains(listOf("--wg-stale-secs", "60")))
        assertTrue(command.windowed(2).contains(listOf("--wg-startup-secs", "45")))
        assertTrue(command.windowed(2).contains(listOf("--wg-reconnect-secs", "2")))
        assertEquals(1280, AndroidWireGuardPolicy.TUN_MTU)
    }
}
