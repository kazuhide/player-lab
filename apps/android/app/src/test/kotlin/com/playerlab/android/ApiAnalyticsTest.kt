package com.playerlab.android

import com.bitmovin.analytics.api.RetryPolicy
import com.bitmovin.player.api.analytics.AnalyticsPlayerConfig
import org.junit.Assert.*
import org.junit.Test

class ApiAnalyticsTest {
    @Test fun every_custom_field_round_trips_through_concrete_sdk_parameters() {
        val values = analyticsCustomKeys.associateWith { "test-$it" }
        assertEquals(values, analyticsCustomDataValues(analyticsCustomData(values)))
        assertEquals("", analyticsCustomDataValues(analyticsCustomData(mapOf("customData100" to "")))["customData100"])
        assertTrue(runCatching { analyticsCustomData(mapOf("customData101" to "invalid")) }.isFailure)
    }

    @Test fun default_and_source_metadata_and_collection_policy_reach_sdk_configs() {
        val settings = ApiAnalyticsSettings(
            randomizeUserId = true, retryPolicy = RetryPolicy.LONG_TERM,
            defaults = mapOf("cdnProvider" to "test-cdn", "customUserId" to "test-viewer", "customData1" to "default"),
            source = mapOf("title" to "Test video", "videoId" to "test-video", "isLive" to "false", "customData100" to "source"),
        )
        val config = settings.playerConfig("public-unit-test-key") as AnalyticsPlayerConfig.Enabled
        assertTrue(config.analyticsConfig.randomizeUserId)
        assertEquals(RetryPolicy.LONG_TERM, config.analyticsConfig.retryPolicy)
        assertEquals("test-viewer", config.defaultMetadata.customUserId)
        assertEquals("default", config.defaultMetadata.customData.customData1)
        val source = settings.sourceMetadata()
        assertEquals(false, source.isLive)
        assertEquals("source", source.customData.customData100)
        assertEquals(AnalyticsPlayerConfig.Disabled, ApiAnalyticsSettings().playerConfig(""))
        assertTrue(ApiAnalyticsSettings(mode = "Deferred license").playerConfig("") is AnalyticsPlayerConfig.Enabled)
    }

    @Test fun invalid_metadata_and_endpoint_fail_while_keys_are_omitted_from_code() {
        assertTrue(runCatching { ApiAnalyticsSettings(source = mapOf("isLive" to "yes")).playerConfig("test") }.isFailure)
        assertTrue(runCatching { ApiAnalyticsSettings(backendUrl = "https://user:pass@example.invalid/").playerConfig("test") }.isFailure)
        val settings = ApiAnalyticsSettings(licenseOverride = "test-key-should-not-be-exported")
        assertFalse(settings.code().contains("test-key-should-not-be-exported"))
        assertTrue(settings.code().contains("YOUR_ANALYTICS_LICENSE_KEY"))
    }

    @Test fun ssai_metadata_uses_typed_builders_and_rejects_invalid_numeric_inputs() {
        val values = mapOf("adId" to "test-ad", "durationInMs" to "12500", "isSlate" to "true", "expectedPaidAds" to "2", "customData100" to "ad-marker")
        val ad = analyticsAdMetadata(values)
        assertEquals("test-ad", ad.adId)
        assertEquals(12500L, ad.durationInMs)
        assertTrue(ad.isSlate)
        assertEquals("ad-marker", requireNotNull(ad.customData).customData100)
        assertEquals(2, analyticsAdBreakMetadata(values).expectedPaidAds)
        assertTrue(runCatching { analyticsAdMetadata(mapOf("durationInMs" to "-1")) }.isFailure)
        assertTrue(runCatching { analyticsAdBreakMetadata(mapOf("expectedPaidAds" to "1.5")) }.isFailure)
        assertTrue(ApiAnalyticsSettings(errorStrategy = "Redact message").code().contains("errorTransformerCallback ="))
    }
}
