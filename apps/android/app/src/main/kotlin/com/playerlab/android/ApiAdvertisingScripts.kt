package com.playerlab.android

import com.bitmovin.player.api.advertising.*
import com.bitmovin.player.api.advertising.vast.*
import com.bitmovin.player.api.advertising.vast.macro.VastMacroValueProvider
import com.bitmovin.player.api.advertising.interstitials.tracking.macro.InterstitialMacroValueProvider
import com.bitmovin.player.api.casting.ConfigureMediaInfoCallback
import com.bitmovin.player.api.casting.GoogleCastMediaInfoConfig
import com.bitmovin.player.api.casting.GoogleCastMediaType
import com.bitmovin.player.api.media.video.quality.VideoAdaptation
import com.bitmovin.player.api.media.AdaptationConfig

internal object ApiAdvertisingScripts {
    private const val SDK = "android:com.bitmovin.player.api."
    private fun program(body: String) = if (body == "null") null else ApiScriptProgram(body)
    private fun bool(value: Any?) = value as? Boolean ?: error("Return a boolean.")
    private fun strings(value: Any?): List<String> {
        val list = value as? List<*> ?: error("Return an array of strings.")
        require(list.size <= 128)
        return list.map { (it as? String ?: error("Return strings.")).also { text -> require(text.length <= 8192) } }
    }
    private fun adItem(item: AdItem) = mapOf("position" to item.position, "preloadOffset" to item.preloadOffset,
        "replaceContentDuration" to item.replaceContentDuration, "bitmovinAdTagLoading" to item.bitmovinAdTagLoading,
        "sources" to item.sources.map { mapOf("type" to it.type.name, "tag" to it.tag, "vastLoadTimeout" to it.vastLoadTimeout, "videoLoadTimeout" to it.videoLoadTimeout) })
    private fun media(file: MediaFile) = mapOf("url" to file.url, "delivery" to file.delivery.name, "type" to file.type,
        "width" to file.width, "height" to file.height, "bitrate" to file.bitrate, "minBitrate" to file.minBitrate,
        "maxBitrate" to file.maxBitrate, "scalable" to file.scalable, "maintainAspectRatio" to file.maintainAspectRatio,
        "mediaType" to file.mediaType, "codec" to file.codec, "fileSize" to file.fileSize)
    val fields = listOf(
        ApiScriptSettings.script("media.AdaptationConfig.videoAdaptation", "input: {suggested}. Return a video quality ID string or null to retain the SDK suggestion. Available IDs are shown in SDK state.", "return input.suggested;",
            player = { c, body, scope ->
                val p = program(body)
                val base = c.adaptationConfig
                c.copy(adaptationConfig = AdaptationConfig.Builder()
                    .setInitialBandwidthEstimateOverride(base.initialBandwidthEstimateOverride).setMaxSelectableVideoBitrate(base.maxSelectableVideoBitrate)
                    .setRebufferingAllowed(base.isRebufferingAllowed).setPreload(base.preload).setQualityStabilityBalance(base.qualityStabilityBalance)
                    .setVideoAdaptation(p?.let { VideoAdaptation { data ->
                        scope.apply(SDK + "media.AdaptationConfig.videoAdaptation", p, mapOf("suggested" to data.suggested), null as String?) { value -> if (value == null) null else value as? String ?: error("Return a quality ID or null.") }
                    } }).build())
            }),
        ApiScriptSettings.script("casting.RemoteControlConfig.onConfigureMediaInfo", "input: {url, type, title, description, metadata} from the SourceConfig. Return a GoogleCastMediaType name. Cast services and a receiver are required to execute this hook.", "return 'Movie';",
            player = { c, body, scope -> val p = program(body); c.copy(remoteControlConfig = c.remoteControlConfig.copy(onConfigureMediaInfo = p?.let { ConfigureMediaInfoCallback { source ->
                scope.apply(SDK + "casting.RemoteControlConfig.onConfigureMediaInfo", p, mapOf("url" to source.url, "type" to source.type.name, "title" to source.title,
                    "description" to source.description, "metadata" to source.metadata), GoogleCastMediaInfoConfig()) { value ->
                    GoogleCastMediaInfoConfig(GoogleCastMediaType.valueOf(value as? String ?: error("Return a GoogleCastMediaType name.")))
                }
            } })) }),
        ApiScriptSettings.script("advertising.AdvertisingConfig.shouldLoadAdItem", "input is AdItem metadata, including position, sources, replacement duration and preload offset. Return a boolean.", "return input.position !== 'post';",
            player = { c, body, scope -> val p = program(body); c.copy(advertisingConfig = c.advertisingConfig.copy(shouldLoadAdItem = if (p == null) AdvertisingConfig().shouldLoadAdItem else ShouldLoadAdItemCallback { item ->
                scope.apply(SDK + "advertising.AdvertisingConfig.shouldLoadAdItem", p, adItem(item), true, ::bool)
            })) }),
        ApiScriptSettings.script("advertising.AdvertisingConfig.shouldPlayAdBreak", "input: {id, scheduleTime, replaceContentDuration, ads: [{id, isLinear, width, height}]}. Return a boolean.", "return input.scheduleTime >= 0;",
            player = { c, body, scope -> val p = program(body); c.copy(advertisingConfig = c.advertisingConfig.copy(shouldPlayAdBreak = if (p == null) AdvertisingConfig().shouldPlayAdBreak else ShouldPlayAdBreakCallback { item ->
                scope.apply(SDK + "advertising.AdvertisingConfig.shouldPlayAdBreak", p, mapOf("id" to item.id, "scheduleTime" to item.scheduleTime,
                    "replaceContentDuration" to item.replaceContentDuration, "ads" to item.ads.map { ad -> mapOf("id" to ad.id, "isLinear" to ad.isLinear, "width" to ad.width, "height" to ad.height) }), true, ::bool)
            })) }),
        ApiScriptSettings.script("advertising.AdvertisingConfig.shouldPlaySeekedOverAdItems", "input: {items: [AdItem metadata plus index], seekFrom, seekTo}. Return unique item indexes to retain, in their original order. Omitted items are discarded.", "return input.items.slice(-1).map(function(item) { return item.index; });",
            player = { c, body, scope -> val p = program(body); c.copy(advertisingConfig = c.advertisingConfig.copy(shouldPlaySeekedOverAdItems = p?.let { ShouldPlaySeekedOverAdItemsCallback { items, context ->
                scope.apply(SDK + "advertising.AdvertisingConfig.shouldPlaySeekedOverAdItems", p, mapOf("items" to items.mapIndexed { index, item -> adItem(item) + ("index" to index) },
                    "seekFrom" to context.seekFrom.time, "seekTo" to context.seekTo.time), items) { value ->
                    val indexes = (value as? List<*> ?: error("Return item indexes.")).map { item ->
                        val n = (item as? Number)?.toDouble() ?: error("Return numeric indexes."); require(n % 1.0 == 0.0 && n >= 0 && n < items.size); n.toInt()
                    }
                    require(indexes.distinct().size == indexes.size && indexes == indexes.sorted())
                    indexes.map { items[it] }
                }
            } })) }),
        ApiScriptSettings.script("advertising.vast.macro.VastMacroConfig.macroValueProvider", "input: {name, values, scope}. Return replacement strings, or an empty array to leave the macro unset. The SDK handles URL encoding.", "return input.name === 'CUSTOM' ? ['lab'] : input.values;",
            player = { c, body, scope -> val p = program(body); c.copy(advertisingConfig = c.advertisingConfig.copy(bitmovin = c.advertisingConfig.bitmovin.copy(macro = c.advertisingConfig.bitmovin.macro.copy(macroValueProvider = p?.let { VastMacroValueProvider { macro, context ->
                scope.apply(SDK + "advertising.vast.macro.VastMacroConfig.macroValueProvider", p, mapOf("name" to macro.name, "values" to macro.values, "scope" to context.scope.name), macro.values, ::strings)
            } })))) }),
        ApiScriptSettings.script("advertising.interstitials.InterstitialsConfig.macroValueProvider", "input: {name, values}. Return replacement strings, or an empty array to leave the macro unset. The SDK handles URL encoding.", "return input.values;",
            player = { c, body, scope -> val p = program(body); c.copy(hlsConfig = c.hlsConfig.copy(interstitialsConfig = c.hlsConfig.interstitialsConfig.copy(macroValueProvider = p?.let { InterstitialMacroValueProvider { macro ->
                scope.apply(SDK + "advertising.interstitials.InterstitialsConfig.macroValueProvider", p, mapOf("name" to macro.name, "values" to macro.values), macro.values, ::strings)
            } }))) }),
        ApiScriptSettings.script("advertising.bitmovin.BitmovinAdvertisingConfig.onSelectAdQuality", "input: {available: [media metadata plus index], suggestedIndex, bitrateEstimate}. Return an available media index or null to keep the SDK suggestion. Selection retains the original native MediaFile.", "return input.suggestedIndex;",
            player = { c, body, scope -> val p = program(body); c.copy(advertisingConfig = c.advertisingConfig.copy(bitmovin = c.advertisingConfig.bitmovin.copy(onSelectAdQuality = p?.let { OnSelectAdQuality { context ->
                scope.apply(SDK + "advertising.bitmovin.BitmovinAdvertisingConfig.onSelectAdQuality", p,
                    mapOf("available" to context.available.mapIndexed { index, file -> media(file) + ("index" to index) }, "suggestedIndex" to context.available.indexOf(context.suggested), "bitrateEstimate" to context.bitrateEstimate), context.suggested) { value ->
                    if (value == null) context.suggested else {
                        val index = (value as? Number)?.toDouble() ?: error("Return a media index or null.")
                        require(index % 1.0 == 0.0 && index >= 0 && index < context.available.size)
                        context.available[index.toInt()]
                    }
                }
            } }))) }),
    )
}
