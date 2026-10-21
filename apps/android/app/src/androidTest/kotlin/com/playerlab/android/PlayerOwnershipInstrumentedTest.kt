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
