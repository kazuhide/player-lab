package com.playerlab.android

import com.bitmovin.player.api.advertising.*
import com.bitmovin.player.api.advertising.ima.*
import com.bitmovin.player.api.advertising.interstitials.*
import com.bitmovin.player.api.advertising.interstitials.tracking.*
import com.google.ads.interactivemedia.v3.api.ImaSdkSettings
import com.google.ads.interactivemedia.v3.api.AdsManager

/** Pure editable decisions are converted to explicit native IMA and interstitial operations. */
internal object ApiImaScripts {
    private const val SDK = "android:com.bitmovin.player.api."
    private fun program(body: String) = body.takeUnless { it == "null" }?.let(::ApiScriptProgram)
    private fun objectValue(value: Any?) = value as? Map<*, *> ?: error("Return a plain object or null.")
    private fun strings(value: Any?): List<String> = (value as? List<*> ?: error("Return strings.")).map { (it as? String ?: error("Return strings.")).also { text -> require(text.length <= 8192) } }.also { require(it.size <= 128) }
    private fun settingsSnapshot(s: ImaSdkSettings) = mapOf("ppid" to s.ppid, "language" to s.language, "maxRedirects" to s.maxRedirects,
        "restrictToCustomPlayer" to s.doesRestrictToCustomPlayer(), "playerType" to s.playerType, "playerVersion" to s.playerVersion,
        "autoPlayAdBreaks" to s.autoPlayAdBreaks, "debugMode" to s.isDebugMode, "sessionId" to s.sessionId, "featureFlags" to s.featureFlags)
    private fun settingsPatch(value: Any?): Map<String, Any?>? {
        if (value == null) return null
        val result = linkedMapOf<String, Any?>()
        objectValue(value).forEach { (key, v) ->
            require(key is String)
            result[key] = when (key) {
                "ppid", "language", "playerType", "playerVersion", "sessionId" -> (v as? String ?: error("Return a string for $key.")).also { require(it.length <= 8192) }
                "restrictToCustomPlayer", "autoPlayAdBreaks", "debugMode" -> v as? Boolean ?: error("Return a boolean for $key.")
                "maxRedirects" -> (v as? Number)?.toDouble()?.also { require(it % 1.0 == 0.0 && it in 0.0..Int.MAX_VALUE.toDouble()) }?.toInt() ?: error("Return a nonnegative integer.")
                "featureFlags" -> objectValue(v).entries.associate { (name, flag) ->
                    require(name is String && name.length <= 256 && flag is String && flag.length <= 8192)
                    name to flag
                }.also { require(it.size <= 128) }
                else -> error("Unknown IMA setting.")
            }
        }
        return result
    }
    private fun applySettings(s: ImaSdkSettings, patch: Map<String, Any?>) {
        patch.forEach { (key, value) -> when (key) {
            "ppid" -> s.ppid = value as String
            "language" -> s.language = value as String
            "playerType" -> s.playerType = value as String
            "playerVersion" -> s.playerVersion = value as String
            "sessionId" -> s.sessionId = value as String
            "restrictToCustomPlayer" -> s.setRestrictToCustomPlayer(value as Boolean)
            "autoPlayAdBreaks" -> s.autoPlayAdBreaks = value as Boolean
            "debugMode" -> s.isDebugMode = value as Boolean
            "maxRedirects" -> s.maxRedirects = value as Int
            "featureFlags" -> s.featureFlags = objectValue(value).entries.associate { (k, v) -> k as String to v as String }
        } }
    }
    private fun managerSnapshot(manager: AdsManager): Map<String, Any?> {
        // Availability precedes some manager state; absent state is a value, not a callback failure.
        val ad = runCatching { manager.currentAd }.getOrNull()
        val progress = runCatching { manager.adProgressInfo }.getOrNull()
        return mapOf("cuePoints" to runCatching { manager.adCuePoints }.getOrNull(), "progress" to progress?.let { mapOf("currentTime" to it.currentTime, "duration" to it.duration) },
            "ad" to ad?.let { mapOf("adId" to it.adId, "title" to it.title, "isLinear" to it.isLinear, "isSkippable" to it.isSkippable, "duration" to it.duration) })
    }
    private val managerActions = setOf("start", "pause", "resume", "skip", "discardAdBreak", "clicked", "focus", "init", "destroy")
    private fun applyManager(manager: AdsManager, action: String) { when (action) {
        "start" -> manager.start(); "pause" -> manager.pause(); "resume" -> manager.resume(); "skip" -> manager.skip();
        "discardAdBreak" -> manager.discardAdBreak(); "clicked" -> manager.clicked(); "focus" -> manager.focus(); "init" -> manager.init(); "destroy" -> manager.destroy()
    } }
    private fun before(id: String, body: String, scope: ApiCallbackContext): BeforeInitializationCallback? = program(body)?.let { p -> BeforeInitializationCallback { s ->
        val patch = scope.apply(id, p, settingsSnapshot(s), null as Map<String, Any?>?, ::settingsPatch)
        if (scope.active && patch != null) applySettings(s, patch)
    } }
    private fun available(id: String, body: String, scope: ApiCallbackContext): AdsManagerAvailableCallback? = program(body)?.let { p -> AdsManagerAvailableCallback { manager ->
        val actions = scope.apply(id, p, managerSnapshot(manager), emptyList()) { v -> if (v == null) emptyList() else strings(v).also { require(it.size <= 16 && it.all(managerActions::contains)) } }
        actions.forEach { if (scope.active) applyManager(manager, it) }
    } }
    private data class Tracking(val trigger: InterstitialTrackingEventTrigger, val event: InterstitialTrackingEvent)
    private data class Mapping(val clickThroughUrl: String?, val setClickThrough: Boolean, val tracking: List<Tracking>)
    private fun mapping(value: Any?): Mapping? {
        if (value == null) return null
        val values = objectValue(value)
        require(values.keys.all { it in setOf("clickThroughUrl", "tracking") })
        val click = values["clickThroughUrl"]
        require(click == null || click is String && click.length <= 8192)
        val records = values["tracking"] as? List<*> ?: if ("tracking" in values) error("Tracking must be an array.") else emptyList<Any?>()
        require(records.size <= 32)
        return Mapping(click as String?, "clickThroughUrl" in values, records.map { record ->
            val fields = objectValue(record); require(fields.keys.all { it in setOf("trigger", "urls", "offset") })
            val offset = fields["offset"]?.let { (it as? Number)?.toDouble()?.also { n -> require(n.isFinite() && n >= 0) } ?: error("Invalid progress offset.") }
            Tracking(InterstitialTrackingEventTrigger.valueOf(fields["trigger"] as? String ?: error("Choose a trigger.")), InterstitialTrackingEvent(strings(fields["urls"]), offset))
        })
    }
    val fields = listOf(
        ApiScriptSettings.script("advertising.ima.ImaConfig.beforeInitialization", "input is current IMA settings. Return a partial settings object (language, ppid, maxRedirects, restrictToCustomPlayer, playerType, playerVersion, autoPlayAdBreaks, debugMode, sessionId, featureFlags), or null to retain them.", "return {language: 'en', maxRedirects: 4};",
            player = { c, v, scope -> c.copy(advertisingConfig = c.advertisingConfig.copy(ima = c.advertisingConfig.ima.copy(beforeInitialization = before(SDK + "advertising.ima.ImaConfig.beforeInitialization", v, scope)))) }),
        ApiScriptSettings.script("advertising.AdvertisingConfig.beforeInitialization", "Deprecated IMA settings hook. Same editable partial settings contract as ImaConfig.beforeInitialization. Use one alias at a time.", "return {language: 'en'};",
            player = { c, v, scope -> c.copy(advertisingConfig = c.advertisingConfig.copy(beforeInitialization = before(SDK + "advertising.AdvertisingConfig.beforeInitialization", v, scope))) }),
        ApiScriptSettings.script("advertising.ima.ImaConfig.onAdsManagerAvailable", "input: {cuePoints, progress, ad}. Return an array of native actions: start, pause, resume, skip, discardAdBreak, clicked, focus, init, destroy. Actions run when the manager becomes available. init/destroy affect the SDK-owned manager; use them only for the intended IMA lifecycle.", "return input.ad && input.ad.isSkippable ? ['skip'] : [];",
            player = { c, v, scope -> c.copy(advertisingConfig = c.advertisingConfig.copy(ima = c.advertisingConfig.ima.copy(onAdsManagerAvailable = available(SDK + "advertising.ima.ImaConfig.onAdsManagerAvailable", v, scope)))) }),
        ApiScriptSettings.script("advertising.AdvertisingConfig.adsManagerAvailableCallback", "Deprecated IMA manager hook. Same editable action contract as ImaConfig.onAdsManagerAvailable. Use one alias at a time.", "return [];",
            player = { c, v, scope -> c.copy(advertisingConfig = c.advertisingConfig.copy(adsManagerAvailableCallback = available(SDK + "advertising.AdvertisingConfig.adsManagerAvailableCallback", v, scope))) }),
        ApiScriptSettings.script("advertising.interstitials.InterstitialsConfig.customAttributesMapping", "input: {kind, id?, url?, duration?, customAttributes}. Return {clickThroughUrl?, tracking: [{trigger, urls: [strings], offset?}]} or null. Trigger names are the public InterstitialTrackingEventTrigger values. The SDK owns when registered URLs are requested.", "return {clickThroughUrl: input.customAttributes['X-CLICK-URL'] || null, tracking: []};",
            player = { c, v, scope -> val p = program(v); c.copy(hlsConfig = c.hlsConfig.copy(interstitialsConfig = c.hlsConfig.interstitialsConfig.copy(customAttributesMapping = p?.let { CustomAttributesMappingHandler { data, registry ->
                val extra = when (data) { is InterstitialMappingData.Interstitial -> mapOf("kind" to "Interstitial", "id" to data.id); is InterstitialMappingData.AssetList -> mapOf("kind" to "AssetList"); is InterstitialMappingData.Asset -> mapOf("kind" to "Asset", "url" to data.url, "duration" to data.duration) }
                val result = scope.apply(SDK + "advertising.interstitials.InterstitialsConfig.customAttributesMapping", p, extra + ("customAttributes" to data.customAttributes), null as Mapping?, ::mapping)
                if (scope.active && result != null) {
                    if (result.setClickThrough) registry.clickThroughUrl = result.clickThroughUrl
                    result.tracking.forEach { if (scope.active) registry.tracking.register(it.event, it.trigger) }
                }
            } }))) }),
    )
}
