package com.playerlab.sportsstreaming

import android.content.Intent
import android.os.SystemClock
import android.view.KeyEvent
import android.webkit.WebView
import androidx.core.view.descendants
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.playerlab.sportsstreaming.core.StreamProtocol
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TelevisionRemoteTest {
    @Test fun catalogTabAndFirstClipAreVisibleAndReachableByRemote() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        org.junit.Assume.assumeTrue(context.isTelevision)
        val input = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(input)
        val base = InstrumentationRegistry.getArguments().getString("mediaBaseUrl") ?: BuildConfig.MEDIA_BASE_URL
        val intent = Intent(context, MainActivity::class.java).putExtra("mediaBaseUrl", base)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            waitForSportsPlayback(scenario) { it.playbackForTest().state.value.catalog != null }
            lateinit var clipsTab: String
            lateinit var clip: String
            scenario.onActivity { activity ->
                clipsTab = activity.getString(R.string.clips)
                val catalog = requireNotNull(activity.playbackForTest().state.value.catalog)
                clip = requireNotNull(catalog.asset("SP-CLIP-A")).localizedTitle(activity.resources.configuration.locales[0].language == "ja")
            }
            val tab = requireNotNull(device.wait(Until.findObject(By.text(clipsTab)), 5_000)).visibleCenter
            fun focusedBounds() = device.findObject(By.focused(true))?.visibleBounds
            var focused = focusedBounds()
            for (step in 1..6) {
                if (focused?.contains(tab.x, tab.y) == true) break
                val previous = focused
                input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
                val deadline = SystemClock.uptimeMillis() + 1_500
                do {
                    SystemClock.sleep(100)
                    focused = focusedBounds()
                } while ((focused == null || focused == previous) && SystemClock.uptimeMillis() < deadline)
            }
            assertTrue("Remote focus $focused should reach $tab", focused?.contains(tab.x, tab.y) == true)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            val firstClip = requireNotNull(device.wait(Until.findObject(By.text(clip)), 5_000))
            assertTrue(firstClip.visibleBounds.height() > 0)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            input.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            waitForSportsPlayback(scenario) { it.playbackForTest().state.value.activeAssetId == "SP-CLIP-A" }
        }
    }

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
