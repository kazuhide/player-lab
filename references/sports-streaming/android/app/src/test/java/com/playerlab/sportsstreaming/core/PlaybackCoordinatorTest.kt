package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class PlaybackCoordinatorTest {
    @Test fun lateArchiveReadinessCannotReplaceNewlySelectedClip() {
        val coordinator = PlaybackCoordinator()
        val live = coordinator.select("live", "local")
        val clip = coordinator.select("clip", "local")
        assertFalse(coordinator.isCurrent(live))
        assertTrue(coordinator.isCurrent(clip))
        assertFalse(coordinator.acceptLoaded(live, "live"))
    }
    @Test fun receiverChangeInvalidatesResponseEvenForSameAsset() {
        val coordinator = PlaybackCoordinator()
        val local = coordinator.select("live", "local")
        coordinator.changeDestination("cast:session-b")
        assertFalse(coordinator.isCurrent(local))
    }
    @Test fun duplicateNotificationCanScheduleOnlyOneHandoff() {
        val coordinator = PlaybackCoordinator()
        val token = coordinator.select("live", "local")
        assertTrue(coordinator.claimHandoff(token))
        assertFalse(coordinator.claimHandoff(token))
    }
    @Test fun endedEventDoesNotImplyArchiveReadiness() {
        val event = EventPlaybackState(EventStatus.ENDED, ArchiveStatus.PROCESSING)
        assertFalse(event.canOfferArchive)
        assertFalse(event.shouldInterruptLive)
        assertFalse(event.shouldAutoContinue(true, ArchivePosition.Available(10)))
    }
    @Test fun autoContinuationRequiresReadyMappedAndExplicitOptIn() {
        val state = EventPlaybackState(EventStatus.ENDED, ArchiveStatus.READY)
        assertFalse(state.shouldAutoContinue(false, ArchivePosition.Available(10)))
        assertFalse(state.shouldAutoContinue(true, ArchivePosition.Unmapped))
        assertFalse(state.shouldAutoContinue(true, ArchivePosition.End))
        assertTrue(state.shouldAutoContinue(true, ArchivePosition.Available(10)))
    }
    @Test fun readinessRetriesHaveFiniteBudget() {
        assertEquals(listOf(2_000L, 5_000L, 10_000L), ReadinessRetry.delaysMs)
        assertNull(ReadinessRetry.delayMs(3))
    }
    @Test fun liveSeekUsesFreshBoundsAtDispatch() {
        var window = LiveWindow(-120.0, -60.0)
        val controller = LiveSeekController { window }
        window = LiveWindow(-30.0, -20.0)
        assertEquals(-30.0, controller.seekBy(-15.0), 0.0)
        assertEquals(-5.0, controller.seekBy(15.0), 0.0)
    }
    @Test fun unknownOrExpiredReturnPositionDoesNotBecomeLiveEdge() {
        val window = LiveWindow(-30.0, -10.0)
        assertEquals(LiveReturn.Unknown, window.returnToUtc(null, 1_000_000))
        assertEquals(LiveReturn.Unknown, window.returnToUtc(980_000, null))
        assertEquals(LiveReturn.Expired, window.returnToUtc(900_000, 1_000_000))
        assertEquals(LiveReturn.Available(-20.0), window.returnToUtc(980_000, 1_000_000))
    }
    @Test fun diagnosticsAreBoundedAndRedactCredentials() {
        val log = DiagnosticLog()
        repeat(205) { log.add("load", "https://media.test/video?token=secret#private", it.toLong()) }
        assertEquals(200, log.entries.size)
        assertEquals(5L, log.entries.first().timestampMs)
        assertFalse(log.entries.any { it.detail.contains("secret") || it.detail.contains("private") })
    }
    @Test fun olderRefreshForSameEventCannotReplaceLatestReadyState() {
        val coordinator = PlaybackCoordinator()
        val selected = coordinator.select("live", "local")
        val guard = StatusRequestGuard()
        val first = guard.begin(selected)
        val second = guard.begin(selected)
        assertFalse(guard.isCurrent(first, coordinator.current))
        assertTrue(guard.isCurrent(second, coordinator.current))
        coordinator.changeDestination("cast:new-session")
        assertFalse(guard.isCurrent(second, coordinator.current))
    }
}
