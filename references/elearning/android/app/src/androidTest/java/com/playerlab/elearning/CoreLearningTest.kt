package com.playerlab.elearning

import android.content.Intent
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CoreLearningTest {
    @Before fun resetLocalDemoState() {
        ApplicationProvider.getApplicationContext<android.content.Context>()
            .getSharedPreferences("learning-progress", android.content.Context.MODE_PRIVATE).edit().clear().commit()
    }
    private fun launch() = ActivityScenario.launch<MainActivity>(Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java).apply {
        InstrumentationRegistry.getArguments().getString("mediaBaseUrl")?.let { putExtra("mediaBaseUrl", it) }
    })
    private fun await(scenario: ActivityScenario<MainActivity>, message: String, predicate: (PlaybackSession) -> Boolean) {
        val deadline = System.nanoTime() + 35_000_000_000L
        do {
            var ready = false
            var error: String? = null
            scenario.onActivity { ready = predicate(it.sessionForTest()); error = it.sessionForTest().errorCode }
            if (ready) return
            assertNull("Unexpected playback error", error)
            Thread.sleep(100)
        } while (System.nanoTime() < deadline)
        fail(message)
    }
    private fun start(scenario: ActivityScenario<MainActivity>, id: String = "EDU-FX-01", autoAdvance: Boolean = false,
                      delivery: CaptionDelivery = CaptionDelivery.EXTERNAL, play: Boolean = false, formatOverride: StreamFormat? = null) {
        await(scenario, "Catalog or local progress did not load") { it.catalog != null && !it.progressLoading }
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            val format = formatOverride ?: if (InstrumentationRegistry.getArguments().getString("streamFormat") == "dash") StreamFormat.DASH else StreamFormat.HLS
            setFormat(format)
            setAutoAdvance(autoAdvance)
            if (delivery == CaptionDelivery.MANIFEST) setCaptionDelivery(delivery)
            startLesson(id, play = play)
        } }
        await(scenario, "Lesson did not become ready") { it.activeItem?.lesson?.id == id && it.player.duration.isFinite() && it.player.duration > 0 && it.playbackReady }
    }

    @Test fun subtitlesOffLeavesTimedTranscriptSearchAndSeekAvailable(): Unit = launch().use { scenario ->
        start(scenario)
        await(scenario, "External subtitle tracks or timed text missing") { it.player.source?.availableSubtitleTracks?.size == 2 && !it.transcriptLoading }
        var sourceIdentity = 0
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            sourceIdentity = System.identityHashCode(player.source)
            setSubtitle(preferences.subtitle.copy(enabled = false))
            val matches = transcript.search("Read the numbers", "en")
            assertTrue(matches.isNotEmpty())
            seek(matches.first().startMs)
        } }
        await(scenario, "Transcript result did not seek") { it.positionMs in 9_000..11_000 }
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            assertNull(player.source?.selectedSubtitleTrack)
            assertEquals(sourceIdentity, System.identityHashCode(player.source))
            assertTrue(transcript.search("数", "ja").isNotEmpty())
        } }
    }

    @Test fun naturalPlaylistTransitionKeepsRateAndClearsUnavailableCaption(): Unit = launch().use { scenario ->
        start(scenario, "EDU-FX-02", autoAdvance = true)
        var seekSetup = ""
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            seekSetup = "controlReady=$playbackReady duration=${player.duration} positionMs=$positionMs"
            setSpeed(1.5f)
            setSubtitle(SubtitlePreference(true, "ja"))
            seek(778_000)
            player.play()
        } }
        await(scenario, "Playlist did not naturally advance to the summary; seekSetup=$seekSetup") { it.activeItem?.lesson?.id == "EDU-FX-03" && it.player.duration in 7.0..9.0 && it.playbackReady }
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            assertEquals(StartOrigin.PLAYLIST, activeItem?.origin)
            assertEquals(1.5f, player.playbackSpeed, 0f)
            assertEquals("ja", preferences.subtitle.language)
            assertTrue(preferences.subtitle.enabled)
            assertNull(player.source?.selectedSubtitleTrack)
            assertTrue(player.source?.availableSubtitleTracks.orEmpty().isEmpty())
        } }
    }

    @Test fun autoAdvanceOffStopsAtTheSelectedMiddleLesson(): Unit = launch().use { scenario ->
        start(scenario, "EDU-FX-02")
        var seekSetup = ""
        scenario.onActivity { it.sessionForTest().apply {
            seekSetup = "controlReady=$playbackReady duration=${player.duration} positionMs=$positionMs"
            seek(779_000); player.play()
        } }
        await(scenario, "Single lesson did not finish; seekSetup=$seekSetup") { it.diagnostics.entries().any { entry -> entry.kind == DiagnosticKind.PLAYBACK_FINISHED } }
        scenario.onActivity { it.sessionForTest().apply {
            assertEquals("EDU-FX-02", activeItem?.lesson?.id)
            assertFalse(player.isPlaying)
        } }
    }

    @Test fun manualNextReloadsTargetWithFixedPlaylistOrigin(): Unit = launch().use { scenario ->
        start(scenario)
        var previousSource = 0
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            previousSource = System.identityHashCode(player.source)
            adjacent(1)
        } }
        await(scenario, "Manual next did not load the exercises") { it.activeItem?.lesson?.id == "EDU-FX-02" && it.player.duration in 779.0..781.0 }
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            assertEquals(StartOrigin.PLAYLIST, activeItem?.origin)
            assertNotEquals(previousSource, System.identityHashCode(player.source))
            assertFalse(preferences.autoAdvance)
        } }
    }

    @Test fun learnerSwitchSeparatesPlayerAndDurableResumeIdentity(): Unit = launch().use { scenario ->
        start(scenario, "EDU-FX-02")
        var firstPlayer = 0
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            firstPlayer = System.identityHashCode(player)
            setSpeed(1.5f)
            setSubtitle(SubtitlePreference(true, "ja"))
            seek(754_000)
        } }
        await(scenario, "12:34 checkpoint not reached") { it.positionMs in 753_000..755_000 }
        scenario.moveToState(Lifecycle.State.CREATED)
        await(scenario, "Pause did not durably save the checkpoint") { (it.resumes["EDU-FX-02"]?.positionMs ?: -1) in 753_000..755_000 }
        scenario.moveToState(Lifecycle.State.RESUMED)
        scenario.onActivity { it.sessionForTest().switchLearner(Learner.B) }
        await(scenario, "Learner B progress did not load") { it.learner == Learner.B && !it.progressLoading }
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            assertNotEquals(firstPlayer, System.identityHashCode(player))
            assertTrue(resumes.isEmpty())
            switchLearner(Learner.A)
        } }
        await(scenario, "Learner A checkpoint was not retained") { it.learner == Learner.A && !it.progressLoading && (it.resumes["EDU-FX-02"]?.positionMs ?: -1) in 753_000..755_000 }
        scenario.onActivity { it.sessionForTest().startLesson("EDU-FX-02", resume = true, play = false) }
        await(scenario, "Explicit resume did not restore 12:34") { it.player.duration > 0 && it.positionMs in 753_000..755_000 && it.playbackReady }
        scenario.onActivity { it.sessionForTest().apply {
            assertEquals(1.5f, player.playbackSpeed, 0f)
            assertEquals("ja", preferences.subtitle.language)
            assertFalse(player.isPlaying)
        } }
    }

    @Test fun hlsManifestCaptionsDoNotAlsoAttachExternalTracks(): Unit = launch().use { scenario ->
        start(scenario, delivery = CaptionDelivery.MANIFEST, formatOverride = StreamFormat.HLS)
        await(scenario, "Manifest caption tracks did not load") { it.player.source?.availableSubtitleTracks?.size == 2 }
        scenario.onActivity { it.sessionForTest().apply {
            assertTrue(player.source?.config?.subtitleTracks.orEmpty().isEmpty())
            assertEquals(setOf("en", "ja"), player.source?.availableSubtitleTracks.orEmpty().map { it.language }.toSet())
        } }
    }
}
