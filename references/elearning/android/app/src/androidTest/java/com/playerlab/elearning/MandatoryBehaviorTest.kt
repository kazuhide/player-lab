package com.playerlab.elearning

import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.view.View
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withText
import com.bitmovin.player.api.event.PlayerEvent
import java.util.Collections
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Requires the reference's own complete media and controlled fault fixtures. */
@RunWith(AndroidJUnit4::class)
class MandatoryBehaviorTest {
    private val context get() = ApplicationProvider.getApplicationContext<Context>()

    @Before fun resetOwnedProgress() {
        assertTrue(context.getSharedPreferences("learning-progress", Context.MODE_PRIVATE).edit().clear().commit())
    }

    private fun launch() = ActivityScenario.launch<MainActivity>(Intent(context, MainActivity::class.java).apply {
        InstrumentationRegistry.getArguments().getString("mediaBaseUrl")?.let { putExtra("mediaBaseUrl", it) }
    })

    private fun await(scenario: ActivityScenario<MainActivity>, message: String, allowError: Boolean = false,
                      predicate: (MainActivity) -> Boolean) {
        val deadline = System.nanoTime() + 35_000_000_000L
        do {
            var ready = false
            scenario.onActivity {
                if (!allowError) assertNull("Unexpected media failure", it.sessionForTest().errorCode)
                ready = predicate(it)
            }
            if (ready) return
            Thread.sleep(100)
        } while (System.nanoTime() < deadline)
        var state = ""
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            state = "positionMs=$positionMs duration=${player.duration} playing=${player.isPlaying} " +
                "subtitle=${player.source?.selectedSubtitleTrack?.language} tracks=${player.source?.availableSubtitleTracks?.size} " +
                "captionIssue=${captionIssue?.kind} captionPreference=${preferences.subtitle} diagnostics=${diagnostics.entries().map { it.kind }} " +
                "activeCueCount=$activeCueCount renderer=${subtitleRenderer.width}x${subtitleRenderer.height} renderedPixels=${renderedCaptionPixels(activity)}"
        } }
        fail("$message; $state")
    }

    private fun start(scenario: ActivityScenario<MainActivity>, fault: OwnedTestFault = OwnedTestFault.NONE,
                      play: Boolean = false, ready: Boolean = true) {
        await(scenario, "Catalog or learner progress missing", allowError = true) { it.sessionForTest().let { s -> s.catalog != null && !s.progressLoading } }
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            setFormat(if (InstrumentationRegistry.getArguments().getString("streamFormat") == "dash") StreamFormat.DASH else StreamFormat.HLS)
            setAutoAdvance(false)
            setSubtitle(SubtitlePreference(true, "en"))
            setOwnedFaultForTest(fault)
            startLesson("EDU-FX-01", play = play)
            activity.setUiMode(UiMode.LEARNING)
        } }
        if (ready) await(scenario, "Owned lesson did not load") { it.sessionForTest().let { s -> s.player.duration in 179.0..181.0 && s.playbackReady } }
    }

    private fun click(scenario: ActivityScenario<MainActivity>, id: Int) {
        scenario.onActivity { activity ->
            val view = requireNotNull(activity.findViewById<View>(id))
            assertTrue("Recovery action must be visible and enabled", view.isShown && view.isEnabled)
            assertTrue(view.performClick())
        }
    }

    private fun seekToRenderedMultilineCue(scenario: ActivityScenario<MainActivity>, positionMs: Long) {
        var completed = false
        var intendedCueEntered = false
        var source: com.bitmovin.player.api.source.Source? = null
        val seeked: (PlayerEvent.Seeked) -> Unit = {
            if (it.to.source === source && kotlin.math.abs(it.to.time * 1000 - positionMs) < 100) completed = true
        }
        val entered: (PlayerEvent.CueEnter) -> Unit = { if (marker(it.cue.styledText) == "MULTILINE") intendedCueEntered = true }
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            source = requireNotNull(player.source)
            player.on(PlayerEvent.Seeked::class, seeked)
            player.on(PlayerEvent.CueEnter::class, entered)
            seek(positionMs)
        } }
        try {
            await(scenario, "The completed seek did not render the intended current cue") {
                completed && intendedCueEntered && it.sessionForTest().positionMs in (positionMs - 100)..(positionMs + 2_000) &&
                    it.sessionForTest().activeCueCount > 0 && renderedCaptionPixels(it) > 0
            }
        } finally {
            scenario.onActivity { it.sessionForTest().player.apply {
                off(PlayerEvent.Seeked::class, seeked)
                off(PlayerEvent.CueEnter::class, entered)
            } }
        }
    }

    @Test fun missingMediaOffersRetryAndLibraryRecovery() {
        launch().use { scenario ->
            start(scenario, OwnedTestFault.MEDIA_404, ready = false)
            await(scenario, "Missing media did not report a public SDK error", allowError = true) {
                it.sessionForTest().errorCode != null && it.findViewById<View>(R.id.playback_problem)?.isShown == true
            }
            var failedSource = 0
            scenario.onActivity { activity -> activity.sessionForTest().apply {
                failedSource = System.identityHashCode(player.source)
                assertTrue(diagnostics.entries().any { it.kind == DiagnosticKind.ERROR && it.sdkCode != null && it.lessonId == "EDU-FX-01" })
                assertEquals(activity.getString(R.string.error_playback), activity.findViewById<TextView>(R.id.playback_problem_message).text.toString())
            } }
            click(scenario, R.id.playback_retry)
            await(scenario, "Retry did not load the valid owned source") { it.sessionForTest().let { s -> s.player.duration > 0 && s.player.isPlaying } }
            scenario.onActivity { activity ->
                assertNotEquals(failedSource, System.identityHashCode(activity.sessionForTest().player.source))
                assertFalse(activity.findViewById<View>(R.id.playback_problem).isShown)
                activity.sessionForTest().returnToCourse()
            }
            start(scenario, OwnedTestFault.MEDIA_404, ready = false)
            await(scenario, "Second missing media did not expose recovery", allowError = true) { it.sessionForTest().errorCode != null }
            click(scenario, R.id.playback_library)
            scenario.onActivity { assertEquals(AppScreen.COURSE, it.sessionForTest().screen) }
            start(scenario, play = true)
            await(scenario, "Returning to the library did not permit a normal lesson") { it.sessionForTest().player.isPlaying }
        }
    }

    @Test fun missingSubtitleReportsActualHttpFailureAndRecovers() {
        captionFailure(OwnedTestFault.SUBTITLE_404, PlaybackIssueKind.SUBTITLE_HTTP_FAILURE, 404)
    }

    @Test fun malformedSubtitleReportsInvalidSignatureAndRecovers() {
        captionFailure(OwnedTestFault.MALFORMED_VTT, PlaybackIssueKind.SUBTITLE_INVALID_FORMAT)
    }

    private fun captionFailure(fault: OwnedTestFault, expected: PlaybackIssueKind, httpStatus: Int? = null) {
        launch().use { scenario ->
            start(scenario, fault, play = true)
            await(scenario, "Controlled caption failure did not surface the actual network or signature issue") { it.sessionForTest().captionIssue?.kind == expected }
            var before: PlaybackSnapshot? = null
            scenario.onActivity { activity -> activity.sessionForTest().apply {
                assertNull("Do not invent an SDK warning code for app-level validation", captionIssue?.sdkCode)
                assertEquals(httpStatus, captionIssue?.httpStatus)
                assertNull(errorCode)
                assertTrue(player.isPlaying)
                val expectedText = if (httpStatus != null) activity.getString(R.string.error_caption_http, httpStatus) else activity.getString(R.string.error_caption_format)
                assertEquals(expectedText, activity.findViewById<TextView>(R.id.playback_problem_message).text.toString())
                assertTrue(diagnostics.entries().any { it.sdkCode == null && it.httpStatus == httpStatus && it.kind ==
                    (if (httpStatus != null) DiagnosticKind.CAPTION_HTTP_FAILURE else DiagnosticKind.CAPTION_INVALID_FORMAT) && it.lessonId == "EDU-FX-01" })
                before = activity.snapshot()
            } }
            await(scenario, "A caption failure must not stop the media clock or video frames") {
                val current = it.snapshot()
                current.time > requireNotNull(before).time + 0.5 && current.frames > requireNotNull(before).frames && current.playing
            }
            click(scenario, R.id.playback_retry)
            await(scenario, "Caption retry did not restore the selected English track") {
                it.sessionForTest().let { s -> s.captionIssue == null && s.player.source?.selectedSubtitleTrack?.language == "en" && s.player.isPlaying }
            }
            seekToRenderedMultilineCue(scenario, 10_300)
        }
    }

    @Test fun actualSdkCueBoundariesClearGapsAndLastCaption() {
        launch().use { scenario ->
            val entered = Collections.synchronizedList(mutableListOf<CueObservation>())
            val exited = Collections.synchronizedList(mutableListOf<CueObservation>())
            val multiline = Collections.synchronizedList(mutableListOf<Boolean>())
            lateinit var session: PlaybackSession
            val enter: (PlayerEvent.CueEnter) -> Unit = { event ->
                entered.add(CueObservation(marker(event.cue.styledText), session.positionMs))
                multiline.add(event.cue.styledText?.contains('\n') == true)
            }
            val exit: (PlayerEvent.CueExit) -> Unit = { event -> exited.add(CueObservation(marker(event.cue.styledText), session.positionMs)) }
            scenario.onActivity { session = it.sessionForTest(); session.player.apply { on(PlayerEvent.CueEnter::class, enter); on(PlayerEvent.CueExit::class, exit) } }
            try {
                start(scenario, play = true)
                await(scenario, "The first cue did not enter at the beginning") { entered.any { e -> e.marker == "FIRST" && e.positionMs in 0..750 } && renderedCaptionPixels(it) > 0 }
                await(scenario, "Caption remained visible in the first gap") {
                    it.sessionForTest().positionMs in 2_300..8_000 && exited.any { e -> e.marker == "FIRST" && e.positionMs in 1_750..2_750 } &&
                        it.sessionForTest().activeCueCount == 0 && renderedCaptionPixels(it) == 0
                }
                scenario.onActivity { it.sessionForTest().seek(9_500) }
                await(scenario, "The two-line cue did not enter at its actual boundary") {
                    entered.any { e -> e.marker == "MULTILINE" && e.positionMs in 9_750..10_750 } && multiline.contains(true) && renderedCaptionPixels(it) > 0
                }
                await(scenario, "Caption remained visible after leaving the two-line cue") {
                    exited.any { e -> e.marker == "MULTILINE" && e.positionMs in 14_750..15_750 } && it.sessionForTest().activeCueCount == 0 && renderedCaptionPixels(it) == 0
                }
                scenario.onActivity { it.sessionForTest().seek(177_500) }
                await(scenario, "The final cue did not enter") { entered.any { e -> e.marker == "LAST" && e.positionMs in 177_750..178_750 } && renderedCaptionPixels(it) > 0 }
                await(scenario, "The last caption remained after playback finished") {
                    it.sessionForTest().diagnostics.entries().any { e -> e.kind == DiagnosticKind.PLAYBACK_FINISHED } &&
                        it.sessionForTest().activeCueCount == 0 && renderedCaptionPixels(it) == 0
                }
                // End of media need not emit CueExit. The actual PlaybackFinished event clears the app-owned renderer.
            } finally {
                scenario.onActivity { it.sessionForTest().player.apply { off(PlayerEvent.CueEnter::class, enter); off(PlayerEvent.CueExit::class, exit) } }
            }
        }
    }

    @Test fun realOrientationAndBothFullscreenControlsKeepOnePlayerAndPausedCaption() {
        launch().use { scenario ->
            try {
                scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
                await(scenario, "Portrait configuration did not arrive") { it.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT }
                start(scenario, play = true)
                seekToRenderedMultilineCue(scenario, 10_500)
                var before: PlaybackSnapshot? = null
                var renderer = 0
                scenario.onActivity { activity -> activity.sessionForTest().apply {
                    player.pause()
                    setSpeed(1.25f)
                    before = activity.snapshot()
                    renderer = System.identityHashCode(subtitleRenderer)
                    assertSame(activity.applicationContext, subtitleRenderer.context)
                    assertTrue(subtitleRenderer.context is Application)
                } }
                scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
                await(scenario, "Landscape configuration or cached caption did not survive recreation") {
                    it.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE && renderedCaptionPixels(it) > 0
                }
                click(scenario, R.id.learning_fullscreen)
                await(scenario, "Native fullscreen did not activate") { it.sessionForTest().viewState.fullscreen }
                scenario.onActivity { it.setUiMode(UiMode.DEFAULT); it.requestSdkFullscreenForTest(false) }
                await(scenario, "SDK fullscreen exit did not update the native scene") { !it.sessionForTest().viewState.fullscreen }
                scenario.onActivity { it.requestSdkFullscreenForTest(true) }
                await(scenario, "SDK fullscreen did not activate") { it.sessionForTest().viewState.fullscreen }
                scenario.onActivity { it.requestSdkFullscreenForTest(false); it.setUiMode(UiMode.LEARNING); it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
                await(scenario, "Portrait return lost the current paused caption") {
                    it.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT && renderedCaptionPixels(it) > 0
                }
                scenario.onActivity { activity ->
                    val original = requireNotNull(before)
                    val after = activity.snapshot()
                    assertEquals(original.playerIdentity, after.playerIdentity)
                    assertEquals(original.sourceIdentity, after.sourceIdentity)
                    assertEquals(original.impressionId, after.impressionId)
                    assertEquals(original.loads, after.loads)
                    assertEquals(original.seeks, after.seeks)
                    assertEquals(original.time, after.time, 0.2)
                    assertEquals(original.speed, after.speed, 0f)
                    assertEquals(original.subtitleId, after.subtitleId)
                    assertEquals(renderer, System.identityHashCode(activity.sessionForTest().subtitleRenderer))
                    assertFalse(after.playing)
                    assertEquals(1, after.playerViews)
                    assertEquals(1, after.subtitleViews)
                    activity.sessionForTest().player.play()
                }
                await(scenario, "Playback did not resume on the retained player after rotation") { it.snapshot().let { s -> s.playing && s.time > requireNotNull(before).time + 0.5 && s.frames > requireNotNull(before).frames } }
                var playingBefore: PlaybackSnapshot? = null
                scenario.onActivity { playingBefore = it.snapshot(); it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
                await(scenario, "Playing rotation interrupted the clock or video frames") {
                    val previous = requireNotNull(playingBefore)
                    val current = it.snapshot()
                    it.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE && current.playing &&
                        current.time > previous.time + 0.5 && current.frames > previous.frames
                }
                scenario.onActivity {
                    val previous = requireNotNull(playingBefore)
                    val current = it.snapshot()
                    assertEquals(previous.playerIdentity, current.playerIdentity)
                    assertEquals(previous.sourceIdentity, current.sourceIdentity)
                    assertEquals(previous.loads, current.loads)
                    assertEquals(previous.seeks, current.seeks)
                    assertEquals(previous.impressionId, current.impressionId)
                }
            } finally { scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED } }
        }
    }

    @Test fun perAppTwoHundredPercentFontKeepsControlsLabeledFocusableAndVisible() {
        val systemScale = context.resources.configuration.fontScale
        GuideLocaleOverride.setForTest("en")
        GuideLocaleOverride.setFontScaleForTest(2f)
        try {
            launch().use { scenario ->
                start(scenario, play = true)
                seekToRenderedMultilineCue(scenario, 10_500)
                scenario.onActivity { assertEquals(2f, it.resources.configuration.fontScale, 0f) }
                scenario.onActivity { activity ->
                    val ids = listOf(R.id.learning_play, R.id.learning_position, R.id.learning_backward,
                        R.id.learning_forward, R.id.learning_settings, R.id.learning_fullscreen)
                    val viewport = activity.screenshotBoundsForTest()
                    ids.forEach { id ->
                        val view = requireNotNull(activity.findViewById<View>(id))
                        val node = view.createAccessibilityNodeInfo()
                        assertTrue("Essential control must be visible", view.isShown && node.isVisibleToUser)
                        assertTrue("Essential control needs a meaningful label", !node.contentDescription.isNullOrBlank() || !node.text.isNullOrBlank())
                        assertTrue("Essential control must be focusable", view.isFocusable && view.requestFocusFromTouch())
                        assertTrue("Essential control must remain enabled", node.isEnabled)
                        val location = IntArray(2).also(view::getLocationInWindow)
                        val bounds = Rect(location[0], location[1], location[0] + view.width, location[1] + view.height)
                        assertTrue("Essential control must fit inside app content at 200% font", viewport.contains(bounds))
                        assertTrue("Essential control ${activity.resources.getResourceEntryName(id)} must retain a 48dp target: actual=${view.width}x${view.height}px minimum=${activity.dp(48)}px fontScale=${activity.resources.configuration.fontScale}", view.width >= activity.dp(48) && view.height >= activity.dp(48))
                        if (view is TextView) view.layout?.let { layout ->
                            assertTrue("Control text must fit its measured height", layout.height <= view.height - view.compoundPaddingTop - view.compoundPaddingBottom)
                            repeat(layout.lineCount) { assertEquals("Control text must not be ellipsized", 0, layout.getEllipsisCount(it)) }
                        }
                    }
                }
                click(scenario, R.id.learning_settings)
                InstrumentationRegistry.getInstrumentation().waitForIdleSync()
                onView(withText(R.string.caption_settings)).check(matches(isDisplayed()))
                onView(withText(R.string.speed)).check(matches(isDisplayed()))
                // This asserts actual labeled nodes and input focus, not spoken TalkBack output.
            }
        } finally {
            GuideLocaleOverride.setFontScaleForTest(null)
            GuideLocaleOverride.setForTest(null)
            assertEquals("App-local font testing must not alter system resources", systemScale, context.resources.configuration.fontScale, 0f)
        }
    }

    /** Draw the real SDK caption view into a transparent bitmap; no test-owned caption text is painted. */
    private fun renderedCaptionPixels(activity: MainActivity): Int {
        val view = activity.sessionForTest().subtitleRenderer
        if (!view.isShown || view.width <= 0 || view.height <= 0) return 0
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))
        val pixels = IntArray(view.width * view.height)
        bitmap.getPixels(pixels, 0, view.width, 0, 0, view.width, view.height)
        bitmap.recycle()
        return pixels.count { it ushr 24 != 0 }
    }

    private data class CueObservation(val marker: String, val positionMs: Long)
    private fun marker(text: CharSequence?): String = when (text?.toString()?.trim()) {
        "A point on a number line." -> "FIRST"
        "Read the numbers.\nCompare the distances." -> "MULTILINE"
        "The final point." -> "LAST"
        else -> "OTHER"
    }
}
