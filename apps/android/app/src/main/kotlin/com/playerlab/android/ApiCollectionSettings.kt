package com.playerlab.android

import com.bitmovin.player.api.advertising.*
import com.bitmovin.player.api.media.MediaTrackRole
import com.bitmovin.player.api.media.subtitle.SubtitleTrack
import com.bitmovin.player.api.playlist.*
import com.bitmovin.player.api.source.*

internal object ApiCollectionSettings {
    private const val SDK = "android:com.bitmovin.player.api."
    const val PLAYLIST = SDK + "playlist.PlaylistConfig.sources"
    private fun text(name: String, example: String = "", nullable: Boolean = false) = ApiRecordField(name, example = example, nullable = nullable)
    private fun bool(name: String, example: Boolean = false) = ApiRecordField(name, ApiValueKind.Boolean, example.toString(), choices = listOf("true", "false"))
    private fun number(name: String, example: String, nullable: Boolean = false, minimum: Double? = null) = ApiRecordField(name, ApiValueKind.Decimal, example, nullable = nullable, minimum = minimum)
    private fun choice(name: String, values: List<String>, example: String = values.first()) = ApiRecordField(name, ApiValueKind.Choice, example, choices = values)
    val roleSchema = ApiRecordSchema("track role", listOf(text("schemeIdUri", "urn:mpeg:dash:role:2011"), text("value", "subtitle", true), text("id", "null", true)))
    val subtitleSchema = ApiRecordSchema("subtitle track", listOf(
        text("url", "https://example.invalid/captions.vtt", true), text("mimeType", "text/vtt", true), text("label", "Captions", true), text("id", "captions"),
        bool("isDefault"), text("language", "en", true), bool("isForced"), ApiRecordField("roles", nested = roleSchema), text("associatedLanguage", "null", true)))
    val adSourceSchema = ApiRecordSchema("ad source", listOf(choice("type", AdSourceType.entries.map { it.name }, "Ima"), text("tag", "https://example.invalid/ad.xml"), number("vastLoadTimeout", "8", minimum = 0.0), number("videoLoadTimeout", "8", minimum = 0.0)), minimumItems = 1)
    val adItemSchema = ApiRecordSchema("scheduled ad", listOf(ApiRecordField("sources", nested = adSourceSchema), text("position", "pre"), number("replaceContentDuration", "0", minimum = 0.0), number("preloadOffset", "0", minimum = 0.0), bool("bitmovinAdTagLoading")))
    val sourceSchema = ApiRecordSchema("playlist source", listOf(text("url", "https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8"), choice("type", SourceType.entries.map { it.name }, "Hls"),
        text("title", "Sample video", true), text("description", "null", true), text("posterSource", "null", true), number("startOffset", "null", true), ApiRecordField("startOffsetTimelineReference", ApiValueKind.Choice, "null", choices = TimelineReferencePoint.entries.map { it.name }, nullable = true)), minimumItems = 1)
    private fun Map<String, String>.optional(name: String) = getValue(name).takeUnless { it == "null" }
    fun roles(value: String) = ApiRecordValues.decode(roleSchema.normalize(value)).map { MediaTrackRole(it.getValue("schemeIdUri"), it.optional("value"), it.optional("id")) }
    fun subtitles(value: String): List<SubtitleTrack> {
        val rows = ApiRecordValues.decode(subtitleSchema.normalize(value))
        require(rows.map { it.getValue("id") }.distinct().size == rows.size) { "Subtitle IDs must be unique." }
        return rows.map { SubtitleTrack(it.optional("url"), it.optional("mimeType"), it.optional("label"), it.getValue("id"), it.getValue("isDefault").toBooleanStrict(), it.optional("language"),
            it.getValue("isForced").toBooleanStrict(), roles(it.getValue("roles")), it.optional("associatedLanguage")) }
    }
    fun adSources(value: String) = ApiRecordValues.decode(adSourceSchema.normalize(value)).map { AdSource(AdSourceType.valueOf(it.getValue("type")), it.getValue("tag"), it.getValue("vastLoadTimeout").toDouble(), it.getValue("videoLoadTimeout").toDouble()) }
    fun adItems(value: String) = ApiRecordValues.decode(adItemSchema.normalize(value)).map { AdItem(adSources(it.getValue("sources")).toTypedArray(), it.getValue("position"), it.getValue("replaceContentDuration").toDouble(), it.getValue("preloadOffset").toDouble(), it.getValue("bitmovinAdTagLoading").toBooleanStrict()) }
    fun sources(value: String) = ApiRecordValues.decode(sourceSchema.normalize(value)).map {
        require(it.getValue("url").isNotBlank()) { "A playlist URL must be nonempty." }
        SourceConfig(it.getValue("url"), SourceType.valueOf(it.getValue("type"))).apply {
            title = it.optional("title"); description = it.optional("description"); posterSource = it.optional("posterSource")
            options = SourceOptions(it.optional("startOffset")?.toDouble(), it.optional("startOffsetTimelineReference")?.let(TimelineReferencePoint::valueOf))
        }
    }
    private fun optionalCode(value: String?) = value?.let(::kotlinString) ?: "null"
    fun sourceCode(c: SourceConfig) = "SourceConfig(${kotlinString(c.url)}, SourceType.${c.type.name}).apply { title = ${optionalCode(c.title)}; description = ${optionalCode(c.description)}; posterSource = ${optionalCode(c.posterSource)}; options = SourceOptions(${c.options.startOffset}, ${c.options.startOffsetTimelineReference?.let { "TimelineReferencePoint.${it.name}" } ?: "null"}) }"
    private fun roleCode(role: MediaTrackRole) = "MediaTrackRole(schemeIdUri = ${kotlinString(role.schemeIdUri)}, value = ${optionalCode(role.value)}, id = ${optionalCode(role.id)})"
    private fun subtitleCode(track: SubtitleTrack) = "SubtitleTrack(url = ${optionalCode(track.url)}, mimeType = ${optionalCode(track.mimeType)}, label = ${optionalCode(track.label)}, id = ${kotlinString(track.id)}, isDefault = ${track.isDefault}, language = ${optionalCode(track.language)}, isForced = ${track.isForced}, roles = ${track.roles.joinToString(", ", "listOf(", ")", transform = ::roleCode)}, associatedLanguage = ${optionalCode(track.associatedLanguage)})"
    private fun adSourceCode(source: AdSource) = "AdSource(type = AdSourceType.${source.type.name}, tag = ${kotlinString(source.tag)}, vastLoadTimeout = ${source.vastLoadTimeout}, videoLoadTimeout = ${source.videoLoadTimeout})"
    private fun adItemCode(item: AdItem) = "AdItem(sources = ${item.sources.joinToString(", ", "arrayOf(", ")", transform = ::adSourceCode)}, position = ${kotlinString(item.position)}, replaceContentDuration = ${item.replaceContentDuration}, preloadOffset = ${item.preloadOffset}, bitmovinAdTagLoading = ${item.bitmovinAdTagLoading})"
    val fields = listOf(
        ApiSetting(SDK + "source.SourceConfig.subtitleTracks", "SourceConfig", ApiValueKind.Records, "External subtitle tracks, with editable IDs, MIME type, forced/default flags, language and nested roles. An empty list removes external tracks. Null is distinct from an empty string.", records = subtitleSchema,
            source = { c, v -> c.subtitleTracks = subtitles(v).toMutableList() }, code = { v -> "sourceConfig.subtitleTracks = ${subtitles(v).joinToString(", ", "mutableListOf(", ")", transform = ::subtitleCode)}" }),
        ApiSetting(SDK + "advertising.AdvertisingConfig.schedule", "AdvertisingConfig", ApiValueKind.Records, "Initial ad schedule. Add one or more sources to each ad, then stage and apply. Position accepts pre, post, a time in seconds or a percentage such as 50%. Timeouts, replacement duration and preload offset use seconds. The SDK advertising module, valid ad tags and compatible content are needed for playback.", records = adItemSchema,
            player = { c, v -> c.copy(advertisingConfig = c.advertisingConfig.copy(schedule = adItems(v))) }, code = { v -> "playerConfig = playerConfig.copy(advertisingConfig = playerConfig.advertisingConfig.copy(schedule = ${adItems(v).joinToString(", ", "listOf(", ")", transform = ::adItemCode)}))" }),
        ApiSetting(PLAYLIST, "PlaylistConfig", ApiValueKind.Records, "Enables playlist loading with these ordered sources. Global Source overrides also apply to every item. Remove this override to return to the standard Source form. Offline playback uses its downloaded source instead.", records = sourceSchema,
            code = { v -> "val playlistSources = listOf(\n" + sources(v).joinToString(",\n") { c -> "    Source(SourceConfig(${kotlinString(c.url)}, SourceType.${c.type.name}).apply { title = ${optionalCode(c.title)}; description = ${optionalCode(c.description)}; posterSource = ${optionalCode(c.posterSource)}; options = SourceOptions(${c.options.startOffset}, ${c.options.startOffsetTimelineReference?.let { "TimelineReferencePoint.${it.name}" } ?: "null"}) })" } + "\n)\nplayer.load(PlaylistConfig(playlistSources, playlistOptions))" }),
        ApiSetting(SDK + "playlist.PlaylistOptions.preloadAllSources", "PlaylistOptions", ApiValueKind.Boolean, "Used when the playlist source override is enabled. Preloading more sources can increase memory and network use.",
            code = { v -> "playlistOptions = playlistOptions.copy(preloadAllSources = $v)" }),
        ApiSetting(SDK + "playlist.PlaylistOptions.replayMode", "PlaylistOptions", ApiValueKind.Choice, "End-of-playlist replay behavior. Used with the playlist source override.", choices = ReplayMode.entries.map { it.name },
            code = { v -> "playlistOptions = playlistOptions.copy(replayMode = ReplayMode.$v)" }),
    )
    fun playlistOptions(values: Map<String, String>) = PlaylistOptions(values[SDK + "playlist.PlaylistOptions.preloadAllSources"]?.toBooleanStrict() ?: false,
        values[SDK + "playlist.PlaylistOptions.replayMode"]?.let(ReplayMode::valueOf) ?: ReplayMode.Playlist)
}
