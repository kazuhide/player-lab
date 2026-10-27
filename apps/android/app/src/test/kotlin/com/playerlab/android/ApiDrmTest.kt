package com.playerlab.android

import com.bitmovin.player.api.drm.*
import com.bitmovin.player.api.source.*
import org.junit.Assert.*
import org.junit.Test

class ApiDrmTest {
    @Test fun nagraAvailabilityUsesTheSameExplicitAndImplicitVariantAsConfiguration() {
        val key = "android:com.bitmovin.player.api.source.SourceConfig.drmConfig"
        assertFalse(apiNagraConfigApplied(emptyMap()))
        assertFalse(apiNagraConfigApplied(mapOf(key to "None")))
        assertFalse(apiNagraConfigApplied(mapOf(key to "Widevine")))
        assertTrue(apiNagraConfigApplied(mapOf(key to "NagraConnect")))
        assertTrue(apiNagraConfigApplied(mapOf("android:com.bitmovin.player.api.drm.NagraConnectConfig.operatorVault" to "example")))
        assertFalse(apiNagraConfigApplied(mapOf("android:com.bitmovin.player.api.drm.DrmConfig.licenseUrl" to "https://example.invalid/license")))
    }
    @Test fun editableCallbackBodyTransformsActualSdkBytesAndRetirementKeepsOriginal() {
        val scope = ApiCallbackContext()
        val values = ApiOverrides.validate(mapOf(id("WidevineConfig.prepareMessageCallback") to "return input.bytes.slice().reverse();",
            id("WidevineConfig.prepareLicenseCallback") to "return input.bytes.map(function(b) { return (b + 1) % 256; });"))
        val source = values.source(SourceConfig("https://example.invalid/drm.mpd", SourceType.Dash), scope)
        val drm = source.drmConfig as WidevineConfig
        assertArrayEquals(byteArrayOf(3, 2, 1), drm.prepareMessageCallback!!.prepareMessage(byteArrayOf(1, 2, 3)))
        assertArrayEquals(byteArrayOf(0, 1), drm.prepareLicenseCallback!!.prepareLicense(byteArrayOf(-1, 0)))
        assertFalse(values.code().contains("slice().reverse"))
        assertTrue(values.code().contains("<YOUR_CALLBACK_BODY>"))
        scope.close()
        assertArrayEquals(byteArrayOf(1, 2, 3), drm.prepareMessageCallback!!.prepareMessage(byteArrayOf(1, 2, 3)))
    }
    @Test fun invalidByteResultsFallBackAndNullableCallbacksRemainAbsent() {
        val scope = ApiCallbackContext()
        val source = ApiOverrides.validate(mapOf(id("PlayReadyConfig.prepareMessageCallback") to "return [-1, 256];",
            id("PlayReadyConfig.prepareLicenseCallback") to "null")).source(SourceConfig("https://example.invalid/drm.mpd", SourceType.Dash), scope)
        val drm = source.drmConfig as PlayReadyConfig
        assertArrayEquals(byteArrayOf(1), drm.prepareMessageCallback!!.prepareMessage(byteArrayOf(1)))
        assertNull(drm.prepareLicenseCallback)
        assertEquals(1 to 1, scope.snapshot()[id("PlayReadyConfig.prepareMessageCallback")])
    }
    private fun id(name: String) = "android:com.bitmovin.player.api.drm.$name"
    private fun source() = SourceConfig("https://example.invalid/stream.mpd", SourceType.Dash)

    @Test fun typed_drm_composition_keeps_every_parameter_independent_of_input_order() {
        val values = linkedMapOf(
            id("DrmConfig.licenseUrl") to "https://example.invalid/license",
            id("DrmConfig.drmSessionKeepaliveMs") to "750",
            id("WidevineConfig.preferredSecurityLevel") to "L3",
            id("DrmConfig.shouldKeepDrmSessionsAlive") to "true",
            id("DrmConfig.httpHeaders") to "X-Test=public-fixture",
            id("WidevineConfig.prepareLicenseCallback") to "Identity",
        )
        for (input in listOf(values, values.entries.reversed().associate { it.toPair() })) {
            val config = ApiOverrides.validate(input).source(source()).drmConfig as WidevineConfig
            assertEquals("https://example.invalid/license", config.licenseUrl)
            assertEquals(750L, config.drmSessionKeepaliveMs)
            assertEquals("L3", config.preferredSecurityLevel)
            assertTrue(config.shouldKeepDrmSessionsAlive)
            assertEquals("public-fixture", config.httpHeaders?.get("X-Test"))
            assertArrayEquals(byteArrayOf(1, 2, 3), config.prepareLicenseCallback!!.prepareLicense(byteArrayOf(1, 2, 3)))
        }
    }

    @Test fun variant_incompatibilities_fail_before_the_current_player_can_be_retired() {
        assertTrue(runCatching { ApiOverrides.validate(mapOf(
            id("WidevineConfig.preferredSecurityLevel") to "L3",
            id("PlayReadyConfig.prepareLicenseCallback") to "Identity",
        )) }.isFailure)
        assertTrue(runCatching { ApiOverrides.validate(mapOf(
            id("PlayReadyConfig.prepareLicenseCallback") to "Identity",
            id("DrmConfig.drmSessionKeepaliveMs") to "750",
        )) }.isFailure)
    }

    @Test fun clear_key_pairs_are_composed_together_and_secrets_are_omitted_from_export() {
        val overrides = ApiOverrides.validate(mapOf(
            id("ClearKeyConfigEntry.key") to "fixture-key-value",
            id("ClearKeyConfigEntry.kid") to "fixture-key-id",
        ))
        val config = overrides.source(source()).drmConfig as ClearKeyConfig
        assertEquals("fixture-key-value", config.entries.single().key)
        assertEquals("fixture-key-id", config.entries.single().kid)
        assertFalse(overrides.code().contains("fixture-key-value"))
        assertFalse(overrides.code().contains("fixture-key-id"))
        assertTrue(overrides.code().contains("YOUR_CLEAR_KEY"))
        val license = ApiOverrides.validate(mapOf(id("DrmConfig.licenseUrl") to "https://example.invalid/private-license"))
        assertFalse(license.code().contains("private-license"))
    }
}
