package com.playerlab.android

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.source.LoadingState
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Licensed real SDK checks. Run apps/android/runtime-fixture.mjs and reverse ports 5273/5274. */
@RunWith(AndroidJUnit4::class)
class PlayerLanguageNetworkInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val controller get() = ui.activity.controller
    private var rendered = AtomicBoolean()

    @Test
    fun globalLanguagePriorityAndSourceOverrideChooseTheInitialNativeAudioTrack() {
        openFixture()
        field("config-audio-languages", " de, en, DE ")
        apply("apply-player")
        awaitPlayback("global preferred German")
        ui.runOnIdle {
            assertEquals("de", controller.player.source?.selectedAudioTrack?.language)
            assertEquals(listOf("de", "en"), controller.player.config.playbackConfig.preferredAudioLanguages)
        }
        val player = controller.player
        field("source-audio-languages", "en,de")
        apply("apply-source")
        awaitPlayback("source preferred English overrides German")
        ui.runOnIdle {
            assertTrue("Source preference reloads the same player", player === controller.player)
            assertEquals("en", controller.player.source?.selectedAudioTrack?.language)
            assertEquals(listOf("en", "de"), controller.player.source?.config?.preferredAudioLanguages)
        }
        field("source-audio-languages", "")
        apply("apply-source")
        awaitPlayback("clearing source preference restores German inheritance")
        ui.runOnIdle { assertEquals("de", controller.player.source?.selectedAudioTrack?.language) }
        println("LANGUAGE_CONFIGURATION_SAFE globalGerman=true sourceEnglish=true clearedSourceGerman=true freshFrames=true samePlayerSourceReload=true")
    }

    @Test
    fun externalWebVttMetadataReachesTheNativeTrackAndTheVisibleSubtitleMenuRendersItsCue() {
        openFixture()
        field("source-subtitle-url", "$media/captions.vtt")
        field("source-subtitle-label", "External English")
        field("source-subtitle-language", "en")
        click("source-subtitle-default")
        apply("apply-source")
        apply("apply-player")
        awaitPlayback("external WebVTT source starts")
        await("external subtitle is available") {
            controller.player.source?.availableSubtitleTracks?.any { it.id == "player-lab-external-webvtt" } == true
        }
        val player = controller.player
        val source = requireNotNull(controller.configuredSource)
        ui.runOnIdle {
            val track = source.availableSubtitleTracks.single { it.id == "player-lab-external-webvtt" }
            assertEquals("External English", track.label)
            assertEquals("en", track.language)
            assertTrue("Default is informational metadata", track.isDefault)
            assertNull("The SDK must not be claimed to enable default subtitles automatically", source.selectedSubtitleTrack)
        }
        val cue = AtomicBoolean()
        ui.runOnIdle {
            player.on(PlayerEvent.CueEnter::class) {
                if (controller.player === player && player.source === source &&
                    source.selectedSubtitleTrack?.id == "player-lab-external-webvtt" && cue.compareAndSet(false, true)) {
                    println("SUBTITLE_CONFIGURATION_SAFE phase=fresh-cue start=${it.start} end=${it.end} position=${player.currentTime}")
                }
            }
        }
        // Sports intentionally has no settings panel. Use the existing Default UI's track menu.
        visibleWebView()
        ui.onNodeWithText("Default").performScrollTo().assertIsDisplayed().performClick()
        val web = visibleWebView()
        ui.runOnIdle {
            assertTrue("UI replacement retains the configured source", player.source === source)
            assertNull("Track metadata alone does not enable subtitles", source.selectedSubtitleTrack)
        }
        webAction(web, "const button = visible('.bmpui-ui-settingstogglebutton'); if (!button) return false; button.click(); return true;")
        webAction(web, """
            const item = [...document.querySelectorAll('.bmpui-ui-settings-panel-item:not(.bmpui-ui-settings-panel-item-select-option)')]
              .find(e => e.textContent.trim().startsWith('Subtitles') && visible('#' + e.id));
            if (!item) return false;
            item.click(); return true;
        """)
        webAction(web, """
            const option = [...document.querySelectorAll('.bmpui-ui-settings-panel-item-select-option')]
              .find(e => e.textContent.trim() === 'External English' && visible('#' + e.id));
            if (!option) return false;
            option.click(); return true;
        """)
        ui.runOnIdle {
            println("SUBTITLE_CONFIGURATION_SAFE phase=menu-choice nativeSelected=${source.selectedSubtitleTrack?.id == "player-lab-external-webvtt"} freshCue=${cue.get()} sourceRetained=${player.source === source} position=${player.currentTime}")
        }
        await("GUI subtitle choice selects the native track and emits a fresh cue") {
            player.source === source && source.selectedSubtitleTrack?.id == "player-lab-external-webvtt" && cue.get()
        }
        awaitWeb(web, """
            const label = visible('.bmpui-ui-subtitle-label');
            return !!label && label.textContent.includes('Player Lab external subtitle');
        """, "external subtitle text must actually be visible")
        assertTrue("WebVTT is downloaded", fixtureState().getInt("subtitleRequests") > 0)
        println("SUBTITLE_CONFIGURATION_SAFE metadata=true defaultDoesNotAutoEnable=true standardMenuSelected=true freshCue=true visibleText=true")
    }

    @Test
    fun explicitRetryScheduleRecoversTwoTemporaryFailuresAndNoneStopsAfterOneRequest() {
        openFixture()
        field("config-http-retries", "0.1,0.2")
        apply("apply-player")
        awaitPlayback("configured retry player starts")
        resetFixture(2)
        field("source-url", "$media/retry/vod-multiaudio/master.m3u8")
        apply("apply-source")
        awaitPlayback("two configured HTTP retries recover the manifest")
        val recovered = fixtureState()
        assertEquals(3, recovered.getInt("retryManifestRequests"))
        assertEquals(2, recovered.getInt("retryFailures"))
        assertEquals(0, recovered.getInt("remainingFailures"))
        field("config-http-retries", "none")
        apply("apply-player")
        awaitPlayback("no-retry player still loads a healthy source")
        resetFixture(1)
        apply("apply-source")
        ui.waitUntil(40_000) {
            var failed = false
            ui.runOnUiThread { failed = controller.lastErrorCode != null }
            failed
        }
        val stopped = fixtureState()
        assertEquals("No retries means one request", 1, stopped.getInt("retryManifestRequests"))
        assertEquals(1, stopped.getInt("retryFailures"))
        ui.runOnIdle { assertFalse("Failed source is not successful playback", controller.player.isPlaying) }
        resetFixture(0)
        field("source-url", "$media/vod-multiaudio/master.m3u8")
        apply("apply-source")
        awaitPlayback("the same player recovers after applying a healthy source")
        println("NETWORK_CONFIGURATION_SAFE scheduledRequests=3 scheduledFailures=2 recoveredFrames=true noRetryRequests=1 expectedSourceError=true healthySourceRecovered=true")
    }

    private fun openFixture() {
        resetFixture(0)
        ui.onNodeWithText("Sports").performScrollTo().performClick()
        click("configuration-toggle")
        field("source-url", "$media/vod-multiaudio/master.m3u8")
        click("source-type-Hls")
        apply("apply-source")
        click("config-autoplay")
        click("config-muted")
    }

    private fun apply(tag: String) {
        ui.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
            .performSemanticsAction(SemanticsActions.OnClick) { action ->
                assertTrue("Real Apply action must execute", action())
                val player = controller.player
                val source = controller.configuredSource
                val frame = AtomicBoolean()
                rendered = frame
                player.on(PlayerEvent.RenderFirstFrame::class) {
                    if (controller.player === player && player.source === source) frame.set(true)
                }
            }
    }

    private fun awaitPlayback(label: String) {
        await(label) {
            val player = controller.player
            player.source === controller.configuredSource && player.source?.loadingState == LoadingState.Loaded &&
                player.duration in 59.0..61.0 && player.isPlaying && rendered.get() && player.currentTime > 0.5
        }
        var start = 0.0
        ui.runOnUiThread { start = controller.player.currentTime }
        await("$label clock advances") { controller.player.isPlaying && controller.player.currentTime > start + 1.0 }
    }

    private fun await(label: String, condition: () -> Boolean) {
        try {
            ui.waitUntil(40_000) {
                var ready = false
                ui.runOnUiThread { ready = condition() || controller.lastErrorCode != null }
                ready
            }
        } catch (failure: androidx.compose.ui.test.ComposeTimeoutException) {
            ui.runOnUiThread {
                println("LANGUAGE_NETWORK_FAILURE_SAFE position=${controller.player.currentTime} playing=${controller.player.isPlaying} externalSelected=${controller.player.source?.selectedSubtitleTrack?.id == "player-lab-external-webvtt"} frame=${rendered.get()} errorCode=${controller.lastErrorCode}")
            }
            throw AssertionError(label, failure)
        }
        ui.runOnIdle { assertNull("$label; numeric Player/Source error", controller.lastErrorCode) }
    }

    private fun click(tag: String) = ui.onNodeWithTag(tag).performScrollTo().assertIsDisplayed().performClick()
    private fun field(tag: String, value: String) {
        ui.onNodeWithTag(tag).performScrollTo().performTextReplacement(value)
        closeSoftKeyboard()
    }

    private fun visibleWebView(): WebView {
        val scroll = ui.onNodeWithTag("player-lab-scroll")
        val y = scroll.fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        scroll.performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, -y) }
        var web: WebView? = null
        await("owned player view is visible") {
            val active = descendants(ui.activity.window.decorView).filterIsInstance<PlayerView>()
                .singleOrNull { it.player === controller.player && it.isShown }
            web = active?.let { descendants(it).filterIsInstance<WebView>().firstOrNull() }
            web != null && requireNotNull(web).getGlobalVisibleRect(android.graphics.Rect())
        }
        return requireNotNull(web)
    }

    private fun webAction(web: WebView, action: String) = awaitWeb(web, action, "visible subtitle menu action")

    private fun awaitWeb(web: WebView, action: String, label: String) {
        ui.waitUntil(40_000) {
            val done = CountDownLatch(1)
            var result: String? = null
            ui.runOnUiThread {
                web.evaluateJavascript("""(() => {
                    document.querySelector('.bmpui-ui-uicontainer')?.dispatchEvent(new MouseEvent('mousemove', {bubbles:true}));
                    const visible = selector => [...document.querySelectorAll(selector)].find(e => {
                        const r = e.getBoundingClientRect();
                        if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth)) return false;
                        for (let n=e; n; n=n.parentElement) {
                            const s=getComputedStyle(n);
                            if (s.display==='none' || s.visibility!=='visible' || Number(s.opacity)<=0) return false;
                        }
                        return true;
                    });
                    $action
                })()""".trimIndent()) { result = it; done.countDown() }
            }
            assertTrue("$label JavaScript callback", done.await(5, TimeUnit.SECONDS))
            result == "true"
        }
    }

    private fun descendants(view: View): List<View> = if (view is ViewGroup) {
        (0 until view.childCount).flatMap { listOf(view.getChildAt(it)) + descendants(view.getChildAt(it)) }
    } else emptyList()

    private fun resetFixture(failures: Int) { control("/configuration/reset?failures=$failures", "POST") }
    private fun fixtureState() = JSONObject(control("/configuration/state", "GET"))
    private fun control(path: String, method: String): String {
        val connection = URL("http://localhost:5273$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            assertEquals("Local fixture response", 200, connection.responseCode)
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally { connection.disconnect() }
    }

    companion object { private const val media = "http://localhost:5274" }
}
