package com.showcase.app

private fun kotlinString(value: String) = buildString {
    append('"')
    value.forEach { character ->
        when (character) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '$' -> { append('\\'); append('$') }
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> if (character.code < 32 || character.code == 127) {
                append("\\u"); append(character.code.toString(16).padStart(4, '0'))
            } else append(character)
        }
    }
    append('"')
}

/** Applied values only; no environment or credential-bearing SDK config is read. */
internal fun configurationCode(source: SourceSettings, player: PlayerSettings, uiMode: UiMode): String {
    val title = source.title.takeIf { it.isNotBlank() }?.let(::kotlinString) ?: "null"
    val poster = source.posterUrl.takeIf { it.isNotBlank() }?.let(::kotlinString) ?: "null"
    val reference = source.offsetReference?.let { "TimelineReferencePoint.${it.name}" } ?: "null"
    val view = uiMode.factoryFunction?.let { factory ->
        """PlayerViewConfig(uiConfig = UiConfig.WebUi(
    jsLocation = "file:///android_asset/bitmovinplayer-ui.js",
    cssLocation = "file:///android_asset/bitmovinplayer-ui.css",
    variant = UiConfig.WebUi.Variant.Custom(${kotlinString(factory)}),
))"""
    } ?: "PlayerViewConfig()"
    return """import com.bitmovin.player.api.*
import com.bitmovin.player.api.buffer.*
import com.bitmovin.player.api.media.AdaptationConfig
import com.bitmovin.player.api.source.*
import com.bitmovin.player.api.ui.*

val playerConfig = PlayerConfig(
    key = "YOUR_PLAYER_KEY",
    playbackConfig = PlaybackConfig(
        isAutoplayEnabled = ${player.autoplay}, isMuted = ${player.muted}, isTimeShiftEnabled = ${player.timeShift},
    ),
    bufferConfig = BufferConfig(
        audioAndVideo = BufferMediaTypeConfig(${player.forwardDuration}),
        startupThreshold = ${player.startupThreshold}, restartThreshold = ${player.restartThreshold},
    ),
    adaptationConfig = AdaptationConfig(
        maxSelectableVideoBitrate = ${player.maxVideoBitrate}, preload = ${player.preload},
        isRebufferingAllowed = ${player.rebuffering}, qualityStabilityBalance = ${player.qualityStabilityBalance}f,
    ),
)
val sourceConfig = SourceConfig(
    url = ${kotlinString(source.url)}, type = SourceType.${source.type.name},
    title = $title, posterSource = $poster, isPosterPersistent = ${source.posterPersistent},
    options = SourceOptions(${source.startOffset ?: "null"}, $reference),
)
val playerViewConfig = $view

// Create and attach PlayerView with playerViewConfig before loading sourceConfig.
// Forward the Activity lifecycle to the view; retain one owner for the player.
// Player and Analytics license values are not included.
// Allow DVR controls the app's quick-seek controls separately from SDK configuration.
"""
}
