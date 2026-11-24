package com.playerlab.elearning

import android.graphics.Rect
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Button
import android.widget.ListView
import androidx.core.view.descendants
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TelevisionRemoteTest : LearningPlaybackScenario() {
    @Test fun lessonRowsAndTranscriptCuesAreReachableByRemote() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        org.junit.Assume.assumeTrue(context.isTelevision)
        val input = InstrumentationRegistry.getInstrumentation()
        launch().use { scenario ->
            start(scenario)
            await(scenario, "Transcript did not load") { !it.transcriptLoading && it.transcript.cues("en").isNotEmpty() }
            scenario.onActivity { activity ->
                val root = activity.window.decorView as ViewGroup
                val learning = root.descendants.filterIsInstance<Button>().first { it.text == activity.getString(R.string.learning_ui) }
                assertTrue(learning.requestFocus())
            }
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            await(scenario, "D-pad should open the lesson list") { it.viewState.panel == LessonPanel.LESSONS }
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            scenario.onActivity { activity ->
                val title = requireNotNull(activity.sessionForTest().activeItem).lesson.localizedTitle(activity)
                val lesson = activity.currentFocus as Button
                assertTrue(lesson.text.startsWith(title))
                assertTrue("Focused lesson row must be visible", lesson.getGlobalVisibleRect(Rect()))
            }
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            await(scenario, "D-pad should open the transcript") { it.viewState.panel == LessonPanel.TRANSCRIPT }
            scenario.onActivity { activity ->
                val root = activity.window.decorView as ViewGroup
                val cues = root.descendants.filterIsInstance<ListView>().first { it.isShown }
                assertTrue("Transcript rows must be visible", cues.childCount > 0 && cues.getChildAt(0).getGlobalVisibleRect(Rect()))
                assertTrue(cues.requestFocus())
                cues.setSelection(0)
            }
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            await(scenario, "D-pad should seek to the second transcript cue") { it.positionMs in 9_000..11_000 }
        }
    }

    @Test fun televisionBackAndRemoteKeysKeepTheActiveSource() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        org.junit.Assume.assumeTrue(context.isTelevision)
        val input = InstrumentationRegistry.getInstrumentation()
        launch().use { scenario ->
            start(scenario, play = true)
            lateinit var source: com.bitmovin.player.api.source.Source
            scenario.onActivity { activity ->
                source = requireNotNull(activity.sessionForTest().player.source)
                val root = activity.window.decorView as android.view.ViewGroup
                assertTrue(root.descendants.filterIsInstance<WebView>().first().requestFocus())
            }
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            await(scenario, "D-pad did not reach the learning controls") { it.uiMode == UiMode.LEARNING }
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PAUSE)
            await(scenario, "Media Pause did not pause the lesson") { it.player.isPaused }
            scenario.onActivity { assertSame(source, it.sessionForTest().player.source) }
        }
    }
}
