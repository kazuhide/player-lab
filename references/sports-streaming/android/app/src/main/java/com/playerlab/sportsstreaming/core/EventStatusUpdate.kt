package com.playerlab.sportsstreaming.core

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

data class ArchiveMappingUpdate(
    val assetId: String, val durationMs: Long?, val utcStartMs: Long?, val intervals: List<UtcInterval>,
) {
    val mapping get() = ArchiveMapping(durationMs, utcStartMs, intervals)
}
data class EventStatusUpdate(
    val eventId: String, val eventStatus: EventStatus, val archiveStatus: ArchiveStatus,
    val liveUtcStartMs: Long?, val archive: ArchiveMappingUpdate?,
    val seekableUtcStartMs: Long? = null, val seekableUtcEndMs: Long? = null,
) {
    fun containsSeekableUtc(utcMs: Long?) = utcMs != null && seekableUtcStartMs != null && seekableUtcEndMs != null &&
        utcMs >= seekableUtcStartMs && utcMs < seekableUtcEndMs
    val archiveMapping get() = archive?.mapping
}

object EventStatusParser {
    fun parse(text: String, expectedEventId: String, expectedLiveAssetId: String?,
              expectedArchiveAssetId: String?): EventStatusUpdate {
        require(text.toByteArray(Charsets.UTF_8).size <= 16 * 1024) { "Status response exceeds 16 KiB" }
        val root = JSONObject(text)
        require(root.id("id") == expectedEventId)
        require(root.optionalId("eventId")?.let { it == expectedEventId } != false)
        require(root.optionalId("liveAssetId") == expectedLiveAssetId)
        require(root.optionalId("archiveAssetId") == expectedArchiveAssetId)
        val status = enumValueOf<EventStatus>(root.text("status").uppercase(Locale.ROOT))
        val archiveStatus = enumValueOf<ArchiveStatus>(root.text("archiveStatus").uppercase(Locale.ROOT))
        val entry = if (root.has("archiveMapping") && !root.isNull("archiveMapping")) root.getJSONObject("archiveMapping") else null
        val mapping = entry?.let {
            require(archiveStatus == ArchiveStatus.READY) { "Unready archive cannot publish a mapping" }
            require(it.id("assetId") == expectedArchiveAssetId) { "Archive mapping belongs to another asset" }
            ArchiveMappingUpdate(it.id("assetId"), it.nullableInteger("durationMs"), it.nullableInteger("utcStartMs"),
                CatalogParser.parseMappings(it.optJSONArray("utcMappings") ?: JSONArray())).also { value -> value.mapping }
        }
        val earliest = root.nullableInteger("seekableUtcStartMs")
        val end = root.nullableInteger("seekableUtcEndMs")
        require((earliest == null && end == null) || (earliest != null && end != null && earliest <= end))
        return EventStatusUpdate(expectedEventId, status, archiveStatus, root.nullableInteger("utcStartMs"), mapping, earliest, end)
    }
}
