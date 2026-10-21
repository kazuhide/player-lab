package com.playerlab.android

import com.bitmovin.player.api.buffer.*
import com.bitmovin.player.api.live.LowLatencySynchronizationConfig
import com.bitmovin.player.api.media.*
import com.bitmovin.player.api.media.audio.AudioTrack
import com.bitmovin.player.api.media.audio.quality.AudioQuality
import com.bitmovin.player.api.media.subtitle.SubtitleTrack
import com.bitmovin.player.api.media.thumbnail.Thumbnail
import com.bitmovin.player.api.media.video.quality.VideoQuality
import com.bitmovin.player.api.source.*
import com.bitmovin.player.api.advertising.*
import com.bitmovin.player.api.ui.ScalingMode
import com.bitmovin.player.api.vr.orientation.Vector3
import com.bitmovin.player.api.vr.orientation.ViewingDirection

internal data class ApiArgument(val name: String, val example: String = "", val choices: List<String> = emptyList())
internal class ApiInputs(private val values: Map<String, String>) {
    fun text(name: String) = values[name] ?: error("Missing $name")
    fun int(name: String, minimum: Int? = null, maximum: Int? = null): Int {
        val value = text(name).trim().toIntOrNull() ?: error("$name must be a whole 32-bit integer.")
        require(minimum == null || value >= minimum) { "$name must be at least $minimum." }
        require(maximum == null || value <= maximum) { "$name must be at most $maximum." }
        return value
    }
    fun number(name: String, minimum: Double? = null): Double {
        val value = text(name).trim().toDoubleOrNull() ?: error("$name must be a decimal number.")
        require(value.isFinite() && (minimum == null || value >= minimum)) { "$name must be finite and within the documented range." }
        return value
    }
    fun float(name: String): Float = number(name).toFloat().also { require(it.isFinite()) { "$name exceeds Float range." } }
    fun bool(name: String) = text(name).toBooleanStrictOrNull() ?: error("$name must be true or false.")
}
internal data class ApiCommand(val id: String, val arguments: List<ApiArgument> = emptyList(), val execute: (PlayerController, ApiInputs) -> Any?)
internal data class ApiRead(val id: String, val read: (PlayerController) -> Any?)

/** Only explicitly selected public values are rendered. Never stringify SDK configs or request payloads. */
internal fun apiValue(value: Any?, depth: Int = 0): String = when {
    depth > 4 -> "[nested value]"
    value == null -> "null"
    value is Unit -> "Command submitted. Inspect state and events for its outcome."
    value is Number || value is Boolean -> value.toString()
    value is String -> value.take(2048)
    value is Enum<*> -> value.name
    value is Map<*, *> -> value.entries.take(32).joinToString("; ") { "${it.key}: ${apiValue(it.value, depth + 1)}" }
    value is Iterable<*> -> value.take(32).joinToString("\n") { apiValue(it, depth + 1) }
    else -> error("This SDK object requires a typed display adapter.")
}

