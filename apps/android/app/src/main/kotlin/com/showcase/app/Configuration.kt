package com.showcase.app

import com.bitmovin.player.api.PlaybackConfig
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.buffer.BufferConfig
import com.bitmovin.player.api.buffer.BufferMediaTypeConfig
import com.bitmovin.player.api.live.SourceLiveConfig
import com.bitmovin.player.api.media.AdaptationConfig
import com.bitmovin.player.api.media.subtitle.SubtitleTrack
import com.bitmovin.player.api.network.NetworkConfig
import com.bitmovin.player.api.network.RetryHttpRequestConfig
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceOptions
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.source.TimelineReferencePoint
import java.net.URI
import java.util.Locale

internal data class ValidatedDraft<T>(val value: T?, val errors: Map<String, String>)

internal data class ExternalSubtitleSettings(
    val url: String,
    val label: String = "",
    val language: String = "",
    val isDefault: Boolean = false,
) {
    fun toSubtitleTrack() = SubtitleTrack(
        url = url, mimeType = "text/vtt", label = label.ifBlank { null },
        id = "showcase-external-webvtt", isDefault = isDefault, language = language.ifBlank { null },
    )
}

/** Values owned by the app; each load receives fresh SDK configuration objects. */
internal data class SourceSettings(
    val url: String,
    val type: SourceType,
    val title: String = "",
    val posterUrl: String = "",
    val posterPersistent: Boolean = false,
    val startOffset: Double? = null,
    val offsetReference: TimelineReferencePoint? = null,
    val liveTargetLatency: Double? = null,
    val preferredAudioLanguages: List<String> = emptyList(),
    val externalSubtitle: ExternalSubtitleSettings? = null,
) {
    fun toSourceConfig() = SourceConfig(
        url = url,
        type = type,
        title = title.ifBlank { null },
        posterSource = posterUrl.ifBlank { null },
        isPosterPersistent = posterPersistent,
        options = SourceOptions(startOffset, offsetReference),
        liveConfig = liveTargetLatency?.let { SourceLiveConfig(targetLatency = it) },
        preferredAudioLanguages = preferredAudioLanguages.toList(),
        subtitleTracks = externalSubtitle?.let { listOf(it.toSubtitleTrack()) } ?: emptyList(),
    )

    companion object {
        fun from(source: ShowcaseSource) = SourceSettings(source.url, source.type)
    }
}

internal data class SourceDraft(
    val url: String = "",
    val type: SourceType = SourceType.Dash,
    val title: String = "",
    val posterUrl: String = "",
    val posterPersistent: Boolean = false,
    val startOffset: String = "",
    val offsetReference: TimelineReferencePoint? = null,
    val liveTargetLatency: String = "",
    val preferredAudioLanguages: String = "",
    val subtitleUrl: String = "",
    val subtitleLabel: String = "",
    val subtitleLanguage: String = "",
    val subtitleDefault: Boolean = false,
) {
    fun validate(): ValidatedDraft<SourceSettings> {
        val errors = mutableMapOf<String, String>()
        if (!httpUrl(url.trim())) errors["url"] = "Enter an absolute HTTP or HTTPS URL."
        if (posterUrl.isNotBlank() && !httpUrl(posterUrl.trim())) {
            errors["posterUrl"] = "Enter an HTTP or HTTPS poster URL, or leave blank."
        }
        val offset = if (startOffset.isBlank()) null else finiteNumber(startOffset, "startOffset", errors)
        val latency = if (liveTargetLatency.isBlank()) null else finiteNumber(liveTargetLatency, "liveTargetLatency", errors)
        val languages = languageList(preferredAudioLanguages, "preferredAudioLanguages", errors)
        if (subtitleUrl.isBlank()) {
            if (subtitleLabel.isNotBlank() || subtitleLanguage.isNotBlank() || subtitleDefault) {
                errors["subtitleUrl"] = "Enter a WebVTT URL for these subtitle settings, or clear them."
            }
        } else if (!httpUrl(subtitleUrl.trim())) {
            errors["subtitleUrl"] = "Enter an absolute HTTP or HTTPS WebVTT URL."
        }
        if (subtitleLanguage.trim().any { it.isWhitespace() || it == ',' }) {
            errors["subtitleLanguage"] = "Enter one language code, such as en or en-US, or leave blank."
        }
        val subtitle = subtitleUrl.trim().takeIf { it.isNotEmpty() }?.let {
            ExternalSubtitleSettings(it, subtitleLabel.trim(), subtitleLanguage.trim(), subtitleDefault)
        }
        // The SDK corrects out-of-bound offsets rather than rejecting their sign.
        // https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.source/-source-options/index.html
        return ValidatedDraft(
            if (errors.isEmpty()) SourceSettings(
                url.trim(), type, title.trim(), posterUrl.trim(), posterPersistent, offset, offsetReference, latency,
                languages, subtitle,
            ) else null,
            errors,
        )
    }

    companion object {
        fun from(settings: SourceSettings) = SourceDraft(
            settings.url, settings.type, settings.title, settings.posterUrl, settings.posterPersistent,
            settings.startOffset?.toString().orEmpty(), settings.offsetReference,
            settings.liveTargetLatency?.toString().orEmpty(),
            settings.preferredAudioLanguages.joinToString(", "), settings.externalSubtitle?.url.orEmpty(),
            settings.externalSubtitle?.label.orEmpty(), settings.externalSubtitle?.language.orEmpty(),
            settings.externalSubtitle?.isDefault ?: false,
        )
    }
}

