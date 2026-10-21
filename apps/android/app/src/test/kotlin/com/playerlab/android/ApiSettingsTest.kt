package com.playerlab.android

import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.SeekMode
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Test

class ApiSettingsTest {
    private fun id(member: String) = "android:com.bitmovin.player.api.$member"

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
}
