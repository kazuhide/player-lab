package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class CatalogTest {
    private val json = """{
      "schemaVersion":1,
      "events":[{"id":"SP-EVENT-S","title":"Short event","status":"live","archiveStatus":"processing",
         "liveAssetId":"SP-LIVE-S","archiveAssetId":"SP-ARCH-S","statusUrl":"api/events/SP-EVENT-S"}],
      "assets":[
        {"id":"SP-LIVE-S","eventId":"SP-EVENT-S","videoId":"sports:SP-LIVE-S","title":"Live","kind":"live",
         "streams":{"hls":"SP-LIVE-S/hls/master.m3u8","dash":"SP-LIVE-S/dash/manifest.mpd"},"durationMs":null,
         "utcStartMs":null,"utcMappings":[],"subtitleTracks":[]},
        {"id":"SP-ARCH-S","eventId":"SP-EVENT-S","videoId":"sports:SP-ARCH-S","title":"Archive","kind":"archive",
         "streams":{"hls":"SP-ARCH-S/hls/master.m3u8"},"durationMs":180000,
         "utcStartMs":null,"utcMappings":[],"subtitleTracks":[]}
      ],"scenarios":[]
    }"""
    @Test fun protocolsShareStableAssetAndVideoId() {
        val catalog = CatalogParser.parse(json, "http://10.0.2.2:8622/")
        val live = catalog.assets.first()
        assertEquals("sports:SP-LIVE-S", live.videoId)
        assertEquals("http://10.0.2.2:8622/SP-LIVE-S/dash/manifest.mpd", live.streams[StreamProtocol.DASH])
        assertEquals(2, live.streams.size)
        assertNull(live.utcStartMs)
        assertNull(live.durationMs)
    }
    @Test(expected = IllegalArgumentException::class)
    fun unknownEventCannotBecomeAnOrphanAsset() {
        CatalogParser.parse(json.replace("\"eventId\":\"SP-EVENT-S\"", "\"eventId\":\"missing\""), "https://media.test/")
    }
    @Test(expected = IllegalArgumentException::class)
    fun duplicateAssetIdsAreRejected() {
        CatalogParser.parse(json.replace("\"id\":\"SP-ARCH-S\"", "\"id\":\"SP-LIVE-S\""), "https://media.test/")
    }
    @Test(expected = IllegalArgumentException::class)
    fun privateFileUrlsCannotBeLoadedFromCatalog() {
        CatalogParser.parse(json.replace("SP-LIVE-S/hls/master.m3u8", "file:///etc/passwd"), "https://media.test/")
    }
    @Test(expected = IllegalArgumentException::class)
    fun invalidDurationIsNotCoercedToZero() {
        CatalogParser.parse(json.replace("180000", "-1"), "https://media.test/")
    }
    @Test(expected = IllegalArgumentException::class)
    fun measuredIntegerFieldsRejectDecimals() {
        CatalogParser.parse(json.replace("180000", "180000.5"), "https://media.test/")
    }
    @Test fun unknownMetadataRemainsUnknown() {
        val archive = CatalogParser.parse(json, "https://media.test/").assets.last()
        assertEquals(ArchivePosition.Unknown, archive.mapping.resolve(1_000_000))
    }
    @Test(expected = IllegalArgumentException::class)
    fun archiveReferencesMustBelongToEventAndCorrectKind() {
        CatalogParser.parse(json.replace("\"archiveAssetId\":\"SP-ARCH-S\"", "\"archiveAssetId\":\"SP-LIVE-S\""), "https://media.test/")
    }
}
