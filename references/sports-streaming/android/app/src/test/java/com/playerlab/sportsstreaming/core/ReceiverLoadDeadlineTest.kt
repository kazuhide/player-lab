package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class ReceiverLoadDeadlineTest {
    private val scope = ReceiverRequestScope(PlaybackRequest(3, "SP-ARCH-S", "cast:receiver"), "receiver", "source-a")
    private fun deadline() = ReceiverLoadDeadline(1_000, initialScope = scope)
    @Test fun missingLoadConfirmationExpiresAfterItsActualDispatchDeadline() {
        assertFalse(deadline().expired(scope, 45_999, waiting = true))
        assertTrue(deadline().expired(scope, 46_000, waiting = true))
    }
    @Test fun completedLoadsAndDifferentSourceRequestOrConnectionCannotFail() {
        val guard = deadline()
        assertFalse(guard.expired(scope, 50_000, waiting = false))
        assertFalse(guard.expired(scope.copy(sourceToken = "source-b"), 50_000, true))
        assertFalse(guard.expired(scope.copy(connectionId = "old-receiver"), 50_000, true))
        assertFalse(guard.expired(scope.copy(request = scope.request.copy(generation = 4)), 50_000, true))
        assertFalse(guard.expired(scope, 999, true))
    }
    @Test fun reconnectRebindPreservesTheOriginalDeadlineAndSource() {
        val guard = deadline()
        val resumed = scope.copy(request = scope.request.copy(generation = 4))
        guard.rebind(scope, resumed)
        assertFalse(guard.expired(scope, 50_000, true))
        assertTrue(guard.expired(resumed, 50_000, true))
        val otherSource = resumed.copy(sourceToken = "source-b")
        guard.rebind(resumed, otherSource)
        assertEquals(resumed, guard.scope)
    }
}
