package com.playerlab.android

import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Test

class ApiCollectionSettingsTest {
    private fun id(value: String) = "android:com.bitmovin.player.api.$value"
    private fun row(schema: ApiRecordSchema, vararg changes: Pair<String, String>) = schema.defaults(0) + changes
    private fun encoded(vararg rows: Map<String, String>) = ApiRecordValues.encode(rows.toList())

    @Test fun subtitleRolesAndNullableStringsReachThePublicSdkConstructor() {
        val role = encoded(row(ApiCollectionSettings.roleSchema, "id" to "", "value" to "caption"))
        val track = row(ApiCollectionSettings.subtitleSchema, "id" to "English", "label" to "null", "url" to "https://example.invalid/a.vtt", "isDefault" to "true", "roles" to role)
        val overrides = ApiOverrides.validate(mapOf(id("source.SourceConfig.subtitleTracks") to encoded(track)))
        val config = overrides.source(SourceConfig("https://example.invalid/main.mpd", SourceType.Dash))
        val actual = config.subtitleTracks.single()
        assertEquals("English", actual.id); assertNull(actual.label); assertTrue(actual.isDefault)
        assertEquals("caption", actual.roles.single().value); assertEquals("", actual.roles.single().id)
        assertTrue(overrides.code().contains("MediaTrackRole(schemeIdUri ="))
        assertTrue(runCatching { ApiOverrides.validate(mapOf(id("source.SourceConfig.subtitleTracks") to encoded(track, track))) }.isFailure)
    }

    @Test fun adScheduleRetainsMultipleSourcesAndRejectsIncompleteRowsBeforeApplication() {
        val first = row(ApiCollectionSettings.adSourceSchema, "tag" to "https://example.invalid/a.xml")
        val second = first + ("tag" to "https://example.invalid/b.xml")
        val item = row(ApiCollectionSettings.adItemSchema, "sources" to encoded(first, second), "position" to "50%", "preloadOffset" to "2.5")
        val overrides = ApiOverrides.validate(mapOf(id("advertising.AdvertisingConfig.schedule") to encoded(item)))
        val actual = overrides.player(PlayerConfig()).advertisingConfig.schedule.single()
        assertEquals(2, actual.sources.size); assertEquals("50%", actual.position); assertEquals(2.5, actual.preloadOffset, 0.0)
        assertTrue(runCatching { ApiOverrides.validate(mapOf(id("advertising.AdvertisingConfig.schedule") to encoded(item + ("sources" to encoded())))) }.isFailure)
        assertTrue(runCatching { ApiCollectionSettings.adItems(encoded(item + ("unknown" to "1"))) }.isFailure)
    }

    @Test fun playlistCodeAndRuntimeApplyOptionsAndGlobalSourceOverridesToEachItemRegardlessOfEditOrder() {
        val first = row(ApiCollectionSettings.sourceSchema, "title" to "First", "startOffset" to "2", "startOffsetTimelineReference" to "Start")
        val second = first + mapOf("title" to "Second", "type" to "Dash", "url" to "https://example.invalid/main.mpd")
        val settings = linkedMapOf(ApiCollectionSettings.PLAYLIST to encoded(first, second), id("source.SourceConfig.description") to "Global", id("playlist.PlaylistOptions.preloadAllSources") to "true", id("playlist.PlaylistOptions.replayMode") to "LastSource")
        for (input in listOf(settings, settings.entries.reversed().associate { it.toPair() })) {
            val overrides = ApiOverrides.validate(input)
            assertTrue(overrides.playlistOptions().preloadAllSources)
            assertEquals("LastSource", overrides.playlistOptions().replayMode.name)
            assertEquals(listOf("First", "Second"), overrides.playlistSources()!!.map { it.title })
            assertEquals(listOf("Global", "Global"), overrides.playlistSources()!!.map { overrides.source(it).description })
            val code = overrides.code()
            assertTrue(code.indexOf("var playlistOptions") < code.indexOf("playlistOptions = playlistOptions.copy"))
            assertTrue(code.indexOf("preloadAllSources = true") < code.indexOf("player.load(PlaylistConfig"))
            assertEquals(2, Regex("sourceConfig.description = ").findAll(code).count())
            assertEquals(2, Regex("Source\\(sourceConfig\\)").findAll(code).count())
        }
    }

