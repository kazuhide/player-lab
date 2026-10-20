package com.showcase.app

import com.bitmovin.player.api.PlaybackConfig
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.buffer.BufferConfig
import com.bitmovin.player.api.buffer.BufferMediaTypeConfig
import com.bitmovin.player.api.media.AdaptationConfig
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceOptions
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.source.TimelineReferencePoint
import java.net.URI

internal data class ValidatedDraft<T>(val value: T?, val errors: Map<String, String>)

/** Values owned by the app; each load receives fresh SDK configuration objects. */
internal data class SourceSettings(
    val url: String,
    val type: SourceType,
    val title: String = "",
    val posterUrl: String = "",
    val posterPersistent: Boolean = false,
    val startOffset: Double? = null,
    val offsetReference: TimelineReferencePoint? = null,
) {
    fun toSourceConfig() = SourceConfig(
        url = url,
        type = type,
        title = title.ifBlank { null },
        posterSource = posterUrl.ifBlank { null },
        isPosterPersistent = posterPersistent,
        options = SourceOptions(startOffset, offsetReference),
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
) {
    fun validate(): ValidatedDraft<SourceSettings> {
        val errors = mutableMapOf<String, String>()
        if (!httpUrl(url.trim())) errors["url"] = "Enter an absolute HTTP or HTTPS URL."
        if (posterUrl.isNotBlank() && !httpUrl(posterUrl.trim())) {
            errors["posterUrl"] = "Enter an HTTP or HTTPS poster URL, or leave blank."
        }
        val offset = if (startOffset.isBlank()) null else finiteNumber(startOffset, "startOffset", errors)
        // The SDK corrects out-of-bound offsets rather than rejecting their sign.
        // https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.source/-source-options/index.html
        return ValidatedDraft(
            if (errors.isEmpty()) SourceSettings(
                url.trim(), type, title.trim(), posterUrl.trim(), posterPersistent, offset, offsetReference,
            ) else null,
            errors,
        )
    }

    companion object {
        fun from(settings: SourceSettings) = SourceDraft(
            settings.url, settings.type, settings.title, settings.posterUrl, settings.posterPersistent,
            settings.startOffset?.toString().orEmpty(), settings.offsetReference,
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
) {
    fun toPlayerConfig(licenseKey: String) = PlayerConfig(
        key = licenseKey,
        playbackConfig = PlaybackConfig(
            isAutoplayEnabled = autoplay, isMuted = muted, isTimeShiftEnabled = timeShift,
        ),
        bufferConfig = BufferConfig(
            audioAndVideo = BufferMediaTypeConfig(forwardDuration),
            startupThreshold = startupThreshold, restartThreshold = restartThreshold,
        ),
        adaptationConfig = AdaptationConfig(
            maxSelectableVideoBitrate = maxVideoBitrate, preload = preload,
            isRebufferingAllowed = rebuffering, qualityStabilityBalance = qualityStabilityBalance,
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
        return ValidatedDraft(
            if (errors.isEmpty()) PlayerSettings(
                autoplay, muted, timeShift, requireNotNull(startup), requireNotNull(restart), requireNotNull(forward),
                requireNotNull(bitrate), preload, rebuffering, requireNotNull(balance).toFloat(),
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
        )
    }
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
