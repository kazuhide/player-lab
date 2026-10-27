package com.playerlab.android

import org.junit.Assert.*
import org.junit.Test

class ApiCommandAvailabilityTest {
    @Test fun hostRendererCommandsRequireTheirInstalledRuntimeObject() {
        for (member in listOf("vr.VrRenderer.setSourceConfig()", "vr.VrRenderer.addUpdateCallback()", "vr.VrRenderer.removeUpdateCallback()")) {
            assertNotNull("$member requires the host renderer", apiCommandUnavailableReason("android:com.bitmovin.player.api.$member", ApiCommandCapabilities(), false))
        }
        assertNull(apiCommandUnavailableReason("android:com.bitmovin.player.api.vr.VrApi.setVrRenderer()", ApiCommandCapabilities(), false))
    }

    @Test fun nonnullRenderTargetsNeedCompatibleAttachedObjectsButNoneRemainsValid() {
        val empty = ApiCommandCapabilities()
        val view = empty.copy(viewAttached = true)
        for ((member, target) in listOf("setSurface()" to "SurfaceHolder", "setSurface()" to "Surface", "setTextureView()" to "Current TextureView", "setAdViewGroup()" to "Current PlayerView")) {
            val id = "android:com.bitmovin.player.api.Player.$member"
            assertNotNull("$member cannot use $target without its view", apiCommandUnavailableReason(id, empty, false, mapOf("target" to target)))
            if (member != "setAdViewGroup()") assertNotNull(apiCommandUnavailableReason(id, view, false, mapOf("target" to target)))
            assertNull("None is an independent cleanup route", apiCommandUnavailableReason(id, empty, false, mapOf("target" to "None")))
            assertNull("The chooser must leave the None route accessible", apiCommandUnavailableReason(id, empty, false))
        }
    }

    @Test fun rendererCallbacksRequireTheCurrentRendererAndSelectedKnownHandle() {
        val setSource = command("vr.VrRenderer.setSourceConfig()")
        val add = command("vr.VrRenderer.addUpdateCallback()")
        val remove = command("vr.VrRenderer.removeUpdateCallback()")
        val renderer = loaded.copy(vrRendererAvailable = true)
        assertNull(apiCommandUnavailableReason(setSource, renderer, false, mapOf("source" to "None")))
        assertNull(apiCommandUnavailableReason(add, renderer, false))
        assertNotNull(apiCommandUnavailableReason(remove, renderer, false))
        val registered = renderer.copy(vrCallbackHandles = setOf("current-callback"))
        assertNull(apiCommandUnavailableReason(remove, registered, false))
        assertNotNull(apiCommandUnavailableReason(remove, registered, false, mapOf("handle" to "previous-callback")))
        assertNull(apiCommandUnavailableReason(remove, registered, false, mapOf("handle" to "current-callback")))
        var calls = 0
        assertTrue(runCatching { runAvailableApiCommand(remove, registered.copy(vrRendererAvailable = false), false,
            mapOf("handle" to "current-callback")) { calls++ } }.isFailure)
        assertEquals(0, calls)
    }

    @Test fun renderTargetArgumentsFollowActualCompatibleObjectsAndRecheckAfterDetach() {
        val surface = command("Player.setSurface()")
        val texture = command("Player.setTextureView()")
        val ads = command("Player.setAdViewGroup()")
        val surfaceView = loaded.copy(viewAttached = true, surfaceReady = true)
        assertNull(apiCommandUnavailableReason(surface, surfaceView, false, mapOf("target" to "SurfaceHolder")))
        assertNull(apiCommandUnavailableReason(surface, surfaceView, false, mapOf("target" to "Surface")))
        assertNotNull(apiCommandUnavailableReason(texture, surfaceView, false, mapOf("target" to "Current TextureView")))
        val textureView = loaded.copy(viewAttached = true, textureViewAvailable = true)
        assertNull(apiCommandUnavailableReason(texture, textureView, false, mapOf("target" to "Current TextureView")))
        assertNotNull(apiCommandUnavailableReason(surface, textureView, false, mapOf("target" to "SurfaceHolder")))
        assertNull(apiCommandUnavailableReason(ads, textureView, false, mapOf("target" to "Current PlayerView")))
        var calls = 0
        val detached = surfaceView.copy(viewAttached = false)
        assertTrue(runCatching { runAvailableApiCommand(surface, detached, false, mapOf("target" to "Surface")) { calls++ } }.isFailure)
        assertEquals(0, calls)
        runAvailableApiCommand(surface, detached, false, mapOf("target" to "None")) { calls++ }
        assertEquals(1, calls)
    }

