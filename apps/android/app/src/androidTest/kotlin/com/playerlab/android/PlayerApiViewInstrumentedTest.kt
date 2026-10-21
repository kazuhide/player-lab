package com.playerlab.android

import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.espresso.Espresso.pressBack
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlayerApiViewInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun viewSubscriptionsRenderBindingAndLifecycleStayOwned() {
        val c = ui.activity.controller
        ui.runOnUiThread {
            c.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8", SourceType.Hls))
            c.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true))
        }
        await("VOD playback") { c.player.isPlaying && c.player.currentTime > 0.5 }
        click("api-runtime-toggle")
        choose("PlayerView.on()")
        field("api-argument-subscription", "repeat-pause")
        field("api-argument-event", "PlayerEvent.Paused")
        click("api-command-run")
        choose("api.Player.pause()")
        click("api-command-run")
        await("PlayerView event callback") { (c.apiEvents["PlayerView.PlayerEvent.Paused"] ?: 0) == 1 }
        choose("PlayerView.off()")
        field("api-argument-subscription", "repeat-pause")
        click("api-command-run")
        choose("PlayerView.next()")
        field("api-argument-subscription", "play-once")
        field("api-argument-event", "PlayerEvent.Play")
        click("api-command-run")
        choose("api.Player.play()")
        click("api-command-run")
        await("One shot event") { (c.apiEvents["PlayerView.PlayerEvent.Play"] ?: 0) == 1 }
        choose("api.Player.pause()")
        click("api-command-run")
        await("Paused after off") { c.player.isPaused }
        choose("api.Player.play()")
        click("api-command-run")
        await("Resumed after once") { c.player.isPlaying }
        ui.runOnUiThread {
            assertEquals(1, c.apiEvents["PlayerView.PlayerEvent.Play"])
            assertEquals(1, c.apiEvents["PlayerView.PlayerEvent.Paused"])
        }
        choose("api.Player.setSurface()")
        field("api-argument-target", "Surface")
        click("api-command-run")
        var before = 0.0
        ui.runOnUiThread { before = c.player.currentTime }
        await("Playback advances on bound Surface") { c.player.currentTime > before + 0.3 }
        choose("PlayerView.onDestroy()")
        var oldView: com.bitmovin.player.PlayerView? = null
        ui.runOnUiThread { oldView = c.currentView() }
        click("api-command-run")
        await("View recreated") { c.currentView() != null && c.currentView() !== oldView && c.player.isPlaying }
        choose("api.Player.destroy()")
        val oldPlayer = c.player
        click("api-command-run")
        await("Player recreated and plays") { oldPlayer.isDestroyed && c.player !== oldPlayer && c.player.isPlaying && c.player.currentTime > 0.5 }
        ui.runOnUiThread { assertNull(c.lastErrorCode) }
    }

    @Test fun installedHostHandlersExpandAndRestoreTheActualVideoView() {
        val c = ui.activity.controller
        await("PlayerView attached") { c.currentView() != null }
        click("api-runtime-toggle")
        choose("PlayerView.setFullscreenHandler()")
        click("api-command-run")
        choose("PlayerView.enterFullscreen()")
        click("api-command-run")
        await("Fullscreen host and SDK agree") { c.apiFullscreen && c.currentView()?.isFullscreen == true }
        pressBack()
        await("Back restores controls") { !c.apiFullscreen && c.currentView()?.isFullscreen == false }
        choose("PlayerView.setPictureInPictureHandler()")
        click("api-command-run")
        ui.runOnUiThread { assertTrue("This emulator supports PiP", c.currentView()!!.isPictureInPictureAvailable) }
        choose("PlayerView.enterPictureInPicture()")
        click("api-command-run")
        await("Android entered PiP") { ui.activity.isInPictureInPictureMode && c.apiPictureInPicture }
        ui.runOnUiThread { c.currentView()!!.exitPictureInPicture() }
        await("PiP restores activity") { !ui.activity.isInPictureInPictureMode && !c.apiPictureInPicture }
        choose("PlayerView.setCustomMessageHandler()")
        field("api-argument-reply", "acknowledged")
        click("api-command-run")
        ui.onNodeWithTag("api-command-result").assertTextContains("Command submitted", substring = true)
    }

    private fun choose(member: String) {
        field("api-runtime-search", member)
        click("api-command-android:com.bitmovin.player.$member")
    }
    private fun click(tag: String) = ui.onNodeWithTag(tag).performScrollTo().performClick()
    private fun field(tag: String, value: String) {
        ui.onNodeWithTag(tag).performScrollTo().performTextReplacement(value)
        closeSoftKeyboard()
    }
    private fun await(label: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 45_000
        while (SystemClock.uptimeMillis() < deadline) {
            var ready = false
            ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail(label)
    }
}
