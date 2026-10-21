package com.playerlab.android

import com.bitmovin.player.api.*
import com.bitmovin.player.api.drm.*
import com.bitmovin.player.api.decoder.DecoderConfig
import com.bitmovin.player.api.live.*
import com.bitmovin.player.api.media.MediaFilter
import com.bitmovin.player.api.media.thumbnail.ThumbnailTrack
import com.bitmovin.player.api.source.*
import com.bitmovin.player.api.network.HttpRequestType
import com.bitmovin.player.api.ui.*
import com.bitmovin.player.api.vr.*

internal enum class ApiValueKind { Boolean, Integer, LongInteger, Decimal, FloatDecimal, Text, TextList, IntegerList, StringMap, Choice, Script }

/** Explicit typed setters and callback adapters; no reflection or arbitrary SDK object mutation. */
internal data class ApiSetting(
    val id: String,
    val owner: String,
    val kind: ApiValueKind,
    val help: String,
    val choices: List<String> = emptyList(),
    val minimum: Double? = null,
    val maximum: Double? = null,
    val nullable: Boolean = false,
    val drmParameter: Boolean = false,
    val order: Int = 10,
    val secret: Boolean = false,
    val player: ((PlayerConfig, String) -> PlayerConfig)? = null,
    val source: ((SourceConfig, String) -> Unit)? = null,
    val playerCallback: ((PlayerConfig, String, ApiCallbackContext) -> PlayerConfig)? = null,
    val sourceCallback: ((SourceConfig, String, ApiCallbackContext) -> Unit)? = null,
    val view: ((PlayerViewConfig, String) -> PlayerViewConfig)? = null,
    val code: ((String) -> String)? = null,
) {
    fun normalize(input: String): String {
        val value = if (kind == ApiValueKind.Text || kind == ApiValueKind.Script) input else input.trim()
        if (nullable && value == "null") return value
        val number = when (kind) {
            ApiValueKind.Boolean -> { require(value == "true" || value == "false") { "Choose true or false." }; null }
            ApiValueKind.Integer -> value.toIntOrNull()?.toDouble() ?: error("Enter a whole 32-bit integer.")
            ApiValueKind.LongInteger -> value.toLongOrNull()?.toDouble() ?: error("Enter a whole 64-bit integer.")
            ApiValueKind.Decimal -> value.toDoubleOrNull()?.also { require(it.isFinite()) { "Enter a finite number." } } ?: error("Enter a finite decimal.")
            ApiValueKind.FloatDecimal -> value.toFloatOrNull()?.also { require(it.isFinite()) { "Enter a finite number." } }?.toDouble() ?: error("Enter a finite decimal.")
            ApiValueKind.Choice -> { require(value in choices) { "Choose a documented SDK value." }; null }
            ApiValueKind.TextList -> {
                require(value.isEmpty() || value.split(',').all { it.trim().isNotEmpty() }) { "Enter comma-separated nonempty values, or leave blank for an empty list." }
                require(choices.isEmpty() || value.isEmpty() || value.split(',').all { it.trim() in choices }) { "Use the documented comma-separated choices." }
                null
            }
            ApiValueKind.IntegerList -> {
                require(value.isEmpty() || value.split(',').all { it.trim().toIntOrNull() != null }) { "Enter comma-separated 32-bit integers, or leave blank for an empty list." }
                null
            }
            ApiValueKind.StringMap -> { parseApiStringMap(value); null }
            ApiValueKind.Text -> { require(value.length <= 8192) { "Text is limited to 8192 characters." }; null }
            ApiValueKind.Script -> { ApiScriptProgram(value); null }
        }
        if (number != null) {
            require(minimum == null || number >= minimum) { "Value must be at least $minimum." }
            require(maximum == null || number <= maximum) { "Value must be at most $maximum." }
        }
        return when (kind) {
            ApiValueKind.Integer -> value.toInt().toString()
            ApiValueKind.LongInteger -> value.toLong().toString()
            ApiValueKind.Decimal -> value.toDouble().toString()
            ApiValueKind.FloatDecimal -> value.toFloat().toString()
            ApiValueKind.TextList -> if (value.isEmpty()) "" else value.split(',').joinToString(",") { it.trim() }
            ApiValueKind.IntegerList -> if (value.isEmpty()) "" else value.split(',').joinToString(",") { it.trim().toInt().toString() }
            else -> value
        }
    }
}

