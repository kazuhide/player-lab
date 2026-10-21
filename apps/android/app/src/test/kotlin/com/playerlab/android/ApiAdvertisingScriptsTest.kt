package com.playerlab.android

import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.advertising.AdItem
import com.bitmovin.player.api.advertising.AdSource
import com.bitmovin.player.api.advertising.AdSourceType
import com.bitmovin.player.api.advertising.vast.macro.*
import com.bitmovin.player.api.media.video.quality.VideoAdaptationData
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Test

class ApiAdvertisingScriptsTest {
    private fun id(member: String) = "android:com.bitmovin.player.api.$member"
    @Test fun videoAdaptationBodySurvivesOtherConfigEditsRegardlessOfOrder() {
        val values = linkedMapOf(id("media.AdaptationConfig.videoAdaptation") to "return 'manual-' + input.suggested;",
            id("media.AdaptationConfig.initialBandwidthEstimateOverride") to "500000")
        for (draft in listOf(values, values.entries.reversed().associate { it.toPair() })) {
            val config = ApiOverrides.validate(draft).player(PlayerConfig()).adaptationConfig
            assertEquals(500000L, config.initialBandwidthEstimateOverride)
            assertEquals("manual-quality", config.videoAdaptation!!.onVideoAdaptation(VideoAdaptationData("quality")))
        }
    }
    @Test fun adPolicyAndMacroBodiesReceiveTypedPublicInputs() {
        val config = ApiOverrides.validate(mapOf(id("advertising.AdvertisingConfig.shouldLoadAdItem") to
            "return input.position === 'pre' && input.sources[0].type === 'Progressive';",
            id("advertising.vast.macro.VastMacroConfig.macroValueProvider") to "return input.name === 'CUSTOM' ? ['lab', input.scope] : input.values;"))
            .player(PlayerConfig()).advertisingConfig
        val source = AdSource(AdSourceType.Progressive, "https://example.invalid/ad.mp4")
        assertTrue(config.shouldLoadAdItem.shouldLoadAdItem(AdItem("pre", source)))
        assertFalse(config.shouldLoadAdItem.shouldLoadAdItem(AdItem("post", source)))
        val scope = VastMacroScope.entries.first()
        assertEquals(listOf("lab", scope.name), config.bitmovin.macro.macroValueProvider!!.provideMacroValues(
            VastMacro("CUSTOM", emptyList()), VastMacroContext(scope)))
    }
    @Test fun castBodyReturnsNativeConfigAndInvalidEnumsUseDefault() {
        val context = ApiCallbackContext()
        val config = ApiOverrides.validate(mapOf(id("casting.RemoteControlConfig.onConfigureMediaInfo") to "return input.type === 'Hls' ? 'Movie' : 'invalid';"))
            .player(PlayerConfig(), context)
        val callback = config.remoteControlConfig.onConfigureMediaInfo!!
        assertEquals(com.bitmovin.player.api.casting.GoogleCastMediaType.Movie, callback.onConfigure(SourceConfig("https://example.invalid/a.m3u8", SourceType.Hls)).mediaType)
        assertEquals(com.bitmovin.player.api.casting.GoogleCastMediaType.Generic, callback.onConfigure(SourceConfig("https://example.invalid/a.mpd", SourceType.Dash)).mediaType)
        assertEquals(2 to 1, context.snapshot()[id("casting.RemoteControlConfig.onConfigureMediaInfo")])
    }
}
