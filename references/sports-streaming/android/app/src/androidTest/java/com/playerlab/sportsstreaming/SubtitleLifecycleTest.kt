package com.playerlab.sportsstreaming

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.source.Source
import com.bitmovin.player.api.source.SourceType
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

@RunWith(AndroidJUnit4::class)
class SubtitleLifecycleTest {
    @Test fun completedSourceClearsItsCueAndReplayRendersAgain() {
        withPlayer(overhangingCue = true) { scenario, _, _ ->
            var finished = false
            val listener: (PlayerEvent.PlaybackFinished) -> Unit = { finished = true }
            scenario.onActivity { it.playbackForTest().player.on(PlayerEvent.PlaybackFinished::class, listener) }
            try {
                selectCaption(scenario)
                waitFor(scenario) { hasCaption(it) }
                waitFor(scenario) { it.playbackForTest().player.currentTime >= 18.0 && hasCaption(it) }
                waitFor(scenario) { finished && !it.playbackForTest().player.isPlaying }
                waitFor(scenario, 3_000) { !hasCaption(it) }
                seekAndWait(scenario, 0.0)
                scenario.onActivity { it.playbackForTest().player.play() }
                waitFor(scenario) { it.playbackForTest().player.isPlaying && it.playbackForTest().player.currentTime > 0.2 && hasCaption(it) }
            } finally { scenario.onActivity { it.playbackForTest().player.off(PlayerEvent.PlaybackFinished::class, listener) } }
        }
    }
    @Test fun aNewSourceRendersCaptionsAfterAFatalSourceFailure() {
        withPlayer { scenario, sourceUrl, subtitleUrl ->
            selectCaption(scenario)
            waitFor(scenario) { hasCaption(it) }
            val type = if (sourceUrl.substringBefore('?').endsWith(".mpd")) SourceType.Dash else SourceType.Hls
            scenario.onActivity { it.playbackForTest().load(sourceUrl.substringBeforeLast('/') + "/missing-source.m3u8",
                "sports:caption-failure", type) }
            waitFor(scenario, checkError = false) { it.playbackForTest().lastErrorCode != null }
            scenario.onActivity { it.playbackForTest().load(sourceUrl, "sports:caption-recovery", type, subtitleUrl) }
            waitFor(scenario) { it.playbackForTest().player.isPlaying && !it.playbackForTest().state.value.loadingSource }
            selectCaption(scenario)
            waitFor(scenario) { hasCaption(it) }
        }
    }
    private fun selectCaption(scenario: ActivityScenario<MainActivity>) {
        waitFor(scenario) { it.playbackForTest().player.source?.availableSubtitleTracks?.any { track -> track.id == "test-en" } == true }
        scenario.onActivity { it.playbackForTest().player.source?.setSubtitleTrack("test-en") }
        waitFor(scenario) { it.playbackForTest().player.source?.selectedSubtitleTrack?.id == "test-en" }
    }
    private fun hasCaption(activity: MainActivity): Boolean {
        val view = activity.nativeSubtitleViewForTest()
        if (!view.isShown || view.width <= 0 || view.height <= 0) return false
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        return try {
            view.draw(Canvas(bitmap))
            val pixels = IntArray(bitmap.width * bitmap.height)
            bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
            pixels.any { it ushr 24 != 0 }
        } finally { bitmap.recycle() }
    }
    private fun withPlayer(overhangingCue: Boolean = false, test: (ActivityScenario<MainActivity>, String, String) -> Unit) {
        val arguments = InstrumentationRegistry.getArguments()
        val sourceUrl = requireNotNull(arguments.getString("sourceUrl"))
        val subtitleUrl = requireNotNull(arguments.getString(if (overhangingCue) "overhangingSubtitleUrl" else "subtitleUrl"))
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra("mediaBaseUrl", arguments.getString("mediaBaseUrl"))
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            var loadedSource: Source? = null
            var readySource: Source? = null
            var cueEnters = 0; var cueExits = 0
            var lastCue = ""
            lateinit var session: PlaybackSession
            val loaded: (SourceEvent.Loaded) -> Unit = { if (it.source.config.url == sourceUrl) loadedSource = it.source }
            val ready: (PlayerEvent.Ready) -> Unit = { readySource = session.player.source }
            val enter: (PlayerEvent.CueEnter) -> Unit = { cueEnters++; lastCue = it.cue.styledText?.toString().orEmpty().take(100) }
            val exit: (PlayerEvent.CueExit) -> Unit = { cueExits++ }
            scenario.onActivity {
                session = it.playbackForTest()
                session.player.on(SourceEvent.Loaded::class, loaded); session.player.on(PlayerEvent.Ready::class, ready)
                session.player.on(PlayerEvent.CueEnter::class, enter); session.player.on(PlayerEvent.CueExit::class, exit)
                session.load(sourceUrl, "sports:subtitle-lifecycle", if (sourceUrl.substringBefore('?').endsWith(".mpd")) SourceType.Dash else SourceType.Hls, subtitleUrl)
                it.switchUiForTest(true)
            }
            try {
                waitFor(scenario) { loadedSource != null && readySource === loadedSource && session.player.source === loadedSource && session.player.isPlaying }
                test(scenario, sourceUrl, subtitleUrl)
            } finally {
                scenario.onActivity {
                    InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
                        putString("subtitleLifecycle", JSONObject().put("loaded", loadedSource != null)
                            .put("readyForLoadedSource", readySource === loadedSource).put("cueEnterCount", cueEnters)
                            .put("cueExitCount", cueExits).put("lastCue", lastCue)
                            .put("selectedTrack", session.player.source?.selectedSubtitleTrack?.id)
                            .put("availableTracks", JSONArray(session.player.source?.availableSubtitleTracks?.map { track -> track.id }.orEmpty()))
                            .put("positionSeconds", session.player.currentTime).put("rendered", hasCaption(it)).toString())
                    })
                    session.player.off(SourceEvent.Loaded::class, loaded); session.player.off(PlayerEvent.Ready::class, ready)
                    session.player.off(PlayerEvent.CueEnter::class, enter); session.player.off(PlayerEvent.CueExit::class, exit)
                }
            }
        }
    }
    private fun seekAndWait(scenario: ActivityScenario<MainActivity>, seconds: Double) {
        var settled = false
        lateinit var session: PlaybackSession
        var source: Source? = null
        val listener: (PlayerEvent.Seeked) -> Unit = { if (session.player.source === source) settled = true }
        scenario.onActivity {
            session = it.playbackForTest(); source = session.player.source
            session.player.on(PlayerEvent.Seeked::class, listener); session.player.seek(seconds)
        }
        try { waitFor(scenario) { settled && session.player.source === source && abs(session.player.currentTime - seconds) < 1.0 } }
        finally { scenario.onActivity { session.player.off(PlayerEvent.Seeked::class, listener) } }
    }
    private fun waitFor(scenario: ActivityScenario<MainActivity>, timeoutMs: Long = 30_000, checkError: Boolean = true,
                        predicate: (MainActivity) -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            var ready = false
            scenario.onActivity { if (checkError) assertNull(it.playbackForTest().lastErrorCode); ready = predicate(it) }
            if (ready) return
            Thread.sleep(80)
        }
        var observed = ""
        scenario.onActivity {
            val session = it.playbackForTest(); val view = it.nativeSubtitleViewForTest()
            observed = "time=${session.player.currentTime},playing=${session.player.isPlaying},paused=${session.player.isPaused}," +
                "subtitle=${session.player.source?.selectedSubtitleTrack?.id},viewShown=${view.isShown},size=${view.width}x${view.height}"
        }
        fail("Required real subtitle lifecycle state was not observed: $observed")
    }
}
