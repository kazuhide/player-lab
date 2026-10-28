package com.playerlab.elearning

import android.content.Context
import android.content.Intent
import android.os.Process
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Run prepare, externally force-stop the app, then run verify as a separate instrumentation invocation. */
@RunWith(AndroidJUnit4::class)
class ProcessDeathCheckpointTest {
    private val context get() = ApplicationProvider.getApplicationContext<Context>()
    private val marker get() = File(context.filesDir, "process-death-checkpoint.json")
    private fun format() = if (InstrumentationRegistry.getArguments().getString("streamFormat") == "dash") StreamFormat.DASH else StreamFormat.HLS

    @Test fun checkpointRestoresInASeparateProcess() {
        when (InstrumentationRegistry.getArguments().getString("processDeathPhase")) {
            "prepare" -> prepare()
            "verify" -> verify()
            else -> error("Select this test explicitly with processDeathPhase=prepare or verify; force-stop between invocations")
        }
    }

    private fun launch(): ActivityScenario<MainActivity> = ActivityScenario.launch(Intent(context, MainActivity::class.java).apply {
        InstrumentationRegistry.getArguments().getString("mediaBaseUrl")?.let { putExtra("mediaBaseUrl", it) }
    })

    private fun prepare() = launch().use { scenario ->
        await(scenario, "Catalog and saved progress did not load") { it.catalog != null && !it.progressLoading }
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            setAutoAdvance(false)
            setFormat(format())
            startLesson("EDU-FX-02", play = false)
        } }
        await(scenario, "Exercises or caption tracks did not load") { it.player.duration in 779.0..781.0 && it.player.source?.availableSubtitleTracks?.size == 2 }
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            setSpeed(1.5f)
            setSubtitle(SubtitlePreference(true, "ja"))
            activity.setUiMode(UiMode.LEARNING)
            seek(754_000)
        } }
        await(scenario, "12:34 checkpoint was not reached") { it.positionMs in 753_000..755_000 }
        scenario.moveToState(Lifecycle.State.CREATED)
        await(scenario, "Checkpoint did not reach durable storage") {
            val saved = it.resumes["EDU-FX-02"]
            saved != null && saved.positionMs in 753_000..755_000 && saved.preferences.speed == 1.5f && saved.preferences.uiMode == UiMode.LEARNING
        }
        var saved: ResumeRecord? = null
        scenario.onActivity { saved = it.sessionForTest().resumes["EDU-FX-02"] }
        val persisted = context.getSharedPreferences("learning-progress", Context.MODE_PRIVATE).getString("resume.A.EDU-FX-02", null)
        assertNotNull(persisted)
        assertEquals(saved, ResumeCodec.decode(requireNotNull(persisted), Learner.A, "EDU-FX-02"))
        marker.writeText(JSONObject().put("schemaVersion", 1).put("preparePid", Process.myPid())
            .put("streamFormat", format().name).put("checkpoint", ResumeCodec.encode(requireNotNull(saved))).toString())
    }

    private fun verify() {
        assertTrue("Run prepare before the external force-stop", marker.isFile)
        val receipt = JSONObject(marker.readText())
        assertEquals(1, receipt.getInt("schemaVersion"))
        assertEquals(format().name, receipt.getString("streamFormat"))
        assertNotEquals("Verification must use a different process", receipt.getInt("preparePid"), Process.myPid())
        val expected = requireNotNull(ResumeCodec.decode(receipt.getString("checkpoint"), Learner.A, "EDU-FX-02"))
        launch().use { scenario ->
            await(scenario, "Saved progress did not load after process restart") { it.catalog != null && !it.progressLoading }
            scenario.onActivity { activity -> activity.sessionForTest().apply {
                assertNull("Launch must not automatically load persisted media", player.source)
                assertEquals(AppScreen.COURSE, screen)
                val saved = requireNotNull(resumes["EDU-FX-02"])
                assertEquals(expected.positionMs, saved.positionMs)
                assertEquals(expected.preferences, saved.preferences)
                setFormat(format())
                startLesson("EDU-FX-02", resume = true, play = false)
            } }
            await(scenario, "Explicit resume did not restore 12:34 in the new process") {
                it.player.duration > 0 && it.positionMs in 753_000..755_000 && it.player.source?.selectedSubtitleTrack?.language == "ja"
            }
            scenario.onActivity { activity -> activity.sessionForTest().apply {
                assertEquals(1.5f, player.playbackSpeed, 0f)
                assertEquals(UiMode.LEARNING, uiMode)
                assertFalse(player.isPlaying)
                assertEquals(StartOrigin.CATALOG, activeItem?.origin)
            } }
        }
        assertTrue(marker.delete())
    }

    private fun await(scenario: ActivityScenario<MainActivity>, message: String, predicate: (PlaybackSession) -> Boolean) {
        val deadline = System.nanoTime() + 35_000_000_000L
        do {
            var ready = false
            scenario.onActivity { assertNull(it.sessionForTest().errorCode); ready = predicate(it.sessionForTest()) }
            if (ready) return
            Thread.sleep(100)
        } while (System.nanoTime() < deadline)
        fail(message)
    }
}
