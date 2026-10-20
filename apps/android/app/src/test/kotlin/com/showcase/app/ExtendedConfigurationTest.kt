package com.showcase.app

import com.bitmovin.player.api.network.RetryHttpRequestConfig
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExtendedConfigurationTest {
    @Test
    fun blankExtensionsKeepOriginalSdkDefaults() {
        val source = requireNotNull(SourceDraft(url = "https://example.com/movie.m3u8").validate().value)
        val player = requireNotNull(PlayerDraft().validate().value)
        assertTrue(source.toSourceConfig().preferredAudioLanguages.isEmpty())
        assertTrue(source.toSourceConfig().subtitleTracks.isEmpty())
        assertTrue(player.toPlayerConfig("dummy").playbackConfig.preferredAudioLanguages.isEmpty())
        assertEquals(RetryHttpRequestConfig.LinearIncreasingBackoffRetry,
            player.toPlayerConfig("dummy").networkConfig.retryHttpRequestConfig)
        assertNull(player.httpRetryDelays)
    }

    @Test
    fun languageOrderAndSubtitleMetadataSurviveNormalizationSdkMappingAndRoundTrip() {
        val source = requireNotNull(SourceDraft(
            url = "https://example.com/movie.m3u8", type = SourceType.Hls,
            preferredAudioLanguages = " de, en-US, DE ",
            subtitleUrl = " https://example.com/captions.vtt ", subtitleLabel = " English captions ",
            subtitleLanguage = " en ", subtitleDefault = true,
        ).validate().value)
        assertEquals(listOf("de", "en-US"), source.preferredAudioLanguages)
        assertEquals(source, SourceDraft.from(source).validate().value)
        val config = source.toSourceConfig()
        assertEquals(listOf("de", "en-US"), config.preferredAudioLanguages)
        val track = config.subtitleTracks.single()
        assertEquals("https://example.com/captions.vtt", track.url)
        assertEquals("English captions", track.label)
        assertEquals("en", track.language)
        assertEquals("text/vtt", track.mimeType)
        assertTrue(track.isDefault)
        assertNotSame(track, source.toSourceConfig().subtitleTracks.single())
    }

    @Test
    fun sourceOnlyExtensionErrorsCannotBecomeAppliedSettings() {
        val original = SourceDraft(url = "https://example.com/movie.m3u8")
        for (languages in listOf("de,,en", "de,", "de en")) {
            val invalid = original.copy(preferredAudioLanguages = languages).validate()
            assertNull(invalid.value)
            assertTrue(invalid.errors.containsKey("preferredAudioLanguages"))
        }
        for (draft in listOf(original.copy(subtitleLabel = "Captions"), original.copy(subtitleDefault = true),
            original.copy(subtitleUrl = "file:///captions.vtt"))) {
            assertNull(draft.validate().value)
            assertTrue(draft.validate().errors.containsKey("subtitleUrl"))
        }
        assertTrue(original.copy(subtitleUrl = "https://example.com/a.vtt", subtitleLanguage = "en US")
            .validate().errors.containsKey("subtitleLanguage"))
    }

    @Test
    fun retryDelaysUseSecondsAndDistinguishDefaultFromNoRetries() {
        val applied = requireNotNull(PlayerDraft(preferredAudioLanguages = " en, de, en ",
            httpRetryDelays = "0, 0.25, 2").validate().value)
        assertEquals(listOf("en", "de"), applied.preferredAudioLanguages)
        assertEquals(applied, PlayerDraft.from(applied).validate().value)
        val config = applied.toPlayerConfig("dummy")
        assertEquals(listOf("en", "de"), config.playbackConfig.preferredAudioLanguages)
        assertEquals(listOf(0.0, 0.25, 2.0),
            (config.networkConfig.retryHttpRequestConfig as RetryHttpRequestConfig.Retry).retryTimeouts)
        assertNotSame(config.networkConfig, applied.toPlayerConfig("dummy").networkConfig)
        val none = requireNotNull(PlayerDraft(httpRetryDelays = " NONE ").validate().value)
        assertTrue((none.toPlayerConfig("dummy").networkConfig.retryHttpRequestConfig as RetryHttpRequestConfig.Retry)
            .retryTimeouts.isEmpty())
        assertEquals("none", PlayerDraft.from(none).httpRetryDelays)
        assertNull(requireNotNull(PlayerDraft().validate().value).httpRetryDelays)
    }

    @Test
    fun invalidRetrySchedulesAndLanguageListsRemainFieldErrorsWithoutArbitraryCaps() {
        for (text in listOf("NaN", "Infinity", "1e999", "-1", "0,,1", "none,1", "1,")) {
            val invalid = PlayerDraft(httpRetryDelays = text).validate()
            assertNull(text, invalid.value)
            assertTrue(text, invalid.errors.containsKey("httpRetryDelays"))
        }
        assertTrue(PlayerDraft(httpRetryDelays = "1000000", preferredAudioLanguages = "de-DE,en-US")
            .validate().errors.isEmpty())
        assertTrue(PlayerDraft(preferredAudioLanguages = "de,,en").validate().errors.containsKey("preferredAudioLanguages"))
    }

    @Test
    fun appliedCodeIncludesEveryExtensionAndEscapesSubtitleTextWithoutCredentials() {
        val source = requireNotNull(SourceDraft(url = "https://example.com/movie.m3u8",
            preferredAudioLanguages = "de,en", subtitleUrl = "https://example.com/captions.vtt",
            subtitleLabel = "Captions ${'$'}{literal}", subtitleLanguage = "en", subtitleDefault = true).validate().value)
        val player = requireNotNull(PlayerDraft(preferredAudioLanguages = "en,de", httpRetryDelays = "0.25,1").validate().value)
        val code = configurationCode(source, player, UiMode.SPORTS)
        assertTrue(code.contains("preferredAudioLanguages = listOf(\"en\", \"de\")"))
        assertTrue(code.contains("preferredAudioLanguages = listOf(\"de\", \"en\")"))
        assertTrue(code.contains("retryHttpRequestConfig = RetryHttpRequestConfig.Retry(listOf(0.25, 1.0))"))
        assertTrue(code.contains("mimeType = \"text/vtt\""))
        assertTrue(code.contains("label = \"Captions \\${'$'}{literal}\""))
        assertTrue(code.contains("isDefault = true, language = \"en\""))
        assertTrue(code.contains("YOUR_PLAYER_KEY"))
        assertFalse(code.contains("AnalyticsConfig("))
        assertTrue(configurationCode(SourceSettings("https://example.com/movie.mpd", SourceType.Dash),
            PlayerSettings(), UiMode.DEFAULT).contains("RetryHttpRequestConfig.LinearIncreasingBackoffRetry"))
    }
}
