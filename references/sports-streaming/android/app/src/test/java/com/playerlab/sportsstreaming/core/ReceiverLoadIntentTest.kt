package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class ReceiverLoadIntentTest {
    private val request = PlaybackRequest(1, "clip-b", "cast:session")
    @Test fun requestedPlayIsAppliedOnceAfterTargetReportsPaused() {
        val intent = ReceiverLoadIntent(request, true)
        assertEquals(ReceiverTransport.PLAY, intent.observe(request, true, false, true))
        assertNull(intent.observe(request, true, false, true))
        assertFalse(intent.fulfilled)
        assertNull(intent.observe(request, true, true, false))
        assertTrue(intent.fulfilled)
    }
    @Test fun requestedPauseNeverBecomesAutomaticPlay() {
        val intent = ReceiverLoadIntent(request, false)
        assertEquals(ReceiverTransport.PAUSE, intent.observe(request, true, true, false))
        assertNull(intent.observe(request, true, true, false))
        assertNull(intent.observe(request, true, false, true))
        assertTrue(intent.fulfilled)
    }
    @Test fun previousSourceAndStaleOperationCannotReceiveTransportCommands() {
        val intent = ReceiverLoadIntent(request, true)
        assertNull(intent.observe(request, false, false, true))
        assertNull(intent.observe(request.copy(generation = 2), true, false, true))
        assertEquals(ReceiverTransport.PLAY, intent.observe(request, true, false, true))
    }
    @Test fun loadingOrIdleStatusIsNotReadinessOrSuccess() {
        val intent = ReceiverLoadIntent(request, true)
        assertNull(intent.observe(request, true, false, false))
        assertFalse(intent.fulfilled)
    }
    @Test fun observingPausedTargetOnlyQueuesUntilDeferredDispatch() {
        val intent = ReceiverLoadIntent(request, true)
        assertEquals(ReceiverTransport.PLAY, intent.observe(request, true, false, true))
        assertTrue(intent.commandQueued)
        assertFalse(intent.commandSent)
        assertEquals(ReceiverTransport.PLAY, intent.dispatch(request, true, false, true))
        assertFalse(intent.commandQueued)
        assertTrue(intent.commandSent)
        assertFalse(intent.fulfilled)
        assertNull(intent.dispatch(request, true, false, true))
    }
    @Test fun deferredDispatchCannotControlAReplacedSourceOrRequest() {
        val intent = ReceiverLoadIntent(request, true)
        intent.observe(request, true, false, true)
        assertNull(intent.dispatch(request.copy(generation = 9), true, false, true))
        assertFalse(intent.commandSent)
        val other = ReceiverLoadIntent(request, false)
        other.observe(request, true, true, false)
        assertNull(other.dispatch(request, false, true, false))
        assertFalse(other.commandSent)
    }
    @Test fun receiverConfirmationBeforeDeferredDispatchNeedsNoCommand() {
        val intent = ReceiverLoadIntent(request, true)
        intent.observe(request, true, false, true)
        intent.observe(request, true, true, false)
        assertTrue(intent.fulfilled)
        assertNull(intent.dispatch(request, true, true, false))
        assertFalse(intent.commandSent)
    }
    @Test fun temporarilyUnreadyDeferredStatusCanBeReobservedWithoutSending() {
        val intent = ReceiverLoadIntent(request, true)
        intent.observe(request, true, false, true)
        assertNull(intent.dispatch(request, true, false, false))
        assertFalse(intent.commandQueued)
        assertFalse(intent.commandSent)
        assertEquals(ReceiverTransport.PLAY, intent.observe(request, true, false, true))
        assertEquals(ReceiverTransport.PLAY, intent.dispatch(request, true, false, true))
    }
    @Test fun reconnectDuringLoadRebindsTheRequestedIntentAndRejectsTheOldGeneration() {
        val initial = ReceiverLoadIntent(request, false)
        initial.observe(request, true, true, false)
        val connected = request.copy(generation = 5)
        val rebound = initial.rebind(connected)
        assertEquals(connected, rebound.request)
        assertFalse(rebound.playWhenReady)
        assertNull(rebound.observe(request, true, true, false))
        assertEquals(ReceiverTransport.PAUSE, rebound.observe(connected, true, true, false))
        assertEquals(ReceiverTransport.PAUSE, rebound.dispatch(connected, true, true, false))
        assertNull(rebound.observe(connected, true, false, true))
        assertTrue(rebound.fulfilled)
    }
}