/** Never mutate PlayerConfig or its nested configs after creating a player. */
internal data class PlayerSettings(
    val autoplay: Boolean = false,
    val muted: Boolean = false,
    val timeShift: Boolean = true,
    val startupThreshold: Double = 2.5,
    val restartThreshold: Double = 5.0,
    val forwardDuration: Double = 50.0,
    val maxVideoBitrate: Int = Int.MAX_VALUE,
    val preload: Boolean = true,
    val rebuffering: Boolean = true,
    val qualityStabilityBalance: Float = 0.5f,
    val preferredAudioLanguages: List<String> = emptyList(),
    val httpRetryDelays: List<Double>? = null,
) {
    fun toPlayerConfig(licenseKey: String) = PlayerConfig(
        key = licenseKey,
        playbackConfig = PlaybackConfig(
            isAutoplayEnabled = autoplay, isMuted = muted, isTimeShiftEnabled = timeShift,
            preferredAudioLanguages = preferredAudioLanguages.toList(),
        ),
        bufferConfig = BufferConfig(
            audioAndVideo = BufferMediaTypeConfig(forwardDuration),
            startupThreshold = startupThreshold, restartThreshold = restartThreshold,
        ),
        adaptationConfig = AdaptationConfig(
            maxSelectableVideoBitrate = maxVideoBitrate, preload = preload,
            isRebufferingAllowed = rebuffering, qualityStabilityBalance = qualityStabilityBalance,
        ),
        networkConfig = NetworkConfig(
            retryHttpRequestConfig = httpRetryDelays?.let { RetryHttpRequestConfig.Retry(it.toList()) }
                ?: RetryHttpRequestConfig.LinearIncreasingBackoffRetry,
        ),
    )
}