internal data class ApiOverrides(val values: Map<String, String> = emptyMap()) {
    fun player(base: PlayerConfig, callbacks: ApiCallbackContext = ApiCallbackContext()): PlayerConfig = values.entries.sortedBy { ApiSettings.byId.getValue(it.key).order }.fold(base) { config, (id, value) ->
        val field = ApiSettings.byId.getValue(id)
        field.playerCallback?.invoke(config, value, callbacks) ?: field.player?.invoke(config, value) ?: config
    }
    fun source(base: SourceConfig, callbacks: ApiCallbackContext = ApiCallbackContext()): SourceConfig = base.also { config ->
        values.entries.sortedBy { ApiSettings.byId.getValue(it.key).order }.forEach { (id, value) ->
            val field = ApiSettings.byId.getValue(id)
            field.sourceCallback?.invoke(config, value, callbacks) ?: field.source?.invoke(config, value)
        }
        configureApiDrm(config, values.filterKeys { ApiSettings.byId.getValue(it).drmParameter })
    }
    fun view(base: PlayerViewConfig): PlayerViewConfig = values.entries.sortedBy { ApiSettings.byId.getValue(it.key).order }.fold(base) { config, (id, value) ->
        ApiSettings.byId.getValue(id).view?.invoke(config, value) ?: config
    }
    fun code(): String {
        val entries = values.entries.sortedBy { ApiSettings.byId.getValue(it.key).order }
        val context = if (entries.any { ApiSettings.byId.getValue(it.key).kind == ApiValueKind.Script }) "val callbackContext = ApiCallbackContext()\n" else ""
        return context + entries.filterNot { ApiSettings.byId.getValue(it.key).drmParameter }.joinToString("\n") { (id, value) ->
            requireNotNull(ApiSettings.byId.getValue(id).code).invoke(value)
        } + apiDrmCode(values.filterKeys { ApiSettings.byId.getValue(it).drmParameter })
    }
    companion object {
        fun validate(draft: Map<String, String>): ApiOverrides {
            val parsed = ApiOverrides(draft.mapValues { (id, value) ->
                val field = ApiSettings.byId[id] ?: error("Unknown SDK configuration field.")
                try { field.normalize(value) } catch (error: IllegalArgumentException) { throw IllegalArgumentException("$id: ${error.message}") }
            }.toMap())
            fun exclusive(first: String, second: String) {
                require(!(draft.keys.any { it.contains(first) } && draft.keys.any { it.contains(second) })) {
                    "Choose one SDK variant: remove overrides from either $first or $second."
                }
            }
            exclusive("BandwidthMeterType.Default.", "BandwidthMeterType.Experimental.")
            exclusive("BandwidthEstimationMode.ExponentialWeightedAverage.", "BandwidthEstimationMode.SlidingPercentile.")
            exclusive("CmcdConfig.Enabled.sessionId", "CmcdSessionId.Custom.value")
            exclusive("UiConfig.WebUi.variant", "UiConfig.WebUi.Variant.Custom.uiManagerFactoryFunction")
            exclusive("TweaksConfig.devicesThatRequireSurfaceWorkaround", "DeviceDescription.")
            exclusive("AdaptationConfig.startupBitrate", "AdaptationConfig.initialBandwidthEstimateOverride")
            exclusive("LoadErrorFallbackConfig.Custom.callback", "LoadErrorFallbackConfig.HttpStatusCode.statusCodes")
            val bandwidth = draft["android:com.bitmovin.player.api.TweaksConfig.bandwidthMeterType"]
            require(bandwidth != "Default" || draft.keys.none { it.contains("BandwidthMeterType.Experimental.") || it.contains("BandwidthEstimationMode.") }) { "Remove experimental bandwidth fields before choosing Default." }
            require(bandwidth != "Experimental" || draft.keys.none { it.contains("BandwidthMeterType.Default.") }) { "Remove default-estimator fields before choosing Experimental." }
            val estimationMode = draft["android:com.bitmovin.player.api.BandwidthMeterType.Experimental.bandwidthEstimationMode"]
            require(estimationMode != "ExponentialWeightedAverage" || draft.keys.none { it.contains("BandwidthEstimationMode.SlidingPercentile.") }) { "Remove sliding-percentile fields before choosing the weighted-average mode." }
            require(estimationMode != "SlidingPercentile" || draft.keys.none { it.contains("BandwidthEstimationMode.ExponentialWeightedAverage.") }) { "Remove weighted-average fields before choosing the sliding-percentile mode." }
            require(draft["android:com.bitmovin.player.api.ui.PlayerViewConfig.uiConfig"] != "Disabled" || draft.keys.none { it.contains("UiConfig.WebUi.") }) { "Remove Web UI field overrides before disabling the Web UI." }
            require(draft["android:com.bitmovin.player.api.source.SourceConfig.cmcdConfig"] != "Disabled" || draft.keys.none { it.contains("CmcdConfig.Enabled.") || it.contains("CmcdSessionId.") }) { "Remove enabled CMCD fields before disabling CMCD." }
            require(draft["android:com.bitmovin.player.api.live.LiveConfig.lowLatencyConfig"] != "null" || draft.keys.none { it.contains("LowLatencyConfig.") }) { "Remove legacy low-latency fields before clearing that config." }
            // Exercise pure configuration constructors before retiring the current player.
            // No Player, Source, network client or device resource is allocated here.
            parsed.player(PlayerConfig())
            parsed.source(SourceConfig("https://example.invalid/validation.m3u8", SourceType.Hls))
            parsed.view(PlayerViewConfig())
            return parsed
        }
    }
}

internal fun parseApiStringMap(value: String): Map<String, String> {
    val result = linkedMapOf<String, String>()
    value.lineSequence().filter(String::isNotBlank).forEach { line ->
        val parts = line.split('=', limit = 2)
        require(parts.size == 2 && parts[0].trim().isNotEmpty()) { "Use one name=value entry per line." }
        val key = parts[0].trim()
        require(key !in result) { "Map entry names must be unique." }
        result[key] = parts[1]
    }
    return result
}

