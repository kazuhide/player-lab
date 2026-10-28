package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class ReceiverLoadGuardTest {
    private val request = PlaybackRequest(4, "clip-a", "cast:receiver")
    private fun accepts(guard: ReceiverLoadGuard, token: String?, mediaId: Long? = 10,
                        current: PlaybackRequest? = request, connection: String = "receiver") =
        guard.accepts(current, request, "receiver", connection, mediaId, token, true)

    @Test fun sameUrlReselectionCannotConfirmThePreviousSourceLoad() {
        val guard = ReceiverLoadGuard("new-source")
        assertFalse(accepts(guard, "old-source", 9))
        assertTrue(accepts(guard, "new-source", 10))
        assertEquals(10L, guard.mediaSessionId)
    }
    @Test fun rapidAToBToARejectsTheUnobservedIntermediateSameUrlLoad() {
        val guard = ReceiverLoadGuard("a-third-load")
        assertFalse(accepts(guard, "a-first-load", 9))
        assertFalse(accepts(guard, "a-second-load", 10))
        assertTrue(accepts(guard, "a-third-load", 11))
        assertFalse(accepts(guard, "a-third-load", 10))
    }
    @Test fun missingIdentityAndReplacedConnectionsOrRequestsStayUnconfirmed() {
        val guard = ReceiverLoadGuard("source")
        assertFalse(accepts(guard, null))
        assertFalse(accepts(guard, "source", null))
        assertFalse(accepts(guard, "source", 0))
        assertFalse(accepts(guard, "source", current = request.copy(generation = 5)))
        assertFalse(accepts(guard, "source", connection = "old-receiver"))
        assertTrue(accepts(guard, "source"))
    }
    @Test fun receiverFailureCannotBeClearedByLaterHealthyStatusForTheSameSource() {
        val guard = ReceiverLoadGuard("source")
        assertTrue(accepts(guard, "source"))
        assertTrue(guard.fail(request, request, "receiver", "receiver", 10, "source", true))
        assertTrue(guard.failed)
        assertFalse(accepts(guard, "source"))
        assertTrue(accepts(ReceiverLoadGuard("retry-source"), "retry-source", 11))
    }
    @Test fun staleReceiverErrorsDoNotFailTheReplacementSource() {
        val guard = ReceiverLoadGuard("new-source")
        assertFalse(guard.fail(request, request, "receiver", "receiver", 9, "old-source", true))
        assertFalse(guard.failed)
        assertTrue(accepts(guard, "new-source"))
    }
}
