package com.playerlab.elearning

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Before

abstract class LearningPlaybackScenario {
    @Before fun resetLocalDemoState() {
        ApplicationProvider.getApplicationContext<android.content.Context>()
            .getSharedPreferences("learning-progress", android.content.Context.MODE_PRIVATE).edit().clear().commit()
    }
    protected fun launch() = ActivityScenario.launch<MainActivity>(Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java).apply {
        InstrumentationRegistry.getArguments().getString("mediaBaseUrl")?.let { putExtra("mediaBaseUrl", it) }
    })
    protected fun await(scenario: ActivityScenario<MainActivity>, message: String, predicate: (PlaybackSession) -> Boolean) {
        val deadline = System.nanoTime() + 35_000_000_000L
        do {
            var ready = false
            var error: String? = null
            scenario.onActivity { ready = predicate(it.sessionForTest()); error = it.sessionForTest().errorCode }
            if (ready) return
            assertNull("Unexpected playback error", error)
            Thread.sleep(100)
        } while (System.nanoTime() < deadline)
        var detail = ""
        scenario.onActivity { activity ->
            val session = activity.sessionForTest()
            detail = "tracks=" + session.player.source?.availableSubtitleTracks?.map { it.language } +
                ", transcriptLoading=" + session.transcriptLoading + ", transcriptFailed=" + session.transcriptFailed
        }
        fail("$message ($detail)")
    }
    protected fun start(scenario: ActivityScenario<MainActivity>, id: String = "EDU-FX-01", autoAdvance: Boolean = false,
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
}
