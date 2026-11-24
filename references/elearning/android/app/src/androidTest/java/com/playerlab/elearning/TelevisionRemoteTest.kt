package com.playerlab.elearning

import android.content.Intent
import android.view.KeyEvent
import android.webkit.WebView
import androidx.core.view.descendants
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TelevisionRemoteTest : LearningPlaybackScenario() {
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