    @Test fun formCodecPreservesArbitraryLiteralTextAndRejectsMalformedOrOversizedInput() {
        val records = listOf(mapOf("key:1" to "literal: \\ \n日本語", "empty" to ""))
        assertEquals(records, ApiRecordValues.decode(ApiRecordValues.encode(records)))
        listOf("1:1:1:a3:x", "0:trailing", "33:", "1:2:1:a1:b1:a1:c").forEach { value -> assertTrue(value, runCatching { ApiRecordValues.decode(value) }.isFailure) }
        assertTrue(runCatching { ApiRecordValues.encode(List(33) { emptyMap() }) }.isFailure)
        assertTrue(runCatching { ApiRecordValues.encode(listOf(mapOf("x" to "a".repeat(65536)))) }.isFailure)
    }

    @Test fun nativeFactoryPreflightRejectsIncompatibleAndUnboundedInputWithoutAllocatingResources() {
        val cache = ApiNativeFactories.fields.first { it.id.endsWith("TweaksConfig.exoPlayerCache") }
        val schema = cache.records!!
        assertTrue(runCatching { ApiOverrides.validate(mapOf(cache.id to encoded(row(schema, "maxBytes" to "1073741825")))) }.isFailure)
        val engine = id("source.SourceNetworkConfig.engine")
        assertTrue(runCatching { ApiOverrides.validate(mapOf(engine to "Cronet", id("source.NetworkEngine.HttpURLConnection.allowCrossProtocolRedirects") to "true")) }.isFailure)
        val companion = ApiNativeFactories.fields.first { it.id.endsWith("AdvertisingConfig.companionAdContainers") }
        val fluid = row(companion.records!!, "width" to "-1", "height" to "-1")
        ApiOverrides.validate(mapOf(companion.id to encoded(fluid)))
        assertTrue(runCatching { ApiOverrides.validate(mapOf(companion.id to encoded(fluid + ("height" to "250")))) }.isFailure)
        assertEquals(0, ApiNativeFactories.snapshot()["cacheInstances"])
        assertEquals(0, ApiNativeFactories.snapshot()["cronetInstances"])
    }
    @Test fun selectedHttpUrlConnectionRetainsRedirectPolicyAndPlaylistCodeRetainsMediaSessionMetadata() {
        val settings = linkedMapOf(id("source.SourceNetworkConfig.engine") to "HttpURLConnection", id("source.NetworkEngine.HttpURLConnection.allowCrossProtocolRedirects") to "true")
        for (input in listOf(settings, settings.entries.reversed().associate { it.toPair() })) {
            val source = ApiOverrides.validate(input).source(SourceConfig("https://example.invalid/a.mpd", SourceType.Dash))
            assertTrue(ApiNativeFactories.httpUrlConnectionEngine(source.networkConfig.engine).allowCrossProtocolRedirects)
        }
        val playlist = encoded(row(ApiCollectionSettings.sourceSchema))
        val overrides = ApiOverrides.validate(mapOf(ApiCollectionSettings.PLAYLIST to playlist, id("media.session.MediaSessionSourceConfig.Enabled.mediaMetadata") to "artist=Sample"))
        val code = overrides.code()
        assertTrue(code.contains("val mediaSessionConfig ="))
        assertTrue(code.contains("Source(sourceConfig, mediaSessionConfig = mediaSessionConfig)"))
        assertTrue(code.indexOf("val mediaSessionConfig =") < code.indexOf("Source(sourceConfig, mediaSessionConfig"))
    }
}