internal data class PlayerDraft(
    val autoplay: Boolean = false,
    val muted: Boolean = false,
    val timeShift: Boolean = true,
    val startupThreshold: String = "2.5",
    val restartThreshold: String = "5",
    val forwardDuration: String = "50",
    val maxVideoBitrate: String = "",
    val preload: Boolean = true,
    val rebuffering: Boolean = true,
    val qualityStabilityBalance: String = "0.5",
    val preferredAudioLanguages: String = "",
    val httpRetryDelays: String = "",
) {
    fun validate(): ValidatedDraft<PlayerSettings> {
        val errors = mutableMapOf<String, String>()
        val startup = finiteNumber(startupThreshold, "startupThreshold", errors, 0.0)
        val restart = finiteNumber(restartThreshold, "restartThreshold", errors, 0.0)
        val forward = finiteNumber(forwardDuration, "forwardDuration", errors, 0.5)
        // The documented threshold ceiling is the forward buffer minus 0.5 seconds.
        // https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.buffer/-buffer-config/index.html
        if (forward != null) {
            // Account for one ULP of subtraction error, e.g. 0.6 - 0.5 being slightly below 0.1.
            fun exceedsHeadroom(threshold: Double) = threshold - (forward - 0.5) > Math.ulp(forward)
            if (startup != null && exceedsHeadroom(startup)) errors["startupThreshold"] = "Must be at most forward buffer minus 0.5 s."
            if (restart != null && exceedsHeadroom(restart)) errors["restartThreshold"] = "Must be at most forward buffer minus 0.5 s."
        }
        val bitrate = if (maxVideoBitrate.isBlank()) Int.MAX_VALUE else maxVideoBitrate.trim().toIntOrNull()
        if (bitrate == null || bitrate < 0) errors["maxVideoBitrate"] = "Enter a whole number from 0 to 2147483647 bps, or leave blank."
        val balance = finiteNumber(qualityStabilityBalance, "qualityStabilityBalance", errors, 0.0)
        if (balance != null && balance > 1.0) errors["qualityStabilityBalance"] = "Enter a number from 0 to 1."
        val languages = languageList(preferredAudioLanguages, "preferredAudioLanguages", errors)
        val retries = when {
            httpRetryDelays.isBlank() -> null
            httpRetryDelays.trim().equals("none", ignoreCase = true) -> emptyList()
            else -> httpRetryDelays.split(',').mapNotNull {
                finiteNumber(it, "httpRetryDelays", errors, 0.0)
            }
        }
        return ValidatedDraft(
            if (errors.isEmpty()) PlayerSettings(
                autoplay, muted, timeShift, requireNotNull(startup), requireNotNull(restart), requireNotNull(forward),
                requireNotNull(bitrate), preload, rebuffering, requireNotNull(balance).toFloat(),
                languages, retries,
            ) else null,
            errors,
        )
    }

    companion object {
        fun from(settings: PlayerSettings) = PlayerDraft(
            settings.autoplay, settings.muted, settings.timeShift, settings.startupThreshold.toString(),
            settings.restartThreshold.toString(), settings.forwardDuration.toString(),
            settings.maxVideoBitrate.takeUnless { it == Int.MAX_VALUE }?.toString().orEmpty(),
            settings.preload, settings.rebuffering, settings.qualityStabilityBalance.toString(),
            settings.preferredAudioLanguages.joinToString(", "),
            settings.httpRetryDelays?.let { if (it.isEmpty()) "none" else it.joinToString(", ") }.orEmpty(),
        )
    }
}

private fun languageList(text: String, field: String, errors: MutableMap<String, String>): List<String> {
    if (text.isBlank()) return emptyList()
    val languages = text.split(',').map { it.trim() }
    if (languages.any { it.isEmpty() || it.any(Char::isWhitespace) }) {
        errors[field] = "Enter comma-separated language codes, such as de, en."
    }
    // Preserve priority and spelling; discard only duplicate codes, ignoring case.
    return languages.distinctBy { it.lowercase(Locale.ROOT) }
}

private fun httpUrl(value: String): Boolean = runCatching {
    val uri = URI(value)
    uri.scheme?.lowercase() in setOf("http", "https") && !uri.host.isNullOrBlank()
}.getOrDefault(false)

private fun finiteNumber(
    text: String,
    field: String,
    errors: MutableMap<String, String>,
    minimum: Double? = null,
): Double? {
    val number = text.trim().toDoubleOrNull()
    if (number == null || !number.isFinite() || (minimum != null && number < minimum)) {
        errors[field] = if (minimum == null) "Enter a finite number." else "Enter a finite number of at least $minimum."
        return null
    }
    return number
}
