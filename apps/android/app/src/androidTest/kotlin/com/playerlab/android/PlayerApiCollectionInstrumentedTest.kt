package com.playerlab.android

import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.api.source.NetworkEngine
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.media3.datasource.DataSpec
import com.bitmovin.media3.datasource.DefaultHttpDataSource
import com.bitmovin.media3.datasource.cache.Cache
import com.bitmovin.media3.datasource.cache.CacheSpan
import com.bitmovin.media3.datasource.cache.CacheDataSource
import com.bitmovin.media3.datasource.cache.CacheWriter
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlayerApiCollectionInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private fun id(member: String) = "android:com.bitmovin.player.api.$member"
    private val sample = "https://kazuhide.github.io/player-lab/web/media/vod-baseline/"

    @Test fun nestedSubtitlesPlaylistOptionsAndRealCacheReachPlaybackThroughTheGui() {
        val c = ui.activity.controller
        baseline()
        click("api-settings-toggle")
        select("source.SourceConfig.subtitleTracks"); click("record-add")
        field("record-0-url", "https://kazuhide.github.io/player-lab/web/media/assets/sintel_en.vtt")
        field("record-0-id", "external-en"); field("record-0-label", "External English")
        click("record-0-roles-toggle"); click("record-0-roles-add")
        field("record-0-roles-0-value", "subtitle"); click("api-setting-stage")
        select("playlist.PlaylistConfig.sources"); click("record-add"); click("record-add")
        field("record-0-title", "First sample"); field("record-1-title", "Second sample")
        field("record-1-url", sample + "manifest.mpd"); click("record-1-type-Dash"); click("api-setting-stage")
        select("playlist.PlaylistOptions.preloadAllSources"); click("api-choice-true"); click("api-setting-stage")
        select("playlist.PlaylistOptions.replayMode"); click("api-choice-LastSource"); click("api-setting-stage")
        select("TweaksConfig.exoPlayerCache"); click("record-add"); field("record-0-maxBytes", "16777216"); click("api-setting-stage")
        val old = c.player
        click("api-settings-apply"); ui.onNodeWithTag("api-settings-error").assertDoesNotExist()
        await("Actual playlist playback after Apply") { old.isDestroyed && c.player !== old && c.player.isPlaying && c.player.currentTime > 0.5 && c.player.playlist.sources.size == 2 }
        ui.runOnUiThread {
            assertEquals(listOf("First sample", "Second sample"), c.player.playlist.sources.map { it.config.title })
            assertTrue(c.apiOverrides.playlistOptions().preloadAllSources)
            assertEquals("LastSource", c.apiOverrides.playlistOptions().replayMode.name)
            c.player.playlist.sources.forEach { source ->
                assertEquals("external-en", source.config.subtitleTracks.single().id)
                assertEquals("subtitle", source.config.subtitleTracks.single().roles.single().value)
            }
            assertNotNull(c.player.config.tweaksConfig.exoPlayerCache)
            assertNull(c.lastErrorCode)
        }
        // The SDK's exoPlayerCache tweak is read-only. Populate sample bytes with public Media3 APIs first.
        var cache: Cache? = null
        ui.runOnUiThread { c.player.pause(); cache = c.player.config.tweaksConfig.exoPlayerCache }
        val actualCache = requireNotNull(cache)
        val assetUrls = listOf("init-stream0.m4s", "init-stream1.m4s", "init-stream2.m4s", "chunk-stream0-00001.m4s", "chunk-stream1-00001.m4s", "chunk-stream2-00001.m4s").map { sample + it }
        val fill = java.util.concurrent.FutureTask {
            assetUrls.forEach { url ->
                val dataSource = CacheDataSource.Factory().setCache(actualCache).setUpstreamDataSourceFactory(DefaultHttpDataSource.Factory()).createDataSource()
                CacheWriter(dataSource, DataSpec.Builder().setUri(url).build(), ByteArray(16_384), null).cache()
            }
        }
        Thread(fill, "qualification-cache-fill").start(); fill.get(40, java.util.concurrent.TimeUnit.SECONDS)
        assertTrue(actualCache.cacheSpace > 0)
        val hits = java.util.concurrent.atomic.AtomicInteger()
        val listener = object : Cache.Listener {
            override fun onSpanAdded(cache: Cache, span: CacheSpan) = Unit
            override fun onSpanRemoved(cache: Cache, span: CacheSpan) = Unit
            override fun onSpanTouched(cache: Cache, oldSpan: CacheSpan, newSpan: CacheSpan) { hits.incrementAndGet() }
        }
        assetUrls.forEach { actualCache.addListener(it, listener) }
        try {
            select("source.SourceConfig.description"); field("api-setting-value", "Cache read qualification"); click("api-setting-stage"); click("api-settings-apply")
            await("SDK reads a prefilled cache span") { hits.get() > 0 && c.player.isPlaying && c.player.currentTime > 0.5 }
        } finally { assetUrls.forEach { actualCache.removeListener(it, listener) } }
        click("api-runtime-toggle"); field("api-runtime-search", "PlaylistApi.seek")
        click("api-command-${id("playlist.PlaylistApi.seek()")}"); field("api-argument-index", "1"); click("api-command-run")
        await("Second playlist source plays") { c.player.source?.config?.title == "Second sample" && c.player.currentTime > 0.5 && c.player.isPlaying }
        ui.runOnUiThread { assertEquals(60.0, c.player.duration, 0.01); assertNull(c.lastErrorCode) }
    }

    @Test fun preparedGooglePlayServicesCronetEngineActuallyPlaysTheSample() {
        val c = ui.activity.controller
        baseline(); click("api-settings-toggle")
        select("source.NetworkEngine.Cronet.cronetEngine"); click("api-cronet-prepare")
        await("Google Play services provider becomes ready") { ApiNativeFactories.cronetReady() }
        click("record-add"); field("record-0-userAgent", "PlayerLab/Android-qualification"); click("api-setting-stage")
        click("api-settings-apply"); ui.onNodeWithTag("api-settings-error").assertDoesNotExist()
        await("Actual Cronet source playback") { c.player.source?.config?.networkConfig?.engine is NetworkEngine.Cronet && c.player.isPlaying && c.player.currentTime > 0.5 }
        ui.runOnUiThread {
            assertEquals(60.0, c.player.duration, 0.01)
            val engine = c.player.source!!.config.networkConfig.engine as NetworkEngine.Cronet
            assertTrue(engine.cronetEngine.versionString.isNotBlank())
            assertEquals(1, ApiNativeFactories.snapshot()["cronetInstances"])
            assertNull(c.lastErrorCode)
        }
    }

    @Test fun explicitOfflineConstructorReachesTheSdkWithEditableRestrictionAndDrmInput() {
        val c = ui.activity.controller
        baseline(); click("offline-toggle"); click("offline-factory-toggle")
        field("offline-factory-cache", "qualification-cache"); field("offline-factory-tracks", "qualification-track-state")
        click("offline-factory-apply")
        await("SDK accepts nonrestricted offline constructor and plays") { c.player.source?.config is com.bitmovin.player.api.offline.OfflineSourceConfig && c.player.isPlaying && c.player.currentTime > 0.5 }
        ui.runOnUiThread {
            val source = c.player.source!!.config as com.bitmovin.player.api.offline.OfflineSourceConfig
            assertFalse(source.isRestrictToOffline); assertNull(source.drmId); assertEquals(60.0, c.player.duration, 0.01)
            assertNull(c.lastErrorCode)
        }
        field("offline-factory-drm", "0010feff"); click("offline-factory-restrict"); click("offline-factory-apply")
        await("SDK receives the second typed constructor") {
            val source = c.player.source?.config as? com.bitmovin.player.api.offline.OfflineSourceConfig
            source?.isRestrictToOffline == true && source.drmId?.contentEquals(byteArrayOf(0,16,-2,-1)) == true
        }
        workspaceOfflineCode(ui, factory = true).assertTextContains("privateDrmIdBytes", substring = true)
        workspaceOfflineCode(ui, factory = true).assertTextContains("true, null)", substring = true)
        // Arbitrary bytes are a constructor routing check, not an issued DRM license or successful offline qualification.
    }

    @Test fun imaScheduleEditableHooksAndRealCompanionHostAreAppliedToTheSdk() {
        val c = ui.activity.controller
        baseline(); click("api-settings-toggle")
        select("advertising.ima.ImaConfig.beforeInitialization"); field("api-setting-value", "return {language: 'en', maxRedirects: 4};"); click("api-setting-stage")
        select("advertising.ima.ImaConfig.onAdsManagerAvailable"); field("api-setting-value", "return [];"); click("api-setting-stage")
        select("advertising.AdvertisingConfig.companionAdContainers"); click("record-add"); field("record-0-container", "qualification-banner"); click("api-setting-stage")
        select("advertising.AdvertisingConfig.schedule"); click("record-add"); click("record-0-sources-toggle"); click("record-0-sources-add")
        field("record-0-sources-0-tag", "https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=")
        click("api-setting-stage"); click("api-settings-apply"); ui.onNodeWithTag("api-settings-error").assertDoesNotExist()
        await("Actual IMA settings and manager callbacks") {
            (c.apiCallbacks.snapshot()[id("advertising.ima.ImaConfig.beforeInitialization")]?.first ?: 0) > 0 &&
                (c.apiCallbacks.snapshot()[id("advertising.ima.ImaConfig.onAdsManagerAvailable")]?.first ?: 0) > 0
        }
        ui.runOnUiThread {
            val container = c.player.config.advertisingConfig.companionAdContainers!!.single()
            assertSame(c.apiCompanionHosts.single().view, container.container)
            assertTrue(container.container.isAttachedToWindow)
            assertEquals(300, container.width); assertEquals(250, container.height)
            assertEquals(0, c.apiCallbacks.snapshot()[id("advertising.ima.ImaConfig.beforeInitialization")]!!.second)
            assertEquals(0, c.apiCallbacks.snapshot()[id("advertising.ima.ImaConfig.onAdsManagerAvailable")]!!.second)
            assertNull(c.lastErrorCode)
        }
        await("IMA ad media actually starts") { (c.apiEvents["PlayerEvent.AdStarted"] ?: 0) > 0 }
    }

    @Test fun deprecatedMediaSourceConstructorAndThumbnailStateUseTheCurrentGuiValues() {
        val c = ui.activity.controller
        baseline(); click("configuration-toggle"); click("source-legacy-constructor"); click("apply-source")
        await("Legacy HLS source constructor actually plays") { c.sourceSettings.useLegacyMediaSource && c.player.isPlaying && c.player.currentTime > 0.5 }
        ui.runOnUiThread { assertEquals(SourceType.Hls, c.player.source!!.config.type); assertEquals(sample + "master.m3u8", c.player.source!!.config.url) }
        click("api-settings-toggle"); select("source.SourceConfig.thumbnailTrack")
        field("api-setting-value", "https://kazuhide.github.io/player-lab/web/media/vod-sprites/thumbnails/thumbnails.vtt"); click("api-setting-stage")
        select("source.NetworkEngine.HttpURLConnection.allowCrossProtocolRedirects"); click("api-choice-true"); click("api-setting-stage")
        select("source.SourceNetworkConfig.engine"); click("api-choice-HttpURLConnection"); click("api-setting-stage"); click("api-settings-apply")
        await("SDK loads the real thumbnail track") { c.player.isPlaying && c.player.source?.getThumbnail(c.player.currentTime) != null }
        ui.runOnUiThread { assertTrue((c.player.source!!.config.networkConfig.engine as NetworkEngine.HttpURLConnection).allowCrossProtocolRedirects) }
        click("api-runtime-toggle"); click("api-section-State"); field("api-runtime-search", "media.thumbnail.Thumbnail."); click("api-state-refresh")
        for (member in listOf("start", "end", "x", "y", "width", "height", "uri", "text")) {
            val node = workspaceState(ui, id("media.thumbnail.Thumbnail.$member")).performScrollTo()
            node.assertExists()
            assertFalse(node.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Text].joinToString { it.text }.startsWith("Unavailable"))
        }
        workspaceState(ui, id("media.thumbnail.Thumbnail.width")).assertTextContains("160", substring = true)
    }

    @Test fun namedManualOrientationValuesReachBothNativeProvidersWithoutAxisSwaps() {
        val c = ui.activity.controller
        baseline(); click("api-runtime-toggle")
        for (provider in listOf("gyroscopic", "touch")) {
            val member = "vr.VrApi.${provider}OrientationProvider"
            field("api-runtime-search", member); click("api-command-${id(member)}")
            field("api-argument-pitch", "17"); field("api-argument-roll", "23"); field("api-argument-yaw", "91"); click("api-command-run")
            ui.runOnUiThread {
                val selected = if (provider == "gyroscopic") c.player.vr.gyroscopicOrientationProvider else c.player.vr.touchOrientationProvider
                val direction = requireNotNull(selected).getViewingDirection()
                assertEquals(17.0, direction.pitch, 0.0); assertEquals(23.0, direction.roll, 0.0); assertEquals(91.0, direction.yaw, 0.0)
            }
            field("api-argument-mode", "Original"); click("api-command-run")
        }
    }

    @Test fun guiAddedSourcesPublishActualSourceEventsAndInvokeTheEditableAnalyticsErrorHook() {
        val c = ui.activity.controller
        baseline(); click("analytics-toggle"); click("analytics-error-strategy-Custom")
        field("analytics-error-body", "return {code: input.code, message: 'Player Lab synthetic source error', severity: input.severity};")
        click("analytics-apply")
        await("Player restarts with custom error transformer") { c.player.isPlaying && c.player.currentTime > 0.5 }
        click("api-runtime-toggle")
        fun command(member: String) { field("api-runtime-search", member); click("api-command-${id(member)}") }
        command("playlist.PlaylistApi.add()")
        field("api-argument-url", sample + "manifest.mpd"); field("api-argument-type", "Dash"); click("api-command-run")
        await("Added DASH source is in the SDK playlist") { c.player.playlist.sources.size == 2 }
        var loadedBefore = 0
        ui.runOnUiThread { loadedBefore = c.apiEvents["SourceEvent.Loaded"] ?: 0 }
        command("playlist.PlaylistApi.seek()"); field("api-argument-index", "1"); click("api-command-run")
        await("Added source actually plays and publishes SourceEvent.Loaded") { c.player.source?.config?.type == SourceType.Dash && c.player.isPlaying && c.player.currentTime > 0.5 && (c.apiEvents["SourceEvent.Loaded"] ?: 0) > loadedBefore }
        ui.runOnUiThread { assertNotNull(c.apiEventTimes["SourceEvent.Loaded"]); assertTrue(c.log.any { it == "SourceLoaded" }) }
        command("playlist.PlaylistApi.add()"); field("api-argument-url", sample + "intentionally-missing-source.m3u8"); field("api-argument-type", "Hls"); click("api-command-run")
        command("playlist.PlaylistApi.seek()"); field("api-argument-index", "2"); click("api-command-run")
        await("Added invalid source publishes its actual SDK error and transforms the Analytics error") {
            (c.apiEvents["SourceEvent.Error"] ?: 0) > 0 && c.lastErrorCode != null &&
                (c.apiCallbacks.snapshot()["AnalyticsConfig.errorTransformerCallback"]?.first ?: 0) > 0
        }
        ui.runOnUiThread {
            assertNotNull(c.apiEventTimes["SourceEvent.Error"])
            assertTrue(c.log.any { it.startsWith("SourceError ") })
            assertEquals(0, c.apiCallbacks.snapshot()["AnalyticsConfig.errorTransformerCallback"]!!.second)
            c.applySource(SourceSettings(sample + "master.m3u8", SourceType.Hls))
        }
        await("Restore the valid sample after the expected negative test") { c.player.isPlaying && c.player.currentTime > 0.5 && c.lastErrorCode == null }
    }

    private fun baseline() {
        val c = ui.activity.controller
        ui.runOnUiThread { c.applySource(SourceSettings(sample + "master.m3u8", SourceType.Hls)); c.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true)) }
        await("Baseline playback") { c.player.isPlaying && c.player.currentTime > 0.5 }
    }
    private fun select(member: String) { field("api-settings-search", member); click("api-select-${id(member)}") }
    private fun click(tag: String) = workspaceClick(ui, tag)
    private fun field(tag: String, value: String) { workspaceField(ui, tag, value); closeSoftKeyboard() }
    private fun await(label: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 45_000
        while (SystemClock.uptimeMillis() < deadline) {
            ui.waitForIdle(); var ready = false; ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail(label)
    }
}
