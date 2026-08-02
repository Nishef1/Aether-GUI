package com.cluvexstudio.aethergui.vpn

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ServiceSessionGateTest {
    @Test
    fun cancelInvalidatesAnInFlightStart() {
        val gate = ServiceSessionGate()
        val first = gate.begin()
        assertTrue(gate.isActive(first))
        gate.cancel()
        assertFalse(gate.isActive(first))
        assertTrue(gate.isCancelled())
    }

    @Test
    fun newerStartInvalidatesOlderWorker() {
        val gate = ServiceSessionGate()
        val first = gate.begin()
        val second = gate.begin()
        assertNotEquals(first, second)
        assertFalse(gate.isActive(first))
        assertTrue(gate.isActive(second))
    }
}
