package com.playerlab.android

import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.SeekMode
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Test

class ApiSettingsTest {
    private fun id(member: String) = "android:com.bitmovin.player.api.$member"

    @Test fun signed_live_buffer_depth_reaches_legacy_and_source_sdk_configuration() {
        assertEquals(-40.0, com.bitmovin.player.api.live.LiveConfig.DEFAULT_MIN_TIME_SHIFT_BUFFER_DEPTH, 0.0)
        assertEquals(-40.0, com.bitmovin.player.api.live.SourceLiveConfig.DEFAULT_MIN_TIME_SHIFT_BUFFER_DEPTH, 0.0)
        for (depth in listOf(-40.0, -120.5, 0.0)) {
            val overrides = ApiOverrides.validate(mapOf(
                id("live.LiveConfig.minTimeShiftBufferDepth") to depth.toString(),
                id("live.SourceLiveConfig.minTimeShiftBufferDepth") to depth.toString(),
            ))
            assertEquals(depth, overrides.player(PlayerConfig()).liveConfig.minTimeShiftBufferDepth, 0.0)
            val source = overrides.source(SourceConfig("https://example.invalid/live.m3u8", SourceType.Hls))
            assertEquals(depth, source.liveConfig!!.minTimeShiftBufferDepth, 0.0)
            assertTrue(overrides.code().contains("minTimeShiftBufferDepth = $depth"))
        }
    }

    @Test fun overrides_reach_fresh_typed_sdk_owners_and_preserve_the_base() {
        val base = PlayerConfig()
        val overrides = ApiOverrides.validate(mapOf(
            id("PlaybackConfig.handleAudioFocus") to "true",
            id("PlaybackConfig.seekMode") to "ClosestSync",
            id("TweaksConfig.timeChangedInterval") to "0.5",
            id("TweaksConfig.maxRetainedDrmSessions") to "3",
            id("decoder.DecoderConfig.delayDecodingUntilPlayback") to "true",
            id("source.SourceConfig.description") to "Example description",
            id("source.SourceConfig.videoCodecPriority") to "avc, hevc",
        ))
        val applied = overrides.player(base)
        assertTrue(applied.playbackConfig.handleAudioFocus)
        assertEquals(SeekMode.ClosestSync, applied.playbackConfig.seekMode)
        assertEquals(0.5, applied.tweaksConfig.timeChangedInterval, 0.0)
        assertEquals(3, applied.tweaksConfig.maxRetainedDrmSessions)
        assertTrue(applied.playbackConfig.decoderConfig.delayDecodingUntilPlayback)
        assertFalse(base.playbackConfig.handleAudioFocus)
        assertEquals(SeekMode.Exact, base.playbackConfig.seekMode)
        val source = overrides.source(SourceConfig("https://example.invalid/stream.m3u8", SourceType.Hls))
        assertEquals("Example description", source.description)
        assertEquals(listOf("avc", "hevc"), source.videoCodecPriority)
        assertEquals("https://example.invalid/stream.m3u8", source.url)
        assertEquals("avc,hevc", overrides.values[id("source.SourceConfig.videoCodecPriority")])
    }

    @Test fun invalid_values_never_reach_sdk_configuration() {
        for ((field, value) in listOf(
            "TweaksConfig.timeChangedInterval" to "NaN",
            "TweaksConfig.timeChangedInterval" to "0",
            "TweaksConfig.maxRetainedDrmSessions" to "2147483648",
            "PlaybackConfig.seekMode" to "invented",
            "PlaybackConfig.handleAudioFocus" to "yes",
            "source.SourceAdaptationConfig.bandwidthFractionAvailableToUse" to "1.1",
            "source.SourceConfig.videoCodecPriority" to "avc,,hevc",
        )) {
            assertTrue("$field must reject $value", runCatching { ApiOverrides.validate(mapOf(id(field) to value)) }.isFailure)
        }
        assertTrue(runCatching { ApiOverrides.validate(mapOf("unknown" to "true")) }.isFailure)
    }

