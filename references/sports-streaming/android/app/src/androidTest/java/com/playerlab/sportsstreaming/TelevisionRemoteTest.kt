package com.playerlab.sportsstreaming

import android.content.Intent
import android.view.KeyEvent
import android.webkit.WebView
import androidx.core.view.descendants
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.playerlab.sportsstreaming.core.StreamProtocol
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TelevisionRemoteTest {
    @Test fun televisionBackAndRemoteKeysKeepTheActiveSource() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        org.junit.Assume.assumeTrue(context.isTelevision)
        val input = InstrumentationRegistry.getInstrumentation()
        val base = InstrumentationRegistry.getArguments().getString("mediaBaseUrl") ?: BuildConfig.MEDIA_BASE_URL
        val intent = Intent(context, MainActivity::class.java).putExtra("mediaBaseUrl", base)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            waitForSportsPlayback(scenario) { it.playbackForTest().state.value.catalog != null }
            scenario.onActivity { it.playbackForTest().selectAsset("SP-CLIP-A", StreamProtocol.HLS) }
            waitForSportsPlayback(scenario) { it.playbackForTest().state.value.canControlPlayback && it.playbackForTest().player.isPlaying }
            lateinit var source: com.bitmovin.player.api.source.Source
            scenario.onActivity { activity ->
                source = requireNotNull(activity.playbackForTest().player.source)
                val root = activity.window.decorView as android.view.ViewGroup
                assertTrue(root.descendants.filterIsInstance<WebView>().first().requestFocus())
            }
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            waitForSportsPlayback(scenario) { it.playbackForTest().state.value.sportsUi }
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PAUSE)
            waitForSportsPlayback(scenario) { it.playbackForTest().player.isPaused }
            scenario.onActivity { assertSame(source, it.playbackForTest().player.source) }
        }
    }
}
