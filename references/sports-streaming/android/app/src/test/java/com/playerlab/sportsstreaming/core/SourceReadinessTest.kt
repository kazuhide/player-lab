package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class SourceReadinessTest {
    private val request = PlaybackRequest(1, "clip-a", "local")
    @Test fun loadedMetadataDoesNotEnablePlaybackCommands() {
        val readiness = SourceReadiness("source", request)
        readiness.onLoaded("source", request)
        assertFalse(readiness.isReady)
        readiness.onReady("source", request)
        assertTrue(readiness.isReady)
    }
    @Test fun readinessAlsoRequiresMetadataForTheSameSourceAndRequest() {
        val readiness = SourceReadiness("source", request)
        readiness.onReady("source", request)
        assertFalse(readiness.isReady)
        readiness.onLoaded("old-source", request)
        readiness.onLoaded("source", request.copy(generation = 2))
        assertFalse(readiness.isReady)
        readiness.onLoaded("source", request)
        assertTrue(readiness.isReady)
    }
    @Test fun failureStaysLatchedThroughLateLoadedAndReadyEventsUntilANewSource() {
        val readiness = SourceReadiness("source", request)
        readiness.fail()
        readiness.onLoaded("source", request)
        readiness.onReady("source", request)
        assertFalse(readiness.isReady)
        val retry = SourceReadiness("retry", request.copy(generation = 2))
        retry.onLoaded("retry", request.copy(generation = 2))
        assertFalse(retry.isReady)
        retry.onReady("retry", request.copy(generation = 2))
        assertTrue(retry.isReady)
    }
    @Test fun changingDestinationRebindsTheSameSourcesOutstandingReadiness() {
        val readiness = SourceReadiness("source", request)
        readiness.onLoaded("source", request)
        val connected = request.copy(generation = 2, destination = "cast:session")
        readiness.rebind(request, connected)
        readiness.onReady("source", request)
        assertFalse(readiness.isReady)
        readiness.onReady("source", connected)
        assertFalse(readiness.isReady)
        readiness.onReceiverPlayable("source", connected)
        assertTrue(readiness.isReady)
    }
    @Test fun nativeReadyCannotStandInForTheReceiverActuallyLoadingTheSource() {
        val cast = request.copy(destination = "cast:session")
        val readiness = SourceReadiness("source", cast)
        readiness.onLoaded("source", cast)
        readiness.onReady("source", cast)
        assertFalse(readiness.isReady)
        readiness.onReceiverPlayable("old-source", cast)
        assertFalse(readiness.isReady)
        readiness.onReceiverPlayable("source", cast)
        assertTrue(readiness.isReady)
    }
    @Test fun actualBoundReceiverStatusIsReadyWithoutInventingALocalSdkReadyEvent() {
        val cast = request.copy(destination = "cast:session")
        val readiness = SourceReadiness("source", cast)
        assertFalse(readiness.isReady)
        readiness.onReceiverPlayable("source", cast)
        assertTrue(readiness.isReady)
        val reconnected = cast.copy(generation = 2)
        readiness.rebind(cast, reconnected)
        assertFalse(readiness.isReady)
        readiness.onReceiverPlayable("source", cast)
        assertFalse(readiness.isReady)
        readiness.onReceiverPlayable("source", reconnected)
        assertTrue(readiness.isReady)
        readiness.fail()
        readiness.onReceiverPlayable("source", reconnected)
        assertFalse(readiness.isReady)
    }
}
