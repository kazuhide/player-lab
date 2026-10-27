package com.playerlab.android

import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** GUI eligibility follows the SDK objects currently attached to the host. */
@RunWith(AndroidJUnit4::class)
class NativeTargetAvailabilityInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val prefix = "android:com.bitmovin.player.api."

    @Test fun renderTargetArgumentsFollowViewTypeAndDetachmentWhileNoneRemainsAvailable() {
        val c = prepareSource()
        await("The default view has a valid SurfaceView surface") { apiCommandCapabilities(c).surfaceReady }
        ui.runOnUiThread { c.player.pause() }
        choose("Player.setTextureView()")
        ui.onNodeWithTag("api-command-run").assertIsNotEnabled()
        field("target", "None")
        ui.onNodeWithTag("api-command-run").assertIsEnabled()
        choose("Player.setSurface()")
        ui.onNodeWithTag("api-command-run").assertIsEnabled()
        workspaceCommand(ui, "android:com.bitmovin.player.PlayerView.player")
        field("attachCurrentPlayer", "false")
        runCommand()
        ui.runOnUiThread { assertNull(c.currentView()) }
        choose("Player.setSurface()")
        ui.onNodeWithTag("api-command-run").assertIsNotEnabled()
        field("target", "None")
        ui.onNodeWithTag("api-command-run").assertIsEnabled()
        choose("Player.setAdViewGroup()")
        ui.onNodeWithTag("api-command-run").assertIsNotEnabled()
        field("target", "None")
        ui.onNodeWithTag("api-command-run").assertIsEnabled()
        workspaceCommand(ui, "android:com.bitmovin.player.PlayerView.player")
        field("attachCurrentPlayer", "true")
        runCommand()
        await("The retained view reattaches") { c.currentView() != null }
        workspaceSdkSetting(ui, "android:com.bitmovin.player.api.ui.PlayerViewConfig.surfaceType")
        workspaceField(ui, "api-setting-value", "TextureView")
        workspaceHideKeyboard(ui)
        workspaceClick(ui, "api-setting-stage")
        workspaceClick(ui, "api-settings-apply")
        ui.waitForIdle()
        await("The applied view uses a real TextureView") { apiCommandCapabilities(c).textureViewAvailable }
        choose("Player.setSurface()")
        field("target", "SurfaceHolder")
        ui.onNodeWithTag("api-command-run").assertIsNotEnabled()
        field("target", "None")
        ui.onNodeWithTag("api-command-run").assertIsEnabled()
        choose("Player.setTextureView()")
        field("target", "Current TextureView")
        ui.onNodeWithTag("api-command-run").assertIsEnabled()
        ui.runOnUiThread { assertNull(c.lastErrorCode) }
    }

    @Test fun rendererMethodsAndCallbackRemovalFollowTheirInstalledHostObjects() {
        val c = prepareSource(vr = true)
        for (member in listOf("vr.VrRenderer.setSourceConfig()", "vr.VrRenderer.addUpdateCallback()", "vr.VrRenderer.removeUpdateCallback()"))
            assertUnavailableChoice(prefix + member)
        choose("vr.VrApi.setVrRenderer()")
        field("enabled", "true")
        runCommand()
        await("The host renderer is installed") { c.apiVrRenderer != null }
        choose("vr.VrRenderer.setSourceConfig()")
        field("source", "None")
        ui.onNodeWithTag("api-command-run").assertIsEnabled()
        runCommand()
        assertUnavailableChoice(prefix + "vr.VrRenderer.removeUpdateCallback()")
        choose("vr.VrRenderer.addUpdateCallback()")
        runCommand()
        ui.runOnUiThread { assertTrue("Registration exists without waiting for a rendered callback result", "frame-observer" in c.apiVrCallbackHandles) }
        choose("vr.VrRenderer.removeUpdateCallback()")
        ui.onNodeWithTag("api-command-run").assertIsEnabled()
        runCommand()
        ui.onNodeWithTag("api-command-run").assertIsNotEnabled()
        choose("vr.VrApi.setVrRenderer()")
        field("enabled", "false")
        runCommand()
        await("The standard PlayerView returns") { c.apiVrRenderer == null && c.currentView() != null }
        assertUnavailableChoice(prefix + "vr.VrRenderer.setSourceConfig()")
        assertUnavailableChoice(prefix + "vr.VrRenderer.addUpdateCallback()")
    }

    private fun prepareSource(vr: Boolean = false): PlayerController {
        val c = ui.activity.controller
        ui.runOnUiThread {
            c.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8", SourceType.Hls))
            c.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true),
                if (vr) ApiOverrides(mapOf(prefix + "vr.VrConfig.vrContentType" to "Single")) else ApiOverrides())
        }
        ui.waitForIdle()
        await("The existing baseline HLS source plays") { c.player.isPlaying && c.player.currentTime > 0.5 && c.currentView() != null }
        return c
    }

    private fun choose(member: String) = workspaceCommand(ui, prefix + member)
    private fun field(name: String, value: String) {
        workspaceField(ui, "api-argument-$name", value)
        workspaceHideKeyboard(ui)
    }
    private fun runCommand() {
        ui.onNodeWithTag("api-command-run").performClick()
        ui.onNodeWithTag("api-command-result").assertTextContains("Command submitted", substring = true)
    }
    private fun assertUnavailableChoice(id: String) {
        ui.onNodeWithTag("workspace-apis").performClick()
        ui.onNodeWithTag("api-section-Commands").performClick()
        workspaceChoose(ui, "api-command-category", apiPurpose(id))
        ui.onNodeWithTag("api-command-selector").performClick()
        ui.onNodeWithTag("api-command-selector-search").performTextReplacement(id)
        ui.onNodeWithTag("api-command-selector-option-$id").assertIsNotEnabled()
        ui.onNodeWithText(workspaceLocalizedLabel(ui, "Close")).performClick()
    }
    private fun await(label: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 45_000
        while (SystemClock.uptimeMillis() < deadline) {
            ui.waitForIdle()
            var ready = false
            ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail(label)
    }
}
