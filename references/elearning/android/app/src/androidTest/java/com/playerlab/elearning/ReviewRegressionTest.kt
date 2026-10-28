package com.playerlab.elearning

import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.SeekBar
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.event.PlayerEvent
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReviewRegressionTest {
    private val context get() = ApplicationProvider.getApplicationContext<Context>()
    private var readyEvents = 0

    @Before fun resetOwnedProgress() {
        assertTrue(context.getSharedPreferences("learning-progress", Context.MODE_PRIVATE).edit().clear().commit())
    }

    private fun launch() = ActivityScenario.launch<MainActivity>(Intent(context, MainActivity::class.java).apply {
        InstrumentationRegistry.getArguments().getString("mediaBaseUrl")?.let { putExtra("mediaBaseUrl", it) }
    }).also { scenario -> scenario.onActivity { it.sessionForTest().player.on(PlayerEvent.Ready::class) { readyEvents++ } } }

    private fun await(scenario: ActivityScenario<MainActivity>, message: String, allowError: Boolean = false,
                      predicate: (MainActivity) -> Boolean) {
        val deadline = System.nanoTime() + 35_000_000_000L
        do {
            var ready = false
            scenario.onActivity {
                if (!allowError) assertNull("Unexpected playback error", it.sessionForTest().errorCode)
                ready = predicate(it)
            }
            if (ready) return
            Thread.sleep(100)
        } while (System.nanoTime() < deadline)
        var state = ""
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
            state = "lesson=${activeItem?.lesson?.id} time=$positionMs duration=${player.duration} loading=${player.source?.loadingState} " +
                "active=${player.source?.isActive} ready=$playbackReady readyEvents=$readyEvents rejected=$resumeOutsideDuration error=$errorCode " +
                "screen=$screen fullscreen=${viewState.fullscreen} statusBar=${insets?.isVisible(WindowInsetsCompat.Type.statusBars())} " +
                "navigationBar=${insets?.isVisible(WindowInsetsCompat.Type.navigationBars())}"
        } }
        fail("$message; $state")
    }

    private fun start(scenario: ActivityScenario<MainActivity>, lesson: String = "EDU-FX-01") {
        await(scenario, "Catalog and learner progress did not load") { it.sessionForTest().let { s -> s.catalog != null && !s.progressLoading } }
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            setFormat(if (InstrumentationRegistry.getArguments().getString("streamFormat") == "dash") StreamFormat.DASH else StreamFormat.HLS)
            startLesson(lesson, play = false)
            activity.setUiMode(UiMode.LEARNING)
        } }
        await(scenario, "Lesson did not become ready") { it.sessionForTest().let { s -> s.player.duration > 0 && s.playbackReady } }
    }

    private fun saved(lesson: String): ResumeRecord? = context.getSharedPreferences("learning-progress", Context.MODE_PRIVATE)
        .getString("resume.A.$lesson", null)?.let { ResumeCodec.decode(it, Learner.A, lesson) }

    private fun setAccessibleProgress(activity: MainActivity, progress: Float) {
        val slider = requireNotNull(activity.findViewById<SeekBar>(R.id.learning_position))
        assertTrue(slider.isShown && slider.isEnabled)
        assertTrue("SeekBar must accept its public accessibility progress action", slider.performAccessibilityAction(
            AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_PROGRESS.id,
            Bundle().apply { putFloat(AccessibilityNodeInfo.ACTION_ARGUMENT_PROGRESS_VALUE, progress) }))
    }

    @Test fun failedResumeRetainsSelectedCheckpointBeforeReadyThroughRetryAndCourseReturn() {
        launch().use { scenario ->
            start(scenario, "EDU-FX-02")
            scenario.onActivity { it.sessionForTest().apply { setSpeed(1.5f); setSubtitle(SubtitlePreference(true, "ja")); seek(754_000) } }
            await(scenario, "Initial 12:34 checkpoint was not reached") { it.sessionForTest().positionMs in 753_000..755_000 }
            scenario.onActivity { it.sessionForTest().returnToCourse() }
            await(scenario, "Initial checkpoint was not durably saved") { (saved("EDU-FX-02")?.positionMs ?: -1L) in 753_000..755_000 }
            scenario.onActivity { activity -> activity.sessionForTest().apply {
                setOwnedFaultForTest(OwnedTestFault.MEDIA_404)
                startLesson("EDU-FX-02", resume = true, play = false)
                assertTrue(requireNotNull(activeItem).startPositionMs in 753_000..755_000)
                // These real settings can request a save before the failed Source ever becomes ready.
                setSpeed(1.25f)
                activity.setUiMode(UiMode.DEFAULT)
                activity.setUiMode(UiMode.LEARNING)
            } }
            await(scenario, "Owned missing media did not fail", allowError = true) { it.sessionForTest().errorCode != null }
            scenario.moveToState(Lifecycle.State.CREATED)
            await(scenario, "Loading or fatal-error saves replaced the selected checkpoint", allowError = true) {
                saved("EDU-FX-02")?.let { r -> r.positionMs in 753_000..755_000 && r.preferences.speed == 1.25f } == true
            }
            scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.onActivity { activity ->
                val retry = requireNotNull(activity.findViewById<View>(R.id.playback_retry))
                assertTrue(retry.isShown && retry.performClick())
            }
            await(scenario, "Actual Retry lost the 12:34 resume offset") { it.sessionForTest().let { s -> s.playbackReady && s.errorCode == null && s.positionMs in 753_000..756_000 } }
            scenario.onActivity { activity -> activity.sessionForTest().apply {
                assertEquals(1.25f, player.playbackSpeed, 0f)
                assertEquals("ja", player.source?.selectedSubtitleTrack?.language)
                returnToCourse()
            } }
            await(scenario, "Returning to the course lost the recovered checkpoint") { (saved("EDU-FX-02")?.positionMs ?: -1L) in 753_000..756_000 }
        }
    }

    @Test fun actualUserSeekToZeroCanReplaceAnOlderCheckpointAndRetryAtZero() {
        launch().use { scenario ->
            start(scenario)
            scenario.onActivity { it.sessionForTest().seek(60_000) }
            await(scenario, "Positive checkpoint setup did not seek") { it.sessionForTest().positionMs in 59_000..61_000 }
            scenario.onActivity { setAccessibleProgress(it, 0f) }
            await(scenario, "Accessibility seek to zero did not reach the SDK") { it.sessionForTest().positionMs in 0..500 }
            scenario.moveToState(Lifecycle.State.CREATED)
            await(scenario, "Valid zero was rejected as an unavailable clock") { (saved("EDU-FX-01")?.positionMs ?: -1L) in 0..500 }
            scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.onActivity { it.sessionForTest().retry() }
            await(scenario, "Explicit retry did not retain valid zero") { it.sessionForTest().let { s -> s.playbackReady && s.player.duration > 0 && s.positionMs in 0..500 } }
        }
    }

    @Test fun sliderAccessibilityAndDpadActionsSeekWithoutReloadOrProgrammaticSeeks() {
        launch().use { scenario ->
            start(scenario)
            var before: PlaybackSnapshot? = null
            scenario.onActivity { before = it.snapshot(); setAccessibleProgress(it, 500f) }
            await(scenario, "Accessibility progress action did not seek to the midpoint") { it.sessionForTest().positionMs in 89_000..91_000 }
            var target = 0L
            scenario.onActivity { activity ->
                val slider = requireNotNull(activity.findViewById<SeekBar>(R.id.learning_position))
                assertTrue("Keyboard target must obtain input focus", slider.requestFocusFromTouch())
                target = ((slider.progress + slider.keyProgressIncrement) / 1000.0 * activity.sessionForTest().player.duration * 1000).toLong()
                assertTrue(slider.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_RIGHT)))
                slider.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_RIGHT))
            }
            await(scenario, "D-pad did not seek using the focused slider") { kotlin.math.abs(it.sessionForTest().positionMs - target) < 1_000 }
            var seeksAfterActions = 0
            scenario.onActivity { activity ->
                val original = requireNotNull(before)
                val after = activity.snapshot()
                assertEquals(original.playerIdentity, after.playerIdentity)
                assertEquals(original.sourceIdentity, after.sourceIdentity)
                assertEquals(original.loads, after.loads)
                assertEquals(original.seeks + 2, after.seeks)
                seeksAfterActions = after.seeks
            }
            Thread.sleep(1_200) // Let periodic progress-to-thumb updates run without any user input.
            scenario.onActivity { assertEquals("Programmatic thumb updates must not seek", seeksAfterActions, it.snapshot().seeks) }
        }
    }

    @Test fun fullscreenErrorLessonsActionRestoresCourseHeaderAndSystemBars() {
        launch().use { scenario ->
            await(scenario, "Catalog and learner progress did not load") { it.sessionForTest().let { s -> s.catalog != null && !s.progressLoading } }
            scenario.onActivity { activity -> activity.sessionForTest().apply {
                setFormat(if (InstrumentationRegistry.getArguments().getString("streamFormat") == "dash") StreamFormat.DASH else StreamFormat.HLS)
                setOwnedFaultForTest(OwnedTestFault.MEDIA_404)
                startLesson("EDU-FX-01", play = false)
                activity.setUiMode(UiMode.LEARNING)
                assertTrue(activity.findViewById<View>(R.id.learning_fullscreen).performClick())
            } }
            await(scenario, "Fullscreen and the actual media failure were not reached", allowError = true) { activity ->
                activity.sessionForTest().let { s -> s.errorCode != null && s.viewState.fullscreen } &&
                    ViewCompat.getRootWindowInsets(activity.window.decorView)?.isVisible(WindowInsetsCompat.Type.statusBars()) == false
            }
            scenario.onActivity { activity ->
                val library = requireNotNull(activity.findViewById<View>(R.id.playback_library))
                assertTrue(library.isShown && library.performClick())
            }
            await(scenario, "Course return did not restore fullscreen state and system bars", allowError = true) { activity ->
                activity.sessionForTest().let { s -> s.screen == AppScreen.COURSE && !s.viewState.fullscreen } &&
                    ViewCompat.getRootWindowInsets(activity.window.decorView)?.let { insets ->
                        insets.isVisible(WindowInsetsCompat.Type.statusBars()) && insets.isVisible(WindowInsetsCompat.Type.navigationBars())
                    } == true
            }
            scenario.onActivity { activity ->
                fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
                val views = descendants(activity.window.decorView)
                val learner = views.single { it.contentDescription == activity.getString(R.string.learner, "A") }
                val more = views.single { it.contentDescription == activity.getString(R.string.more_options) }
                assertTrue("Course learner selection must be visible and operable", learner.isShown && learner.isEnabled)
                assertTrue("Course More action must be visible and operable", more.isShown && more.isEnabled)
                assertTrue(learner.performClick())
            }
        }
    }

    @Test fun shorterActualSourceRequiresExplicitRestartWithoutClampingTheCheckpoint() {
        launch().use { scenario ->
            start(scenario, "EDU-FX-02")
            scenario.onActivity { it.sessionForTest().seek(754_000) }
            await(scenario, "12:34 checkpoint setup failed") { it.sessionForTest().positionMs in 753_000..755_000 }
            scenario.onActivity { it.sessionForTest().returnToCourse() }
            await(scenario, "12:34 checkpoint was not durable") { (saved("EDU-FX-02")?.positionMs ?: -1L) in 753_000..755_000 }
            var before: PlaybackSnapshot? = null
            scenario.onActivity { activity -> activity.sessionForTest().apply {
                before = activity.snapshot()
                setOwnedFaultForTest(OwnedTestFault.SHORTER_MEDIA)
                startLesson("EDU-FX-02", resume = true, play = true)
            } }
            await(scenario, "The real shorter source did not expose its invalid saved offset") {
                it.sessionForTest().let { s -> s.player.duration in 7.0..9.0 && s.resumeOutsideDuration }
            }
            scenario.onActivity { activity ->
                val session = activity.sessionForTest()
                assertFalse("Out-of-range resume must await an explicit restart", session.player.isPlaying)
                val banner = requireNotNull(activity.findViewById<View>(R.id.playback_problem))
                assertTrue("The actual duration must expose a restart choice", banner.isShown)
                assertEquals(activity.getString(R.string.start_over), activity.findViewById<android.widget.Button>(R.id.playback_retry).text.toString())
                assertEquals("Do not attempt the out-of-range resume seek", requireNotNull(before).seeks, activity.snapshot().seeks)
                session.setSpeed(1.25f)
            }
            await(scenario, "Actual duration rejection overwrote the selected checkpoint") { (saved("EDU-FX-02")?.positionMs ?: -1L) in 753_000..755_000 }
            var loadedSource = 0
            var loads = 0
            scenario.onActivity { activity ->
                loadedSource = activity.snapshot().sourceIdentity
                loads = activity.snapshot().loads
                assertTrue(activity.findViewById<View>(R.id.playback_retry).performClick())
            }
            await(scenario, "Explicit Restart did not play the real short source from the beginning") {
                it.sessionForTest().let { s -> s.playbackReady && s.player.duration in 7.0..9.0 && s.player.isPlaying && s.positionMs in 0..2_000 } &&
                    !it.findViewById<View>(R.id.playback_problem).isShown
            }
            scenario.onActivity { activity ->
                assertEquals("Restart must use the source whose duration was checked", loadedSource, activity.snapshot().sourceIdentity)
                assertEquals(loads, activity.snapshot().loads)
                assertEquals(1.25f, activity.sessionForTest().player.playbackSpeed, 0f)
            }
            await(scenario, "Explicit Restart did not replace the old checkpoint with valid zero") { (saved("EDU-FX-02")?.positionMs ?: -1L) in 0..2_000 }
        }
    }

    @Test fun englishLocaleOverrideAllowsActualLandscapeAndPortrait() { localizedOrientation("en", 1.2f) }
    @Test fun japaneseLocaleOverrideAllowsActualLandscapeAndPortrait() { localizedOrientation("ja", 2f) }

    private fun localizedOrientation(language: String, scale: Float) {
        GuideLocaleOverride.setForTest(language)
        GuideLocaleOverride.setFontScaleForTest(scale)
        try {
            launch().use { scenario ->
                try {
                    scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
                    await(scenario, "Localized portrait configuration did not arrive") { it.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT }
                    start(scenario)
                    var before: PlaybackSnapshot? = null
                    scenario.onActivity { before = it.snapshot(); it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
                    await(scenario, "Localized context pinned the portrait qualifiers") {
                        it.resources.configuration.let { c -> c.orientation == Configuration.ORIENTATION_LANDSCAPE && c.screenWidthDp > c.screenHeightDp &&
                            c.locales[0].language == language && c.fontScale == scale }
                    }
                    scenario.onActivity { activity ->
                        val original = requireNotNull(before)
                        val after = activity.snapshot()
                        assertEquals(original.playerIdentity, after.playerIdentity)
                        assertEquals(original.sourceIdentity, after.sourceIdentity)
                        assertEquals(original.loads, after.loads)
                        assertEquals(original.seeks, after.seeks)
                        assertTrue(activity.findViewById<View>(R.id.learning_fullscreen).isShown)
                        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    }
                    await(scenario, "Localized portrait return did not arrive") {
                        it.resources.configuration.let { c -> c.orientation == Configuration.ORIENTATION_PORTRAIT && c.screenHeightDp > c.screenWidthDp && c.locales[0].language == language }
                    }
                } finally { scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED } }
            }
        } finally { GuideLocaleOverride.setForTest(null); GuideLocaleOverride.setFontScaleForTest(null) }
    }
}
