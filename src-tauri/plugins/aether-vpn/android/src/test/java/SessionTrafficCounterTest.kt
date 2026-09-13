package com.cluvexstudio.aethergui.vpn

import org.junit.Assert.assertEquals
import org.junit.Test

class SessionTrafficCounterTest {
    @Test
    fun firstSampleOnlyEstablishesSessionBaseline() {
        val counter = SessionTrafficCounter()

        assertEquals(
            FinalNativeTraffic(),
            counter.sample(FinalNativeTraffic(receivedBytes = 8_000_000, sentBytes = 4_000_000)),
        )
    }

    @Test
    fun reportsOnlyGrowthAfterTheBaseline() {
        val counter = SessionTrafficCounter()
        counter.sample(FinalNativeTraffic(receivedBytes = 8_000, sentBytes = 4_000))

        assertEquals(
            FinalNativeTraffic(receivedBytes = 250, sentBytes = 75),
            counter.sample(FinalNativeTraffic(receivedBytes = 8_250, sentBytes = 4_075)),
        )
    }

    @Test
    fun counterResetDoesNotBackfillOldTunnelBytes() {
        val counter = SessionTrafficCounter()
        counter.sample(FinalNativeTraffic(receivedBytes = 8_000, sentBytes = 4_000))
        counter.sample(FinalNativeTraffic(receivedBytes = 8_250, sentBytes = 4_075))

        assertEquals(
            FinalNativeTraffic(receivedBytes = 250, sentBytes = 75),
            counter.sample(FinalNativeTraffic(receivedBytes = 100, sentBytes = 50)),
        )
        assertEquals(
            FinalNativeTraffic(receivedBytes = 300, sentBytes = 100),
            counter.sample(FinalNativeTraffic(receivedBytes = 150, sentBytes = 75)),
        )
    }

    @Test
    fun resetStartsANewSessionWithoutCarryingPriorBytes() {
        val counter = SessionTrafficCounter()
        counter.sample(FinalNativeTraffic(receivedBytes = 1_000, sentBytes = 500))
        counter.sample(FinalNativeTraffic(receivedBytes = 1_400, sentBytes = 700))
        counter.reset()

        assertEquals(
            FinalNativeTraffic(),
            counter.sample(FinalNativeTraffic(receivedBytes = 5_000, sentBytes = 3_000)),
        )
    }
}
