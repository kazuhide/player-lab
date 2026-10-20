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