    @Test fun presentedPauseAdsCanBeDismissedWithoutLinearAdStateOrAnAdClock() {
        val ordinary = loaded.copy(activeAd = false, skippableAd = false)
        val presented = ordinary.copy(nonLinearAdPresented = true)
        for (member in listOf("Player.skipAd()", "advertising.AdvertisingApi.skip()")) {
            assertNotNull(reason(member, ordinary))
            assertNull(reason(member, presented))
            assertNotNull(reason(member, presented.copy(nonLinearAdPresented = false)))
            assertNotNull(reason(member, presented.copy(playerAvailable = false)))
            var calls = 0
            runAvailableApiCommand(command(member), presented, false) { calls++ }
            assertEquals(1, calls)
            assertTrue(runCatching { runAvailableApiCommand(command(member), ordinary, false) { calls++ } }.isFailure)
            assertEquals(1, calls)
        }
    }
    private val loaded = ApiCommandCapabilities(sourceAttached = true, sourceLoaded = true)
    private fun command(member: String) = "android:com.bitmovin.player.api.$member"
    private fun reason(member: String, state: ApiCommandCapabilities = loaded, manualSsai: Boolean = false) =
        apiCommandUnavailableReason(command(member), state, manualSsai)

    @Test fun ordinaryPlaybackCannotCreateOrSignalSsaiMetadataWithoutAnExplicitOptIn() {
        assertNotNull(apiCommandUnavailableReason("app:ssai-ad", loaded, false))
        assertNotNull(reason("ssai.SsaiApi.registerAdBreak()"))
        assertNull(apiCommandUnavailableReason("app:ssai-ad", loaded, true))
        assertNotNull(apiCommandUnavailableReason("app:ssai-ad", ApiCommandCapabilities(), true))
        assertNotNull(apiCommandUnavailableReason("app:ssai-ad", loaded.copy(casting = true), true))
    }

    @Test fun ssaiLifecycleFollowsActualActiveAdAndBreakState() {
        assertNotNull(reason("ssai.SsaiApi.startAd()", loaded.copy(hasSsaiAds = true), true))
        val activeBreak = loaded.copy(hasSsaiAds = true, hasSsaiBreaks = true, activeSsaiBreak = true)
        assertNull(reason("ssai.SsaiApi.startAd()", activeBreak, true))
        assertNotNull(reason("ssai.SsaiApi.finishAd()", activeBreak, true))
        val activeAd = activeBreak.copy(activeAd = true, activeSsaiAd = true)
        assertNull(reason("ssai.SsaiApi.finishAd()", activeAd, true))
        assertNull(reason("ssai.SsaiApi.reportAdQuartile()", activeAd, true))
        assertNull("Starting another SSAI ad replaces the current ad", reason("ssai.SsaiApi.startAd()", activeAd, true))
        assertNotNull(reason("ssai.SsaiApi.reportAdQuartile()", activeBreak, true))
        assertNotNull(reason("ssai.SsaiApi.finishAdBreak()", loaded, true))
        assertNull(reason("ssai.SsaiApi.finishAdBreak()", activeBreak, true))
    }

