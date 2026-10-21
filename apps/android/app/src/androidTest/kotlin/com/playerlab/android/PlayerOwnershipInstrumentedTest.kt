package com.playerlab.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.deficiency.PlayerErrorCode
import com.bitmovin.player.api.deficiency.SourceErrorCode
import com.bitmovin.player.api.event.Event
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.live.LowLatencyApi
import com.bitmovin.player.api.live.TargetPlaybackLatencyCallback
import com.bitmovin.player.api.source.Source
import com.bitmovin.player.api.source.SourceConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Proxy
import kotlin.reflect.KClass

/** Deterministic API-call ownership checks; real SDK/view invalidation is checked separately. */
@RunWith(AndroidJUnit4::class)
class PlayerOwnershipInstrumentedTest {
    @Test
    fun replacementAndReleaseDestroyEachOwnedPlayerOnceAndRejectRetiredCallbacks() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val created = mutableListOf<RecordingPlayer>()
            val sources = mutableListOf<RecordingSource>()
            val host = object : LifecycleOwner { override val lifecycle = LifecycleRegistry(this) }
            val controller = PlayerController(
                instrumentation.targetContext, "dummy",
                playerFactory = { config -> RecordingPlayer(config).also { created += it }.api },
                sourceFactory = { config -> RecordingSource(config).also { sources += it }.api },
                lifecycle = host.lifecycle,
            )
            controller.load(Sources.all.first())
            val original = created.single()
            val retiredCallbacks = original.subscriptions.toList()
            val retiredSource = sources.single()
            val retiredSourceCallbacks = retiredSource.subscriptions.toList()
            controller.load(Sources.all.last())
            assertTrue("Previous source subscriptions must be removed", retiredSource.subscriptions.isEmpty())
            val activeSource = sources.last()
            activeSource.subscriptions.filter { it.first == SourceEvent.Error::class }.forEach { it.second(SourceEvent.Error(SourceErrorCode.General, "test")) }
            val sourceError = controller.lastErrorCode
            val sourceLog = controller.log.toList()
            retiredSourceCallbacks.filter { it.first == SourceEvent.Loaded::class }.forEach { it.second(SourceEvent.Loaded(retiredSource.api)) }
            retiredSourceCallbacks.filter { it.first == SourceEvent.Error::class }.forEach { it.second(SourceEvent.Error(SourceErrorCode.UnsupportedStreamType, "test")) }
            assertEquals("Retired source must not clear the active error", sourceError, controller.lastErrorCode)
            assertEquals(sourceLog, controller.log.toList())
            original.subscriptions.filter { it.first == PlayerEvent.Error::class }.forEach { it.second(PlayerEvent.Error(PlayerErrorCode.LicenseAuthenticationFailed, "test")) }
            val playerError = controller.lastErrorCode
            assertEquals(PlayerErrorCode.LicenseAuthenticationFailed.value, playerError)
            activeSource.subscriptions.filter { it.first == SourceEvent.Loaded::class }.forEach { it.second(SourceEvent.Loaded(activeSource.api)) }
            assertEquals("Loading a source must not clear the current player's error", playerError, controller.lastErrorCode)
            assertEquals("SourceLoaded", controller.log.first())
            val source = controller.sourceSettings
            controller.applyPlayerSettings(PlayerSettings(muted = true))
            assertEquals(1, original.destroyCalls)
            assertTrue("Retired subscriptions must be removed", original.subscriptions.isEmpty())
            assertTrue("Recreation removes source subscriptions", activeSource.subscriptions.isEmpty())
            assertEquals(source, controller.sourceSettings)
            val active = created.last()
            val logBefore = controller.log.toList()
            retiredCallbacks.filter { it.first == PlayerEvent.Error::class }
                .forEach { it.second(PlayerEvent.Error(PlayerErrorCode.General, "test")) }
            retiredCallbacks.filter { it.first == PlayerEvent.DvrWindowExceeded::class }
                .forEach { it.second(PlayerEvent.DvrWindowExceeded()) }
            assertNull("Retired errors must not affect active player", controller.lastErrorCode)
            assertEquals(logBefore, controller.log.toList())
            assertEquals("Retired recovery must not seek the new player", 0, active.timeShiftCalls)
            val finalCallbacks = active.subscriptions.toList()
            controller.release()
            controller.release()
            controller.applyPlayerSettings(PlayerSettings())
            controller.load(Sources.all.last())
            finalCallbacks.filter { it.first == PlayerEvent.Error::class }
                .forEach { it.second(PlayerEvent.Error(PlayerErrorCode.General, "test")) }
            assertEquals("Released controller must not create players", 2, created.size)
            assertEquals(1, original.destroyCalls)
            assertEquals(1, active.destroyCalls)
            assertTrue(active.subscriptions.isEmpty())
            assertTrue(sources.last().subscriptions.isEmpty())
            assertNull(controller.lastErrorCode)
        }
    }

    @Test
    fun latencyQueriesIgnoreEarlierQueriesRetiredSourcesAndRelease() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        lateinit var controller: PlayerController
        lateinit var player: RecordingPlayer
        instrumentation.runOnMainSync {
            val host = object : LifecycleOwner { override val lifecycle = LifecycleRegistry(this) }
            controller = PlayerController(
                instrumentation.targetContext, "dummy",
                playerFactory = { config -> RecordingPlayer(config).also { player = it }.api },
                sourceFactory = { config -> RecordingSource(config).api }, lifecycle = host.lifecycle,
            )
            controller.load(Sources.all.first())
            controller.queryTargetPlaybackLatency()
            controller.queryTargetPlaybackLatency()
            player.latencyCallbacks[1].onTargetPlaybackLatency(2.0)
            player.latencyCallbacks[0].onTargetPlaybackLatency(1.0)
        }
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync {
            assertEquals("LowLatencyApi.getTargetPlaybackLatency: 2.0", controller.apiAsyncResult)
            controller.queryTargetPlaybackLatency()
            controller.load(Sources.all.last())
            player.latencyCallbacks[2].onTargetPlaybackLatency(3.0)
        }
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync {
            assertEquals("A retired source must not publish a query result", "", controller.apiAsyncResult)
            controller.queryTargetPlaybackLatency()
            controller.release()
            player.latencyCallbacks[3].onTargetPlaybackLatency(4.0)
        }
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync { assertEquals("", controller.apiAsyncResult) }
    }

    @Test fun unloadTransitionAndGuiAddedSourcesFenceQueriesAndOwnAllSourceEvents() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        lateinit var controller: PlayerController
        lateinit var player: RecordingPlayer
        val sources = mutableListOf<RecordingSource>()
        lateinit var added: RecordingSource
        var retiredEvents = emptyList<Pair<KClass<*>, (Event) -> Unit>>()
        instrumentation.runOnMainSync {
            val host = object : LifecycleOwner { override val lifecycle = LifecycleRegistry(this) }
            controller = PlayerController(instrumentation.targetContext, "dummy", playerFactory = { config -> RecordingPlayer(config).also { player = it }.api },
                sourceFactory = { config -> RecordingSource(config).also { sources += it }.api }, lifecycle = host.lifecycle)
            controller.load(Sources.all.first())
            controller.queryTargetPlaybackLatency()
            controller.unloadApiSource()
            player.latencyCallbacks[0].onTargetPlaybackLatency(7.0)
        }
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync {
            assertEquals("Unloaded source query cannot publish", "", controller.apiAsyncResult)
            controller.load(Sources.all.first())
            controller.addApiPlaylistSource("https://example.invalid/second.m3u8", com.bitmovin.player.api.source.SourceType.Hls, null)
            added = sources.last()
            assertTrue("Dynamic source receives SDK source event subscriptions", added.subscriptions.size >= ApiEvents.source.size)
            val event = SourceEvent.Loaded(added.api)
            added.subscriptions.filter { it.first == SourceEvent.Loaded::class }.toList().forEach { it.second(event) }
            assertEquals(1, controller.apiEvents["SourceEvent.Loaded"])
            assertEquals(event.timestamp, controller.apiEventTimes["SourceEvent.Loaded"])
            added.subscriptions.filter { it.first == SourceEvent.Error::class }.toList().forEach { it.second(SourceEvent.Error(SourceErrorCode.General, "Synthetic")) }
            assertEquals(SourceErrorCode.General.value, controller.lastErrorCode)
            controller.queryTargetPlaybackLatency()
            controller.seekApiPlaylistSource(1, com.bitmovin.player.api.playlist.SeekTarget(0.0))
            player.latencyCallbacks[1].onTargetPlaybackLatency(8.0)
        }
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync {
            assertEquals("Previous playlist source query cannot publish", "", controller.apiAsyncResult)
            controller.queryTargetPlaybackLatency()
            // Exercise the SDK-driven automatic transition too, rather than only the GUI wrapper.
            val transition = PlayerEvent.PlaylistTransition(added.api, player.playlistSources.first())
            player.currentSource = player.playlistSources.first()
            player.subscriptions.filter { it.first == PlayerEvent.PlaylistTransition::class }.toList().forEach { it.second(transition) }
            player.latencyCallbacks[2].onTargetPlaybackLatency(9.0)
            retiredEvents = added.subscriptions.toList()
            controller.removeApiPlaylistSource(1)
            assertTrue("Removed source subscriptions are retired", added.subscriptions.isEmpty())
        }
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync {
            assertEquals("Automatic transition query cannot publish", "", controller.apiAsyncResult)
            val counts = controller.apiEvents.toMap(); val error = controller.lastErrorCode
            retiredEvents.filter { it.first == SourceEvent.Error::class }.forEach { it.second(SourceEvent.Error(SourceErrorCode.UnsupportedStreamType, "Retired")) }
            assertEquals(counts, controller.apiEvents.toMap()); assertEquals(error, controller.lastErrorCode)
            controller.release(); assertTrue(sources.all { it.subscriptions.isEmpty() })
        }
    }

    private class RecordingPlayer(private val config: PlayerConfig) : InvocationHandler {
        val latencyCallbacks = mutableListOf<TargetPlaybackLatencyCallback>()
        private val lowLatency = Proxy.newProxyInstance(
            LowLatencyApi::class.java.classLoader, arrayOf(LowLatencyApi::class.java),
        ) { _, method, args ->
            if (method.name == "getTargetPlaybackLatency") {
                @Suppress("UNCHECKED_CAST")
                latencyCallbacks += args!![0] as TargetPlaybackLatencyCallback
            }
            null
        } as LowLatencyApi
        var currentSource: Source? = null
        val playlistSources = mutableListOf<Source>()
        private val playlist = Proxy.newProxyInstance(
            com.bitmovin.player.api.playlist.PlaylistApi::class.java.classLoader, arrayOf(com.bitmovin.player.api.playlist.PlaylistApi::class.java),
        ) { _, method, arguments ->
            val values = arguments.orEmpty()
            when (method.name) {
                "getSources" -> playlistSources.toList()
                "add" -> { val source = values[0] as Source; if (values.size == 1) playlistSources.add(source) else playlistSources.add(values[1] as Int, source); Unit }
                "remove" -> { val removed = playlistSources.removeAt(values[0] as Int); if (currentSource === removed) currentSource = playlistSources.firstOrNull(); Unit }
                "seek" -> { currentSource = values[0] as Source; Unit }
                else -> null
            }
        } as com.bitmovin.player.api.playlist.PlaylistApi
        var destroyCalls = 0
        var timeShiftCalls = 0
        val subscriptions = mutableListOf<Pair<KClass<*>, (Event) -> Unit>>()
        val api: Player = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java), this) as Player

        @Suppress("UNCHECKED_CAST")
        override fun invoke(proxy: Any, method: java.lang.reflect.Method, arguments: Array<out Any?>?): Any? {
            val args = arguments.orEmpty()
            return when (method.name) {
                "on" -> { subscriptions += (args[0] as KClass<*>) to (args[1] as (Event) -> Unit); Unit }
                "off" -> { subscriptions.removeAll { it.first == args[0] && it.second === args[1] }; Unit }
                "destroy" -> { destroyCalls++; Unit }
                "timeShift" -> { timeShiftCalls++; Unit }
                "load" -> { val loaded = args[0]; playlistSources.clear(); playlistSources += if (loaded is Source) listOf(loaded) else (loaded as com.bitmovin.player.api.playlist.PlaylistConfig).sources; currentSource = playlistSources.firstOrNull(); Unit }
                "unload" -> { currentSource = null; playlistSources.clear(); Unit }
                "getSource" -> currentSource
                "getPlaylist" -> playlist
                "getConfig" -> config
                "getLowLatency" -> lowLatency
                "isDestroyed" -> destroyCalls > 0
                "equals" -> proxy === args[0]
                "hashCode" -> System.identityHashCode(proxy)
                "toString" -> "RecordingPlayer"
                else -> when (method.returnType) {
                    java.lang.Boolean.TYPE -> false
                    java.lang.Double.TYPE -> 0.0
                    java.lang.Integer.TYPE -> 0
                    java.lang.Long.TYPE -> 0L
                    java.lang.Float.TYPE -> 0f
                    else -> null
                }
            }
        }
    }

    private class RecordingSource(private val config: SourceConfig) : InvocationHandler {
        val subscriptions = mutableListOf<Pair<KClass<*>, (Event) -> Unit>>()
        val api: Source = Proxy.newProxyInstance(Source::class.java.classLoader, arrayOf(Source::class.java), this) as Source

        @Suppress("UNCHECKED_CAST")
        override fun invoke(proxy: Any, method: java.lang.reflect.Method, arguments: Array<out Any?>?): Any? {
            val args = arguments.orEmpty()
            return when (method.name) {
                "on" -> { subscriptions += (args[0] as KClass<*>) to (args[1] as (Event) -> Unit); Unit }
                "off" -> { subscriptions.removeAll { it.first == args[0] && it.second === args[1] }; Unit }
                "getConfig" -> config
                "equals" -> proxy === args[0]
                "hashCode" -> System.identityHashCode(proxy)
                "toString" -> "RecordingSource"
                else -> null
            }
        }
    }
}
