package com.playerlab.android

import org.junit.Assert.*
import org.junit.Test

class UiLocalizationTest {
    @Test fun everyAppOwnedSettingHelpParagraphHasAJapaneseResource() {
        val missing = ApiSettings.fields.flatMap { field ->
            apiHelpText(field.help).paragraphs.filter { it.isNotEmpty() && it !in UiTextCatalog.resources }.map { field.id to it }
        }
        assertTrue("Missing app-owned help translations:\n${missing.distinctBy { it.second }.joinToString("\n") { it.second }}", missing.isEmpty())
    }

    @Test fun configurationAndAppCommandLabelsHaveResourcesWithoutChangingTheirIds() {
        val labels = configurationItems.map { it.label } + WorkspaceTab.entries.map { it.label } +
            ApiRuntime.commands.filter { it.id.startsWith("app:") }.map { it.label }
        val missing = labels.filter { it !in UiTextCatalog.resources }
        assertTrue("Missing app-owned labels: $missing", missing.isEmpty())
        assertEquals("source-url", configurationItems.first().id)
        assertTrue(ApiRuntime.commands.any { it.id == "android:com.bitmovin.player.api.Player.seek()" })
    }

    @Test fun callbackExamplesAreNeverTreatedAsTranslatedProse() {
        val field = ApiSettings.fields.first { it.id.endsWith("media.LabelingConfig.videoQualityLabeler") }
        val text = apiHelpText(field.help)
        assertEquals("return input.height + 'p';", text.example)
        assertFalse(text.example in UiTextCatalog.resources)
        assertEquals(2, text.paragraphs.size)
        assertTrue("true" !in UiTextCatalog.resources && "false" !in UiTextCatalog.resources && "null" !in UiTextCatalog.resources)
    }
}
