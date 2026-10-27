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
import com.bitmovin.player.api.ssai.SsaiAd
import com.bitmovin.player.api.ssai.SsaiAdBreak
import com.bitmovin.player.api.deficiency.PlayerErrorCode
import com.bitmovin.player.api.advertising.vast.VastAdExtension
import com.bitmovin.player.api.analytics.AnalyticsApi.Companion.analytics

internal data class ApiArgument(val name: String, val example: String = "", val choices: List<String> = emptyList(), val multiline: Boolean = false)
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
internal data class ApiCommand(val id: String, val arguments: List<ApiArgument> = emptyList(), val label: String = id.removePrefix("android:com.bitmovin.player."), val execute: (PlayerController, ApiInputs) -> Any?) {
    fun validate(inputs: ApiInputs) {
        arguments.forEach { argument ->
            val value = inputs.text(argument.name)
            require(argument.choices.isEmpty() || value in argument.choices) { "Choose a documented ${argument.name} value." }
        }
    }
}
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
    private fun ad(c: PlayerController): Ad? = c.player.ads.activeLinearAd ?: c.apiSsaiAds[c.apiSelectedSsaiAd]
    private fun adBreak(c: PlayerController): AdBreak? = c.player.ads.activeAdBreak ?: c.apiSsaiBreaks[c.apiSelectedSsaiBreak]
    private fun extension(e: VastAdExtension, depth: Int = 0): Map<String, Any?> = mapOf(
        "name" to e.name, "value" to e.value, "attributes" to e.attributes,
        "children" to if (depth < 3) e.children.take(32).map { extension(it, depth + 1) } else "[nested extensions]")
    private fun adSummary(a: Ad?) = a?.let { mapOf("id" to it.id, "isLinear" to it.isLinear, "width" to it.width,
        "height" to it.height, "clickThroughUrl" to it.clickThroughUrl, "mediaFileUrl" to it.mediaFileUrl,
        "data" to it.data?.let { data -> mapOf("mimeType" to data.mimeType, "bitrate" to data.bitrate, "minBitrate" to data.minBitrate, "maxBitrate" to data.maxBitrate) }) }
    private fun breakSummary(b: AdBreak?) = b?.let { mapOf("id" to it.id, "scheduleTime" to it.scheduleTime, "ads" to it.ads.take(32).map(::adSummary)) }
    val commands: List<ApiCommand> = listOf(
        ApiCommand("android:com.bitmovin.player.api.Player.play()", listOf()) { c, i -> c.player.play() },
        ApiCommand("android:com.bitmovin.player.api.Player.pause()", listOf()) { c, i -> c.player.pause() },
        ApiCommand("android:com.bitmovin.player.api.Player.mute()", listOf()) { c, i -> c.player.mute() },
        ApiCommand("android:com.bitmovin.player.api.Player.unmute()", listOf()) { c, i -> c.player.unmute() },
        ApiCommand("android:com.bitmovin.player.api.Player.preload()", listOf()) { c, i -> c.player.preload() },
        ApiCommand("android:com.bitmovin.player.api.Player.unload()", listOf()) { c, i -> c.unloadApiSource() },
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
        ApiCommand("android:com.bitmovin.player.api.buffer.BufferApi.setTargetLevel()", listOf(ApiArgument("type", "ForwardDuration", BufferType.entries.map { it.name }), ApiArgument("seconds", "30"))) { c, i -> c.player.buffer.setTargetLevel(BufferType.valueOf(i.text("type")), i.number("seconds", 0.0)) },
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
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.moveViewingDirection()", listOf(ApiArgument("phi", "0"), ApiArgument("x", "0"), ApiArgument("y", "0"))) { c, i -> val direction = Vector3(i.number("phi"), i.number("x"), i.number("y")); c.apiVector = direction; c.player.vr.moveViewingDirection(direction) },
        ApiCommand("android:com.bitmovin.player.api.playlist.PlaylistApi.add()", listOf(ApiArgument("url", "https://example.invalid/stream.m3u8"), ApiArgument("type", "Hls", SourceType.entries.map { it.name }), ApiArgument("index", ""))) { c, i -> c.addApiPlaylistSource(i.text("url"), SourceType.valueOf(i.text("type")), if (i.text("index").isBlank()) null else i.int("index", 0)) },
        ApiCommand("android:com.bitmovin.player.api.playlist.PlaylistApi.remove()", listOf(ApiArgument("index", "0"))) { c, i -> c.removeApiPlaylistSource(i.int("index", 0)) },
        ApiCommand("android:com.bitmovin.player.api.playlist.PlaylistApi.seek()", listOf(ApiArgument("index", "0"), ApiArgument("time", "0"), ApiArgument("startOffsetTimelineReference", "null", listOf("null") + TimelineReferencePoint.entries.map { it.name }), ApiArgument("useSeekTarget", "true", listOf("true", "false")))) { c, i ->
            val target = if (i.bool("useSeekTarget")) com.bitmovin.player.api.playlist.SeekTarget(i.number("time"), i.text("startOffsetTimelineReference").takeUnless { it == "null" }?.let(TimelineReferencePoint::valueOf)) else null
            c.seekApiPlaylistSource(i.int("index", 0), target)
        },
        ApiCommand("android:com.bitmovin.player.api.Player.scheduleAd()", listOf(ApiArgument("tag", "https://example.invalid/ad.xml"), ApiArgument("type", "Bitmovin", AdSourceType.entries.map { it.name }), ApiArgument("position", "pre"), ApiArgument("replaceContentDuration", "0"), ApiArgument("preloadOffset", "0"), ApiArgument("bitmovinAdTagLoading", "false", listOf("true","false")), ApiArgument("vastLoadTimeout", "8"), ApiArgument("videoLoadTimeout", "8"))) { c, i -> AdItem(sources = arrayOf(AdSource(AdSourceType.valueOf(i.text("type")), i.text("tag"), i.number("vastLoadTimeout", 0.0), i.number("videoLoadTimeout", 0.0))), position = i.text("position"), replaceContentDuration = i.number("replaceContentDuration", 0.0), preloadOffset = i.number("preloadOffset", 0.0), bitmovinAdTagLoading = i.bool("bitmovinAdTagLoading")).let { ad -> c.player.scheduleAd(ad) } },
        ApiCommand("android:com.bitmovin.player.api.advertising.AdvertisingApi.schedule()", listOf(ApiArgument("tag", "https://example.invalid/ad.xml"), ApiArgument("type", "Bitmovin", AdSourceType.entries.map { it.name }), ApiArgument("position", "pre"), ApiArgument("replaceContentDuration", "0"), ApiArgument("preloadOffset", "0"), ApiArgument("bitmovinAdTagLoading", "false", listOf("true","false")), ApiArgument("vastLoadTimeout", "8"), ApiArgument("videoLoadTimeout", "8"))) { c, i -> AdItem(sources = arrayOf(AdSource(AdSourceType.valueOf(i.text("type")), i.text("tag"), i.number("vastLoadTimeout", 0.0), i.number("videoLoadTimeout", 0.0))), position = i.text("position"), replaceContentDuration = i.number("replaceContentDuration", 0.0), preloadOffset = i.number("preloadOffset", 0.0), bitmovinAdTagLoading = i.bool("bitmovinAdTagLoading")).let { ad -> c.player.ads.schedule(ad) } },
        ApiCommand("android:com.bitmovin.player.api.Player.skipAd()", listOf()) { c, i -> c.player.skipAd() },
        ApiCommand("android:com.bitmovin.player.api.advertising.AdvertisingApi.skip()", listOf()) { c, i -> c.player.ads.skip() },
        ApiCommand("android:com.bitmovin.player.PlayerView.enterFullscreen()", listOf()) { c, i -> view(c).enterFullscreen() },
        ApiCommand("android:com.bitmovin.player.PlayerView.exitFullscreen()", listOf()) { c, i -> view(c).exitFullscreen() },
        ApiCommand("android:com.bitmovin.player.PlayerView.enterPictureInPicture()", listOf()) { c, i -> view(c).enterPictureInPicture() },
        ApiCommand("android:com.bitmovin.player.PlayerView.exitPictureInPicture()", listOf()) { c, i -> view(c).exitPictureInPicture() },
        ApiCommand("android:com.bitmovin.player.PlayerView.isUiVisible", listOf(ApiArgument("visible", "true", listOf("true","false")))) { c, i -> view(c).isUiVisible = i.bool("visible") },
        ApiCommand("android:com.bitmovin.player.PlayerView.scalingMode", listOf(ApiArgument("mode", "Fit", ScalingMode.entries.map { it.name }))) { c, i -> view(c).scalingMode = ScalingMode.valueOf(i.text("mode")) },
        ApiCommand("android:com.bitmovin.player.PlayerView.setPosterImage()", listOf(ApiArgument("url", "https://example.invalid/poster.jpg"), ApiArgument("persistent", "false", listOf("true","false")))) { c, i -> view(c).setPosterImage(i.text("url"), i.bool("persistent")) },
        ApiCommand("android:com.bitmovin.player.api.Player.getThumbnail()", listOf(ApiArgument("time", "0"))) { c, i -> thumbnail(c.player.getThumbnail(i.number("time", 0.0))) },
        ApiCommand("android:com.bitmovin.player.api.source.Source.getThumbnail()", listOf(ApiArgument("time", "0"))) { c, i -> thumbnail(source(c).getThumbnail(i.number("time", 0.0))) },
        ApiCommand("app:ssai-ad", listOf(ApiArgument("id", "test-ad"), ApiArgument("duration", "10"), ApiArgument("skippableAfter", ""), ApiArgument("clickThroughUrl", "")), "Create SSAI ad metadata") { c, i -> val value = SsaiAd(id = i.text("id"), duration = i.number("duration", 0.0), skippableAfter = i.text("skippableAfter").takeIf { it.isNotBlank() }?.let { i.number("skippableAfter", 0.0) }, clickThroughUrl = i.text("clickThroughUrl").ifBlank { null }); require(value.id in c.apiSsaiAds || c.apiSsaiAds.size < 64) { "Clear test objects or recreate the player before adding more ads." }; c.apiSsaiAds[value.id] = value; c.apiSelectedSsaiAd = value.id; mapOf("createdMetadataAdId" to value.id, "mediaInserted" to false) },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.registerAdBreak()", listOf(ApiArgument("id", "test-break"), ApiArgument("scheduleTime", "0"), ApiArgument("duration", ""), ApiArgument("adIds", "test-ad"))) { c, i -> SsaiAdBreak(id = i.text("id"), scheduleTime = i.number("scheduleTime", 0.0), duration = i.text("duration").takeIf { it.isNotBlank() }?.let { i.number("duration", 0.0) }, ads = i.text("adIds").split(',').filter { it.isNotBlank() }.map { c.apiSsaiAds[it.trim()] ?: error("Create the selected SSAI test ad first.") }).let { candidate -> require(candidate.id in c.apiSsaiBreaks || c.apiSsaiBreaks.size < 64) { "Clear test breaks before adding more." }; val registered = c.player.ssai.registerAdBreak(candidate); c.apiSsaiBreaks[registered.id] = registered; c.apiSelectedSsaiBreak = registered.id; breakSummary(registered) } },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.registerAdBreaks()", listOf(ApiArgument("breakIds", "test-break"))) { c, i -> i.text("breakIds").split(',').filter { it.isNotBlank() }.map { c.apiSsaiBreaks[it.trim()] ?: error("Register the selected test break first.") }.let(c.player.ssai::registerAdBreaks) },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.startAdBreak()", listOf(ApiArgument("id", "test-break"))) { c, i -> (c.apiSsaiBreaks[i.text("id")] ?: error("Register the selected SSAI test break first.")).let { c.player.ssai.startAdBreak(it); c.apiSelectedSsaiBreak = it.id } },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.removeAdBreak()", listOf(ApiArgument("id", "test-break"))) { c, i -> (c.apiSsaiBreaks[i.text("id")] ?: error("Register the selected SSAI test break first.")).let { c.player.ssai.removeAdBreak(it); c.apiSsaiBreaks.remove(it.id); if (c.apiSelectedSsaiBreak == it.id) c.apiSelectedSsaiBreak = null; Unit } },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.startAd()", listOf(ApiArgument("id", "test-ad"))) { c, i -> (c.apiSsaiAds[i.text("id")] ?: error("Create the selected SSAI test ad first.")).let { c.player.ssai.startAd(it); c.apiSelectedSsaiAd = it.id } },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.clearAdBreaks()", listOf()) { c, i -> c.player.ssai.clearAdBreaks(); c.apiSsaiBreaks.clear(); c.apiSelectedSsaiBreak = null },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.finishAd()", listOf()) { c, i -> c.player.ssai.finishAd() },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.finishAdBreak()", listOf()) { c, i -> c.player.ssai.finishAdBreak() },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.reportAdQuartile()", listOf(ApiArgument("quartile", "FirstQuartile", AdQuartile.entries.map { it.name }))) { c, i -> c.player.ssai.reportAdQuartile(AdQuartile.valueOf(i.text("quartile"))) },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.reportAdError()", listOf(ApiArgument("message", "Test ad error"), ApiArgument("code", "1"))) { c, i -> c.player.ssai.reportAdError(i.text("message"), i.int("code")) },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiApi.reportFatalError()", listOf(ApiArgument("message", "Test fatal SSAI error"), ApiArgument("code", "General", PlayerErrorCode.entries.map { it.name }), ApiArgument("confirmPlaybackError", "false", listOf("true", "false")))) { c, i -> require(i.bool("confirmPlaybackError")); c.player.ssai.reportFatalError(i.text("message"), PlayerErrorCode.valueOf(i.text("code"))) },
        ApiCommand("android:com.bitmovin.player.api.advertising.Ad.expanded()", listOf()) { c, i -> (ad(c) ?: error("No active ad or SSAI test ad.")).expanded() },
        ApiCommand("android:com.bitmovin.player.api.advertising.Ad.collapsed()", listOf()) { c, i -> (ad(c) ?: error("No active ad or SSAI test ad.")).collapsed() },
        ApiCommand("android:com.bitmovin.player.api.advertising.Ad.clickThroughUrlOpened()", listOf(ApiArgument("openedExternally", "false", listOf("true","false")))) { c, i -> require(i.bool("openedExternally")) { "Confirm that the click-through URL was opened externally first." }.let { (ad(c) ?: error("No ad object.")).clickThroughUrlOpened() } },
        ApiCommand("android:com.bitmovin.player.api.ssai.SsaiAd.clickThroughUrlOpened()", listOf(ApiArgument("id", "test-ad"), ApiArgument("openedExternally", "false", listOf("true","false")))) { c, i -> require(i.bool("openedExternally")).let { (c.apiSsaiAds[i.text("id")] ?: error("No SSAI test ad.")).clickThroughUrlOpened() } },
        ApiCommand("android:com.bitmovin.player.api.vr.orientation.OrientationProvider.enable()", listOf(ApiArgument("provider", "gyroscopic", listOf("gyroscopic","touch")))) { c, i -> (if (i.text("provider") == "gyroscopic") c.player.vr.gyroscopicOrientationProvider else c.player.vr.touchOrientationProvider)?.enable() ?: error("The selected orientation provider is unavailable.") },
        ApiCommand("android:com.bitmovin.player.api.vr.orientation.OrientationProvider.disable()", listOf(ApiArgument("provider", "gyroscopic", listOf("gyroscopic","touch")))) { c, i -> (if (i.text("provider") == "gyroscopic") c.player.vr.gyroscopicOrientationProvider else c.player.vr.touchOrientationProvider)?.disable() ?: error("The selected orientation provider is unavailable.") }
    ) + ApiAdditionalRuntime.commands + ApiVrRuntime.commands
    val reads: List<ApiRead> = listOf(
        ApiRead("android:com.bitmovin.player.api.Player.ssai") { c -> c.player.ssai.let { "SDK SSAI API is available. Use its named operations in Commands." } },
        ApiRead("android:com.bitmovin.player.api.analytics.AnalyticsApi.ssai") { c -> c.player.analytics?.ssai?.let { "SDK SSAI Analytics API is available. Use Analytics controls for its named operations." } },
        ApiRead("android:com.bitmovin.player.api.deficiency.DeficiencyCode.value") { c -> c.lastErrorCode },
        ApiRead("android:com.bitmovin.player.api.media.thumbnail.Thumbnail.start") { c -> c.player.source?.getThumbnail(c.player.currentTime)?.start },
        ApiRead("android:com.bitmovin.player.api.media.thumbnail.Thumbnail.end") { c -> c.player.source?.getThumbnail(c.player.currentTime)?.end },
        ApiRead("android:com.bitmovin.player.api.media.thumbnail.Thumbnail.x") { c -> c.player.source?.getThumbnail(c.player.currentTime)?.x },
        ApiRead("android:com.bitmovin.player.api.media.thumbnail.Thumbnail.y") { c -> c.player.source?.getThumbnail(c.player.currentTime)?.y },
        ApiRead("android:com.bitmovin.player.api.media.thumbnail.Thumbnail.width") { c -> c.player.source?.getThumbnail(c.player.currentTime)?.width },
        ApiRead("android:com.bitmovin.player.api.media.thumbnail.Thumbnail.height") { c -> c.player.source?.getThumbnail(c.player.currentTime)?.height },
        ApiRead("android:com.bitmovin.player.api.media.thumbnail.Thumbnail.uri") { c -> c.player.source?.getThumbnail(c.player.currentTime)?.uri?.toString() },
        ApiRead("android:com.bitmovin.player.api.media.thumbnail.Thumbnail.text") { c -> c.player.source?.getThumbnail(c.player.currentTime)?.text },

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
        ApiRead("android:com.bitmovin.player.api.vr.orientation.ViewingDirection.yaw") { c -> c.player.vr.viewingDirection?.yaw },
        ApiRead("android:com.bitmovin.player.api.Player.ads") { c -> mapOf("activeAdBreak" to breakSummary(c.player.ads.activeAdBreak), "activeLinearAd" to adSummary(c.player.ads.activeLinearAd), "schedule" to c.player.ads.schedule.take(32).map(::breakSummary)) },
        ApiRead("android:com.bitmovin.player.api.advertising.AdvertisingApi.activeAdBreak") { c -> breakSummary(c.player.ads.activeAdBreak) },
        ApiRead("android:com.bitmovin.player.api.advertising.AdvertisingApi.activeLinearAd") { c -> adSummary(c.player.ads.activeLinearAd) },
        ApiRead("android:com.bitmovin.player.api.advertising.AdvertisingApi.schedule") { c -> c.player.ads.schedule.take(32).map(::breakSummary) },
        ApiRead("android:com.bitmovin.player.api.advertising.AdvertisingApi.viewGroup") { c -> c.player.ads.viewGroup?.let { "Attached Android ViewGroup (${it.childCount} children)" } },
        ApiRead("android:com.bitmovin.player.api.advertising.Ad.id") { c -> ad(c)?.id },
        ApiRead("android:com.bitmovin.player.api.advertising.Ad.isLinear") { c -> ad(c)?.isLinear },
        ApiRead("android:com.bitmovin.player.api.advertising.Ad.width") { c -> ad(c)?.width },
        ApiRead("android:com.bitmovin.player.api.advertising.Ad.height") { c -> ad(c)?.height },
        ApiRead("android:com.bitmovin.player.api.advertising.Ad.clickThroughUrl") { c -> ad(c)?.clickThroughUrl },
        ApiRead("android:com.bitmovin.player.api.advertising.Ad.mediaFileUrl") { c -> ad(c)?.mediaFileUrl },
        ApiRead("android:com.bitmovin.player.api.advertising.Ad.data") { c -> ad(c)?.data?.let { mapOf("mimeType" to it.mimeType, "bitrate" to it.bitrate, "minBitrate" to it.minBitrate, "maxBitrate" to it.maxBitrate) } },
        ApiRead("android:com.bitmovin.player.api.advertising.Ad.extensions") { c -> ad(c)?.extensions?.take(32)?.map { extension(it) } },
        ApiRead("android:com.bitmovin.player.api.advertising.AdBreak.id") { c -> adBreak(c)?.id },
        ApiRead("android:com.bitmovin.player.api.advertising.AdBreak.scheduleTime") { c -> adBreak(c)?.scheduleTime },
        ApiRead("android:com.bitmovin.player.api.advertising.AdBreak.ads") { c -> adBreak(c)?.ads?.take(32)?.map(::adSummary) },
        ApiRead("android:com.bitmovin.player.api.advertising.AdData.mimeType") { c -> ad(c)?.data?.mimeType },
        ApiRead("android:com.bitmovin.player.api.advertising.AdData.bitrate") { c -> ad(c)?.data?.bitrate },
        ApiRead("android:com.bitmovin.player.api.advertising.AdData.minBitrate") { c -> ad(c)?.data?.minBitrate },
        ApiRead("android:com.bitmovin.player.api.advertising.AdData.maxBitrate") { c -> ad(c)?.data?.maxBitrate },
        ApiRead("android:com.bitmovin.player.api.advertising.LinearAd.isLinear") { c -> (ad(c) as? LinearAd)?.isLinear },
        ApiRead("android:com.bitmovin.player.api.advertising.LinearAd.duration") { c -> (ad(c) as? LinearAd)?.duration },
        ApiRead("android:com.bitmovin.player.api.advertising.LinearAd.skippableAfter") { c -> (ad(c) as? LinearAd)?.skippableAfter },
        ApiRead("android:com.bitmovin.player.api.advertising.LinearAd.uiConfig") { c -> (ad(c) as? LinearAd)?.uiConfig?.let { mapOf("requestsUi" to it.requestsUi) } },
        ApiRead("android:com.bitmovin.player.api.advertising.vast.VastAdExtension.name") { c -> ad(c)?.extensions?.firstOrNull()?.name },
        ApiRead("android:com.bitmovin.player.api.advertising.vast.VastAdExtension.value") { c -> ad(c)?.extensions?.firstOrNull()?.value },
        ApiRead("android:com.bitmovin.player.api.advertising.vast.VastAdExtension.attributes") { c -> ad(c)?.extensions?.firstOrNull()?.attributes },
        ApiRead("android:com.bitmovin.player.api.advertising.vast.VastAdExtension.children") { c -> ad(c)?.extensions?.firstOrNull()?.children?.take(32)?.map { extension(it) } },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAd.id") { c -> c.apiSsaiAds[c.apiSelectedSsaiAd]?.id },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAd.width") { c -> c.apiSsaiAds[c.apiSelectedSsaiAd]?.width },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAd.height") { c -> c.apiSsaiAds[c.apiSelectedSsaiAd]?.height },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAd.clickThroughUrl") { c -> c.apiSsaiAds[c.apiSelectedSsaiAd]?.clickThroughUrl },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAd.mediaFileUrl") { c -> c.apiSsaiAds[c.apiSelectedSsaiAd]?.mediaFileUrl },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAd.duration") { c -> c.apiSsaiAds[c.apiSelectedSsaiAd]?.duration },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAd.skippableAfter") { c -> c.apiSsaiAds[c.apiSelectedSsaiAd]?.skippableAfter },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAd.data") { c -> c.apiSsaiAds[c.apiSelectedSsaiAd]?.data?.let { mapOf("mimeType" to it.mimeType, "bitrate" to it.bitrate) } },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAd.uiConfig") { c -> c.apiSsaiAds[c.apiSelectedSsaiAd]?.uiConfig?.let { mapOf("requestsUi" to it.requestsUi) } },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAdBreak.id") { c -> c.apiSsaiBreaks[c.apiSelectedSsaiBreak]?.id },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAdBreak.scheduleTime") { c -> c.apiSsaiBreaks[c.apiSelectedSsaiBreak]?.scheduleTime },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAdBreak.duration") { c -> c.apiSsaiBreaks[c.apiSelectedSsaiBreak]?.duration },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAdBreak.replaceContentDuration") { c -> c.apiSsaiBreaks[c.apiSelectedSsaiBreak]?.replaceContentDuration },
        ApiRead("android:com.bitmovin.player.api.ssai.SsaiAdBreak.ads") { c -> c.apiSsaiBreaks[c.apiSelectedSsaiBreak]?.ads?.take(32)?.map(::adSummary) },
        ApiRead("android:com.bitmovin.player.api.vr.orientation.OrientationProvider.isEnabled()") { c -> c.player.vr.gyroscopicOrientationProvider?.isEnabled() },
        ApiRead("android:com.bitmovin.player.api.vr.orientation.OrientationProvider.getViewingDirection()") { c -> c.player.vr.gyroscopicOrientationProvider?.getViewingDirection()?.let { mapOf("pitch" to it.pitch, "roll" to it.roll, "yaw" to it.yaw) } },
        ApiRead("android:com.bitmovin.player.api.source.SourceConfig.dashSource") { c -> source(c).config.dashSource?.let { mapOf("url" to it.url, "type" to it.type.name) } },
        ApiRead("android:com.bitmovin.player.api.source.SourceConfig.hlsSource") { c -> source(c).config.hlsSource?.let { mapOf("url" to it.url, "type" to it.type.name) } },
        ApiRead("android:com.bitmovin.player.api.source.SourceConfig.progressiveSource") { c -> source(c).config.progressiveSource?.let { mapOf("url" to it.url, "type" to it.type.name) } },
        ApiRead("android:com.bitmovin.player.api.source.SourceConfig.smoothSource") { c -> source(c).config.smoothSource?.let { mapOf("url" to it.url, "type" to it.type.name) } },
        ApiRead("android:com.bitmovin.player.api.source.SourceConfig.drmConfigs") { c -> source(c).config.drmConfigs.map { it?.let { mapOf("uuid" to it.uuid.toString(), "licenseUrl" to "[redacted]", "isLicenseRenewable" to it.isLicenseRenewable, "shouldKeepDrmSessionsAlive" to it.shouldKeepDrmSessionsAlive) } } }
    ) + ApiAdditionalRuntime.reads + ApiVrRuntime.reads
}