    @Test fun noOpAdCommandsRequireAnActiveCompatibleAdState() {
        assertNotNull(reason("advertising.AdvertisingApi.skip()"))
        assertNotNull(reason("Player.skipAd()", loaded.copy(activeAd = true)))
        assertNull(reason("advertising.AdvertisingApi.skip()", loaded.copy(activeAd = true, skippableAd = true)))
        assertNotNull(reason("advertising.Ad.expanded()"))
        assertNotNull(reason("advertising.Ad.expanded()", loaded.copy(activeAd = true)))
        assertNull(reason("advertising.Ad.expanded()", loaded.copy(activeAd = true, clientAdCallbacksAvailable = true)))
        assertNotNull(reason("advertising.Ad.expanded()", loaded.copy(activeAd = true, activeSsaiAd = true)))
        assertNotNull(reason("advertising.AdvertisingApi.schedule()", loaded.copy(casting = true)))
        assertNull(reason("advertising.AdvertisingApi.schedule()"))
    }

    @Test fun loadingUnloadAndCastingRetireOperationsWithoutReplacingTheirSelection() {
        val noSource = ApiCommandCapabilities()
        for (member in listOf("Player.play()", "Player.pause()", "Player.seek()", "source.Source.setAudioTrack()")) {
            assertNotNull(reason(member, noSource))
            assertNull(reason(member))
        }
        assertNotNull(reason("casting.RemoteControlApi.castVideo()"))
        assertNull(reason("casting.RemoteControlApi.castVideo()", loaded.copy(castAvailable = true)))
        assertNotNull(reason("casting.RemoteControlApi.castVideo()", loaded.copy(castAvailable = true, casting = true)))
        assertNotNull(reason("casting.RemoteControlApi.castStop()"))
        assertNull(reason("casting.RemoteControlApi.castStop()", loaded.copy(casting = true)))
    }

    @Test fun preloadingAndPlaybackCanStartBeforeAnAttachedSourceHasFinishedLoading() {
        val deferred = ApiCommandCapabilities(sourceAttached = true)
        for (member in listOf("Player.preload()", "Player.play()", "Player.pause()", "Player.unload()", "source.Source.setAudioTrack()")) {
            assertNull("An active session can accept $member before Ready", reason(member, deferred))
            assertNotNull(reason(member, ApiCommandCapabilities()))
        }
        assertNull(reason("ssai.SsaiApi.registerAdBreak()", deferred, true))
        assertNull(reason("advertising.AdvertisingApi.schedule()", deferred))
        assertNotNull(reason("Player.seek()", deferred))
        assertNotNull(reason("Player.timeShift()", deferred))
    }

    @Test fun liveAndVodOperationsFollowTheLoadedTimelineAndRewindConfiguration() {
        assertNotNull(reason("Player.timeShift()"))
        val live = loaded.copy(isLive = true)
        assertNotNull(reason("Player.seek()", live))
        assertNotNull(reason("Player.timeShift()", live))
        assertNull(reason("Player.timeShift()", live.copy(liveRewindAvailable = true)))
        assertNotNull(reason("live.LowLatencyApi.targetLatency"))
        assertNull(reason("live.LowLatencyApi.targetLatency", live))
    }

    @Test fun aStaleEnabledSelectionCannotExecuteAfterSourceUnloadOrAdCompletion() {
        var calls = 0
        val skip = command("advertising.AdvertisingApi.skip()")
        val active = loaded.copy(activeAd = true, skippableAd = true)
        assertNull(apiCommandUnavailableReason(skip, active, false))
        assertTrue(runCatching { runAvailableApiCommand(skip, loaded, false) { calls++ } }.isFailure)
        assertEquals(0, calls)
        runAvailableApiCommand(skip, active, false) { calls++ }
        assertEquals(1, calls)
        assertTrue(runCatching { runAvailableApiCommand(command("Player.play()"), ApiCommandCapabilities(), false) { calls++ } }.isFailure)
        assertEquals(1, calls)
    }

