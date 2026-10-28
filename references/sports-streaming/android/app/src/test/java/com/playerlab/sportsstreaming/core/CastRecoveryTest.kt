package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class CastRecoveryTest {
    @Test fun disconnectedUnknownReceiverPositionRequiresUserChoice() {
        val state = CastRecovery()
        state.connecting("session-a")
        state.connected("session-a")
        state.disconnected("session-a")
        assertEquals(CastConnection.DISCONNECTED, state.connection)
        assertTrue(state.needsLocalReturnChoice)
        assertNull(state.lastObservedPositionMs)
        assertNull(state.localResumePosition())
    }
    @Test fun stalePositionFromPreviousSessionIsRejected() {
        val state = CastRecovery()
        state.connecting("session-a")
        state.connected("session-a")
        state.connecting("session-b")
        assertFalse(state.observe("session-a", "SP-LIVE-S", 40_000))
        assertNull(state.lastObservedPositionMs)
    }
    @Test fun actualReceiverObservationCanOfferExplicitLocalResume() {
        val state = CastRecovery()
        state.connecting("session-a")
        state.connected("session-a")
        assertTrue(state.observe("session-a", "SP-ARCH-S", 40_000))
        state.disconnected("session-a")
        assertEquals(40_000L, state.localResumePosition())
        assertTrue(state.needsLocalReturnChoice)
    }
    @Test fun reconnectingDoesNotSelectLocalPlayback() {
        val state = CastRecovery()
        state.connecting("session-a")
        state.connected("session-a")
        state.reconnecting("session-a")
        assertEquals(CastConnection.RECONNECTING, state.connection)
        assertFalse(state.needsLocalReturnChoice)
    }
    @Test fun staleConnectionCallbackCannotTakeBackExplicitLocalDestination() {
        val state = CastRecovery()
        state.connecting("session-a")
        state.connected("session-a")
        state.disconnected("session-a")
        state.acknowledgeLocalChoice()
        state.connected("session-a")
        state.reconnecting("session-a")
        assertEquals(CastConnection.DISCONNECTED, state.connection)
    }
}
