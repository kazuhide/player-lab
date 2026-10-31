package com.playerlab.android

import androidx.compose.ui.test.assertIsDisplayed

import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performSemanticsAction
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.ExperimentalBitmovinApi
import com.bitmovin.player.api.buffer.BufferType
import com.bitmovin.player.api.media.MediaType
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.playerlab.android.playback.PlaybackMode
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs

/** Licensed runtime checks against the actual app controls, SDK and shared Web UI. */
@OptIn(ExperimentalBitmovinApi::class)
@RunWith(AndroidJUnit4::class)
class PlayerControlsInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val errors = CopyOnWriteArrayList<Int>()
    private val timeShiftRequests = AtomicInteger()
    private val timeShiftCompletions = AtomicInteger()
    private val completedTimeShiftPosition = AtomicReference(Double.NaN)
    private val timeShiftObservations = CopyOnWriteArrayList<TimeShiftObservation>()
    private var pointerSide = false
    private var lastProbeUptime = 0L
    private val rewindSeconds = InstrumentationRegistry.getArguments().getString("liveRewindSeconds")?.let {
        require(it in listOf("10", "30", "60")) { "liveRewindSeconds must name an existing rewind control" }
        it.toInt()
    } ?: 10

    private val liveTargetLatency = InstrumentationRegistry.getArguments().getString("liveTargetLatency")?.let {
        require(it.toDoubleOrNull()?.isFinite() == true) { "liveTargetLatency must be finite" }
        it
    }

    private data class TimeShiftObservation(
        val phase: String,
        val uptimeMs: Long,
        val position: Double,
        val target: Double?,
        val offset: Double,
    )

    @Test
    fun sharedUiPlaybackSourceSwitchAndDvrControls() {
        val controller = ui.activity.controller
        val player = controller.player
        ui.runOnUiThread {
            player.on(PlayerEvent.Error::class) { errors.add(it.code.value) }
            player.on(SourceEvent.Error::class) { errors.add(it.code.value) }
            player.on(PlayerEvent.TimeShift::class) {
                timeShiftRequests.incrementAndGet()
                timeShiftObservations.add(
                    TimeShiftObservation("request", SystemClock.uptimeMillis(), it.position, it.target, player.timeShift),
                )
                println("LIVE_SYNC_EVENT phase=request ms=${SystemClock.uptimeMillis()} position=${it.position} target=${it.target} offset=${player.timeShift}")
                probeSync("request")
            }
            player.on(PlayerEvent.TimeShifted::class) {
                val position = player.currentTime
                completedTimeShiftPosition.set(position)
                timeShiftObservations.add(
                    TimeShiftObservation("completed", SystemClock.uptimeMillis(), position, null, player.timeShift),
                )
                timeShiftCompletions.incrementAndGet()
                println("LIVE_SYNC_EVENT phase=completed ms=${SystemClock.uptimeMillis()} position=$position offset=${player.timeShift}")
                probeSync("completed")
            }
            player.mute()
        }

        workspaceTheme(ui, "Sports")
        workspaceSource(ui, "VOD HLS")
        await("finite VOD duration") {
            player.duration > 0 && player.duration.isFinite() && controller.dvr.mode == PlaybackMode.VOD
        }
        var shared: WebView? = null
        await("shared UI WebView attaches") {
            shared = descendants(ui.activity.window.decorView).filterIsInstance<WebView>().firstOrNull()
            shared != null
        }
        val webView = requireNotNull(shared)
        awaitJavascript(webView, """
            typeof bitmovin?.playerui?.UIFactory?.buildSportsUI === 'function' &&
            !!document.querySelector('.bmpui-ui-skin-sports') &&
            [...document.querySelectorAll('link[rel="stylesheet"]')]
              .some(link => link.href.includes('bitmovinplayer-ui.css'))
        """.trimIndent())
        awaitJavascript(webView, """
            (() => {
              $visibleElementScript
              const button = visible('.bmpui-ui-playbacktogglebutton');
              if (!button) return false;
              button.click();
              return true;
            })()
        """.trimIndent(), "shared UI playback button becomes visible", revealControls = true)
        var start = 0.0
        ui.runOnUiThread { start = player.currentTime }
        await("shared UI starts advancing playback") { player.isPlaying && player.currentTime > start + 1 }

        workspaceSource(ui, "Live DASH + DVR")
        liveTargetLatency?.let { latency ->
            workspaceClick(ui, "configuration-toggle")
            workspaceConfigurationNode(ui, "source-live-target").performScrollTo().performTextReplacement(latency)
            closeSoftKeyboard()
            ui.onNodeWithTag("apply-source").assertIsDisplayed().performClick()
            ui.runOnUiThread {
                assertEquals(latency.toDouble(), requireNotNull(controller.configuredSource?.config?.liveConfig?.targetLatency), 0.0)
                assertTrue("Source policy must retain the player", player === controller.player)
            }
            workspaceClick(ui, "configuration-toggle")
        }
        await("live source loads") { player.isLive }
        ui.runOnUiThread { player.play() }
        await("live source supplies a rewind window") {
            controller.dvr.dvrAvailable && controller.dvr.windowDuration > rewindSeconds
        }
        var liveClock = 0.0
        ui.runOnUiThread { liveClock = player.currentTime }
        await("live playback advances before rewind") { player.currentTime > liveClock + 1 }
        workspaceMore(ui, "Live controls")
        val rewindButton = ui.onNodeWithText("-${rewindSeconds}s").performScrollTo()
        var beforeRewind = 0
        var rewindTarget = Double.NaN
        ui.runOnUiThread {
            beforeRewind = timeShiftCompletions.get()
            rewindTarget = player.currentTime - player.timeShift - rewindSeconds
        }
        assertTrue("Rewind target must be finite", rewindTarget.isFinite())
        rewindButton.performClick()
        awaitJavascript(webView, sharedLiveUiScript(atEdge = false), "rewind completes in the SDK and shared UI", revealControls = true) {
            val offset = player.timeShift
            timeShiftCompletions.get() > beforeRewind && offset.isFinite() && offset < 0 &&
                abs(completedTimeShiftPosition.get() - rewindTarget) <= 3
        }
        ui.runOnUiThread { liveClock = player.currentTime }
        await("rewound playback advances before return") { player.currentTime > liveClock + 1 }
        val beforeReturn = timeShiftCompletions.get()
        ui.onNodeWithText("Live edge").performScrollTo().performClick()
        awaitJavascript(webView, sharedLiveUiScript(atEdge = true), "return to live completes in the SDK and shared UI", revealControls = true) {
            timeShiftCompletions.get() > beforeReturn && timeShiftCompletions.get() == timeShiftRequests.get() &&
                abs(player.timeShift) < 1
        }
        workspaceClick(ui, "allow-dvr")
        ui.runOnUiThread { assertFalse(controller.dvr.dvrAvailable) }
        workspaceClick(ui, "allow-dvr")
        ui.runOnUiThread { assertTrue(controller.dvr.dvrAvailable) }
        workspaceSource(ui, "VOD HLS")
        await("VOD state after source switch") { controller.dvr.mode == PlaybackMode.VOD }
        assertTrue("Player/Source error codes: $errors", errors.isEmpty())
    }


    @Test
    fun liveRewindSwitchChangesVisibleControlsWithoutReloadingPlayback() {
        val controller = ui.activity.controller
        val player = controller.player
        observeErrors()
        ui.runOnUiThread { player.mute() }
        for (sourceName in listOf("Live DASH + DVR", "Live HLS")) {
            workspaceSource(ui, sourceName)
            await("$sourceName supplies a real rewind window") {
                player.isLive && player.maxTimeShift < -10 && controller.dvr.dvrAvailable
            }
            ui.runOnUiThread { player.play() }
            for (theme in listOf("Default", "Sports", "Live", "Cinema")) {
                workspaceTheme(ui, theme)
                workspaceMore(ui, "Playback options")
                var source: com.bitmovin.player.api.source.Source? = null
                var clock = 0.0
                var generation = 0
                var revision = 0
                ui.runOnUiThread {
                    source = controller.configuredSource
                    clock = player.currentTime
                    generation = controller.apiPlayerGeneration
                    revision = controller.sourceRevision
                }
                awaitJavascript(attachedWebView(), rewindControlsScript(enabled = true),
                    "$sourceName / $theme initially shows live seeking", revealControls = true)
                ui.onNodeWithTag("allow-dvr").assertIsDisplayed().performClick()
                awaitJavascript(attachedWebView(), rewindControlsScript(enabled = false),
                    "$sourceName / $theme hides only live seeking", revealControls = true)
                ui.runOnUiThread {
                    assertTrue("The UI switch must retain the player", player === controller.player)
                    assertTrue("The UI switch must retain the source", source === controller.configuredSource)
                    assertEquals(generation, controller.apiPlayerGeneration)
                    assertEquals(revision, controller.sourceRevision)
                }
                await("$sourceName / $theme keeps playing while seeking is hidden") {
                    player.isPlaying && player.currentTime > clock + 1
                }
                if (theme == "Default") {
                    awaitJavascript(attachedWebView(), rewindControlsScript(enabled = false),
                        "the hidden preference persists after view initialization", revealControls = true)
                    ApiGuideScreenshot.capture("android-${Sources.all.first { it.label == sourceName }.id}-rewind-disabled", ui.activity)
                }
                ui.runOnUiThread { clock = player.currentTime }
                ui.onNodeWithTag("allow-dvr").assertIsDisplayed().performClick()
                await("$sourceName / $theme keeps playing after seeking is restored") {
                    player.isPlaying && player.currentTime > clock + 1
                }
                awaitJavascript(attachedWebView(), rewindControlsScript(enabled = true),
                    "$sourceName / $theme restores live seeking", revealControls = true)
                if (theme == "Default") ApiGuideScreenshot.capture("android-${Sources.all.first { it.label == sourceName }.id}-rewind-enabled", ui.activity)
                ui.runOnUiThread {
                    assertTrue(player === controller.player && source === controller.configuredSource)
                    println("LIVE_REWIND_UI source=$sourceName theme=$theme hidden=true restored=true retainedPlayer=true retainedSource=true")
                }
            }
        }
        workspaceMore(ui, "Playback options")
        ui.onNodeWithTag("allow-dvr").assertIsDisplayed().performClick()
        workspaceSource(ui, "VOD HLS")
        await("VOD loads with the live preference disabled") { !player.isLive && player.duration.isFinite() && player.duration > 20 }
        awaitJavascript(attachedWebView(), rewindControlsScript(enabled = true),
            "VOD seeking is unaffected by the live-only switch", revealControls = true)
        workspaceSource(ui, "Live DASH + DVR")
        await("live source returns with preference disabled") { player.isLive && player.maxTimeShift < -10 }
        awaitJavascript(attachedWebView(), rewindControlsScript(enabled = false),
            "the disabled preference survives source changes", revealControls = true)
        assertTrue("Player/Source error codes: $errors", errors.isEmpty())
    }

    private fun rewindControlsScript(enabled: Boolean): String = """
        (() => {
          $visibleElementScript
          const inViewport = selector => {
            const element = visible(selector);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight ? element : null;
          };
          const controls = inViewport('.bmpui-ui-playbacktogglebutton');
          if (!controls) return false;
          const seekbar = inViewport('.bmpui-ui-seekbar');
          const quickSeek = inViewport('.bmpui-ui-quickseekbutton');
          return $enabled ? !!seekbar : !seekbar && !quickSeek;
        })()
    """.trimIndent()

    @Test
    fun standardVodControlsDriveNativePlaybackSeekMuteAndSpeed() {
        val controller = ui.activity.controller
        val player = controller.player
        observeErrors()
        workspaceTheme(ui, "Sports")
        workspaceSource(ui, "VOD HLS")
        await("standard UI VOD loads") { player.duration.isFinite() && player.duration > 20 }
        var web = attachedWebView()
        var start = 0.0
        ui.runOnUiThread { start = player.currentTime; assertFalse(player.isMuted) }
        clickWeb(web, ".bmpui-ui-playbacktogglebutton")
        await("standard UI Play advances native playback") { player.isPlaying && player.currentTime > start + 1 }
        clickWeb(web, ".bmpui-ui-playbacktogglebutton")
        await("standard UI Pause reaches native pause") { player.isPaused }
        clickWeb(web, ".bmpui-ui-volumetogglebutton")
        await("standard UI Mute reaches native mute") { player.isMuted }
        clickWeb(web, ".bmpui-ui-volumetogglebutton")
        await("standard UI Unmute reaches native unmute") { !player.isMuted }
        val seeked = AtomicInteger()
        var target = 0.0
        ui.runOnUiThread { player.on(PlayerEvent.Seeked::class) { seeked.incrementAndGet() }; target = player.duration * 0.25 }
        mouseSeek(web, ".bmpui-ui-seekbar .bmpui-seekbar", 0.25)
        await("standard UI seek finishes at its native media target") {
            seeked.get() > 0 && abs(player.currentTime - target) <= 3 && player.isPaused
        }
        workspaceTheme(ui, "Default")
        web = attachedWebView()
        chooseSetting(web, "Speed", label = "1.5x")
        await("standard speed option reaches the native property") { player.playbackSpeed == 1.5f }
        ui.runOnUiThread {
            assertTrue("Standard UI changes retain the player", player === controller.player)
            println("NATIVE_UI_SAFE action=vod-controls play=true pause=true mute=true unmute=true seeked=${seeked.get()} playbackSpeed=${player.playbackSpeed}")
        }
    }

    @Test
    fun standardTrackAndQualityChoicesReachTheCurrentNativeSource() {
        val player = ui.activity.controller.player
        observeErrors()
        workspaceSource(ui, "Live DASH + Multi-audio")
        await("native reference source exposes tracks and video qualities") {
            val source = player.source
            player.isLive && source != null && source.availableAudioTracks.size >= 2 &&
                source.availableSubtitleTracks.isNotEmpty() && source.availableVideoQualities.size >= 2
        }
        val web = attachedWebView()
        clickWeb(web, ".bmpui-ui-playbacktogglebutton")
        var start = 0.0
        ui.runOnUiThread { start = player.currentTime }
        await("reference playback advances before settings changes") { player.isPlaying && player.currentTime > start + 1 }
        val audioChanged = AtomicInteger()
        val subtitleChanged = AtomicInteger()
        val qualityChanged = AtomicInteger()
        val source = requireNotNull(player.source)
        var audioId = ""
        var subtitleId = ""
        var qualityId = ""
        var audioIndex = 0
        var subtitleIndex = 0
        var qualityIndex = 0
        ui.runOnUiThread {
            source.on(SourceEvent.AudioTrackChanged::class) { audioChanged.incrementAndGet() }
            source.on(SourceEvent.SubtitleTrackChanged::class) { subtitleChanged.incrementAndGet() }
            source.on(SourceEvent.VideoQualityChanged::class) { qualityChanged.incrementAndGet() }
            audioIndex = source.availableAudioTracks.indexOfFirst { it.id != source.selectedAudioTrack?.id }
            subtitleIndex = source.availableSubtitleTracks.indexOfFirst { !it.isForced }
            qualityIndex = source.availableVideoQualities.indexOfLast { it.id != source.selectedVideoQuality?.id }
            assertTrue(audioIndex >= 0 && subtitleIndex >= 0 && qualityIndex >= 0)
            audioId = source.availableAudioTracks[audioIndex].id
            subtitleId = source.availableSubtitleTracks[subtitleIndex].id
            qualityId = source.availableVideoQualities[qualityIndex].id
        }
        awaitJavascript(web, """
            (() => { $visibleElementScript
              return !!visible('.bmpui-ui-touch-control-overlay') && !visible('.bmpui-ui-controlbar');
            })()
        """.trimIndent(), "Default touch UI controls auto-hide before the real reveal gesture")
        chooseSetting(web, "Audio Track", index = audioIndex)
        await("standard audio choice reaches the native source") { audioChanged.get() > 0 && source.selectedAudioTrack?.id == audioId }
        chooseSetting(web, "Subtitles", index = subtitleIndex + 1)
        await("standard subtitle choice reaches the native source") { subtitleChanged.get() > 0 && source.selectedSubtitleTrack?.id == subtitleId }
        chooseSetting(web, "Video Quality", index = qualityIndex + 1)
        await("standard quality choice reaches the native source") { qualityChanged.get() > 0 && source.selectedVideoQuality?.id == qualityId }
        ui.runOnUiThread {
            assertTrue("Track choices retain source ownership", source === player.source)
            println("NATIVE_UI_SAFE action=source-choices audioChanged=${audioChanged.get()} subtitleChanged=${subtitleChanged.get()} qualityChanged=${qualityChanged.get()} audioMatch=true subtitleMatch=true qualityMatch=true")
        }
    }

    @Test
    fun standardUnavailableRoutesAndNativeThumbnailQueryAreRecorded() {
        val player = ui.activity.controller.player
        observeErrors()
        workspaceTheme(ui, "Sports")
        workspaceSource(ui, "VOD HLS")
        await("reference VOD metadata loads") { player.duration.isFinite() && player.duration > 20 }
        val web = attachedWebView()
        awaitJavascript(web, """
            (() => {
              $visibleElementScript
              return !!visible('.bmpui-ui-playbacktogglebutton') &&
                !visible('.bmpui-ui-fullscreentogglebutton') &&
                !visible('.bmpui-ui-piptogglebutton,.bmpui-ui-pictureinpicturetogglebutton') &&
                !visible('.bmpui-ui-volumeslider');
            })()
        """.trimIndent(), "standard control availability is visible", revealControls = true)
        val view = descendants(ui.activity.window.decorView).filterIsInstance<PlayerView>().single { it.player === player }
        ui.runOnUiThread {
            assertFalse("No fullscreen handler is configured by this app", view.isFullscreen())
            assertFalse("No PiP handler is configured by this app", view.isPictureInPictureAvailable())
            assertFalse(view.isPictureInPicture())
            println("NATIVE_UI_SAFE action=unavailable-routes fullscreenButton=false fullscreen=false pipAvailable=false pip=false mobileVolumeSlider=false nativeVolume=${player.volume}")
        }
        // Pass through the actual published native method and record only numeric/null results.
        // The request itself must originate from hovering the standard seek bar.
        assertEquals("Native thumbnail bridge can be observed", "true", javascript(web, """
            (() => {
              const original = Android;
              window.__thumbnailQuery = {calls: 0, present: false, time: 0};
              window.__nativeAndroidBeforeThumbnailProbe = original;
              window.Android = new Proxy(original, {get(target, key) {
                if (key === 'getThumbnail') return time => {
                  const result = target.getThumbnail(time);
                  window.__thumbnailQuery = {calls: window.__thumbnailQuery.calls + 1,
                    present: result !== null && result !== 'null', time};
                  return result;
                };
                const value = target[key];
                return typeof value === 'function' ? value.bind(target) : value;
              }});
              return Android !== original;
            })()
        """.trimIndent()))
        try {
            awaitJavascript(web, """
                (() => {
                  $visibleElementScript
                  const bar = visible('.bmpui-ui-seekbar .bmpui-seekbar');
                  if (!bar) return false;
                  const rect = bar.getBoundingClientRect();
                  bar.dispatchEvent(new MouseEvent('mousemove', {bubbles: true,
                    clientX: rect.left + rect.width * 0.4, clientY: rect.top + rect.height / 2}));
                  return true;
                })()
            """.trimIndent(), "standard seek bar receives hover input", revealControls = true)
            awaitJavascript(web, "window.__thumbnailQuery.calls > 0", "standard hover invokes the actual native thumbnail query")
            val thumbnail = javascript(web, "JSON.stringify(window.__thumbnailQuery)")
            println("NATIVE_UI_SAFE action=thumbnail-query result=$thumbnail")
        } finally {
            javascript(web, "window.Android = window.__nativeAndroidBeforeThumbnailProbe; true")
        }
    }

    private fun observeErrors() {
        val player = ui.activity.controller.player
        ui.runOnUiThread {
            player.on(PlayerEvent.Error::class) { errors += it.code.value }
            player.on(SourceEvent.Error::class) { errors += it.code.value }
        }
    }

    private fun attachedWebView(): WebView {
        ui.waitForIdle()
        ui.onNodeWithTag("player-preview").assertIsDisplayed()
        var web: WebView? = null
        await("active WebView attaches") {
            val player = ui.activity.controller.player
            val active = descendants(ui.activity.window.decorView).filterIsInstance<PlayerView>()
                .singleOrNull { it.player === player }
            web = active?.let { descendants(it).filterIsInstance<WebView>().firstOrNull() }
            web != null
        }
        return requireNotNull(web)
    }

    private fun clickWeb(view: WebView, selector: String) = awaitJavascript(view, """
        (() => { $visibleElementScript
          const element = visible(${JSONObject.quote(selector)});
          if (!element) return false;
          element.click(); return true;
        })()
    """.trimIndent(), "visible standard UI control $selector", revealControls = true)

    private fun mouseSeek(view: WebView, selector: String, fraction: Double) = awaitJavascript(view, """
        (() => { $visibleElementScript
          const bar = visible(${JSONObject.quote(selector)});
          if (!bar) return false;
          const rect = bar.getBoundingClientRect();
          const input = {bubbles:true, clientX:rect.left+rect.width*$fraction, clientY:rect.top+rect.height/2, button:0};
          bar.dispatchEvent(new MouseEvent('mousedown', input));
          document.dispatchEvent(new MouseEvent('mouseup', input));
          return true;
        })()
    """.trimIndent(), "visible standard seek control", revealControls = true)

    private fun chooseSetting(view: WebView, title: String, index: Int? = null, label: String? = null) {
        val root = ".bmpui-ui-settings-panel-item:not(.bmpui-ui-settings-panel-item-select-option)"
        val titleJson = JSONObject.quote(title)
        val rootVisible = javascript(view, """
            (() => { $visibleElementScript
              return [...document.querySelectorAll('$root')].some(element =>
                element.textContent.trim().startsWith($titleJson) && visible('#' + element.id));
            })()
        """.trimIndent()) == "true"
        if (!rootVisible) clickWeb(view, ".bmpui-ui-settingstogglebutton")
        awaitJavascript(view, """
            (() => { $visibleElementScript
              const element = [...document.querySelectorAll('$root')].find(item => item.textContent.trim().startsWith($titleJson));
              if (!element) return false;
              element.scrollIntoView({block:'nearest'});
              if (!visible('#' + element.id)) return false;
              element.click(); return true;
            })()
        """.trimIndent(), "visible $title settings page", revealControls = true)
        awaitJavascript(view, """
            (() => { $visibleElementScript
              const options = [...document.querySelectorAll('.bmpui-ui-settings-panel-item-select-option')];
              const option = ${if (label != null) "options.find(item => item.textContent.trim() === ${JSONObject.quote(label)})" else "options[$index]"};
              if (!option) return false;
              option.scrollIntoView({block:'nearest'});
              if (!visible('#' + option.id)) return false;
              option.click(); return true;
            })()
        """.trimIndent(), "visible $title option", revealControls = true)
        clickWeb(view, ".bmpui-ui-settingspanelpagebackbutton")
    }

    private fun probeSync(phase: String) {
        val player = ui.activity.controller.player
        if (!player.isLive) return
        val now = SystemClock.uptimeMillis()
        lastProbeUptime = now
        println("LIVE_SYNC_SAFE phase=$phase ms=$now position=${player.currentTime} offset=${player.timeShift} latency=${player.lowLatency.latency} target=${player.lowLatency.targetLatency} videoBuffer=${player.buffer.getLevel(BufferType.ForwardDuration, MediaType.Video).level} audioBuffer=${player.buffer.getLevel(BufferType.ForwardDuration, MediaType.Audio).level} playing=${player.isPlaying} seekableStart=${player.source?.seekableRange?.start} seekableEnd=${player.source?.seekableRange?.end} userPlaybackSpeed=${player.playbackSpeed} catchupRate=${player.lowLatency.catchupConfig?.playbackRate} catchupSeek=${player.lowLatency.catchupConfig?.seekThreshold} fallbackRate=${player.lowLatency.fallbackConfig?.playbackRate}")
        player.lowLatency.getTargetPlaybackLatency { effective ->
            println("LIVE_SYNC_SAFE phase=$phase referenceMs=$now effectiveTarget=$effective callbackMs=${SystemClock.uptimeMillis()}")
        }
    }

    private fun await(label: String, predicate: () -> Boolean) {
        ui.waitUntil(timeoutMillis = 40_000) {
            var ready = false
            ui.runOnUiThread {
                ready = predicate()
                if (SystemClock.uptimeMillis() - lastProbeUptime >= 1000) probeSync("poll")
            }
            ready || errors.isNotEmpty() || ui.activity.controller.lastErrorCode != null
        }
        assertTrue("$label; Player/Source error codes: $errors", errors.isEmpty())
        assertEquals("$label; app Player/Source error code", null, ui.activity.controller.lastErrorCode)
    }

    private fun javascript(view: WebView, script: String): String? {
        val done = CountDownLatch(1)
        var result: String? = null
        ui.runOnUiThread { view.evaluateJavascript(script) { result = it; done.countDown() } }
        assertTrue("Web UI JavaScript callback timed out", done.await(5, TimeUnit.SECONDS))
        return result
    }

    private fun awaitJavascript(
        view: WebView,
        script: String,
        label: String = "Shared UI DOM/styles",
        revealControls: Boolean = false,
        predicate: () -> Boolean = { true },
    ) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(40)
        var readyPolls = 0
        var lastTouchReveal = 0L
        while (System.nanoTime() < deadline && errors.isEmpty() && ui.activity.controller.lastErrorCode == null) {
            var ready = false
            ui.runOnUiThread {
                ready = predicate()
                if (SystemClock.uptimeMillis() - lastProbeUptime >= 1000) probeSync("poll")
            }
            if (ready) {
                readyPolls++
                if (revealControls) {
                    movePointerInside(view)
                }
                if (javascript(view, script) == "true") {
                    ui.runOnUiThread { ready = predicate() && errors.isEmpty() && ui.activity.controller.lastErrorCode == null }
                    if (ready) {
                        if (label == "return to live completes in the SDK and shared UI") ui.runOnUiThread {
                            val player = ui.activity.controller.player
                            probeSync("accepted")
                            println("LIVE_RETURN_ACCEPTED ms=${SystemClock.uptimeMillis()} position=${player.currentTime} offset=${player.timeShift} latency=${player.lowLatency.latency} target=${player.lowLatency.targetLatency} requests=${timeShiftRequests.get()} completions=${timeShiftCompletions.get()} visibleLive=true")
                        }
                        return
                    }
                }
                // Touch UI can auto-hide again while a native seek settles. Reveal
                // only an empty, currently hidden overlay, using the real window route.
                if (revealControls && SystemClock.uptimeMillis() - lastTouchReveal >= 1000 && revealTouchControls(view)) {
                    lastTouchReveal = SystemClock.uptimeMillis()
                }
            }
            Thread.sleep(100)
        }
        var native = ""
        ui.runOnUiThread {
            val player = ui.activity.controller.player
            native = "requests=${timeShiftRequests.get()} completions=${timeShiftCompletions.get()} readyPolls=$readyPolls " +
                "position=${player.currentTime} completedPosition=${completedTimeShiftPosition.get()} " +
                "offset=${player.timeShift} maxOffset=${player.maxTimeShift} playing=${player.isPlaying} " +
                "latency=${player.lowLatency.latency} targetLatency=${player.lowLatency.targetLatency} " +
                "observations=${timeShiftObservations.takeLast(8)}"
        }
        // Diagnose a missed native condition separately from hidden or stale Web UI state.
        // Only live-control text, numeric playback state and CSS visibility are captured.
        val dom = runCatching { javascript(view, """
            JSON.stringify([...document.querySelectorAll('.bmpui-ui-label-behindlive,.bmpui-ui-livebutton,.bmpui-ui-settings-panel-item,.bmpui-ui-settingspanelpagebackbutton,.bmpui-ui-settingstogglebutton')].slice(0, 24).map(element => {
              const rect = element.getBoundingClientRect();
              return {text:element.textContent.trim(), classes:element.className, rect:{x:rect.x,y:rect.y,w:rect.width,h:rect.height},
                hiddenBy:[element,...(function*(){for(let n=element.parentElement;n;n=n.parentElement)yield n;})()].flatMap(node => {
                  const style=getComputedStyle(node);
                  return style.display==='none'||style.visibility!=='visible'||Number(style.opacity)<=0
                    ? [{classes:node.className,display:style.display,visibility:style.visibility,opacity:style.opacity}] : [];
                })};
            }))
        """.trimIndent()) }.getOrDefault("unavailable")
        assertTrue(
            "$label did not settle; error codes: $errors; startup code: ${ui.activity.controller.lastErrorCode}; $native; dom=$dom",
            false,
        )
    }

    private fun revealTouchControls(view: WebView): Boolean {
        val geometry = javascript(view, """
            (() => { $visibleElementScript
              if (visible('.bmpui-ui-controlbar') || visible('.bmpui-ui-settings-panel')) return null;
              const interactive = 'button,a,input,select,textarea,[role="button"],[role="slider"],[role="checkbox"],[role="radio"],[contenteditable="true"]';
              const surface = '.bmpui-ui-touch-control-overlay,.bmpui-ui-playerinfo-card,.bmpui-ui-scoreboard-strip,.bmpui-ui-uicontainer';
              for (const root of document.querySelectorAll(surface)) {
                const rect = root.getBoundingClientRect();
                const left = Math.max(4, rect.left), right = Math.min(innerWidth - 4, rect.right);
                const top = Math.max(4, rect.top), bottom = Math.min(innerHeight - 4, rect.bottom);
                if (right - left < 16 || bottom - top < 16) continue;
                for (const [fx, fy] of [[.25,.25],[.5,.5],[.75,.25]]) {
                  const x = left + (right - left) * fx, y = top + (bottom - top) * fy;
                  const target = document.elementFromPoint(x, y);
                  if (!target || target.closest(interactive) || !root.contains(target)) continue;
                  const passiveCard = root.matches('.bmpui-ui-playerinfo-card,.bmpui-ui-scoreboard-strip');
                  if (!passiveCard && target !== root) continue;
                  return {x:x/innerWidth,y:y/innerHeight,gesture:'tap'};
                }
              }
              // A full-video playback button leaves no inert tap target. A drag
              // reveals its UIContainer through touchend without clicking Play/Pause.
              for (const fx of [.5,.75,.25]) {
                const y = innerHeight * .25, endY = innerHeight * .55;
                const first = document.elementFromPoint(innerWidth * fx, y);
                const last = document.elementFromPoint(innerWidth * fx, endY);
                const button = first?.closest('.bmpui-ui-hugeplaybacktogglebutton');
                if (button && last?.closest('.bmpui-ui-hugeplaybacktogglebutton') === button &&
                    button.closest('.bmpui-ui-playbacktoggle-overlay')) {
                  return {x:fx,y:y/innerHeight,endY:endY/innerHeight,gesture:'drag'};
                }
              }
              return null;
            })()
        """.trimIndent())
        if (geometry == null || geometry == "null") return false
        val point = JSONObject(geometry)
        val x = point.getDouble("x").toFloat()
        val y = point.getDouble("y").toFloat()
        require(x in 0.01f..0.99f && y in 0.01f..0.99f)
        if (point.getString("gesture") == "drag") {
            val endY = point.getDouble("endY").toFloat()
            require(endY in 0.01f..0.99f)
            workspaceSwipeVisiblePlayer(ui, view, x, y, endY)
        } else {
            workspaceTapVisiblePlayer(ui, view, x, y)
        }
        ui.runOnUiThread {
            println("NATIVE_UI_SAFE action=reveal-geometry gesture=${point.getString("gesture")} nativeInput=true visibleViewport=true playing=${ui.activity.controller.player.isPlaying}")
        }
        return true
    }

    private fun movePointerInside(view: WebView) {
        ui.runOnUiThread {
            val now = SystemClock.uptimeMillis()
            pointerSide = !pointerSide
            val x = view.width * if (pointerSide) 0.3f else 0.4f
            val event = MotionEvent.obtain(now, now, MotionEvent.ACTION_HOVER_MOVE, x, view.height / 3f, 0)
            event.source = InputDevice.SOURCE_MOUSE
            try {
                view.dispatchGenericMotionEvent(event)
            } finally {
                event.recycle()
            }
        }
    }

    private val visibleElementScript = """
        const visible = selector => [...document.querySelectorAll(selector)].find(element => {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          for (let node = element; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0) return false;
          }
          return true;
        });
    """.trimIndent()

    private fun sharedLiveUiScript(atEdge: Boolean): String = """
        (() => {
          $visibleElementScript
          const label = visible('.bmpui-ui-label-behindlive');
          const button = visible('.bmpui-ui-livebutton');
          if (!label || !button) return false;
          const text = label.textContent.trim();
          return $atEdge
            ? text === 'LIVE' && button.classList.contains('bmpui-at-live-edge')
              && !button.classList.contains('bmpui-behind-live')
            : text.endsWith(' behind') && button.classList.contains('bmpui-behind-live')
              && !button.classList.contains('bmpui-at-live-edge');
        })()
    """.trimIndent()

    private fun descendants(view: View): List<View> =
        if (view is ViewGroup) (0 until view.childCount).flatMap { index ->
            val child = view.getChildAt(index)
            listOf(child) + descendants(child)
        } else emptyList()
}
