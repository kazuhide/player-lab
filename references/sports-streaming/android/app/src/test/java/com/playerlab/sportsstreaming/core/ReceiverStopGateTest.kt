package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class ReceiverStopGateTest {
    private val request = PlaybackRequest(3, "clip-a", "cast:receiver")
    private val proof = ReceiverStopProof("receiver", 6, 10, "old-source", cancelled = true, mediaCleared = false)
    private fun gate() = ReceiverStopGate("receiver", 10, "old-source", 5, 1_000)
    @Test fun freshBoundCancelledStatusPermitsTheSdkOwnedReplacementLoad() {
        assertTrue(gate().accepts(proof, request, request, 1_500))
    }
    @Test fun cachedStatusAndUnrelatedMediaCannotReleaseThePendingLoad() {
        assertFalse(gate().accepts(proof.copy(statusRevision = 5), request, request, 1_500))
        assertFalse(gate().accepts(proof.copy(sourceLoadToken = "other", mediaSessionId = 20), request, request, 1_500))
        assertFalse(gate().accepts(proof.copy(connectionId = "old-receiver"), request, request, 1_500))
        assertFalse(gate().accepts(proof.copy(cancelled = false), request, request, 1_500))
    }
    @Test fun aConfirmedClearedMediaQueueIsDistinctFromUnknownIdentity() {
        val noMedia = proof.copy(sourceLoadToken = null, mediaSessionId = null)
        assertFalse(gate().accepts(noMedia, request, request, 1_500))
        assertTrue(gate().accepts(noMedia.copy(cancelled = false, mediaCleared = true), request, request, 1_500))
    }
    @Test fun replacementRequestsAndTimeoutCannotDispatchAStaleOrUnboundedLoad() {
        val oldRequest = request.copy(generation = 2)
        assertFalse(gate().accepts(proof, request, oldRequest, 1_500))
        assertTrue(gate().accepts(proof, request, request, 1_500))
        assertFalse(gate().accepts(proof, request, request, 21_000))
        assertTrue(gate().expired(21_000))
    }
}
