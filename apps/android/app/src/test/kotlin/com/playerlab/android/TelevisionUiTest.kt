package com.playerlab.android

import com.bitmovin.player.api.ui.UiConfig
import org.junit.Assert.*
import org.junit.Test

class TelevisionUiTest {
    @Test fun defaultControlsUseTheActualDeviceInputModel() {
        val phone = playerViewConfig(UiMode.DEFAULT, television = false).uiConfig as UiConfig.WebUi
        val tv = playerViewConfig(UiMode.DEFAULT, television = true).uiConfig as UiConfig.WebUi
        assertEquals(UiConfig.WebUi.Variant.SmallScreenUi, phone.variant)
        assertFalse(phone.focusUiOnInitialization)
        assertEquals(UiConfig.WebUi.Variant.TvUi, tv.variant)
        assertTrue(tv.focusUiOnInitialization)
    }

    @Test fun televisionDoesNotReplaceAnExplicitCustomTheme() {
        val sports = playerViewConfig(UiMode.SPORTS, television = true).uiConfig as UiConfig.WebUi
        assertEquals("bitmovin.playerui.UIFactory.buildSportsUI", (sports.variant as UiConfig.WebUi.Variant.Custom).uiManagerFactoryFunction)
    }

    @Test fun appliedCodeShowsTheTelevisionVariantAndItsFocusPolicy() {
        val source = SourceSettings.from(Sources.all.first())
        val phone = configurationCode(source, PlayerSettings(), UiMode.DEFAULT)
        val tv = configurationCode(source, PlayerSettings(), UiMode.DEFAULT, television = true)
        assertTrue(phone.contains("val playerViewConfig = PlayerViewConfig()"))
        assertTrue(tv.contains("variant = UiConfig.WebUi.Variant.TvUi"))
        assertTrue(tv.contains("focusUiOnInitialization = true"))
        assertTrue(tv.contains("YOUR_PLAYER_KEY"))
    }

    @Test fun appliedCodeDistinguishesTheUiOnlyPreferenceFromSdkTimeShifting() {
        val source = SourceSettings.from(Sources.all.first())
        val code = configurationCode(source, PlayerSettings(), UiMode.DEFAULT, liveRewindEnabled = false)
        assertTrue(code.contains("isTimeShiftEnabled = true"))
        assertTrue(code.contains("customOptions = \"{\\\"playerLabLiveRewindEnabled\\\":false}\""))
    }
}
