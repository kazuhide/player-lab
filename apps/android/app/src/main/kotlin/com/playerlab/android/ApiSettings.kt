package com.playerlab.android

import com.bitmovin.player.api.*
import com.bitmovin.player.api.decoder.DecoderConfig
import com.bitmovin.player.api.live.*
import com.bitmovin.player.api.media.MediaFilter
import com.bitmovin.player.api.media.thumbnail.ThumbnailTrack
import com.bitmovin.player.api.source.*
import com.bitmovin.player.api.vr.*

internal enum class ApiValueKind { Boolean, Integer, LongInteger, Decimal, FloatDecimal, Text, TextList, Choice }

/** Explicit typed setters; no reflection, script evaluation or arbitrary SDK mutation. */
internal data class ApiSetting(
    val id: String,
    val owner: String,
    val kind: ApiValueKind,
    val help: String,
    val choices: List<String> = emptyList(),
    val minimum: Double? = null,
    val maximum: Double? = null,
    val nullable: Boolean = false,
    val player: ((PlayerConfig, String) -> PlayerConfig)? = null,
    val source: ((SourceConfig, String) -> Unit)? = null,
    val code: (String) -> String,
) {
    fun normalize(input: String): String {
        val value = if (kind == ApiValueKind.Text) input else input.trim()
        if (nullable && value == "null") return value
        val number = when (kind) {
            ApiValueKind.Boolean -> { require(value == "true" || value == "false") { "Choose true or false." }; null }
            ApiValueKind.Integer -> value.toIntOrNull()?.toDouble() ?: error("Enter a whole 32-bit integer.")
            ApiValueKind.LongInteger -> { value.toLongOrNull() ?: error("Enter a whole 64-bit integer."); null }
            ApiValueKind.Decimal -> value.toDoubleOrNull()?.also { require(it.isFinite()) { "Enter a finite number." } } ?: error("Enter a finite decimal.")
            ApiValueKind.FloatDecimal -> value.toFloatOrNull()?.also { require(it.isFinite()) { "Enter a finite number." } }?.toDouble() ?: error("Enter a finite decimal.")
            ApiValueKind.Choice -> { require(value in choices) { "Choose a documented SDK value." }; null }
            ApiValueKind.TextList -> { require(value.isEmpty() || value.split(',').all { it.trim().isNotEmpty() }) { "Enter comma-separated nonempty values, or leave blank for an empty list." }; null }
            ApiValueKind.Text -> { require(value.length <= 8192) { "Text is limited to 8192 characters." }; null }
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
            else -> value
        }
    }
}

internal data class ApiOverrides(val values: Map<String, String> = emptyMap()) {
    fun player(base: PlayerConfig): PlayerConfig = values.entries.fold(base) { config, (id, value) ->
        ApiSettings.byId.getValue(id).player?.invoke(config, value) ?: config
    }
    fun source(base: SourceConfig): SourceConfig = base.also { config ->
        values.forEach { (id, value) -> ApiSettings.byId.getValue(id).source?.invoke(config, value) }
    }
    fun code(): String = values.entries.joinToString("\n") { (id, value) -> ApiSettings.byId.getValue(id).code(value) }
    companion object {
        fun validate(draft: Map<String, String>): ApiOverrides = ApiOverrides(draft.mapValues { (id, value) ->
            val field = ApiSettings.byId[id] ?: error("Unknown SDK configuration field.")
            try { field.normalize(value) } catch (error: IllegalArgumentException) { throw IllegalArgumentException("$id: ${error.message}") }
        }.toMap())
    }
}

internal object ApiSettings {
    private fun textList(value: String) = if (value.isEmpty()) emptyList() else value.split(',').map(String::trim)
    private fun listCode(value: String) = textList(value).joinToString(", ", "listOf(", ")", transform = ::kotlinString)
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
        )
    )
    val byId: Map<String, ApiSetting> = fields.associateBy(ApiSetting::id)
}
