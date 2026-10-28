package com.playerlab.sportsstreaming.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.Locale

enum class AssetKind { LIVE, CLIP, ARCHIVE }
enum class StreamProtocol { HLS, DASH }
data class SubtitleEntry(val url: String, val language: String, val label: String)
data class SportsEvent(
    val id: String, val title: String, val titleJa: String?, val status: EventStatus,
    val archiveStatus: ArchiveStatus, val liveAssetId: String?, val archiveAssetId: String?,
    val statusUrl: String?,
) {
    fun localizedTitle(japanese: Boolean) = if (japanese) titleJa ?: title else title
}
data class MediaAsset(
    val id: String, val eventId: String, val videoId: String, val title: String, val titleJa: String?,
    val kind: AssetKind, val streams: Map<StreamProtocol, String>, val subtitleTracks: List<SubtitleEntry>,
    val durationMs: Long?, val utcStartMs: Long?, val utcMappings: List<UtcInterval>,
) {
    val mapping get() = ArchiveMapping(durationMs, utcStartMs, utcMappings)
    fun localizedTitle(japanese: Boolean) = if (japanese) titleJa ?: title else title
}
data class SportsCatalog(val events: List<SportsEvent>, val assets: List<MediaAsset>) {
    init {
        require(events.isNotEmpty() && assets.isNotEmpty())
        require(events.map { it.id }.toSet().size == events.size)
        require(assets.map { it.id }.toSet().size == assets.size)
        require(assets.map { it.videoId }.toSet().size == assets.size)
        require(assets.all { asset -> events.any { it.id == asset.eventId } })
        events.forEach { event ->
            listOf(event.liveAssetId to AssetKind.LIVE, event.archiveAssetId to AssetKind.ARCHIVE)
                .forEach { (id, kind) ->
                    require(id == null || assets.any { it.id == id && it.eventId == event.id && it.kind == kind })
                }
        }
    }
    fun asset(id: String?) = assets.firstOrNull { it.id == id }
    fun event(id: String?) = events.firstOrNull { it.id == id }
}

object CatalogParser {
    fun parse(text: String, mediaBaseUrl: String): SportsCatalog {
        require(text.toByteArray(Charsets.UTF_8).size <= 512 * 1024) { "Catalog exceeds 512 KiB" }
        val base = httpUri(mediaBaseUrl)
        val root = JSONObject(text)
        require(root.integer("schemaVersion") == 1L) { "Unsupported catalog version" }
        val events = root.getJSONArray("events").objects(100).map { entry ->
            SportsEvent(entry.id("id"), entry.text("title"), entry.optionalText("titleJa"),
                enumValueOf(entry.text("status").uppercase(Locale.ROOT)),
                enumValueOf(entry.text("archiveStatus").uppercase(Locale.ROOT)),
                entry.optionalId("liveAssetId"), entry.optionalId("archiveAssetId"),
                entry.optionalText("statusUrl")?.let { resolve(base, it) })
        }
        val assets = root.getJSONArray("assets").objects(500).map { entry ->
            val streamsObject = entry.getJSONObject("streams")
            val streams = StreamProtocol.entries.mapNotNull { protocol ->
                streamsObject.optionalText(protocol.name.lowercase(Locale.ROOT))?.let { protocol to resolve(base, it) }
            }.toMap()
            require(streams.isNotEmpty()) { "Asset has no HLS or DASH stream" }
            val duration = entry.nullableInteger("durationMs")
            val utc = entry.nullableInteger("utcStartMs")
            val mappings = parseMappings(entry.optJSONArray("utcMappings") ?: JSONArray())
            ArchiveMapping(duration, utc, mappings)
            val subtitles = (entry.optJSONArray("subtitleTracks") ?: JSONArray()).objects(20).map {
                SubtitleEntry(resolve(base, it.text("url")), it.text("language"), it.text("label"))
            }
            MediaAsset(entry.id("id"), entry.id("eventId"), entry.id("videoId"), entry.text("title"),
                entry.optionalText("titleJa"), enumValueOf(entry.text("kind").uppercase(Locale.ROOT)),
                streams, subtitles, duration, utc, mappings)
        }
        return SportsCatalog(events, assets)
    }

    internal fun parseMappings(array: JSONArray) = array.objects(100).map {
        UtcInterval(it.integer("utcStartMs"), it.integer("utcEndMs"), it.integer("archiveStartMs"))
    }
    internal fun httpUri(value: String): URI {
        val uri = URI(value)
        require(uri.scheme in listOf("http", "https") && !uri.host.isNullOrBlank()
            && uri.userInfo == null && uri.fragment == null) { "Expected an HTTP(S) media URL without credentials" }
        return uri
    }
    private fun resolve(base: URI, value: String) = httpUri(base.resolve(value).toASCIIString()).toASCIIString()
}

internal fun JSONArray.objects(maximum: Int): List<JSONObject> {
    require(length() <= maximum) { "Too many catalog entries" }
    return (0 until length()).map { getJSONObject(it) }
}
internal fun JSONObject.text(name: String): String {
    val value = get(name)
    require(value is String && value.isNotBlank() && value.length <= 2_048) { "Invalid text field: $name" }
    return value
}
internal fun JSONObject.optionalText(name: String): String? = if (isNull(name) || !has(name)) null else text(name)
internal fun JSONObject.id(name: String) = text(name).also {
    require(Regex("[A-Za-z0-9_.:-]{1,100}").matches(it)) { "Invalid identifier: $name" }
}
internal fun JSONObject.optionalId(name: String): String? = if (isNull(name) || !has(name)) null else id(name)
internal fun JSONObject.integer(name: String): Long {
    val value = get(name)
    require(value is Int || value is Long) { "Expected integer milliseconds: $name" }
    return (value as Number).toLong().also { require(it >= 0) { "Negative integer: $name" } }
}
internal fun JSONObject.nullableInteger(name: String): Long? =
    if (!has(name) || isNull(name)) null else integer(name)
