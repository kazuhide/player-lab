package com.playerlab.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.api.ui.PlayerViewConfig
import com.bitmovin.player.api.ui.UiConfig
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LiveRewindUiInstrumentedTest {
    @Test fun hostPreferencePreservesUserOptionsAndExplicitUiConfiguration() {
        val original = UiConfig.WebUi(
            customOptions = """{"metadata":{"title":"Example"},"playerLabLiveRewindEnabled":true}""",
            supplementalCssLocation = "file:///android_asset/custom.css",
            variant = UiConfig.WebUi.Variant.TvUi,
        )
        val result = liveRewindViewConfig(PlayerViewConfig(uiConfig = original), false).uiConfig as UiConfig.WebUi
        val options = JSONObject(result.customOptions!!)
        assertFalse(options.getBoolean("playerLabLiveRewindEnabled"))
        assertEquals("Example", options.getJSONObject("metadata").getString("title"))
        assertEquals(original.variant, result.variant)
        assertEquals(original.supplementalCssLocation, result.supplementalCssLocation)
        assertTrue(result.focusUiOnInitialization)
        assertTrue(JSONObject((liveRewindViewConfig(PlayerViewConfig(), true).uiConfig as UiConfig.WebUi).customOptions!!)
            .getBoolean("playerLabLiveRewindEnabled"))
    }

    @Test fun disabledUiAndInvalidCustomOptionsKeepTheirExistingSdkHandling() {
        val disabled = PlayerViewConfig(uiConfig = UiConfig.Disabled)
        val invalid = PlayerViewConfig(uiConfig = UiConfig.WebUi(customOptions = "not JSON"))
        assertSame(disabled, liveRewindViewConfig(disabled, false))
        assertSame(invalid, liveRewindViewConfig(invalid, false))
    }
}