internal object ApiRuntime {
    private fun source(c: PlayerController) = c.player.source ?: c.configuredSource ?: error("Load a source first.")
    private fun view(c: PlayerController) = c.currentView() ?: error("Attach a player view first.")
    private fun quality(q: Quality?) = q?.let { mapOf("id" to it.id, "label" to it.label, "bitrate" to it.bitrate,
        "averageBitrate" to it.averageBitrate, "peakBitrate" to it.peakBitrate, "codec" to it.codec) }
    private fun audio(q: AudioQuality?) = q?.let { quality(it).orEmpty() + ("channelCount" to it.channelCount) }
    private fun video(q: VideoQuality?) = q?.let { quality(it).orEmpty() + mapOf("width" to it.width, "height" to it.height, "frameRate" to it.frameRate, "dynamicRange" to it.dynamicRange.name) }
    private fun track(t: Track?) = t?.let { mapOf("id" to it.id, "label" to it.label, "url" to it.url, "isDefault" to it.isDefault, "type" to it.type?.name) }
    private fun audioTrack(t: AudioTrack?) = t?.let { track(it).orEmpty() + mapOf("language" to it.language, "associatedLanguage" to it.associatedLanguage, "qualities" to it.qualities.map(::audio)) }
    private fun subtitle(t: SubtitleTrack?) = t?.let { track(it).orEmpty() + mapOf("language" to it.language, "mimeType" to it.mimeType, "isForced" to it.isForced, "controller" to it.controller.let { "Available subtitle controller" }) }
    private fun thumbnail(t: Thumbnail?) = t?.let { mapOf("start" to it.start, "end" to it.end, "x" to it.x, "y" to it.y,
        "width" to it.width, "height" to it.height, "uri" to it.uri.toString(), "text" to it.text) }
    private fun sourceSummary(s: Source?) = s?.let { mapOf("type" to it.config.type.name, "title" to it.config.title,
        "loadingState" to it.loadingState.name, "duration" to it.duration, "isActive" to it.isActive, "isAttachedToPlayer" to it.isAttachedToPlayer) }
    val commands: List<ApiCommand> = listOf(
        ApiCommand("android:com.bitmovin.player.api.Player.play()", listOf()) { c, i -> c.player.play() },
        ApiCommand("android:com.bitmovin.player.api.Player.pause()", listOf()) { c, i -> c.player.pause() },
        ApiCommand("android:com.bitmovin.player.api.Player.mute()", listOf()) { c, i -> c.player.mute() },
        ApiCommand("android:com.bitmovin.player.api.Player.unmute()", listOf()) { c, i -> c.player.unmute() },
        ApiCommand("android:com.bitmovin.player.api.Player.preload()", listOf()) { c, i -> c.player.preload() },
        ApiCommand("android:com.bitmovin.player.api.Player.unload()", listOf()) { c, i -> c.player.unload() },
        ApiCommand("android:com.bitmovin.player.api.Player.seek()", listOf(ApiArgument("time", "10"))) { c, i -> c.player.seek(i.number("time", 0.0)) },
        ApiCommand("android:com.bitmovin.player.api.Player.timeShift()", listOf(ApiArgument("offset", "-10"))) { c, i -> c.player.timeShift(i.number("offset")) },
        ApiCommand("android:com.bitmovin.player.api.Player.setMaxSelectableVideoBitrate()", listOf(ApiArgument("bitrate", "2000000"))) { c, i -> c.player.setMaxSelectableVideoBitrate(i.int("bitrate", 0)) },
        ApiCommand("android:com.bitmovin.player.api.Player.setAudio()", listOf(ApiArgument("trackId", ""))) { c, i -> c.player.setAudio(i.text("trackId")) },
        ApiCommand("android:com.bitmovin.player.api.Player.setAudioQuality()", listOf(ApiArgument("qualityId", "auto"))) { c, i -> c.player.setAudioQuality(i.text("qualityId")) },
        ApiCommand("android:com.bitmovin.player.api.Player.setVideoQuality()", listOf(ApiArgument("qualityId", "auto"))) { c, i -> c.player.setVideoQuality(i.text("qualityId")) },
        ApiCommand("android:com.bitmovin.player.api.Player.removeSubtitle()", listOf(ApiArgument("trackId", ""))) { c, i -> c.player.removeSubtitle(i.text("trackId")) },
        ApiCommand("android:com.bitmovin.player.api.Player.setSubtitle()", listOf(ApiArgument("trackId", ""))) { c, i -> c.player.setSubtitle(i.text("trackId").ifBlank { null }) },
        ApiCommand("android:com.bitmovin.player.api.Player.volume", listOf(ApiArgument("volume", "50"))) { c, i -> c.player.volume = i.int("volume", 0, 100) },
        ApiCommand("android:com.bitmovin.player.api.Player.playbackSpeed", listOf(ApiArgument("speed", "1"))) { c, i -> c.player.playbackSpeed = i.float("speed") },
        ApiCommand("android:com.bitmovin.player.api.Player.isFrameAboutToBeRenderedEventEnabled", listOf(ApiArgument("enabled", "true", listOf("true","false")))) { c, i -> c.player.isFrameAboutToBeRenderedEventEnabled = i.bool("enabled") },
        ApiCommand("android:com.bitmovin.player.api.Player.setMaxSelectableVideoQualityForViewportSize()", listOf(ApiArgument("width", "1280"), ApiArgument("height", "720"))) { c, i -> c.player.setMaxSelectableVideoQualityForViewportSize(i.int("width", 1), i.int("height", 1)) },
        ApiCommand("android:com.bitmovin.player.api.casting.RemoteControlApi.castVideo()", listOf()) { c, i -> c.player.castVideo() },
        ApiCommand("android:com.bitmovin.player.api.casting.RemoteControlApi.castStop()", listOf()) { c, i -> c.player.castStop() },
        ApiCommand("android:com.bitmovin.player.api.source.Source.setAudioTrack()", listOf(ApiArgument("trackId", ""))) { c, i -> source(c).setAudioTrack(i.text("trackId")) },
        ApiCommand("android:com.bitmovin.player.api.source.Source.setAudioQuality()", listOf(ApiArgument("qualityId", ""))) { c, i -> source(c).setAudioQuality(i.text("qualityId")) },
        ApiCommand("android:com.bitmovin.player.api.source.Source.setVideoQuality()", listOf(ApiArgument("qualityId", ""))) { c, i -> source(c).setVideoQuality(i.text("qualityId")) },
        ApiCommand("android:com.bitmovin.player.api.source.Source.setSubtitleTrack()", listOf(ApiArgument("trackId", ""))) { c, i -> source(c).setSubtitleTrack(i.text("trackId").ifBlank { null }) },
        ApiCommand("android:com.bitmovin.player.api.source.Source.removeSubtitleTrack()", listOf(ApiArgument("trackId", ""))) { c, i -> source(c).removeSubtitleTrack(i.text("trackId")) },
        ApiCommand("android:com.bitmovin.player.api.buffer.BufferApi.setTargetLevel()", listOf(ApiArgument("type", "ForwardDuration", listOf("ForwardDuration","BackwardDuration")), ApiArgument("seconds", "30"))) { c, i -> c.player.buffer.setTargetLevel(BufferType.valueOf(i.text("type")), i.number("seconds", 0.0)) },
        ApiCommand("android:com.bitmovin.player.api.live.LowLatencyApi.targetLatency", listOf(ApiArgument("seconds", "5"))) { c, i -> c.player.lowLatency.targetLatency = i.number("seconds", 0.0) },
        ApiCommand("android:com.bitmovin.player.api.live.LowLatencyApi.catchupConfig", listOf(ApiArgument("playbackRate", "1.05"), ApiArgument("seekThreshold", "4"), ApiArgument("playbackRateThreshold", "1"))) { c, i -> c.player.lowLatency.catchupConfig = LowLatencySynchronizationConfig(playbackRate = i.float("playbackRate"), seekThreshold = i.number("seekThreshold", 0.0), playbackRateThreshold = i.number("playbackRateThreshold", 0.0)) },
        ApiCommand("android:com.bitmovin.player.api.live.LowLatencyApi.fallbackConfig", listOf(ApiArgument("playbackRate", "0.95"), ApiArgument("seekThreshold", "4"), ApiArgument("playbackRateThreshold", "1"))) { c, i -> c.player.lowLatency.fallbackConfig = LowLatencySynchronizationConfig(playbackRate = i.float("playbackRate"), seekThreshold = i.number("seekThreshold", 0.0), playbackRateThreshold = i.number("playbackRateThreshold", 0.0)) },
        ApiCommand("android:com.bitmovin.player.api.live.LowLatencyApi.getTargetPlaybackLatency()", listOf()) { c, i -> c.queryTargetPlaybackLatency() },
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.isGyroscopeEnabled", listOf(ApiArgument("enabled", "true", listOf("true","false")))) { c, i -> c.player.vr.isGyroscopeEnabled = i.bool("enabled") },
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.isTouchControlEnabled", listOf(ApiArgument("enabled", "true", listOf("true","false")))) { c, i -> c.player.vr.isTouchControlEnabled = i.bool("enabled") },
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.isStereo", listOf(ApiArgument("enabled", "true", listOf("true","false")))) { c, i -> c.player.vr.isStereo = i.bool("enabled") },
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.viewingDirectionChangeThreshold", listOf(ApiArgument("value", "1"))) { c, i -> c.player.vr.viewingDirectionChangeThreshold = i.number("value", 0.0) },
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.viewingDirectionChangeEventInterval", listOf(ApiArgument("value", "1"))) { c, i -> c.player.vr.viewingDirectionChangeEventInterval = i.number("value", 0.0) },
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.viewingDirection", listOf(ApiArgument("pitch", "0"), ApiArgument("roll", "0"), ApiArgument("yaw", "0"))) { c, i -> c.player.vr.viewingDirection = ViewingDirection(i.number("pitch"), i.number("roll"), i.number("yaw")) },
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.moveViewingDirection()", listOf(ApiArgument("phi", "0"), ApiArgument("x", "0"), ApiArgument("y", "0"))) { c, i -> c.player.vr.moveViewingDirection(Vector3(i.number("phi"), i.number("x"), i.number("y"))) },
        ApiCommand("android:com.bitmovin.player.api.playlist.PlaylistApi.add()", listOf(ApiArgument("url", "https://example.invalid/stream.m3u8"), ApiArgument("type", "Hls", listOf("Hls","Dash","Progressive","Smooth")), ApiArgument("index", ""))) { c, i -> Source(SourceConfig(i.text("url"), SourceType.valueOf(i.text("type")))).let { source -> if (i.text("index").isBlank()) c.player.playlist.add(source) else c.player.playlist.add(source, i.int("index", 0)) } },
        ApiCommand("android:com.bitmovin.player.api.playlist.PlaylistApi.remove()", listOf(ApiArgument("index", "0"))) { c, i -> c.player.playlist.remove(i.int("index", 0)) },
        ApiCommand("android:com.bitmovin.player.api.playlist.PlaylistApi.seek()", listOf(ApiArgument("index", "0"), ApiArgument("time", "0"))) { c, i -> c.player.playlist.seek(c.player.playlist.sources.getOrNull(i.int("index", 0)) ?: error("No playlist source at that index."), i.number("time", 0.0)) },
        ApiCommand("android:com.bitmovin.player.api.Player.scheduleAd()", listOf(ApiArgument("tag", "https://example.invalid/ad.xml"), ApiArgument("type", "Bitmovin", listOf("Bitmovin","Ima","Progressive","Unknown")), ApiArgument("position", "pre"), ApiArgument("replaceContentDuration", "0"), ApiArgument("preloadOffset", "0"), ApiArgument("bitmovinAdTagLoading", "false", listOf("true","false")), ApiArgument("vastLoadTimeout", "8"), ApiArgument("videoLoadTimeout", "8"))) { c, i -> AdItem(sources = arrayOf(AdSource(AdSourceType.valueOf(i.text("type")), i.text("tag"), i.number("vastLoadTimeout", 0.0), i.number("videoLoadTimeout", 0.0))), position = i.text("position"), replaceContentDuration = i.number("replaceContentDuration", 0.0), preloadOffset = i.number("preloadOffset", 0.0), bitmovinAdTagLoading = i.bool("bitmovinAdTagLoading")).let { ad -> c.player.scheduleAd(ad) } },
        ApiCommand("android:com.bitmovin.player.api.advertising.AdvertisingApi.schedule()", listOf(ApiArgument("tag", "https://example.invalid/ad.xml"), ApiArgument("type", "Bitmovin", listOf("Bitmovin","Ima","Progressive","Unknown")), ApiArgument("position", "pre"), ApiArgument("replaceContentDuration", "0"), ApiArgument("preloadOffset", "0"), ApiArgument("bitmovinAdTagLoading", "false", listOf("true","false")), ApiArgument("vastLoadTimeout", "8"), ApiArgument("videoLoadTimeout", "8"))) { c, i -> AdItem(sources = arrayOf(AdSource(AdSourceType.valueOf(i.text("type")), i.text("tag"), i.number("vastLoadTimeout", 0.0), i.number("videoLoadTimeout", 0.0))), position = i.text("position"), replaceContentDuration = i.number("replaceContentDuration", 0.0), preloadOffset = i.number("preloadOffset", 0.0), bitmovinAdTagLoading = i.bool("bitmovinAdTagLoading")).let { ad -> c.player.ads.schedule(ad) } },
        ApiCommand("android:com.bitmovin.player.api.Player.skipAd()", listOf()) { c, i -> c.player.skipAd() },
        ApiCommand("android:com.bitmovin.player.api.advertising.AdvertisingApi.skip()", listOf()) { c, i -> c.player.ads.skip() },
        ApiCommand("android:com.bitmovin.player.PlayerView.enterFullscreen()", listOf()) { c, i -> view(c).enterFullscreen() },
        ApiCommand("android:com.bitmovin.player.PlayerView.exitFullscreen()", listOf()) { c, i -> view(c).exitFullscreen() },
        ApiCommand("android:com.bitmovin.player.PlayerView.enterPictureInPicture()", listOf()) { c, i -> view(c).enterPictureInPicture() },
        ApiCommand("android:com.bitmovin.player.PlayerView.exitPictureInPicture()", listOf()) { c, i -> view(c).exitPictureInPicture() },
        ApiCommand("android:com.bitmovin.player.PlayerView.isUiVisible", listOf(ApiArgument("visible", "true", listOf("true","false")))) { c, i -> view(c).isUiVisible = i.bool("visible") },
        ApiCommand("android:com.bitmovin.player.PlayerView.scalingMode", listOf(ApiArgument("mode", "Fit", listOf("Fit","Stretch","Zoom")))) { c, i -> view(c).scalingMode = ScalingMode.valueOf(i.text("mode")) },
        ApiCommand("android:com.bitmovin.player.PlayerView.setPosterImage()", listOf(ApiArgument("url", "https://example.invalid/poster.jpg"), ApiArgument("persistent", "false", listOf("true","false")))) { c, i -> view(c).setPosterImage(i.text("url"), i.bool("persistent")) },
        ApiCommand("android:com.bitmovin.player.api.Player.getThumbnail()", listOf(ApiArgument("time", "0"))) { c, i -> thumbnail(c.player.getThumbnail(i.number("time", 0.0))) },
        ApiCommand("android:com.bitmovin.player.api.source.Source.getThumbnail()", listOf(ApiArgument("time", "0"))) { c, i -> thumbnail(source(c).getThumbnail(i.number("time", 0.0))) }
    )
    val reads: List<ApiRead> = listOf(
        ApiRead("android:com.bitmovin.player.api.Player.isLive") { c -> c.player.isLive },
        ApiRead("android:com.bitmovin.player.api.Player.currentTime") { c -> c.player.currentTime },
        ApiRead("android:com.bitmovin.player.api.Player.duration") { c -> c.player.duration },
        ApiRead("android:com.bitmovin.player.api.Player.timeShift") { c -> c.player.timeShift },
        ApiRead("android:com.bitmovin.player.api.Player.maxTimeShift") { c -> c.player.maxTimeShift },
        ApiRead("android:com.bitmovin.player.api.Player.isMuted") { c -> c.player.isMuted },
        ApiRead("android:com.bitmovin.player.api.Player.isPlaying") { c -> c.player.isPlaying },
        ApiRead("android:com.bitmovin.player.api.Player.isPaused") { c -> c.player.isPaused },
        ApiRead("android:com.bitmovin.player.api.Player.isStalled") { c -> c.player.isStalled },
        ApiRead("android:com.bitmovin.player.api.Player.isAd") { c -> c.player.isAd },
        ApiRead("android:com.bitmovin.player.api.Player.isDestroyed") { c -> c.player.isDestroyed },
        ApiRead("android:com.bitmovin.player.api.Player.droppedVideoFrames") { c -> c.player.droppedVideoFrames },
        ApiRead("android:com.bitmovin.player.api.Player.currentVideoFrameRate") { c -> c.player.currentVideoFrameRate },
        ApiRead("android:com.bitmovin.player.api.Player.playbackTimeOffsetToRelativeTime") { c -> c.player.playbackTimeOffsetToRelativeTime },
        ApiRead("android:com.bitmovin.player.api.Player.playbackTimeOffsetToAbsoluteTime") { c -> c.player.playbackTimeOffsetToAbsoluteTime },
        ApiRead("android:com.bitmovin.player.api.Player.availableAudio") { c -> c.player.availableAudio.map(::audioTrack) },
        ApiRead("android:com.bitmovin.player.api.Player.audio") { c -> audioTrack(c.player.audio) },
        ApiRead("android:com.bitmovin.player.api.Player.availableAudioQualities") { c -> c.player.availableAudioQualities.map(::audio) },
        ApiRead("android:com.bitmovin.player.api.Player.audioQuality") { c -> audio(c.player.audioQuality) },
        ApiRead("android:com.bitmovin.player.api.Player.playbackAudioData") { c -> audio(c.player.playbackAudioData) },
        ApiRead("android:com.bitmovin.player.api.Player.availableVideoQualities") { c -> c.player.availableVideoQualities.map(::video) },
        ApiRead("android:com.bitmovin.player.api.Player.videoQuality") { c -> video(c.player.videoQuality) },
        ApiRead("android:com.bitmovin.player.api.Player.playbackVideoData") { c -> video(c.player.playbackVideoData) },
        ApiRead("android:com.bitmovin.player.api.Player.availableSubtitles") { c -> c.player.availableSubtitles.map(::subtitle) },
        ApiRead("android:com.bitmovin.player.api.Player.subtitle") { c -> subtitle(c.player.subtitle) },
        ApiRead("android:com.bitmovin.player.api.Player.source") { c -> sourceSummary(c.player.source) },
        ApiRead("android:com.bitmovin.player.api.Player.playlist") { c -> c.player.playlist.sources.map(::sourceSummary) },
        ApiRead("android:com.bitmovin.player.api.Player.buffer") { c -> listOf(MediaType.Audio, MediaType.Video).map { c.player.buffer.getLevel(BufferType.ForwardDuration, it).let { level -> mapOf("media" to level.media.name, "level" to level.level, "targetLevel" to level.targetLevel, "type" to level.type.name) } } },
        ApiRead("android:com.bitmovin.player.api.Player.lowLatency") { c -> mapOf("latency" to c.player.lowLatency.latency, "targetLatency" to c.player.lowLatency.targetLatency) },
        ApiRead("android:com.bitmovin.player.api.Player.vr") { c -> mapOf("stereo" to c.player.vr.isStereo, "gyroscope" to c.player.vr.isGyroscopeEnabled, "touch" to c.player.vr.isTouchControlEnabled, "direction" to c.player.vr.viewingDirection?.let { mapOf("pitch" to it.pitch, "roll" to it.roll, "yaw" to it.yaw) }) },
        ApiRead("android:com.bitmovin.player.api.Player.config") { c -> c.player.config.let { mapOf("autoplay" to it.playbackConfig.isAutoplayEnabled, "muted" to it.playbackConfig.isMuted, "timeShift" to it.playbackConfig.isTimeShiftEnabled, "forwardDuration" to it.bufferConfig.audioAndVideo.forwardDuration, "timeChangedInterval" to it.tweaksConfig.timeChangedInterval, "license" to "[redacted]") } },
        ApiRead("android:com.bitmovin.player.api.source.Source.loadingState") { c -> source(c).loadingState },
        ApiRead("android:com.bitmovin.player.api.source.Source.isAttachedToPlayer") { c -> source(c).isAttachedToPlayer },
        ApiRead("android:com.bitmovin.player.api.source.Source.isActive") { c -> source(c).isActive },
        ApiRead("android:com.bitmovin.player.api.source.Source.duration") { c -> source(c).duration },
        ApiRead("android:com.bitmovin.player.api.source.Source.availableVideoQualities") { c -> source(c).availableVideoQualities.map(::video) },
        ApiRead("android:com.bitmovin.player.api.source.Source.selectedVideoQuality") { c -> video(source(c).selectedVideoQuality) },
        ApiRead("android:com.bitmovin.player.api.source.Source.availableAudioTracks") { c -> source(c).availableAudioTracks.map(::audioTrack) },
        ApiRead("android:com.bitmovin.player.api.source.Source.selectedAudioTrack") { c -> audioTrack(source(c).selectedAudioTrack) },
        ApiRead("android:com.bitmovin.player.api.source.Source.availableAudioQualities") { c -> source(c).availableAudioQualities.map(::audio) },
        ApiRead("android:com.bitmovin.player.api.source.Source.selectedAudioQuality") { c -> audio(source(c).selectedAudioQuality) },
        ApiRead("android:com.bitmovin.player.api.source.Source.availableSubtitleTracks") { c -> source(c).availableSubtitleTracks.map(::subtitle) },
        ApiRead("android:com.bitmovin.player.api.source.Source.selectedSubtitleTrack") { c -> subtitle(source(c).selectedSubtitleTrack) },
        ApiRead("android:com.bitmovin.player.api.source.Source.seekableRange") { c -> source(c).seekableRange.let { mapOf("start" to it.start, "end" to it.end) } },
        ApiRead("android:com.bitmovin.player.api.source.Source.config") { c -> source(c).config.let { mapOf("url" to it.url, "type" to it.type.name, "title" to it.title, "description" to it.description, "posterSource" to it.posterSource, "isPosterPersistent" to it.isPosterPersistent, "metadata" to it.metadata, "startOffset" to it.options.startOffset) } },
        ApiRead("android:com.bitmovin.player.api.casting.RemoteControlApi.isCastAvailable") { c -> c.player.isCastAvailable },
        ApiRead("android:com.bitmovin.player.api.casting.RemoteControlApi.isCasting") { c -> c.player.isCasting },
        ApiRead("android:com.bitmovin.player.api.live.LowLatencyApi.latency") { c -> c.player.lowLatency.latency },
        ApiRead("android:com.bitmovin.player.api.live.LowLatencyApi.producerReferenceTimeInfo") { c -> c.player.lowLatency.producerReferenceTimeInfo?.offsetToAvailabilityStartTime },
        ApiRead("android:com.bitmovin.player.api.live.ProducerReferenceTimeInfo.offsetToAvailabilityStartTime") { c -> c.player.lowLatency.producerReferenceTimeInfo?.offsetToAvailabilityStartTime },
        ApiRead("android:com.bitmovin.player.api.playlist.PlaylistApi.sources") { c -> c.player.playlist.sources.map(::sourceSummary) },
        ApiRead("android:com.bitmovin.player.PlayerView.isFullscreen") { c -> view(c).isFullscreen },
        ApiRead("android:com.bitmovin.player.PlayerView.isPictureInPicture") { c -> view(c).isPictureInPicture },
        ApiRead("android:com.bitmovin.player.PlayerView.isPictureInPictureAvailable") { c -> view(c).isPictureInPictureAvailable },
        ApiRead("android:com.bitmovin.player.PlayerView.config") { c -> view(c).config.let { mapOf("hideFirstFrame" to it.hideFirstFrame, "scalingMode" to it.scalingMode.name, "surfaceType" to it.surfaceType.name, "enableComposeSurfaceSyncWorkaround" to it.enableComposeSurfaceSyncWorkaround) } },
        ApiRead("android:com.bitmovin.player.api.media.Quality.id") { c -> c.player.videoQuality?.id },
        ApiRead("android:com.bitmovin.player.api.media.Quality.label") { c -> c.player.videoQuality?.label },
        ApiRead("android:com.bitmovin.player.api.media.Quality.bitrate") { c -> c.player.videoQuality?.bitrate },
        ApiRead("android:com.bitmovin.player.api.media.Quality.averageBitrate") { c -> c.player.videoQuality?.averageBitrate },
        ApiRead("android:com.bitmovin.player.api.media.Quality.peakBitrate") { c -> c.player.videoQuality?.peakBitrate },
        ApiRead("android:com.bitmovin.player.api.media.Quality.codec") { c -> c.player.videoQuality?.codec },
        ApiRead("android:com.bitmovin.player.api.media.audio.quality.AudioQuality.id") { c -> c.player.audioQuality?.id },
        ApiRead("android:com.bitmovin.player.api.media.audio.quality.AudioQuality.label") { c -> c.player.audioQuality?.label },
        ApiRead("android:com.bitmovin.player.api.media.audio.quality.AudioQuality.bitrate") { c -> c.player.audioQuality?.bitrate },
        ApiRead("android:com.bitmovin.player.api.media.audio.quality.AudioQuality.averageBitrate") { c -> c.player.audioQuality?.averageBitrate },
        ApiRead("android:com.bitmovin.player.api.media.audio.quality.AudioQuality.peakBitrate") { c -> c.player.audioQuality?.peakBitrate },
        ApiRead("android:com.bitmovin.player.api.media.audio.quality.AudioQuality.codec") { c -> c.player.audioQuality?.codec },
        ApiRead("android:com.bitmovin.player.api.media.audio.quality.AudioQuality.channelCount") { c -> c.player.audioQuality?.channelCount },
        ApiRead("android:com.bitmovin.player.api.media.video.quality.VideoQuality.id") { c -> c.player.videoQuality?.id },
        ApiRead("android:com.bitmovin.player.api.media.video.quality.VideoQuality.label") { c -> c.player.videoQuality?.label },
        ApiRead("android:com.bitmovin.player.api.media.video.quality.VideoQuality.bitrate") { c -> c.player.videoQuality?.bitrate },
        ApiRead("android:com.bitmovin.player.api.media.video.quality.VideoQuality.averageBitrate") { c -> c.player.videoQuality?.averageBitrate },
        ApiRead("android:com.bitmovin.player.api.media.video.quality.VideoQuality.peakBitrate") { c -> c.player.videoQuality?.peakBitrate },
        ApiRead("android:com.bitmovin.player.api.media.video.quality.VideoQuality.codec") { c -> c.player.videoQuality?.codec },
        ApiRead("android:com.bitmovin.player.api.media.video.quality.VideoQuality.width") { c -> c.player.videoQuality?.width },
        ApiRead("android:com.bitmovin.player.api.media.video.quality.VideoQuality.height") { c -> c.player.videoQuality?.height },
        ApiRead("android:com.bitmovin.player.api.media.video.quality.VideoQuality.frameRate") { c -> c.player.videoQuality?.frameRate },
        ApiRead("android:com.bitmovin.player.api.media.video.quality.VideoQuality.dynamicRange") { c -> c.player.videoQuality?.dynamicRange?.name },
        ApiRead("android:com.bitmovin.player.api.media.audio.AudioTrack.language") { c -> c.player.audio?.language },
        ApiRead("android:com.bitmovin.player.api.media.audio.AudioTrack.associatedLanguage") { c -> c.player.audio?.associatedLanguage },
        ApiRead("android:com.bitmovin.player.api.media.subtitle.SubtitleTrack.controller") { c -> c.player.subtitle?.controller?.let { "Available subtitle controller" } },
        ApiRead("android:com.bitmovin.player.api.media.audio.AudioTrack.qualities") { c -> c.player.audio?.qualities?.map(::audio) },
        ApiRead("android:com.bitmovin.player.api.TimeRange.start") { c -> source(c).seekableRange.start },
        ApiRead("android:com.bitmovin.player.api.TimeRange.end") { c -> source(c).seekableRange.end },
        ApiRead("android:com.bitmovin.player.api.buffer.BufferLevel.level") { c -> c.player.buffer.getLevel(BufferType.ForwardDuration, MediaType.Video).level },
        ApiRead("android:com.bitmovin.player.api.buffer.BufferLevel.targetLevel") { c -> c.player.buffer.getLevel(BufferType.ForwardDuration, MediaType.Video).targetLevel },
        ApiRead("android:com.bitmovin.player.api.buffer.BufferLevel.media") { c -> c.player.buffer.getLevel(BufferType.ForwardDuration, MediaType.Video).media },
        ApiRead("android:com.bitmovin.player.api.buffer.BufferLevel.type") { c -> c.player.buffer.getLevel(BufferType.ForwardDuration, MediaType.Video).type },
        ApiRead("android:com.bitmovin.player.api.buffer.BufferApi.getLevel()") { c -> listOf(BufferType.ForwardDuration, BufferType.BackwardDuration).flatMap { type -> listOf(MediaType.Audio, MediaType.Video).map { media -> c.player.buffer.getLevel(type, media).let { mapOf("type" to it.type.name, "media" to it.media.name, "level" to it.level, "targetLevel" to it.targetLevel) } } } },
        ApiRead("android:com.bitmovin.player.api.vr.orientation.ViewingDirection.pitch") { c -> c.player.vr.viewingDirection?.pitch },
        ApiRead("android:com.bitmovin.player.api.vr.orientation.ViewingDirection.roll") { c -> c.player.vr.viewingDirection?.roll },
        ApiRead("android:com.bitmovin.player.api.vr.orientation.ViewingDirection.yaw") { c -> c.player.vr.viewingDirection?.yaw }
    )
}
