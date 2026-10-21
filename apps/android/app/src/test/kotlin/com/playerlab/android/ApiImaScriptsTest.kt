package com.playerlab.android

import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.advertising.interstitials.*
import com.bitmovin.player.api.advertising.interstitials.tracking.*
import com.google.ads.interactivemedia.v3.api.AdsManager
import com.google.ads.interactivemedia.v3.api.ImaSdkSettings
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test

class ApiImaScriptsTest {
    private val prefix = "android:com.bitmovin.player.api."
    private inline fun <reified T> fake(crossinline invoke: (String, Array<out Any?>) -> Any?): T = Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, method, args -> invoke(method.name, args ?: emptyArray()) } as T
    private fun settings(writes: MutableMap<String, Any?>): ImaSdkSettings = fake { name, args ->
        if (name.startsWith("set")) { writes[name] = args.single(); null } else when (name) {
            "getPpid", "getLanguage", "getPlayerType", "getPlayerVersion", "getSessionId" -> "en"
            "getMaxRedirects" -> 3
            "doesRestrictToCustomPlayer", "getAutoPlayAdBreaks", "isDebugMode" -> false
            "getFeatureFlags" -> emptyMap<String, String>()
            else -> error("Unexpected IMA method $name")
        }
    }

    @Test fun editedSettingsPatchIsValidatedBeforeAnyNativeMutationAndHonorsRetirement() {
        val id = prefix + "advertising.ima.ImaConfig.beforeInitialization"
        val context = ApiCallbackContext()
        val config = ApiOverrides.validate(mapOf(id to "return {language: input.language.toUpperCase(), maxRedirects: 7, featureFlags: {sample: 'enabled'}};" )).player(PlayerConfig(), context)
        val writes = linkedMapOf<String, Any?>()
        config.advertisingConfig.ima.beforeInitialization!!.beforeInitialization(settings(writes))
        assertEquals("EN", writes["setLanguage"]); assertEquals(7, writes["setMaxRedirects"])
        assertEquals(mapOf("sample" to "enabled"), writes["setFeatureFlags"])
        context.close(); writes.clear()
        config.advertisingConfig.ima.beforeInitialization!!.beforeInitialization(settings(writes))
        assertTrue(writes.isEmpty())
        val invalid = ApiOverrides.validate(mapOf(id to "return {language: 'ja', invented: true};")).player(PlayerConfig())
        invalid.advertisingConfig.ima.beforeInitialization!!.beforeInitialization(settings(writes))
        assertTrue("An invalid later property must not partially apply the earlier language", writes.isEmpty())
    }

    @Test fun managerStateCanBeAbsentAndTheWholeActionListIsValidatedBeforeExecution() {
        val id = prefix + "advertising.ima.ImaConfig.onAdsManagerAvailable"
        val calls = mutableListOf<String>()
        val manager: AdsManager = fake { name, _ -> if (name.startsWith("get")) error("State is not ready") else { calls += name; null } }
        val config = ApiOverrides.validate(mapOf(id to "return input.ad === null && input.progress === null ? ['pause', 'resume'] : [];" )).player(PlayerConfig())
        config.advertisingConfig.ima.onAdsManagerAvailable!!.onAdsManagerAvailable(manager)
        assertEquals(listOf("pause", "resume"), calls)
        calls.clear()
        val invalid = ApiOverrides.validate(mapOf(id to "return ['pause', 'invented'];")).player(PlayerConfig())
        invalid.advertisingConfig.ima.onAdsManagerAvailable!!.onAdsManagerAvailable(manager)
        assertTrue(calls.isEmpty())
    }

    @Test fun interstitialMetadataMapsToNativeClickAndTrackingAndRejectsPartialMutation() {
        val registered = mutableListOf<Pair<InterstitialTrackingEvent, InterstitialTrackingEventTrigger>>()
        val registry = object : InterstitialCustomAttributesMappingRegistry {
            override var clickThroughUrl: String? = null
            override val tracking = object : InterstitialTrackingRegistry {
                override fun register(trackingEvents: List<InterstitialTrackingEvent>, eventTrigger: InterstitialTrackingEventTrigger) { trackingEvents.forEach { register(it, eventTrigger) } }
                override fun register(trackingEvent: InterstitialTrackingEvent, eventTrigger: InterstitialTrackingEventTrigger) { registered += trackingEvent to eventTrigger }
                override fun trackingEvents(eventTrigger: InterstitialTrackingEventTrigger) = registered.filter { it.second == eventTrigger }.map { it.first }
            }
        }
        val id = prefix + "advertising.interstitials.InterstitialsConfig.customAttributesMapping"
        val scope = ApiCallbackContext()
        val input = InterstitialMappingData.Asset("https://example.invalid/ad.m3u8", 5.0, mapOf("X-CLICK" to "https://example.invalid/click"))
        val valid = ApiOverrides.validate(mapOf(id to "return {clickThroughUrl: input.customAttributes['X-CLICK'], tracking: [{trigger: 'Progress', urls: ['https://example.invalid/track'], offset: input.duration / 2}]};")).player(PlayerConfig(), scope)
        valid.hlsConfig.interstitialsConfig.customAttributesMapping!!.handleInterstitialMapping(input, registry)
        assertEquals("https://example.invalid/click", registry.clickThroughUrl)
        assertEquals(InterstitialTrackingEventTrigger.Progress, registered.single().second)
        assertEquals(2.5, registered.single().first.offset!!, 0.0)
        val invalid = ApiOverrides.validate(mapOf(id to "return {clickThroughUrl: 'changed', tracking: [{trigger: 'invented', urls: []}]};")).player(PlayerConfig())
        invalid.hlsConfig.interstitialsConfig.customAttributesMapping!!.handleInterstitialMapping(input, registry)
        assertEquals("https://example.invalid/click", registry.clickThroughUrl); assertEquals(1, registered.size)
        scope.close(); registry.clickThroughUrl = null; registered.clear()
        valid.hlsConfig.interstitialsConfig.customAttributesMapping!!.handleInterstitialMapping(input, registry)
        assertNull(registry.clickThroughUrl); assertTrue(registered.isEmpty())
    }
}
