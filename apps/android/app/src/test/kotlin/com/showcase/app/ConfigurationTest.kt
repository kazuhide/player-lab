package com.showcase.app

import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.source.TimelineReferencePoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConfigurationTest {
    @Test
    fun exportedLivePolicyRetainsTheAppliedValueAndNullDefault() {
        val source = SourceSettings("https://example.com/live.m3u8", SourceType.Hls)
        assertTrue(configurationCode(source, PlayerSettings(), UiMode.DEFAULT).contains("liveConfig = null,"))
        val applied = source.copy(liveTargetLatency = 30.0)
        assertTrue(configurationCode(applied, PlayerSettings(), UiMode.SPORTS)
            .contains("liveConfig = SourceLiveConfig(targetLatency = 30.0),"))
    }

    @Test
    fun exportedSourceTextEscapesKotlinInterpolationAndNewlines() {
        val title = "A \"quoted\" title ${'$'}{mustStayText}\nnext line"
        val source = SourceSettings("https://example.com/movie.m3u8", SourceType.Hls, title = title)
        val code = configurationCode(source, PlayerSettings(), UiMode.SPORTS)
        val titleLine = code.lineSequence().single { it.trim().startsWith("title = ") }
        assertTrue(titleLine.contains("\\\"quoted\\\""))
        assertTrue(titleLine.contains("\\${'$'}{mustStayText}\\nnext line"))
        assertFalse(code.contains(title))
        assertTrue(code.contains("YOUR_PLAYER_KEY"))
        assertFalse(code.contains("AnalyticsConfig("))
    }

    @Test
    fun defaultsKeepSdkPlaybackBufferAndAdaptationDefaults() {
        val settings = requireNotNull(PlayerDraft().validate().value)
        val config = settings.toPlayerConfig("dummy")
        assertFalse(config.playbackConfig.isAutoplayEnabled)
        assertFalse(config.playbackConfig.isMuted)
        assertTrue(config.playbackConfig.isTimeShiftEnabled)
        assertEquals(2.5, config.bufferConfig.startupThreshold, 0.0)
        assertEquals(5.0, config.bufferConfig.restartThreshold, 0.0)
        assertEquals(50.0, config.bufferConfig.audioAndVideo.forwardDuration, 0.0)
        assertEquals(Int.MAX_VALUE, config.adaptationConfig.maxSelectableVideoBitrate)
        assertTrue(config.adaptationConfig.preload)
        assertTrue(config.adaptationConfig.isRebufferingAllowed)
        assertEquals(0.5f, config.adaptationConfig.qualityStabilityBalance)
        assertNotSame(config.bufferConfig, settings.toPlayerConfig("dummy").bufferConfig)
    }

    @Test
    fun sourceDraftMapsMetadataAndOffsetsWithoutClampingSdkInputs() {
        val draft = SourceDraft(
            url = "https://example.com/video.mpd", type = SourceType.Dash,
            title = " Example ", posterUrl = "https://example.com/poster.jpg",
            posterPersistent = true, startOffset = "-12.5",
            offsetReference = TimelineReferencePoint.Start,
        )
        val config = requireNotNull(draft.validate().value).toSourceConfig()
        assertEquals("Example", config.title)
        assertEquals("https://example.com/poster.jpg", config.posterSource)
        assertTrue(config.isPosterPersistent)
        assertEquals(-12.5, requireNotNull(config.options.startOffset), 0.0)
        assertEquals(TimelineReferencePoint.Start, config.options.startOffsetTimelineReference)
        assertTrue(draft.copy(startOffset = "12.5", offsetReference = TimelineReferencePoint.End).validate().errors.isEmpty())
        val defaultOptions = requireNotNull(draft.copy(startOffset = "", offsetReference = null).validate().value)
            .toSourceConfig().options
        assertNull(defaultOptions.startOffset)
        assertNull(defaultOptions.startOffsetTimelineReference)
    }

    @Test
    fun invalidNumbersAndBufferThresholdsProduceFieldErrors() {
        for (number in listOf("NaN", "Infinity", "1e999", "bad", "-1")) {
            assertTrue(number, PlayerDraft(startupThreshold = number).validate().errors.containsKey("startupThreshold"))
        }
        val invalid = PlayerDraft(startupThreshold = "49.6", restartThreshold = "50", forwardDuration = "50").validate()
        assertNull(invalid.value)
        assertTrue(invalid.errors.keys.containsAll(listOf("startupThreshold", "restartThreshold")))
        assertTrue(PlayerDraft(forwardDuration = "0.4").validate().errors.containsKey("forwardDuration"))
        assertTrue(PlayerDraft(maxVideoBitrate = "2147483648").validate().errors.containsKey("maxVideoBitrate"))
        assertTrue(PlayerDraft(qualityStabilityBalance = "1.01").validate().errors.containsKey("qualityStabilityBalance"))
        assertTrue(PlayerDraft(maxVideoBitrate = "0").validate().errors.isEmpty())
    }

    @Test
    fun invalidSourceAndNonFiniteOffsetCannotBecomeAppliedSettings() {
        val invalid = SourceDraft(url = "file:///tmp/video.mpd", posterUrl = "https://", startOffset = "NaN").validate()
        assertNull(invalid.value)
        assertTrue(invalid.errors.keys.containsAll(listOf("url", "posterUrl", "startOffset")))
        assertTrue(SourceDraft(url = "https://example.com/video.mpd?token=sample").validate().errors.isEmpty())
    }

    @Test
    fun liveTargetLatencyIsOptionalAndSurvivesDraftAndSdkConfigurationRoundTrips() {
        val draft = SourceDraft(url = "https://example.com/live.mpd")
        assertNull(requireNotNull(draft.validate().value).toSourceConfig().liveConfig)
        val settings = requireNotNull(draft.copy(liveTargetLatency = "30.25").validate().value)
        assertEquals(30.25, requireNotNull(settings.liveTargetLatency), 0.0)
        assertEquals(settings, SourceDraft.from(settings).validate().value)
        val first = requireNotNull(settings.toSourceConfig().liveConfig)
        val second = requireNotNull(settings.toSourceConfig().liveConfig)
        assertEquals(30.25, requireNotNull(first.targetLatency), 0.0)
        assertNotSame(first, second)
        first.targetLatency = 45.0
        assertEquals(30.25, requireNotNull(second.targetLatency), 0.0)
        assertNull(requireNotNull(SourceDraft.from(settings).copy(liveTargetLatency = " ").validate().value).toSourceConfig().liveConfig)
    }

    @Test
    fun liveTargetLatencyRejectsNonFiniteInputWithoutInventingSdkRangeLimits() {
        val draft = SourceDraft(url = "https://example.com/live.mpd")
        for (number in listOf("NaN", "Infinity", "-Infinity", "1e999", "bad")) {
            val invalid = draft.copy(liveTargetLatency = number).validate()
            assertNull(number, invalid.value)
            assertTrue(number, invalid.errors.containsKey("liveTargetLatency"))
        }
        for (number in listOf("0", "-2.5", "100000")) {
            assertTrue(number, draft.copy(liveTargetLatency = number).validate().errors.isEmpty())
        }
    }

    @Test
    fun decimalBufferBoundaryAcceptsRoundingWithoutRelaxingTheHeadroomRule() {
        val draft = PlayerDraft(forwardDuration = "0.6", startupThreshold = "0.1", restartThreshold = "0.1")
        val settings = requireNotNull(draft.validate().value)
        assertEquals(0.1, settings.toPlayerConfig("dummy").bufferConfig.startupThreshold, 0.0)
        assertEquals(0.1, settings.toPlayerConfig("dummy").bufferConfig.restartThreshold, 0.0)
        assertTrue(draft.copy(startupThreshold = "0.100001").validate().errors.containsKey("startupThreshold"))
    }

    @Test
    fun editedValuesSurviveDraftRoundTripsWithExactSdkUnits() {
        val settings = requireNotNull(PlayerDraft(
            autoplay = true, muted = true, timeShift = false, startupThreshold = "1",
            restartThreshold = "2", forwardDuration = "12", maxVideoBitrate = "1500000",
            preload = false, rebuffering = false, qualityStabilityBalance = "0.75",
        ).validate().value)
        assertEquals(settings, PlayerDraft.from(settings).validate().value)
        assertEquals(1_500_000, settings.toPlayerConfig("dummy").adaptationConfig.maxSelectableVideoBitrate)
    }
}