    @Test fun nullable_fields_and_code_export_retain_exact_user_values() {
        val overrides = ApiOverrides.validate(mapOf(
            id("TweaksConfig.enableMainContentDecodingDuringAds") to "null",
            id("source.SourceConfig.description") to "Text with \"quotes\", \\ and \$variables\nnext line",
        ))
        assertNull(overrides.player(PlayerConfig()).tweaksConfig.enableMainContentDecodingDuringAds)
        val code = overrides.code()
        assertTrue(code.contains("enableMainContentDecodingDuringAds = null"))
        assertTrue(code.contains("\\\"quotes\\\""))
        assertTrue(code.contains("\\\$variables"))
        assertTrue(code.contains("\\nnext line"))
    }

    @Test fun numeric_code_is_canonical_and_empty_codec_lists_are_supported() {
        val overrides = ApiOverrides.validate(mapOf(
            id("TweaksConfig.maxRetainedDrmSessions") to "0003",
            id("TweaksConfig.timeChangedInterval") to ".5",
            id("source.SourceConfig.audioCodecPriority") to "",
        ))
        assertEquals("3", overrides.values[id("TweaksConfig.maxRetainedDrmSessions")])
        assertEquals("0.5", overrides.values[id("TweaksConfig.timeChangedInterval")])
        assertEquals(emptyList<String>(), overrides.source(SourceConfig("https://example.invalid/a.m3u8", SourceType.Hls)).audioCodecPriority)
        assertFalse(overrides.code().contains("0003"))
    }

    @Test fun structured_maps_cmcd_and_view_settings_reach_their_sdk_types() {
        val overrides = ApiOverrides.validate(mapOf(
            id("source.SourceConfig.metadata") to "label=Example\nvalue=a=b",
            id("source.CmcdConfig.Enabled.contentId") to "public-sample",
            id("source.CmcdConfig.Enabled.excludedKeys") to "SessionId,ContentId",
            id("ui.PlayerViewConfig.surfaceType") to "TextureView",
            id("ui.UiConfig.WebUi.focusUiOnInitialization") to "true",
            id("casting.RemoteControlConfig.customReceiverConfig") to "mode=test",
        ))
        val source = overrides.source(SourceConfig("https://example.invalid/a.m3u8", SourceType.Hls))
        assertEquals(mapOf("label" to "Example", "value" to "a=b"), source.metadata)
        val cmcd = source.cmcdConfig as com.bitmovin.player.api.source.CmcdConfig.Enabled
        assertEquals("public-sample", cmcd.contentId)
        assertEquals(2, cmcd.excludedKeys.size)
        val view = overrides.view(com.bitmovin.player.api.ui.PlayerViewConfig())
        assertEquals(com.bitmovin.player.api.ui.SurfaceType.TextureView, view.surfaceType)
        assertTrue((view.uiConfig as com.bitmovin.player.api.ui.UiConfig.WebUi).focusUiOnInitialization)
        assertEquals(mapOf("mode" to "test"), overrides.player(PlayerConfig()).remoteControlConfig.customReceiverConfig)
        assertTrue(runCatching { ApiOverrides.validate(mapOf(id("source.SourceConfig.metadata") to "same=one\nsame=two")) }.isFailure)
        assertTrue(runCatching { ApiOverrides.validate(mapOf(id("source.CmcdConfig.Enabled.contentId") to "x".repeat(65))) }.isFailure)
        assertTrue(runCatching { ApiOverrides.validate(mapOf(id("source.CmcdSessionId.Custom.value") to "")) }.isFailure)
    }

    @Test fun incompatible_union_variants_are_rejected_before_player_replacement() {
        assertTrue(runCatching { ApiOverrides.validate(mapOf(
            id("BandwidthMeterType.Default.bandwidthEstimateWeightLimit") to "2000",
            id("BandwidthMeterType.Experimental.usePreloadHintsForBandwidthEstimation") to "true",
        )) }.isFailure)
        assertTrue(runCatching { ApiOverrides.validate(mapOf(
            id("ui.UiConfig.WebUi.variant") to "TvUi",
            id("ui.UiConfig.WebUi.Variant.Custom.uiManagerFactoryFunction") to "exampleFactory",
        )) }.isFailure)
    }