internal object ApiSettings {
    private fun textList(value: String) = if (value.isEmpty()) emptyList() else value.split(',').map(String::trim)
    private fun listCode(value: String) = textList(value).joinToString(", ", "listOf(", ")", transform = ::kotlinString)
    private fun mapCode(value: String) = parseApiStringMap(value).entries.joinToString(", ", "mapOf(", ")") { "${kotlinString(it.key)} to ${kotlinString(it.value)}" }
    val fields: List<ApiSetting> = listOf(
        ApiSetting(
            id = "android:com.bitmovin.player.api.PlaybackConfig.isTunneledPlaybackEnabled",
            owner = "PlaybackConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(playbackConfig = c.playbackConfig.copy(isTunneledPlaybackEnabled = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(playbackConfig = playerConfig.playbackConfig.copy(isTunneledPlaybackEnabled = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.PlaybackConfig.handleAudioFocus",
            owner = "PlaybackConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(playbackConfig = c.playbackConfig.copy(handleAudioFocus = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(playbackConfig = playerConfig.playbackConfig.copy(handleAudioFocus = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.PlaybackConfig.handleAudioBecomingNoisy",
            owner = "PlaybackConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(playbackConfig = c.playbackConfig.copy(handleAudioBecomingNoisy = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(playbackConfig = playerConfig.playbackConfig.copy(handleAudioBecomingNoisy = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.PlaybackConfig.audioCodecPriority",
            owner = "PlaybackConfig",
            kind = ApiValueKind.TextList,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(playbackConfig = c.playbackConfig.copy(audioCodecPriority = textList(v))) },
            code = { v -> "playerConfig = playerConfig.copy(playbackConfig = playerConfig.playbackConfig.copy(audioCodecPriority = ${listCode(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.PlaybackConfig.videoCodecPriority",
            owner = "PlaybackConfig",
            kind = ApiValueKind.TextList,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(playbackConfig = c.playbackConfig.copy(videoCodecPriority = textList(v))) },
            code = { v -> "playerConfig = playerConfig.copy(playbackConfig = playerConfig.playbackConfig.copy(videoCodecPriority = ${listCode(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.PlaybackConfig.seekMode",
            owner = "PlaybackConfig",
            kind = ApiValueKind.Choice,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            choices = listOf("Exact", "ClosestSync", "PreviousSync", "NextSync"),
            player = { c, v -> c.copy(playbackConfig = c.playbackConfig.copy(seekMode = SeekMode.valueOf(v))) },
            code = { v -> "playerConfig = playerConfig.copy(playbackConfig = playerConfig.playbackConfig.copy(seekMode = SeekMode.$v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.PlaybackConfig.audioFilter",
            owner = "PlaybackConfig",
            kind = ApiValueKind.Choice,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            choices = listOf("Strict", "Loose", "None"),
            player = { c, v -> c.copy(playbackConfig = c.playbackConfig.copy(audioFilter = MediaFilter.valueOf(v))) },
            code = { v -> "playerConfig = playerConfig.copy(playbackConfig = playerConfig.playbackConfig.copy(audioFilter = MediaFilter.$v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.PlaybackConfig.videoFilter",
            owner = "PlaybackConfig",
            kind = ApiValueKind.Choice,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            choices = listOf("Strict", "Loose", "None"),
            player = { c, v -> c.copy(playbackConfig = c.playbackConfig.copy(videoFilter = MediaFilter.valueOf(v))) },
            code = { v -> "playerConfig = playerConfig.copy(playbackConfig = playerConfig.playbackConfig.copy(videoFilter = MediaFilter.$v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.decoder.DecoderConfig.delayDecodingUntilPlayback",
            owner = "decoder.DecoderConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(playbackConfig = c.playbackConfig.copy(decoderConfig = c.playbackConfig.decoderConfig.copy(delayDecodingUntilPlayback = v.toBooleanStrict()))) },
            code = { v -> "playerConfig = playerConfig.copy(playbackConfig = playerConfig.playbackConfig.copy(decoderConfig = playerConfig.playbackConfig.decoderConfig.copy(delayDecodingUntilPlayback = $v)))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.languagePropertyNormalization",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(languagePropertyNormalization = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(languagePropertyNormalization = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.useFiletypeExtractorFallbackForHls",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(useFiletypeExtractorFallbackForHls = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(useFiletypeExtractorFallbackForHls = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.useDrmSessionForClearPeriods",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(useDrmSessionForClearPeriods = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(useDrmSessionForClearPeriods = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.useDrmSessionForClearSources",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(useDrmSessionForClearSources = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(useDrmSessionForClearSources = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.discardAdsWhileCasting",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(discardAdsWhileCasting = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(discardAdsWhileCasting = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.allowChunklessPreparationForHls",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(allowChunklessPreparationForHls = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(allowChunklessPreparationForHls = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.allowChunklessPreparationForHlsStreamingAds",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(allowChunklessPreparationForHlsStreamingAds = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(allowChunklessPreparationForHlsStreamingAds = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.assumeEmsgMetadataForHlsChunklessPreparations",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(assumeEmsgMetadataForHlsChunklessPreparations = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(assumeEmsgMetadataForHlsChunklessPreparations = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.disableAudioTracksWhileInBackground",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(disableAudioTracksWhileInBackground = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(disableAudioTracksWhileInBackground = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.disableVideoTracksWhileInBackground",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(disableVideoTracksWhileInBackground = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(disableVideoTracksWhileInBackground = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.reuseAdsLoaderAcrossImaAds",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(reuseAdsLoaderAcrossImaAds = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(reuseAdsLoaderAcrossImaAds = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.attemptVideoFreezeRecovery",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(attemptVideoFreezeRecovery = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(attemptVideoFreezeRecovery = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.parseSubtitlesDuringExtraction",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(parseSubtitlesDuringExtraction = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(parseSubtitlesDuringExtraction = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.enableDrmLicenseRenewRetry",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(enableDrmLicenseRenewRetry = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(enableDrmLicenseRenewRetry = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.constantBitrateSeekingEnabled",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(constantBitrateSeekingEnabled = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(constantBitrateSeekingEnabled = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.enableHlsInterstitials",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(enableHlsInterstitials = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(enableHlsInterstitials = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.assumeOnlyFirstVideoSampleIsSyncFrame",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(assumeOnlyFirstVideoSampleIsSyncFrame = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(assumeOnlyFirstVideoSampleIsSyncFrame = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.enableMainContentDecodingDuringAds",
            owner = "TweaksConfig",
            kind = ApiValueKind.Boolean,
            help = "null keeps the nullable SDK value; remove override to restore the base configuration.",
            nullable = true,
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(enableMainContentDecodingDuringAds = if (v == "null") null else v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(enableMainContentDecodingDuringAds = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.timeChangedInterval",
            owner = "TweaksConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            minimum = 0.001,
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(timeChangedInterval = v.toDouble())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(timeChangedInterval = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.localDynamicDashWindowUpdateInterval",
            owner = "TweaksConfig",
            kind = ApiValueKind.Decimal,
            help = "null keeps the nullable SDK value; remove override to restore the base configuration.",
            minimum = 0.001,
            nullable = true,
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(localDynamicDashWindowUpdateInterval = if (v == "null") null else v.toDouble())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(localDynamicDashWindowUpdateInterval = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.minForwardBufferLevelForQualityIncrease",
            owner = "TweaksConfig",
            kind = ApiValueKind.Decimal,
            help = "null keeps the nullable SDK value; remove override to restore the base configuration.",
            minimum = 0.0,
            nullable = true,
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(minForwardBufferLevelForQualityIncrease = if (v == "null") null else v.toDouble())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(minForwardBufferLevelForQualityIncrease = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.maxForwardBufferLevelForQualityDecrease",
            owner = "TweaksConfig",
            kind = ApiValueKind.Decimal,
            help = "null keeps the nullable SDK value; remove override to restore the base configuration.",
            minimum = 0.0,
            nullable = true,
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(maxForwardBufferLevelForQualityDecrease = if (v == "null") null else v.toDouble())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(maxForwardBufferLevelForQualityDecrease = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.releasePlayerTimeout",
            owner = "TweaksConfig",
            kind = ApiValueKind.Decimal,
            help = "null keeps the nullable SDK value; remove override to restore the base configuration.",
            minimum = 0.0,
            nullable = true,
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(releasePlayerTimeout = if (v == "null") null else v.toDouble())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(releasePlayerTimeout = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.detachSurfaceTimeout",
            owner = "TweaksConfig",
            kind = ApiValueKind.Decimal,
            help = "null keeps the nullable SDK value; remove override to restore the base configuration.",
            minimum = 0.0,
            nullable = true,
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(detachSurfaceTimeout = if (v == "null") null else v.toDouble())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(detachSurfaceTimeout = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.maxRetainedDrmSessions",
            owner = "TweaksConfig",
            kind = ApiValueKind.Integer,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            minimum = 0.0,
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(maxRetainedDrmSessions = v.toInt())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(maxRetainedDrmSessions = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.LicensingConfig.delay",
            owner = "LicensingConfig",
            kind = ApiValueKind.Integer,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            minimum = 0.0,
            player = { c, v -> c.copy(licensingConfig = c.licensingConfig.copy(delay = v.toInt())) },
            code = { v -> "playerConfig = playerConfig.copy(licensingConfig = playerConfig.licensingConfig.copy(delay = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.media.AdaptationConfig.initialBandwidthEstimateOverride",
            owner = "media.AdaptationConfig",
            kind = ApiValueKind.LongInteger,
            help = "null keeps the nullable SDK value; remove override to restore the base configuration.",
            nullable = true,
            player = { c, v -> c.copy(adaptationConfig = c.adaptationConfig.copy(initialBandwidthEstimateOverride = if (v == "null") null else v.toLong())) },
            code = { v -> "playerConfig = playerConfig.copy(adaptationConfig = playerConfig.adaptationConfig.copy(initialBandwidthEstimateOverride = ${if (v == "null") v else v + "L"}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.live.LiveConfig.liveEdgeOffset",
            owner = "live.LiveConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            minimum = -1.0,
            player = { c, v -> c.copy(liveConfig = c.liveConfig.copy(liveEdgeOffset = v.toDouble())) },
            code = { v -> "playerConfig = playerConfig.copy(liveConfig = playerConfig.liveConfig.copy(liveEdgeOffset = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.live.LiveConfig.minTimeShiftBufferDepth",
            owner = "live.LiveConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            minimum = 0.0,
            player = { c, v -> c.copy(liveConfig = c.liveConfig.copy(minTimeShiftBufferDepth = v.toDouble())) },
            code = { v -> "playerConfig = playerConfig.copy(liveConfig = playerConfig.liveConfig.copy(minTimeShiftBufferDepth = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.live.LowLatencyConfig.targetLatency",
            owner = "live.LowLatencyConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            minimum = 0.0,
            player = { c, v -> c.copy(liveConfig = c.liveConfig.copy(lowLatencyConfig = (c.liveConfig.lowLatencyConfig ?: LowLatencyConfig()).copy(targetLatency = v.toDouble()))) },
            code = { v -> "playerConfig = playerConfig.copy(liveConfig = playerConfig.liveConfig.copy(lowLatencyConfig = (playerConfig.liveConfig.lowLatencyConfig ?: LowLatencyConfig()).copy(targetLatency = $v)))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.SourceConfig.description",
            owner = "source.SourceConfig",
            kind = ApiValueKind.Text,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            source = { c, v -> c.description = v },
            code = { v -> "sourceConfig.description = ${kotlinString(v)}" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.SourceConfig.audioCodecPriority",
            owner = "source.SourceConfig",
            kind = ApiValueKind.TextList,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            source = { c, v -> c.audioCodecPriority = textList(v) },
            code = { v -> "sourceConfig.audioCodecPriority = ${listCode(v)}" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.SourceConfig.videoCodecPriority",
            owner = "source.SourceConfig",
            kind = ApiValueKind.TextList,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            source = { c, v -> c.videoCodecPriority = textList(v) },
            code = { v -> "sourceConfig.videoCodecPriority = ${listCode(v)}" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.SourceConfig.thumbnailTrack",
            owner = "source.SourceConfig",
            kind = ApiValueKind.Text,
            help = "External thumbnail WebVTT URL. Requires a reachable track and thumbnail images.",
            source = { c, v -> c.thumbnailTrack = ThumbnailTrack(v) },
            code = { v -> "sourceConfig.thumbnailTrack = ThumbnailTrack(${kotlinString(v)})" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.SourceAdaptationConfig.bandwidthFractionAvailableToUse",
            owner = "source.SourceAdaptationConfig",
            kind = ApiValueKind.FloatDecimal,
            help = "null keeps the nullable SDK value; remove override to restore the base configuration.",
            minimum = 0.0,
            maximum = 1.0,
            nullable = true,
            source = { c, v -> c.adaptationConfig = c.adaptationConfig.copy(bandwidthFractionAvailableToUse = if (v == "null") null else v.toFloat()) },
            code = { v -> "sourceConfig.adaptationConfig = sourceConfig.adaptationConfig.copy(bandwidthFractionAvailableToUse = ${if (v == "null") v else v + "f"})" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.vr.VrConfig.isStereo",
            owner = "vr.VrConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            source = { c, v -> c.vrConfig = c.vrConfig.copy(isStereo = v.toBooleanStrict()) },
            code = { v -> "sourceConfig.vrConfig = sourceConfig.vrConfig.copy(isStereo = $v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.vr.VrConfig.startPosition",
            owner = "vr.VrConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            source = { c, v -> c.vrConfig = c.vrConfig.copy(startPosition = v.toDouble()) },
            code = { v -> "sourceConfig.vrConfig = sourceConfig.vrConfig.copy(startPosition = $v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.vr.VrConfig.viewingDirectionChangeEventInterval",
            owner = "vr.VrConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            minimum = 0.0,
            source = { c, v -> c.vrConfig = c.vrConfig.copy(viewingDirectionChangeEventInterval = v.toDouble()) },
            code = { v -> "sourceConfig.vrConfig = sourceConfig.vrConfig.copy(viewingDirectionChangeEventInterval = $v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.vr.VrConfig.viewingDirectionChangeThreshold",
            owner = "vr.VrConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            minimum = 0.0,
            source = { c, v -> c.vrConfig = c.vrConfig.copy(viewingDirectionChangeThreshold = v.toDouble()) },
            code = { v -> "sourceConfig.vrConfig = sourceConfig.vrConfig.copy(viewingDirectionChangeThreshold = $v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.vr.VrViewingWindowConfig.maxPitch",
            owner = "vr.VrViewingWindowConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            source = { c, v -> c.vrConfig = c.vrConfig.copy(viewingWindow = c.vrConfig.viewingWindow.copy(maxPitch = v.toDouble())) },
            code = { v -> "sourceConfig.vrConfig = sourceConfig.vrConfig.copy(viewingWindow = sourceConfig.vrConfig.viewingWindow.copy(maxPitch = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.vr.VrViewingWindowConfig.maxYaw",
            owner = "vr.VrViewingWindowConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            source = { c, v -> c.vrConfig = c.vrConfig.copy(viewingWindow = c.vrConfig.viewingWindow.copy(maxYaw = v.toDouble())) },
            code = { v -> "sourceConfig.vrConfig = sourceConfig.vrConfig.copy(viewingWindow = sourceConfig.vrConfig.viewingWindow.copy(maxYaw = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.vr.VrViewingWindowConfig.minPitch",
            owner = "vr.VrViewingWindowConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            source = { c, v -> c.vrConfig = c.vrConfig.copy(viewingWindow = c.vrConfig.viewingWindow.copy(minPitch = v.toDouble())) },
            code = { v -> "sourceConfig.vrConfig = sourceConfig.vrConfig.copy(viewingWindow = sourceConfig.vrConfig.viewingWindow.copy(minPitch = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.vr.VrViewingWindowConfig.minYaw",
            owner = "vr.VrViewingWindowConfig",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. SDK content and device requirements apply.",
            source = { c, v -> c.vrConfig = c.vrConfig.copy(viewingWindow = c.vrConfig.viewingWindow.copy(minYaw = v.toDouble())) },
            code = { v -> "sourceConfig.vrConfig = sourceConfig.vrConfig.copy(viewingWindow = sourceConfig.vrConfig.viewingWindow.copy(minYaw = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.casting.RemoteControlConfig.isCastEnabled",
            owner = "casting.RemoteControlConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            player = { c, v -> c.copy(remoteControlConfig = c.remoteControlConfig.copy(isCastEnabled = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(remoteControlConfig = playerConfig.remoteControlConfig.copy(isCastEnabled = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.casting.RemoteControlConfig.sendManifestRequestsWithCredentials",
            owner = "casting.RemoteControlConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            player = { c, v -> c.copy(remoteControlConfig = c.remoteControlConfig.copy(sendManifestRequestsWithCredentials = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(remoteControlConfig = playerConfig.remoteControlConfig.copy(sendManifestRequestsWithCredentials = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.casting.RemoteControlConfig.sendSegmentRequestsWithCredentials",
            owner = "casting.RemoteControlConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            player = { c, v -> c.copy(remoteControlConfig = c.remoteControlConfig.copy(sendSegmentRequestsWithCredentials = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(remoteControlConfig = playerConfig.remoteControlConfig.copy(sendSegmentRequestsWithCredentials = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.casting.RemoteControlConfig.sendDrmLicenseRequestsWithCredentials",
            owner = "casting.RemoteControlConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            player = { c, v -> c.copy(remoteControlConfig = c.remoteControlConfig.copy(sendDrmLicenseRequestsWithCredentials = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(remoteControlConfig = playerConfig.remoteControlConfig.copy(sendDrmLicenseRequestsWithCredentials = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.casting.RemoteControlConfig.stopCastingOnError",
            owner = "casting.RemoteControlConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            player = { c, v -> c.copy(remoteControlConfig = c.remoteControlConfig.copy(stopCastingOnError = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(remoteControlConfig = playerConfig.remoteControlConfig.copy(stopCastingOnError = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.casting.RemoteControlConfig.receiverStylesheetUrl",
            owner = "casting.RemoteControlConfig",
            kind = ApiValueKind.Text,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            player = { c, v -> c.copy(remoteControlConfig = c.remoteControlConfig.copy(receiverStylesheetUrl = v)) },
            code = { v -> "playerConfig = playerConfig.copy(remoteControlConfig = playerConfig.remoteControlConfig.copy(receiverStylesheetUrl = ${kotlinString(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.casting.RemoteControlConfig.customReceiverConfig",
            owner = "casting.RemoteControlConfig",
            kind = ApiValueKind.StringMap,
            help = "One receiver name=value entry per line. Empty input sends an empty map. Receiver support is required.",
            player = { c, v -> c.copy(remoteControlConfig = c.remoteControlConfig.copy(customReceiverConfig = parseApiStringMap(v))) },
            code = { v -> "playerConfig = playerConfig.copy(remoteControlConfig = playerConfig.remoteControlConfig.copy(customReceiverConfig = ${mapCode(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.SourceConfig.metadata",
            owner = "source.SourceConfig",
            kind = ApiValueKind.StringMap,
            help = "One metadata name=value entry per line. Empty input sends an empty map.",
            source = { c, v -> c.metadata = parseApiStringMap(v) },
            code = { v -> "sourceConfig.metadata = ${mapCode(v)}" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.NetworkEngine.HttpURLConnection.allowCrossProtocolRedirects",
            owner = "source.NetworkEngine.HttpURLConnection",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            source = { c, v -> c.networkConfig = SourceNetworkConfig(NetworkEngine.HttpURLConnection(allowCrossProtocolRedirects = v.toBooleanStrict())) },
            code = { v -> "sourceConfig.networkConfig = SourceNetworkConfig(NetworkEngine.HttpURLConnection(allowCrossProtocolRedirects = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.CmcdConfig.Enabled.transmissionMode",
            owner = "source.CmcdConfig.Enabled",
            kind = ApiValueKind.Choice,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            choices = listOf("Header","Query"),
            source = { c, v -> c.cmcdConfig = (c.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled()).copy(transmissionMode = CmcdTransmissionMode.valueOf(v)) },
            code = { v -> "sourceConfig.cmcdConfig = (sourceConfig.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled()).copy(transmissionMode = CmcdTransmissionMode.$v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.CmcdConfig.Enabled.contentId",
            owner = "source.CmcdConfig.Enabled",
            kind = ApiValueKind.Text,
            help = "Content identifier, at most 64 characters. Setting a CMCD leaf enables CMCD.",
            source = { c, v -> c.cmcdConfig = (c.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled()).copy(contentId = v) },
            code = { v -> "sourceConfig.cmcdConfig = (sourceConfig.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled()).copy(contentId = ${kotlinString(v)})" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.CmcdConfig.Enabled.excludedKeys",
            owner = "source.CmcdConfig.Enabled",
            kind = ApiValueKind.TextList,
            help = "Comma-separated CMCD enum names; blank creates an empty exclusion set.",
            choices = listOf("Bitrate","BufferLength","ContentId","SessionId","MaximumRequestedBitrate","StreamingFormat","StreamType","Version","TopBitrate","ObjectDuration","MeasuredThroughput","ObjectType","BufferStarvation","Deadline","PlaybackRate","Startup","NextObjectRequest","NextRangeRequest"),
            source = { c, v -> c.cmcdConfig = (c.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled()).copy(excludedKeys = textList(v).map { CmcdKey.Predefined.valueOf(it) }.toSet()) },
            code = { v -> "sourceConfig.cmcdConfig = (sourceConfig.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled()).copy(excludedKeys = ${textList(v).joinToString(", ", "setOf(", ")") { "CmcdKey.Predefined.$it" }})" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.CmcdConfig.Enabled.sessionId",
            owner = "source.CmcdConfig.Enabled",
            kind = ApiValueKind.Choice,
            help = "Generate or omit the session ID; the custom value field sets the Custom variant.",
            choices = listOf("Generate","None"),
            source = { c, v -> c.cmcdConfig = (c.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled()).copy(sessionId = if (v == "Generate") CmcdSessionId.Generate else CmcdSessionId.None) },
            code = { v -> "sourceConfig.cmcdConfig = (sourceConfig.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled()).copy(sessionId = CmcdSessionId.$v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.source.CmcdSessionId.Custom.value",
            owner = "source.CmcdSessionId.Custom",
            kind = ApiValueKind.Text,
            help = "Nonempty custom session identifier, at most 64 characters.",
            source = { c, v -> c.cmcdConfig = (c.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled()).copy(sessionId = CmcdSessionId.Custom(v)) },
            code = { v -> "sourceConfig.cmcdConfig = (sourceConfig.cmcdConfig as? CmcdConfig.Enabled ?: CmcdConfig.Enabled()).copy(sessionId = CmcdSessionId.Custom(${kotlinString(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.BandwidthMeterType.Default.bandwidthEstimateWeightLimit",
            owner = "BandwidthMeterType.Default",
            kind = ApiValueKind.Integer,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            minimum = 1.0,
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(bandwidthMeterType = BandwidthMeterType.Default(v.toInt()))) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(bandwidthMeterType = BandwidthMeterType.Default($v)))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.BandwidthMeterType.Experimental.minBytesTransferred",
            owner = "BandwidthMeterType.Experimental",
            kind = ApiValueKind.LongInteger,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(bandwidthMeterType = (c.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).copy(minBytesTransferred = v.toLong()))) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(bandwidthMeterType = (playerConfig.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).copy(minBytesTransferred = ${v}L)))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.BandwidthMeterType.Experimental.usePreloadHintsForBandwidthEstimation",
            owner = "BandwidthMeterType.Experimental",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(bandwidthMeterType = (c.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).copy(usePreloadHintsForBandwidthEstimation = v.toBooleanStrict()))) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(bandwidthMeterType = (playerConfig.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).copy(usePreloadHintsForBandwidthEstimation = $v)))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.BandwidthEstimationMode.ExponentialWeightedAverage.smoothingFactor",
            owner = "BandwidthEstimationMode.ExponentialWeightedAverage",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            minimum = 0.0,
            maximum = 1.0,
            player = { c, v -> (c.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).let { existing -> c.copy(tweaksConfig = c.tweaksConfig.copy(bandwidthMeterType = existing.copy(bandwidthEstimationMode = BandwidthEstimationMode.ExponentialWeightedAverage(v.toDouble())))) } },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(bandwidthMeterType = (playerConfig.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).let { existing -> existing.copy(bandwidthEstimationMode = BandwidthEstimationMode.ExponentialWeightedAverage($v)) })))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.BandwidthEstimationMode.SlidingPercentile.maxSampleCount",
            owner = "BandwidthEstimationMode.SlidingPercentile",
            kind = ApiValueKind.Integer,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            minimum = 1.0,
            player = { c, v -> (c.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).let { existing -> c.copy(tweaksConfig = c.tweaksConfig.copy(bandwidthMeterType = existing.copy(bandwidthEstimationMode = (existing.bandwidthEstimationMode as? BandwidthEstimationMode.SlidingPercentile ?: BandwidthEstimationMode.SlidingPercentile()).copy(maxSampleCount = v.toInt())))) } },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(bandwidthMeterType = (playerConfig.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).let { existing -> existing.copy(bandwidthEstimationMode = (existing.bandwidthEstimationMode as? BandwidthEstimationMode.SlidingPercentile ?: BandwidthEstimationMode.SlidingPercentile()).copy(maxSampleCount = $v)) })))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.BandwidthEstimationMode.SlidingPercentile.percentile",
            owner = "BandwidthEstimationMode.SlidingPercentile",
            kind = ApiValueKind.Decimal,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            minimum = 0.0,
            maximum = 1.0,
            player = { c, v -> (c.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).let { existing -> c.copy(tweaksConfig = c.tweaksConfig.copy(bandwidthMeterType = existing.copy(bandwidthEstimationMode = (existing.bandwidthEstimationMode as? BandwidthEstimationMode.SlidingPercentile ?: BandwidthEstimationMode.SlidingPercentile()).copy(percentile = v.toDouble())))) } },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(bandwidthMeterType = (playerConfig.tweaksConfig.bandwidthMeterType as? BandwidthMeterType.Experimental ?: BandwidthMeterType.Experimental()).let { existing -> existing.copy(bandwidthEstimationMode = (existing.bandwidthEstimationMode as? BandwidthEstimationMode.SlidingPercentile ?: BandwidthEstimationMode.SlidingPercentile()).copy(percentile = $v)) })))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.httpResponseTypesToPreprocess",
            owner = "TweaksConfig",
            kind = ApiValueKind.TextList,
            help = "Comma-separated request types. Preprocessing retains full responses in memory; select only required types. Blank creates an empty list.",
            choices = listOf("ManifestDash","ManifestHlsMaster","ManifestHlsVariant","ManifestSmooth","MediaProgressive","MediaAudio","MediaVideo","MediaSubtitles","MediaThumbnails","DrmLicenseWidevine","DrmLicenseNagraConnect","DrmLicensePlayReady","KeyHlsAes","HlsInterstitialsAssetList","Unknown"),
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(httpResponseTypesToPreprocess = textList(v).map(HttpRequestType::valueOf))) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(httpResponseTypesToPreprocess = ${textList(v).joinToString(", ", "listOf(", ")") { "HttpRequestType.$it" }}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.TweaksConfig.forceReuseVideoCodecReasons",
            owner = "TweaksConfig",
            kind = ApiValueKind.TextList,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            choices = listOf("ColorInfoMismatch","MaxInputSizeExceeded","MaxResolutionExceeded"),
            player = { c, v -> c.copy(tweaksConfig = c.tweaksConfig.copy(forceReuseVideoCodecReasons = textList(v).map(ForceReuseVideoCodecReason::valueOf).toSet())) },
            code = { v -> "playerConfig = playerConfig.copy(tweaksConfig = playerConfig.tweaksConfig.copy(forceReuseVideoCodecReasons = ${textList(v).joinToString(", ", "setOf(", ")") { "ForceReuseVideoCodecReason.$it" }}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.vr.VrConfig.vrContentType",
            owner = "vr.VrConfig",
            kind = ApiValueKind.Choice,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            choices = listOf("None","Sbs","Single","Tab"),
            source = { c, v -> c.vrConfig = c.vrConfig.copy(vrContentType = VrContentType.valueOf(v)) },
            code = { v -> "sourceConfig.vrConfig = sourceConfig.vrConfig.copy(vrContentType = VrContentType.$v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.PlayerViewConfig.hideFirstFrame",
            owner = "ui.PlayerViewConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            view = { c, v -> c.copy(hideFirstFrame = v.toBooleanStrict()) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(hideFirstFrame = $v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.PlayerViewConfig.enableComposeSurfaceSyncWorkaround",
            owner = "ui.PlayerViewConfig",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            view = { c, v -> c.copy(enableComposeSurfaceSyncWorkaround = v.toBooleanStrict()) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(enableComposeSurfaceSyncWorkaround = $v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.PlayerViewConfig.scalingMode",
            owner = "ui.PlayerViewConfig",
            kind = ApiValueKind.Choice,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            choices = listOf("Fit","Stretch","Zoom"),
            view = { c, v -> c.copy(scalingMode = ScalingMode.valueOf(v)) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(scalingMode = ScalingMode.$v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.PlayerViewConfig.surfaceType",
            owner = "ui.PlayerViewConfig",
            kind = ApiValueKind.Choice,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            choices = listOf("SurfaceView","TextureView"),
            view = { c, v -> c.copy(surfaceType = SurfaceType.valueOf(v)) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(surfaceType = SurfaceType.$v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.PlayerViewConfig.playerMaxVideoQualityConstraint",
            owner = "ui.PlayerViewConfig",
            kind = ApiValueKind.Choice,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            choices = listOf("RelaxedViewport","None"),
            view = { c, v -> c.copy(playerMaxVideoQualityConstraint = PlayerViewConfig.PlayerVideoQualityConstraint.valueOf(v)) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(playerMaxVideoQualityConstraint = PlayerViewConfig.PlayerVideoQualityConstraint.$v)" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.UiConfig.WebUi.cssLocation",
            owner = "ui.UiConfig.WebUi",
            kind = ApiValueKind.Text,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            view = { c, v -> c.copy(uiConfig = ((c.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(cssLocation = v)) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(uiConfig = ((playerViewConfig.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(cssLocation = ${kotlinString(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.UiConfig.WebUi.jsLocation",
            owner = "ui.UiConfig.WebUi",
            kind = ApiValueKind.Text,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            view = { c, v -> c.copy(uiConfig = ((c.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(jsLocation = v)) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(uiConfig = ((playerViewConfig.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(jsLocation = ${kotlinString(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.UiConfig.WebUi.supplementalCssLocation",
            owner = "ui.UiConfig.WebUi",
            kind = ApiValueKind.Text,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            view = { c, v -> c.copy(uiConfig = ((c.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(supplementalCssLocation = v)) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(uiConfig = ((playerViewConfig.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(supplementalCssLocation = ${kotlinString(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.UiConfig.WebUi.customOptions",
            owner = "ui.UiConfig.WebUi",
            kind = ApiValueKind.Text,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            view = { c, v -> c.copy(uiConfig = ((c.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(customOptions = v)) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(uiConfig = ((playerViewConfig.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(customOptions = ${kotlinString(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.UiConfig.WebUi.playbackSpeedSelectionEnabled",
            owner = "ui.UiConfig.WebUi",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            view = { c, v -> c.copy(uiConfig = ((c.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(playbackSpeedSelectionEnabled = v.toBooleanStrict())) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(uiConfig = ((playerViewConfig.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(playbackSpeedSelectionEnabled = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.UiConfig.WebUi.forceSubtitlesIntoViewContainer",
            owner = "ui.UiConfig.WebUi",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            view = { c, v -> c.copy(uiConfig = ((c.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(forceSubtitlesIntoViewContainer = v.toBooleanStrict())) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(uiConfig = ((playerViewConfig.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(forceSubtitlesIntoViewContainer = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.UiConfig.WebUi.focusUiOnInitialization",
            owner = "ui.UiConfig.WebUi",
            kind = ApiValueKind.Boolean,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            view = { c, v -> c.copy(uiConfig = ((c.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(focusUiOnInitialization = v.toBooleanStrict())) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(uiConfig = ((playerViewConfig.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(focusUiOnInitialization = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.UiConfig.WebUi.Variant.Custom.uiManagerFactoryFunction",
            owner = "ui.UiConfig.WebUi.Variant.Custom",
            kind = ApiValueKind.Text,
            help = "Remove override to restore the base configuration. Content and device support still apply.",
            view = { c, v -> c.copy(uiConfig = ((c.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(variant = UiConfig.WebUi.Variant.Custom(v))) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(uiConfig = ((playerViewConfig.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(variant = UiConfig.WebUi.Variant.Custom(${kotlinString(v)})))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.UiConfig.WebUi.variant",
            owner = "ui.UiConfig.WebUi",
            kind = ApiValueKind.Choice,
            help = "Built-in variants. Use uiManagerFactoryFunction for a Custom variant.",
            choices = listOf("SmallScreenUi","TvUi"),
            view = { c, v -> c.copy(uiConfig = ((c.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(variant = if (v == "TvUi") UiConfig.WebUi.Variant.TvUi else UiConfig.WebUi.Variant.SmallScreenUi)) },
            code = { v -> "playerViewConfig = playerViewConfig.copy(uiConfig = ((playerViewConfig.uiConfig as? UiConfig.WebUi) ?: UiConfig.WebUi()).copy(variant = UiConfig.WebUi.Variant.$v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.StyleConfig.isUiEnabled",
            owner = "ui.StyleConfig",
            kind = ApiValueKind.Boolean,
            help = "Deprecated SDK field. Explicit PlayerViewConfig can take precedence; prefer the corresponding view field for current UI behavior.",
            player = { c, v -> c.copy(styleConfig = c.styleConfig.copy(isUiEnabled = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(styleConfig = playerConfig.styleConfig.copy(isUiEnabled = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.StyleConfig.isHideFirstFrame",
            owner = "ui.StyleConfig",
            kind = ApiValueKind.Boolean,
            help = "Deprecated SDK field. Explicit PlayerViewConfig can take precedence; prefer the corresponding view field for current UI behavior.",
            player = { c, v -> c.copy(styleConfig = c.styleConfig.copy(isHideFirstFrame = v.toBooleanStrict())) },
            code = { v -> "playerConfig = playerConfig.copy(styleConfig = playerConfig.styleConfig.copy(isHideFirstFrame = $v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.StyleConfig.playerUiCss",
            owner = "ui.StyleConfig",
            kind = ApiValueKind.Text,
            help = "Deprecated SDK field. Explicit PlayerViewConfig can take precedence; prefer the corresponding view field for current UI behavior.",
            player = { c, v -> c.copy(styleConfig = c.styleConfig.copy(playerUiCss = v)) },
            code = { v -> "playerConfig = playerConfig.copy(styleConfig = playerConfig.styleConfig.copy(playerUiCss = ${kotlinString(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.StyleConfig.playerUiJs",
            owner = "ui.StyleConfig",
            kind = ApiValueKind.Text,
            help = "Deprecated SDK field. Explicit PlayerViewConfig can take precedence; prefer the corresponding view field for current UI behavior.",
            player = { c, v -> c.copy(styleConfig = c.styleConfig.copy(playerUiJs = v)) },
            code = { v -> "playerConfig = playerConfig.copy(styleConfig = playerConfig.styleConfig.copy(playerUiJs = ${kotlinString(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.StyleConfig.supplementalPlayerUiCss",
            owner = "ui.StyleConfig",
            kind = ApiValueKind.Text,
            help = "Deprecated SDK field. Explicit PlayerViewConfig can take precedence; prefer the corresponding view field for current UI behavior.",
            player = { c, v -> c.copy(styleConfig = c.styleConfig.copy(supplementalPlayerUiCss = v)) },
            code = { v -> "playerConfig = playerConfig.copy(styleConfig = playerConfig.styleConfig.copy(supplementalPlayerUiCss = ${kotlinString(v)}))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.ui.StyleConfig.scalingMode",
            owner = "ui.StyleConfig",
            kind = ApiValueKind.Choice,
            help = "Deprecated SDK field. Explicit PlayerViewConfig can take precedence; prefer the corresponding view field for current UI behavior.",
            choices = listOf("Fit","Stretch","Zoom"),
            player = { c, v -> c.copy(styleConfig = c.styleConfig.copy(scalingMode = ScalingMode.valueOf(v))) },
            code = { v -> "playerConfig = playerConfig.copy(styleConfig = playerConfig.styleConfig.copy(scalingMode = ScalingMode.$v))" }
        ),
        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.DrmConfig.licenseUrl",
            owner = "drm.DrmConfig",
            kind = ApiValueKind.Text,
            help = "License endpoint. Preserves the current public DRM variant and common fields; defaults to Widevine when no DRM is configured. The URL is omitted from code export.",
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.DrmConfig.isLicenseRenewable",
            owner = "drm.DrmConfig",
            kind = ApiValueKind.Boolean,
            help = "DRM settings require compatible encrypted content, a licensed endpoint and device support. Values remain local to this running app.",
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.DrmConfig.shouldKeepDrmSessionsAlive",
            owner = "drm.DrmConfig",
            kind = ApiValueKind.Boolean,
            help = "DRM settings require compatible encrypted content, a licensed endpoint and device support. Values remain local to this running app.",
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.DrmConfig.immediateLicenseRequest",
            owner = "drm.DrmConfig",
            kind = ApiValueKind.Boolean,
            help = "DRM settings require compatible encrypted content, a licensed endpoint and device support. Values remain local to this running app.",
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.DrmConfig.drmSessionKeepaliveMs",
            owner = "drm.DrmConfig",
            kind = ApiValueKind.LongInteger,
            help = "DRM settings require compatible encrypted content, a licensed endpoint and device support. Values remain local to this running app.",
            nullable = true,
            minimum = 0.0,
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.DrmConfig.httpHeaders",
            owner = "drm.DrmConfig",
            kind = ApiValueKind.StringMap,
            help = "DRM settings require compatible encrypted content, a licensed endpoint and device support. Values remain local to this running app.",
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.WidevineConfig.preferredSecurityLevel",
            owner = "drm.WidevineConfig",
            kind = ApiValueKind.Choice,
            help = "DRM settings require compatible encrypted content, a licensed endpoint and device support. Values remain local to this running app.",
            choices = listOf("L1","L3"),
            nullable = true,
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.NagraConnectConfig.operatorVault",
            owner = "drm.NagraConnectConfig",
            kind = ApiValueKind.Text,
            help = "DRM settings require compatible encrypted content, a licensed endpoint and device support. Values remain local to this running app.",
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.ClearKeyConfigEntry.key",
            owner = "drm.ClearKeyConfigEntry",
            kind = ApiValueKind.Text,
            help = "DRM settings require compatible encrypted content, a licensed endpoint and device support. Values remain local to this running app.",
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.ClearKeyConfigEntry.kid",
            owner = "drm.ClearKeyConfigEntry",
            kind = ApiValueKind.Text,
            help = "DRM settings require compatible encrypted content, a licensed endpoint and device support. Values remain local to this running app.",
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.WidevineConfig.prepareMessageCallback",
            owner = "drm.WidevineConfig",
            kind = ApiValueKind.Choice,
            help = "Named callback strategies. These presets do not represent arbitrary native callback code. Binary license data is not displayed or logged.",
            choices = listOf("Identity","Base64Encode","Base64Decode"),
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.WidevineConfig.prepareLicenseCallback",
            owner = "drm.WidevineConfig",
            kind = ApiValueKind.Choice,
            help = "Named callback strategies. These presets do not represent arbitrary native callback code. Binary license data is not displayed or logged.",
            choices = listOf("Identity","Base64Encode","Base64Decode"),
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.PlayReadyConfig.prepareMessageCallback",
            owner = "drm.PlayReadyConfig",
            kind = ApiValueKind.Choice,
            help = "Named callback strategies. These presets do not represent arbitrary native callback code. Binary license data is not displayed or logged.",
            choices = listOf("Identity","Base64Encode","Base64Decode"),
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.PlayReadyConfig.prepareLicenseCallback",
            owner = "drm.PlayReadyConfig",
            kind = ApiValueKind.Choice,
            help = "Named callback strategies. These presets do not represent arbitrary native callback code. Binary license data is not displayed or logged.",
            choices = listOf("Identity","Base64Encode","Base64Decode"),
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.NagraConnectConfig.prepareMessageCallback",
            owner = "drm.NagraConnectConfig",
            kind = ApiValueKind.Choice,
            help = "Named callback strategies. These presets do not represent arbitrary native callback code. Binary license data is not displayed or logged.",
            choices = listOf("Identity","Base64Encode","Base64Decode"),
            drmParameter = true
        ),        ApiSetting(
            id = "android:com.bitmovin.player.api.drm.NagraConnectConfig.prepareLicenseCallback",
            owner = "drm.NagraConnectConfig",
            kind = ApiValueKind.Choice,
            help = "Named callback strategies. These presets do not represent arbitrary native callback code. Binary license data is not displayed or logged.",
            choices = listOf("Identity","Base64Encode","Base64Decode"),
            drmParameter = true
        )
    ) + ApiStructuredSettings.fields + ApiScriptSettings.fields
    val byId: Map<String, ApiSetting> = fields.associateBy(ApiSetting::id)
}
