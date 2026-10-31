package com.playerlab.android

import android.content.Context
import android.app.LocaleManager
import android.os.Build
import android.os.LocaleList
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith

/** Real Compose actions exercise persistence and draft ownership without applying SDK settings. */
@RunWith(AndroidJUnit4::class)
class PlayerConfigurationProfilesInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private var previous: Map<String, Any?>? = null
    private var previousLocale: String? = null
    @Before fun preserveInitialProfiles() {
        if (Build.VERSION.SDK_INT >= 33) previousLocale = ui.activity.getSystemService(LocaleManager::class.java)?.applicationLocales?.toLanguageTags()
        val preferences = ui.activity.getSharedPreferences(AndroidConfigurationProfileStorage.STORE, Context.MODE_PRIVATE)
        previous = preferences.all.mapValues { (_, value) -> if (value is Set<*>) value.toSet() else value }
        check(preferences.edit().clear().commit())
    }
    @After fun restoreInitialProfiles() {
        try {
            val values = previous ?: return
            val editor = ui.activity.getSharedPreferences(AndroidConfigurationProfileStorage.STORE, Context.MODE_PRIVATE).edit().clear()
            values.forEach { (key, value) -> when (value) {
                null -> editor.remove(key)
                is String -> editor.putString(key, value)
                is Boolean -> editor.putBoolean(key, value)
                is Int -> editor.putInt(key, value)
                is Long -> editor.putLong(key, value)
                is Float -> editor.putFloat(key, value)
                is Set<*> -> { check(value.all { it is String }); editor.putStringSet(key, value.filterIsInstance<String>().toSet()) }
                else -> error("Unsupported preference value type.")
            } }
            check(editor.commit())
        } finally {
            val languageTags = previousLocale
            if (Build.VERSION.SDK_INT >= 33 && languageTags != null) ui.runOnUiThread {
                ui.activity.getSystemService(LocaleManager::class.java)?.let { manager ->
                    if (manager.applicationLocales.toLanguageTags() != languageTags) manager.applicationLocales = LocaleList.forLanguageTags(languageTags)
                }
            }
        }
    }
    private fun profiles() {
        ui.onNodeWithTag("workspace-settings").performClick()
        workspaceChoose(ui, "settings-page", "Profiles")
        ui.waitUntil(5_000) { runCatching { ui.onNodeWithTag("profile-name").assertIsEnabled() }.isSuccess }
    }
    private fun status(message: String) {
        val localized = workspaceLocalizedLabel(ui, message)
        ui.waitUntil(5_000) { runCatching { ui.onNodeWithTag("profile-status").assertTextContains(localized, substring = true) }.isSuccess }
    }

    @Test fun savedProfileSurvivesActivityRestartAndRestoresOnlyDrafts() {
        workspaceField(ui, "source-offset", "23")
        profiles()
        ui.onNodeWithTag("profile-name").performTextReplacement("Source")
        workspaceHideKeyboard(ui)
        ui.onNodeWithTag("profile-save").assertIsDisplayed().performClick()
        status("Profile saved.")
        ui.activityRule.scenario.recreate()
        ui.waitForIdle()
        val controller = ui.activity.controller
        val owner = controller.player; val source = controller.configuredSource
        val revision = controller.sourceRevision; val generation = controller.apiPlayerGeneration
        assertNull(controller.sourceSettings.startOffset)
        profiles()
        workspaceChoose(ui, "profile-selector", "Source")
        ui.onNodeWithTag("profile-selector").assertTextContains("Source", substring = true)
        ui.onNodeWithTag("profile-restore").assertIsDisplayed().performClick()
        status("Loaded into drafts. Playback is unchanged.")
        ui.runOnIdle {
            assertSame(owner, controller.player); assertSame(source, controller.configuredSource)
            assertEquals(revision, controller.sourceRevision); assertEquals(generation, controller.apiPlayerGeneration)
            assertNull(controller.sourceSettings.startOffset)
        }
        workspaceSetting(ui, "source-offset")
        ui.onNodeWithTag("source-offset").assert(hasText("23"))
        profiles(); ui.onNodeWithTag("profile-delete").assertIsDisplayed().performClick()
        ui.onNodeWithTag("profile-delete-confirm").performClick(); status("Profile deleted.")
        assertTrue(ConfigurationProfileRepository(AndroidConfigurationProfileStorage(ui.activity), BuildConfig.PLAYER_SDK_VERSION).list().isEmpty())
        ui.runOnIdle { assertSame(owner, controller.player); assertSame(source, controller.configuredSource) }
    }

    @Test fun differentSdkRequiresVisibleConfirmationBeforeDraftRestoration() {
        val controller = ui.activity.controller
        val saved = ConfigurationProfiles.capture("Earlier SDK", "0.0.0", SourceDraft.from(controller.sourceSettings).copy(startOffset = "23"), PlayerDraft.from(controller.playerSettings), emptyMap())
        ConfigurationProfileRepository(AndroidConfigurationProfileStorage(ui.activity), BuildConfig.PLAYER_SDK_VERSION).save(saved)
        workspaceField(ui, "source-offset", "99")
        val owner = controller.player; val source = controller.configuredSource
        profiles(); workspaceChoose(ui, "profile-selector", "Earlier SDK")
        ui.onNodeWithTag("profile-restore").performClick()
        ui.onNodeWithTag("profile-sdk-confirm").assertIsDisplayed()
        ui.onNodeWithText(workspaceLocalizedLabel(ui, "Cancel")).performClick()
        workspaceSetting(ui, "source-offset"); ui.onNodeWithTag("source-offset").assert(hasText("99"))
        profiles(); ui.onNodeWithTag("profile-restore").performClick(); ui.onNodeWithTag("profile-sdk-confirm").performClick()
        status("Loaded into drafts. Playback is unchanged.")
        workspaceSetting(ui, "source-offset"); ui.onNodeWithTag("source-offset").assert(hasText("23"))
        ui.runOnIdle { assertSame(owner, controller.player); assertSame(source, controller.configuredSource) }
    }
}