    @Test fun structured_variant_selection_is_independent_of_edit_order_and_rejects_conflicts() {
        val values = linkedMapOf(
            id("BandwidthEstimationMode.SlidingPercentile.maxSampleCount") to "9",
            id("BandwidthMeterType.Experimental.bandwidthEstimationMode") to "SlidingPercentile",
            id("TweaksConfig.bandwidthMeterType") to "Experimental",
        )
        for (input in listOf(values, values.entries.reversed().associate { it.toPair() })) {
            val config = ApiOverrides.validate(input).player(PlayerConfig())
            val bandwidth = config.tweaksConfig.bandwidthMeterType as com.bitmovin.player.api.BandwidthMeterType.Experimental
            assertEquals(9, (bandwidth.bandwidthEstimationMode as com.bitmovin.player.api.BandwidthEstimationMode.SlidingPercentile).maxSampleCount)
        }
        assertTrue(runCatching { ApiOverrides.validate(values + (id("TweaksConfig.bandwidthMeterType") to "Default")) }.isFailure)
        assertTrue(runCatching { ApiOverrides.validate(mapOf(id("source.SourceConfig.cmcdConfig") to "Disabled", id("source.CmcdConfig.Enabled.contentId") to "sample")) }.isFailure)
        assertTrue(runCatching { ApiOverrides.validate(mapOf(id("source.SourceConfig.drmConfig") to "None", id("drm.DrmConfig.licenseUrl") to "https://example.invalid/license")) }.isFailure)
    }

    @Test fun device_and_live_structures_retain_all_typed_members_and_export_canonical_code() {
        val overrides = ApiOverrides.validate(mapOf(
            id("TweaksConfig.devicesThatRequireSurfaceWorkaround") to "model.1=Example model\ndevice.2=example-device",
            id("LoadErrorFallbackConfig.HttpStatusCode.statusCodes") to "00404, 503",
            id("live.LiveConfig.synchronization") to "Ntp.1=time.example.invalid",
            id("live.SourceLiveConfig.catchupConfig") to "playbackRate=1.1\nseekThreshold=Infinity",
            id("live.SourceLiveConfig.fallbackConfig") to "playbackRate=0.9\nseekThreshold=8",
        ))
        val player = overrides.player(PlayerConfig())
        assertEquals(2, player.tweaksConfig.devicesThatRequireSurfaceWorkaround.size)
        assertEquals(listOf(404, 503), (player.tweaksConfig.loadErrorFallbackConfig as com.bitmovin.player.api.LoadErrorFallbackConfig.HttpStatusCode).statusCodes)
        assertEquals("time.example.invalid", player.liveConfig.synchronization.single().source)
        val source = overrides.source(SourceConfig("https://example.invalid/live.mpd", SourceType.Dash))
        assertEquals(1.1f, source.liveConfig!!.catchupConfig.playbackRate)
        assertEquals(Double.POSITIVE_INFINITY, source.liveConfig!!.catchupConfig.seekThreshold, 0.0)
        assertEquals(8.0, source.liveConfig!!.fallbackConfig.seekThreshold, 0.0)
        assertTrue(overrides.code().contains("Double.POSITIVE_INFINITY"))
        assertTrue(runCatching { ApiOverrides.validate(mapOf(id("live.SourceLiveConfig.catchupConfig") to "playbackRate=NaN")) }.isFailure)
        assertTrue(runCatching { ApiOverrides.validate(mapOf(id("live.SourceLiveConfig.catchupConfig") to "unknown=1")) }.isFailure)
        assertTrue(runCatching { ApiOverrides.validate(mapOf(id("LoadErrorFallbackConfig.HttpStatusCode.statusCodes") to "404,nope")) }.isFailure)
    }

    @Test fun explicit_disabled_configs_and_key_override_are_typed_and_export_no_key_value() {
        val overrides = ApiOverrides.validate(mapOf(
            id("PlayerConfig.key") to "unit-test-key-not-for-export",
            id("ui.PlayerViewConfig.uiConfig") to "Disabled",
            id("source.SourceConfig.cmcdConfig") to "Disabled",
            id("source.SourceConfig.drmConfig") to "None",
        ))
        assertEquals("unit-test-key-not-for-export", overrides.player(PlayerConfig()).key)
        assertEquals(com.bitmovin.player.api.ui.UiConfig.Disabled, overrides.view(com.bitmovin.player.api.ui.PlayerViewConfig()).uiConfig)
        val source = overrides.source(SourceConfig("https://example.invalid/a.m3u8", SourceType.Hls))
        assertEquals(com.bitmovin.player.api.source.CmcdConfig.Disabled, source.cmcdConfig)
        assertNull(source.drmConfig)
        assertFalse(overrides.code().contains("unit-test-key-not-for-export"))
    }
}