    @Test fun viewAndPlaylistCommandsRequireTheirCurrentTargets() {
        val enter = "android:com.bitmovin.player.PlayerView.enterFullscreen()"
        val exit = "android:com.bitmovin.player.PlayerView.exitFullscreen()"
        assertNotNull(apiCommandUnavailableReason(enter, loaded, false))
        val view = loaded.copy(viewAttached = true)
        assertNull(apiCommandUnavailableReason(enter, view, false))
        assertNotNull(apiCommandUnavailableReason(exit, view, false))
        assertNotNull(apiCommandUnavailableReason(enter, view.copy(fullscreen = true), false))
        assertNull(apiCommandUnavailableReason(exit, view.copy(fullscreen = true), false))
        assertNotNull(reason("playlist.PlaylistApi.seek()"))
        assertNull(reason("playlist.PlaylistApi.seek()", loaded.copy(playlistSize = 1)))
    }

    @Test fun detachingAViewKeepsTheReattachOperationAvailable() {
        val player = "android:com.bitmovin.player.PlayerView.player"
        assertNotNull(apiCommandUnavailableReason(player, loaded, false))
        val retained = loaded.copy(viewRecoverable = true)
        assertNull(apiCommandUnavailableReason(player, retained, false))
        assertNotNull(apiCommandUnavailableReason("android:com.bitmovin.player.PlayerView.enterFullscreen()", retained, false))
        var calls = 0
        runAvailableApiCommand(player, retained, false) { calls++ }
        assertEquals(1, calls)
        assertNull(apiCommandUnavailableReason(player, retained.copy(viewAttached = true), false))
    }

    @Test fun customMessagesAndNagraPreloadingRequireTheirActualConfiguredObjects() {
        assertNotNull(apiCommandUnavailableReason("app:custom-message-send", loaded, false))
        assertNull(apiCommandUnavailableReason("app:custom-message-send", loaded.copy(customMessageHandlerInstalled = true), false))
        assertNotNull(reason("Player.preloadDrmLicense()"))
        assertNull("DRM preloading does not require an active media session", reason("Player.preloadDrmLicense()", ApiCommandCapabilities(nagraConfigured = true)))
    }

    @Test fun trackMethodsRequireAnAttachedSourceWithoutProhibitingNullOrClearValues() {
        val members = listOf("Player.setAudio()", "Player.setAudioQuality()", "Player.setVideoQuality()", "Player.removeSubtitle()", "Player.setSubtitle()",
            "source.Source.setAudioTrack()", "source.Source.setSubtitleTrack()", "source.Source.removeSubtitleTrack()")
        for (member in members) {
            assertNotNull(reason(member, ApiCommandCapabilities()))
            assertNull(reason(member, loaded))
        }
        assertNull(apiCommandUnavailableReason(command("Player.setSubtitle()"), loaded, false, mapOf("trackId" to "")))
        assertNull(apiCommandUnavailableReason(command("source.Source.setSubtitleTrack()"), loaded, false, mapOf("trackId" to "")))
    }

    @Test fun orientationOperationsUseTheSelectedProviderButKeepNullableSettersAvailable() {
        val enable = command("vr.orientation.OrientationProvider.enable()")
        val touchOnly = loaded.copy(touchProviderAvailable = true)
        assertNotNull(apiCommandUnavailableReason(enable, loaded, false))
        assertNull("The chooser must allow an operation with at least one supported target", apiCommandUnavailableReason(enable, touchOnly, false))
        assertNotNull(apiCommandUnavailableReason(enable, touchOnly, false, mapOf("provider" to "gyroscopic")))
        assertNull(apiCommandUnavailableReason(enable, touchOnly, false, mapOf("provider" to "touch")))
        var calls = 0
        assertTrue(runCatching { runAvailableApiCommand(enable, touchOnly, false, mapOf("provider" to "gyroscopic")) { calls++ } }.isFailure)
        assertEquals(0, calls)
        runAvailableApiCommand(enable, touchOnly, false, mapOf("provider" to "touch")) { calls++ }
        assertEquals(1, calls)
        assertNull(apiCommandUnavailableReason(command("vr.VrApi.gyroscopicOrientationProvider"), loaded, false, mapOf("mode" to "None")))
    }
}
