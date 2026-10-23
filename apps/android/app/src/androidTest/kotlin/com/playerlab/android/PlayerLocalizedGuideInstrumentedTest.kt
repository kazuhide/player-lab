package com.playerlab.android

import android.app.LocaleManager
import android.os.LocaleList
import android.os.SystemClock
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@SdkSuppress(minSdkVersion = 33)
class PlayerLocalizedGuideInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun captureSettingsAndAppliedCodeInTheActualAppLanguage() {
        val language = requireNotNull(InstrumentationRegistry.getArguments().getString("guideLocale"))
        assertEquals(language, ui.activity.resources.configuration.locales[0].language)
        assertEquals(apiValue("Default"), apiResultText(ui.activity, "Default"))
        assertEquals(apiValue("Source"), apiResultText(ui.activity, "Source"))
        assertEquals(ui.activity.getString(R.string.ui_command_submitted), apiResultText(ui.activity, Unit))
        if (language == "ja") {
            UiTextCatalog.resources.forEach { (source, id) ->
                val translated = ui.activity.getString(id)
                // The Japanese navigation uses the literal technical label API.
                if (source == "APIs") assertEquals("API", translated)
                else assertTrue("Japanese resource must be packaged for $id", translated.any { it in '\u3040'..'\u9fff' })
            }
        }
        loadSample()
        workspaceSetting(ui, "source-url")
        ui.onNodeWithTag("workspace-settings").assertTextContains(if (language == "ja") "設定" else "Settings")
        ui.onNodeWithTag("apply-source").assertIsDisplayed().assertTextContains(if (language == "ja") "ソースに適用" else "Apply source")
        ApiGuideScreenshot.capture("android-source-settings", ui.activity)

        workspaceSetting(ui, "config-autoplay")
        ui.onNodeWithTag("config-autoplay").assertIsDisplayed().assertIsOn()
        ui.onNodeWithTag("apply-player").assertIsDisplayed()
        ApiGuideScreenshot.capture("android-player-settings", ui.activity)

        val code = workspaceAppliedCode(ui)
        code.assertTextContains("PlayerConfig", substring = true)
        code.assertTextContains("YOUR_PLAYER_KEY", substring = true)
        ApiGuideScreenshot.capture("android-applied-code", ui.activity)
    }

    @Test fun changingAppLanguageKeepsDraftsArgumentsAppliedCodeAndSdkIdentity() {
        loadSample()
        val localeManager = requireNotNull(ui.activity.getSystemService(LocaleManager::class.java))
        val originalLocales = localeManager.applicationLocales
        val originalLanguage = ui.activity.resources.configuration.locales[0].language
        val target = if (originalLanguage == "ja") "en" else "ja"
        val controller = ui.activity.controller
        val player = controller.player
        val source = controller.configuredSource
        val appliedTitle = controller.sourceSettings.title
        try {
            workspaceField(ui, "source-title", "Default")
            workspaceCommand(ui, "android:com.bitmovin.player.api.Player.seek()")
            workspaceField(ui, "api-argument-time", "7.25")
            ui.runOnUiThread { localeManager.applicationLocales = LocaleList.forLanguageTags(target) }
            ui.waitUntil(10_000) {
                ui.activity.resources.configuration.locales[0].language == target &&
                    runCatching { ui.onNodeWithTag("workspace-settings").assertTextContains(if (target == "ja") "設定" else "Settings") }.isSuccess
            }
            assertSame(controller, ui.activity.controller)
            assertSame(player, controller.player)
            assertSame(source, controller.configuredSource)
            ui.onNodeWithTag("api-argument-time").assert(editable("7.25"))
            workspaceSetting(ui, "source-title")
            ui.onNodeWithTag("source-title").assert(editable("Default"))
            assertEquals("Unapplied title must remain a draft", appliedTitle, controller.sourceSettings.title)
            workspaceAppliedCode(ui).assertTextContains("PlayerConfig", substring = true)

            // A user string that matches a translated label must still reach the SDK unchanged.
            workspaceClick(ui, "apply-source")
            await { controller.configuredSource?.config?.title == "Default" }
            workspaceState(ui, "android:com.bitmovin.player.api.source.Source.config")
                .assertTextContains("Default", substring = true)
            assertEquals("Default", controller.configuredSource?.config?.title)
        } finally {
            ui.runOnUiThread { localeManager.applicationLocales = originalLocales }
            ui.waitUntil(10_000) { ui.activity.resources.configuration.locales[0].language == originalLanguage }
        }
    }

    private fun editable(value: String) = SemanticsMatcher.expectValue(SemanticsProperties.EditableText, androidx.compose.ui.text.AnnotatedString(value))

    private fun loadSample() {
        val controller = ui.activity.controller
        ui.runOnUiThread {
            controller.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8", SourceType.Hls, title = "Player Lab sample"))
            controller.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true))
        }
        await { controller.player.isPlaying && controller.player.currentTime > 0.5 }
    }

    private fun await(condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 45_000
        while (SystemClock.uptimeMillis() < deadline) {
            var ready = false
            ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail("Actual SDK state did not arrive")
    }
}
