package com.playerlab.android

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.event.Event
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.source.Source
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.ui.PlayerViewConfig
import com.bitmovin.player.api.ui.UiConfig
import com.playerlab.android.playback.PlaybackTimeline
import com.playerlab.android.playback.TimelineConfig
import com.playerlab.android.playback.TimelineState
import com.playerlab.android.playback.PlayerSnapshot
import kotlin.reflect.KClass

/**
 * Which UI renders over the player. `DEFAULT` uses the SDK's default Web UI configuration; the rest load
 * our shared `@showcase/ui-shared` bundle (synced into assets/ — see
 * scripts/sync-webui-bundle.sh) and pick one of its custom factories by name, demonstrating
 * the §12 "build the UI once, reuse it across web-capable targets" story. Android renders the
 * player UI as a Web UI in a WebView, so the same bundle the web app uses runs here unchanged.
 */
enum class UiMode(val label: String, val factoryFunction: String?) {
    DEFAULT("Default", null),
    SPORTS("Sports", "bitmovin.playerui.UIFactory.buildSportsUI"),
    LIVE("Live (DVR)", "bitmovin.playerui.UIFactory.buildLiveUI"),
    CINEMA("Cinema", "bitmovin.playerui.UIFactory.buildCinemaUI"),
}

/**
 * Build a [PlayerViewConfig] for a [UiMode]. `DEFAULT` keeps the SDK's UI configuration defaults; the
 * custom modes point the Web UI at our synced bundle and select the factory by name.
 */
private fun playerViewConfig(mode: UiMode): PlayerViewConfig =
    if (mode.factoryFunction == null) {
        PlayerViewConfig()
    } else {
        PlayerViewConfig(
            uiConfig = UiConfig.WebUi(
                jsLocation = "file:///android_asset/bitmovinplayer-ui.js",
                cssLocation = "file:///android_asset/bitmovinplayer-ui.css",
                variant = UiConfig.WebUi.Variant.Custom(mode.factoryFunction),
            ),
        )
    }

/**
 * Coordinates Player configuration, source loading, and playback state for Compose.
 * SDK-independent playback timing calculations live in the `:playback` module.
 * The Player SDK is pinned in app/build.gradle.kts. Device playback requires
 * a license that allows this app identifier.
 */
internal class PlayerController(
    private val context: Context,
    private val licenseKey: String,
    private val analyticsLicenseKey: String = "",
    private val playerFactory: ((PlayerConfig) -> Player)? = null,
    private val sourceFactory: ((SourceConfig) -> Source)? = null,
    lifecycle: Lifecycle,
) {
    // §15: the bundled analytics collector reports QoE to the Bitmovin dashboard
    // when a key is configured (repo-root .env → sync-env.sh → local.properties).
    internal var apiAnalyticsSettings by mutableStateOf(ApiAnalyticsSettings())
        private set
    internal var apiCallbacks = ApiCallbackContext()
        private set
    internal var apiSourceCallbacks = ApiCallbackContext()
        private set
    internal val hostContext get() = context
    private var preparedCompanions = emptyList<ApiNativeFactories.Host>()
    private fun createPlayer(settings: PlayerSettings, overrides: ApiOverrides = ApiOverrides(), analytics: ApiAnalyticsSettings = apiAnalyticsSettings, callbacks: ApiCallbackContext = apiCallbacks): Player {
        val prepared = ApiNativeFactories.player(context, overrides.player(settings.toPlayerConfig(licenseKey), callbacks), overrides.values)
        val result = playerFactory?.invoke(prepared.config) ?: Player(context, prepared.config, analytics.playerConfig(analyticsLicenseKey, callbacks))
        preparedCompanions = prepared.hosts
        return result
    }

    var player: Player by mutableStateOf(createPlayer(PlayerSettings()))
        private set
    internal var apiCompanionHosts by mutableStateOf(preparedCompanions)
        private set
    internal var playerSettings: PlayerSettings by mutableStateOf(PlayerSettings())
        private set
    internal var apiOverrides: ApiOverrides by mutableStateOf(ApiOverrides())
        private set
    internal var sourceSettings: SourceSettings by mutableStateOf(SourceSettings.from(Sources.all.first()))
        private set
    internal var sourceRevision: Int by mutableStateOf(0)
        private set
    internal var configurationStatus: String by mutableStateOf("")
        private set
    private val views = mutableSetOf<PlayerView>()
    internal val apiSurfaces = ApiSurfaceBinding()
    internal var apiViewRevision by mutableStateOf(0)
        private set
    private var apiDetachedView: PlayerView? = null
    private class ApiViewSubscription(val owner: PlayerView) { var dispose: () -> Unit = {} }
    private val apiViewSubscriptions = mutableMapOf<String, ApiViewSubscription>()
    private val apiFullscreenHandlers = mutableMapOf<PlayerView, ApiFullscreenHandler>()
    private val apiCustomMessages = mutableMapOf<PlayerView, ApiCustomMessages>()
    private val apiCustomMessageTokens = mutableMapOf<PlayerView, Any>()
    internal var apiFullscreen by mutableStateOf(false)
        private set
    internal var apiPictureInPicture by mutableStateOf(false)
        private set
    internal val apiHostMessages = mutableStateListOf<String>()
    internal var apiClearFocus: () -> Unit = {}
    internal var apiVrRenderer: ApiVrRenderer? by mutableStateOf(null)
        private set
    private var apiVrRequested = false
    internal val apiVrCallbackStates = androidx.compose.runtime.mutableStateMapOf<String, String>()
    private val apiVrCallbacks = mutableMapOf<String, ApiVrUserCallback>()
    private val apiHostLifecycle = lifecycle
    private val apiVrLifecycle = androidx.lifecycle.LifecycleEventObserver { _, event ->
        when (event) {
            androidx.lifecycle.Lifecycle.Event.ON_RESUME -> apiVrRenderer?.onResume()
            androidx.lifecycle.Lifecycle.Event.ON_PAUSE -> apiVrRenderer?.onPause()
            else -> Unit
        }
    }
    internal fun setApiVrRendererActive(enabled: Boolean) {
        check(!released)
        apiVrRequested = enabled
        if (!enabled) { retireApiVrRenderer(); apiViewRevision++; return }
        if (apiVrRenderer != null) return
        apiClearFocus()
        val owner = player
        lateinit var renderer: ApiVrRenderer
        fun owns() = !released && player === owner && apiVrRenderer === renderer
        renderer = ApiVrRenderer(context, owner, ::owns) { message -> if (owns()) append(message) }
        retireApiViewSubscriptions()
        views.forEach { retireApiViewHandlers(it); apiSurfaces.clear(it); viewLifecycle.detach(it); it.player = null }
        apiDetachedView = null
        apiVrRenderer = renderer
        try {
            owner.vr.setVrRenderer(renderer)
            renderer.setSourceConfig(owner.source?.config ?: configuredSource?.config)
            if (apiHostLifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) renderer.onResume() else renderer.onPause()
        } catch (error: Exception) {
            retireApiVrRenderer(); apiVrRequested = false; apiViewRevision++
            throw error
        }
    }
    private fun retireApiVrRenderer() {
        apiVrCallbacks.values.forEach { it.close(); it.renderer.removeUpdateCallback(it) }
        apiVrCallbacks.clear(); apiVrCallbackStates.clear()
        apiVrRenderer?.close()
        apiVrRenderer = null
    }
    internal fun addApiVrCallback(id: String, everyFrames: Int, body: String) {
        require(id.matches(Regex("[A-Za-z0-9_-]{1,64}")))
        val renderer = requireNotNull(apiVrRenderer) { "Enable the host VR renderer first." }
        require(id in apiVrCallbacks || apiVrCallbacks.size < 16) { "Use at most 16 callback handles." }
        val owner = player
        val callback = ApiVrUserCallback(renderer, body, everyFrames, { delta ->
            val direction = owner.vr.viewingDirection
            mapOf("delta" to delta, "viewingDirection" to direction?.let { mapOf("yaw" to it.yaw, "pitch" to it.pitch, "roll" to it.roll) })
        }) { handle, _ ->
            apiMain.post {
                val result = handle.takeResult()
                if (!released && player === owner && apiVrRenderer === renderer && apiVrCallbacks[id] === handle && handle.context.active && result != null) {
                    result.move?.let(owner.vr::moveViewingDirection)
                    apiVrCallbackStates[id] = "calls=${handle.calls.get()}; result=${result.text ?: "null"}; fallback=${handle.context.snapshot()["VrRenderer.UpdateCallback"]?.second ?: 0}"
                }
            }
        }
        apiVrCallbacks.remove(id)?.let { it.close(); it.renderer.removeUpdateCallback(it) }
        apiVrCallbacks[id] = callback
        renderer.addUpdateCallback(callback)
    }
    internal fun removeApiVrCallback(id: String) {
        val callback = requireNotNull(apiVrCallbacks.remove(id)) { "Unknown callback handle." }
        callback.close(); callback.renderer.removeUpdateCallback(callback); apiVrCallbackStates.remove(id)
    }
    private val viewLifecycle = PlayerViewLifecycle(lifecycle)
    private val playerSubscriptions = mutableListOf<() -> Unit>()
    private var sourceSubscription: (() -> Unit)? = null
    private class ApiSourceObservation(val source: Source, val owner: Player, val generation: Int) { var dispose: () -> Unit = {} }
    private val apiObservedSources = java.util.IdentityHashMap<Source, ApiSourceObservation>()
    private val apiMain = android.os.Handler(android.os.Looper.getMainLooper())
    private var apiQuerySequence = 0L
    private var apiQueryTimeout: Runnable? = null
    internal val apiEvents = androidx.compose.runtime.mutableStateMapOf<String, Int>()
    internal val apiEventTimes = androidx.compose.runtime.mutableStateMapOf<String, Long>()
    internal val apiSsaiAds = androidx.compose.runtime.mutableStateMapOf<String, com.bitmovin.player.api.ssai.SsaiAd>()
    internal val apiSsaiBreaks = androidx.compose.runtime.mutableStateMapOf<String, com.bitmovin.player.api.ssai.SsaiAdBreak>()
    internal var apiSelectedSsaiAd: String? by mutableStateOf(null)
    internal var apiSelectedSsaiBreak: String? by mutableStateOf(null)
    internal var apiVector: com.bitmovin.player.api.vr.orientation.Vector3? = null
    internal var apiMediaSession: com.bitmovin.player.api.media.session.MediaSession? = null
        private set
    internal fun setApiMediaSessionActive(enabled: Boolean) {
        check(!released)
        if (!enabled) { apiMediaSession?.release(); apiMediaSession = null }
        else if (apiMediaSession == null) apiMediaSession = com.bitmovin.player.api.media.session.MediaSession(context, android.os.Looper.getMainLooper(), player)
    }
    internal val apiOriginalOrientations = mutableMapOf<String, com.bitmovin.player.api.vr.orientation.OrientationProvider?>()
    internal var apiEventRecording by mutableStateOf(true)
    internal var apiAsyncResult by mutableStateOf("")
        private set
    internal val apiOffline = ApiOffline(context) { id, timestamp -> apiEvent(id, timestamp) { !released } }
    private var offlinePlayback: com.bitmovin.player.api.offline.OfflineSourceConfig? = null
    internal fun createOfflineManager(id: String) {
        apiOffline.open(apiOverrides.source(sourceSettings.toSourceConfig()), id)
    }
    internal fun loadOfflineSource(config: com.bitmovin.player.api.offline.OfflineSourceConfig) {
        if (released) return
        offlinePlayback = config
        sourceSettings = SourceSettings(config.url, config.type, title = config.title.orEmpty())
        sourceRevision++
        loadCurrentSource()
        configurationStatus = "SDK offline source loaded. Inspect playback and track states."
    }
    private fun sourceConfiguration(overrides: ApiOverrides = apiOverrides, callbacks: ApiCallbackContext = ApiCallbackContext()): SourceConfig {
        val offline = offlinePlayback
        val source = if (offline == null) sourceSettings.toSourceConfig() else {
            // Copy the SDK Parcelable so removing an override does not retain an earlier mutation.
            val parcel = android.os.Parcel.obtain()
            try {
                offline.writeToParcel(parcel, 0)
                parcel.setDataPosition(0)
                com.bitmovin.player.api.offline.OfflineSourceConfig.CREATOR.createFromParcel(parcel)
            } finally { parcel.recycle() }
        }
        return ApiNativeFactories.source(context, overrides.source(source, callbacks), overrides.values)
    }
    private fun sourceConfigurations(overrides: ApiOverrides = apiOverrides, callbacks: ApiCallbackContext): List<SourceConfig> {
        val playlist = if (offlinePlayback == null) overrides.playlistSources() else null
        return playlist?.map { ApiNativeFactories.source(context, overrides.source(it, callbacks), overrides.values) }
            ?: listOf(sourceConfiguration(overrides, callbacks))
    }
    internal fun currentView(): PlayerView? = views.firstOrNull { it.player === player }
    internal fun setApiFullscreenHandler(enabled: Boolean) {
        val view = requireNotNull(currentView()) { "Attach a PlayerView first." }
        val activity = requireNotNull(context.apiActivity()) { "A host Activity is required." }
        apiFullscreenHandlers.remove(view)?.close()
        val handler = if (!enabled) null else ApiFullscreenHandler(activity,
            { !released && currentView() === view }, { apiClearFocus(); apiFullscreen = it })
        view.setFullscreenHandler(handler)
        if (handler != null) apiFullscreenHandlers[view] = handler
    }
    internal fun setApiPictureInPictureHandler(enabled: Boolean, width: Int, height: Int) {
        require(width > 0 && height > 0 && width.toDouble() / height in (1.0 / 2.39)..2.39) { "Choose a positive Android PiP aspect ratio between 1:2.39 and 2.39:1." }
        val view = requireNotNull(currentView()) { "Attach a PlayerView first." }
        val activity = requireNotNull(context.apiActivity()) { "A host Activity is required." }
        view.setPictureInPictureHandler(if (!enabled) null else ApiPictureInPictureHandler(activity, view, width, height) { !released && currentView() === view })
    }
    internal fun setApiCustomMessageHandler(enabled: Boolean, reply: String) {
        val view = requireNotNull(currentView()) { "Attach a PlayerView first." }
        apiCustomMessages.remove(view)
        apiCustomMessageTokens.remove(view)
        val token = Any()
        val messages = if (!enabled) null else ApiCustomMessages(reply) { payload ->
            apiMain.post {
                if (!released && currentView() === view && apiCustomMessageTokens[view] === token) {
                    apiHostMessages.add(0, payload)
                    while (apiHostMessages.size > 20) apiHostMessages.removeAt(apiHostMessages.lastIndex)
                }
            }
        }
        view.setCustomMessageHandler(messages?.handler)
        if (messages != null) { apiCustomMessages[view] = messages; apiCustomMessageTokens[view] = token }
    }
    internal fun sendApiCustomMessage(name: String, payload: String) {
        require(name.matches(Regex("[A-Za-z][A-Za-z0-9_.-]{0,63}")))
        require(payload.length <= 2048)
        requireNotNull(apiCustomMessages[currentView()]) { "Install the host message handler first." }.handler.sendMessage(name, payload)
    }
    private fun retireApiViewHandlers(view: PlayerView) {
        apiFullscreenHandlers.remove(view)?.close()
        apiCustomMessages.remove(view)
        apiCustomMessageTokens.remove(view)
        view.setFullscreenHandler(null)
        view.setPictureInPictureHandler(null)
        view.setCustomMessageHandler(null)
    }
    internal fun pictureInPictureChanged(active: Boolean, configuration: android.content.res.Configuration) {
        if (released) return
        apiClearFocus()
        apiPictureInPicture = active
        views.toList().forEach { it.onPictureInPictureModeChanged(active, configuration) }
    }
    internal fun subscribeApiView(id: String, event: String, once: Boolean) {
        require(id.matches(Regex("[A-Za-z0-9_.-]{1,64}"))) { "Use a subscription ID with 1–64 letters, digits, dots, underscores or hyphens." }
        val view = requireNotNull(currentView()) { "Attach a PlayerView first." }
        val entry = ApiEvents.views.firstOrNull { it.id == event } ?: error("Choose a supported event.")
        check(id in apiViewSubscriptions || apiViewSubscriptions.size < 64) { "Remove an existing subscription first (limit 64)." }
        unsubscribeApiView(id)
        val handle = ApiViewSubscription(view)
        apiViewSubscriptions[id] = handle
        try {
            handle.dispose = entry.subscribe(view, once) { name, timestamp ->
                apiEvent("PlayerView.$name", timestamp) {
                    !released && currentView() === view && apiViewSubscriptions[id] === handle
                }
            }
        } catch (failure: Exception) {
            apiViewSubscriptions.remove(id)
            throw failure
        }
    }
    internal fun unsubscribeApiView(id: String) { apiViewSubscriptions.remove(id)?.dispose?.invoke() }
    private fun retireApiViewSubscriptions(view: PlayerView? = null) {
        apiViewSubscriptions.filterValues { view == null || it.owner === view }.keys.toList().forEach(::unsubscribeApiView)
    }
    internal fun recreateApiView() {
        if (released) return
        apiClearFocus()
        apiDetachedView = null
        apiViewRevision++
    }
    internal fun setApiViewAttached(attach: Boolean) {
        check(!released)
        check(apiVrRenderer == null) { "Disable the host VR renderer before attaching a PlayerView." }
        val view = currentView() ?: apiDetachedView?.takeIf { it in views } ?: error("Create a PlayerView first.")
        if (attach) {
            view.player = player
            apiDetachedView = null
            viewLifecycle.attach(view, view::onStart, view::onResume, view::onPause, view::onStop)
        } else {
            retireApiViewHandlers(view)
            retireApiViewSubscriptions(view)
            apiSurfaces.clear(view)
            viewLifecycle.detach(view)
            view.player = null
            apiDetachedView = view
        }
    }
    private fun invalidateApiQuery() {
        apiQuerySequence++
        apiQueryTimeout?.let(apiMain::removeCallbacks)
        apiQueryTimeout = null
        apiAsyncResult = ""
    }
    internal fun queryTargetPlaybackLatency() {
        if (released) return
        invalidateApiQuery()
        val owner = player
        val generation = playerGeneration
        val source = sourceGeneration
        val activeSource = owner.source
        val configured = configuredSource
        val query = apiQuerySequence
        fun ownsBase() = !released && player === owner && generation == playerGeneration &&
            source == sourceGeneration && query == apiQuerySequence
        fun ownsQuery() = ownsBase() && owner.source === activeSource && configuredSource === configured
        apiAsyncResult = "Waiting for target playback latency."
        val timeout = Runnable {
            if (ownsBase() && !ownsQuery()) invalidateApiQuery()
            else if (ownsQuery()) {
                apiQuerySequence++
                apiQueryTimeout = null
                apiAsyncResult = "No target playback latency result within 10 seconds. Try again after loading a source."
            }
        }
        apiQueryTimeout = timeout
        apiMain.postDelayed(timeout, 10_000L)
        try {
            owner.lowLatency.getTargetPlaybackLatency { value ->
                apiMain.post {
                    if (ownsBase() && !ownsQuery()) invalidateApiQuery()
                    else if (ownsQuery()) {
                        apiMain.removeCallbacks(timeout)
                        apiQueryTimeout = null
                        apiQuerySequence++
                        apiAsyncResult = "LowLatencyApi.getTargetPlaybackLatency: ${value ?: "null"}"
                    }
                }
            }
        } catch (failure: Exception) {
            invalidateApiQuery()
            throw failure
        }
    }
    private fun apiEvent(id: String, timestamp: Long, owns: () -> Boolean) {
        val record = {
            if (owns() && apiEventRecording) {
                apiEvents[id] = ((apiEvents[id] ?: 0).toLong() + 1).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
                apiEventTimes[id] = timestamp
            }
        }
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) record() else apiMain.post { record() }
    }
    internal var configuredSource: Source? = null
        private set
    private var playerGeneration = 0
    private var sourceGeneration = 0
    private var released = false

    var dvr: TimelineState by mutableStateOf(PlaybackTimeline.deriveState(snapshot(), TimelineConfig(timeShiftEnabled = true)))
        private set
    var timeShiftEnabled: Boolean by mutableStateOf(true)
        private set
    val log = mutableStateListOf<String>()
    var lastErrorCode: Int? by mutableStateOf(null)
        private set

    init {
        apiHostLifecycle.addObserver(apiVrLifecycle)
        observePlayer()
    }

    private fun observePlayer() {
        val owner = player
        val generation = playerGeneration
        ApiEvents.player.forEach { entry ->
            playerSubscriptions += entry.subscribe(owner) { id, timestamp ->
                apiEvent(id, timestamp) { !released && player === owner && generation == playerGeneration }
            }
        }
        onPlayer(PlayerEvent.PlaylistTransition::class) { invalidateApiQuery(); configuredSource = it.to }
        onPlayer(PlayerEvent.Error::class) { lastErrorCode = it.code.value; append("PlayerError ${it.code.value}") }
        onPlayer(PlayerEvent.TimeChanged::class) { refresh() }
        onPlayer(PlayerEvent.TimeShifted::class) { append("TimeShifted"); refresh() }
        // §5.3: recover from DVRWindowExceeded by snapping to the live edge.
        onPlayer(PlayerEvent.DvrWindowExceeded::class) {
            append("DVRWindowExceeded → recover")
            player.timeShift(0.0)
        }
    }

    fun load(source: PlayerSource) {
        if (released) return
        offlinePlayback = null
        sourceSettings = SourceSettings.from(source)
        // Also replace a dirty editor when the same catalog preset is selected again.
        sourceRevision++
        append("load ${source.label}")
        loadCurrentSource()
    }

    internal fun applySource(settings: SourceSettings) {
        if (released) return
        offlinePlayback = null
        sourceSettings = settings
        sourceRevision++
        loadCurrentSource()
        configurationStatus = "Source applied; current player reloaded."
        append("Source configuration applied")
    }

    private fun observeApiSource(source: Source) {
        sourceSubscription = ::retireApiSourceSubscriptions
        if (apiObservedSources.containsKey(source)) return
        val observation = ApiSourceObservation(source, player, sourceGeneration)
        apiObservedSources[source] = observation
        fun ownsSource() = !released && player === observation.owner && sourceGeneration == observation.generation && apiObservedSources[source] === observation
        val error: (SourceEvent.Error) -> Unit = { if (ownsSource()) { lastErrorCode = it.code.value; append("SourceError ${it.code.value}") } }
        val loaded: (SourceEvent.Loaded) -> Unit = { if (ownsSource()) { append("SourceLoaded"); refresh() } }
        source.on(SourceEvent.Error::class, error); source.on(SourceEvent.Loaded::class, loaded)
        val subscriptions = ApiEvents.source.map { entry -> entry.subscribe(source) { id, timestamp -> apiEvent(id, timestamp, ::ownsSource) } }
        observation.dispose = {
            source.off(SourceEvent.Error::class, error); source.off(SourceEvent.Loaded::class, loaded)
            subscriptions.forEach { it() }
        }
    }
    private fun retireApiSource(source: Source) { apiObservedSources.remove(source)?.dispose?.invoke() }
    private fun retireApiSourceSubscriptions() {
        val retired = apiObservedSources.values.toList(); apiObservedSources.clear()
        retired.forEach { it.dispose() }
    }
    internal fun unloadApiSource() {
        check(!released); invalidateApiQuery(); ++sourceGeneration
        retireApiSourceSubscriptions(); sourceSubscription = null; configuredSource = null
        apiSourceCallbacks.close(); apiSourceCallbacks = ApiCallbackContext()
        player.unload(); refresh()
    }
    internal fun addApiPlaylistSource(url: String, type: SourceType, index: Int?) {
        check(!released)
        require(index == null || index in 0..player.playlist.sources.size) { "Playlist insertion index is outside the current source list." }
        val config = ApiNativeFactories.source(context, apiOverrides.source(SourceConfig(url, type), apiSourceCallbacks), apiOverrides.values)
        val source = sourceFactory?.invoke(config) ?: Source(config, com.bitmovin.player.api.analytics.AnalyticsSourceConfig.Enabled(apiAnalyticsSettings.sourceMetadata()), mediaSessionConfig = apiOverrides.mediaSession())
        observeApiSource(source)
        try { if (index == null) player.playlist.add(source) else player.playlist.add(source, index) }
        catch (failure: Exception) { retireApiSource(source); throw failure }
    }
    internal fun removeApiPlaylistSource(index: Int) {
        check(!released)
        val source = player.playlist.sources.getOrNull(index) ?: error("No playlist source at that index.")
        invalidateApiQuery(); player.playlist.remove(index); retireApiSource(source)
        if (configuredSource === source) configuredSource = player.source ?: player.playlist.sources.firstOrNull()
    }
    internal fun seekApiPlaylistSource(index: Int, target: com.bitmovin.player.api.playlist.SeekTarget?) {
        check(!released)
        val source = player.playlist.sources.getOrNull(index) ?: error("No playlist source at that index.")
        invalidateApiQuery(); player.playlist.seek(source, target); configuredSource = source
    }

    private fun loadCurrentSource(configs: List<SourceConfig>? = null, callbacks: ApiCallbackContext = ApiCallbackContext()) {
        val sourceConfigs = configs ?: sourceConfigurations(callbacks = callbacks)
        val sources = sourceConfigs.map { sourceConfig -> sourceFactory?.invoke(sourceConfig)
            ?: Source(sourceConfig, com.bitmovin.player.api.analytics.AnalyticsSourceConfig.Enabled(apiAnalyticsSettings.sourceMetadata()), mediaSessionConfig = apiOverrides.mediaSession()) }
        invalidateApiQuery()
        sourceSubscription?.invoke()
        val owner = player
        ++sourceGeneration
        apiSourceCallbacks.close()
        apiSourceCallbacks = callbacks
        configuredSource = sources.first()
        sources.forEach(::observeApiSource)
        sourceSubscription = ::retireApiSourceSubscriptions
        lastErrorCode = null
        if (offlinePlayback == null && ApiCollectionSettings.PLAYLIST in apiOverrides.values)
            owner.load(com.bitmovin.player.api.playlist.PlaylistConfig(sources, apiOverrides.playlistOptions()))
        else owner.load(sources.single())
        refresh()
    }

    internal fun applyPlayerSettings(settings: PlayerSettings, overrides: ApiOverrides = apiOverrides, analytics: ApiAnalyticsSettings = apiAnalyticsSettings) {
        if (released) return
        val nextCallbacks = ApiCallbackContext()
        val nextSourceCallbacks = ApiCallbackContext()
        if (ApiNativeFactories.requiresCronet(overrides.values) && !ApiNativeFactories.cronetReady()) {
            nextCallbacks.close(); nextSourceCallbacks.close()
            configurationStatus = "Prepare the Google Play services Cronet provider in SDK API settings before applying."
            return
        }
        val sourceConfigs = runCatching { sourceConfigurations(overrides, nextSourceCallbacks) }.getOrElse {
            nextCallbacks.close(); nextSourceCallbacks.close()
            configurationStatus = "Unable to build source configuration; current settings kept."
            return
        }
        // PlayerConfig and its nested configs are fixed at construction time in SDK 3.171.0.
        // https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api/-player-config/index.html
        val replacement = runCatching { createPlayer(settings, overrides, analytics, nextCallbacks) }.getOrElse {
            nextCallbacks.close(); nextSourceCallbacks.close()
            configurationStatus = "Unable to create a player; current settings kept."
            append("Player recreation failed")
            return
        }
        retireApiVrRenderer()
        playerGeneration++
        sourceGeneration++
        sourceSubscription?.invoke()
        sourceSubscription = null
        playerSubscriptions.forEach { it() }
        playerSubscriptions.clear()
        val previous = player
        apiCallbacks.close()
        // Detach synchronously, even if another Apply occurs before Compose disposes the old view.
        retireApiViewSubscriptions()
        views.forEach { retireApiViewHandlers(it); apiSurfaces.clear(it); viewLifecycle.detach(it); it.player = null }
        apiDetachedView = null
        player = replacement
        apiCompanionHosts = preparedCompanions
        apiMediaSession?.player = replacement
        playerSettings = settings
        apiOverrides = overrides
        apiAnalyticsSettings = analytics
        apiCallbacks = nextCallbacks
        invalidateApiQuery()
        apiSsaiAds.clear()
        apiSsaiBreaks.clear()
        apiSelectedSsaiAd = null
        apiSelectedSsaiBreak = null
        apiVector = null
        apiOriginalOrientations.clear()
        observePlayer()
        previous.destroy()
        loadCurrentSource(sourceConfigs, nextSourceCallbacks)
        if (apiVrRequested) setApiVrRendererActive(true)
        configurationStatus = "Player settings applied; current source reloaded."
        append("Player recreated; source retained")
    }

    private fun <E : Event> onPlayer(type: KClass<E>, action: (E) -> Unit) {
        val owner = player
        val generation = playerGeneration
        val guarded: (E) -> Unit = { if (!released && player === owner && generation == playerGeneration) action(it) }
        owner.on(type, guarded)
        playerSubscriptions += { owner.off(type, guarded) }
    }

    internal fun attachView(view: PlayerView): PlayerView = view.also {
        if (views.add(it) && !released && it.player === player) {
            viewLifecycle.attach(it, it::onStart, it::onResume, it::onPause, it::onStop)
        }
    }

    internal fun releaseView(view: PlayerView) {
        if (!views.remove(view)) return
        retireApiViewSubscriptions(view)
        retireApiViewHandlers(view)
        apiSurfaces.clear(view)
        if (apiDetachedView === view) apiDetachedView = null
        viewLifecycle.detach(view)
        view.player = null
        view.onDestroy()
    }

    fun goToLiveEdge() {
        if (released || !dvr.isLive) return
        player.timeShift(0.0)
    }

    fun seek(offsetFromEdge: Double) {
        if (released) return
        player.timeShift(if (timeShiftEnabled && playerSettings.timeShift) PlaybackTimeline.clampToWindow(offsetFromEdge, player.maxTimeShift) else 0.0)
    }

    fun toggleDvr(enabled: Boolean) {
        if (released) return
        timeShiftEnabled = enabled
        refresh()
    }

    fun release() {
        if (released) return
        retireApiVrRenderer()
        apiVrRequested = false
        apiHostLifecycle.removeObserver(apiVrLifecycle)
        released = true
        apiCallbacks.close()
        apiSourceCallbacks.close()
        apiMediaSession?.release()
        apiMediaSession = null
        invalidateApiQuery()
        apiMain.removeCallbacksAndMessages(null)
        apiSsaiAds.clear()
        apiSsaiBreaks.clear()
        apiSelectedSsaiAd = null
        apiSelectedSsaiBreak = null
        apiVector = null
        apiOriginalOrientations.clear()
        apiSurfaces.clear()
        retireApiViewSubscriptions()
        views.forEach(::retireApiViewHandlers)
        apiDetachedView = null
        apiOffline.dispose()
        offlinePlayback = null
        playerGeneration++
        sourceGeneration++
        sourceSubscription?.invoke()
        sourceSubscription = null
        configuredSource = null
        playerSubscriptions.forEach { it() }
        playerSubscriptions.clear()
        viewLifecycle.release()
        views.forEach { it.player = null }
        player.destroy()
    }

    private fun snapshot() = PlayerSnapshot(
        isLive = player.isLive,
        duration = player.duration,
        maxTimeShift = player.maxTimeShift,
        timeShift = player.timeShift,
        currentTime = player.currentTime,
    )

    private fun refresh() {
        dvr = PlaybackTimeline.deriveState(snapshot(), TimelineConfig(timeShiftEnabled = timeShiftEnabled && playerSettings.timeShift))
    }

    private fun append(message: String) {
        log.add(0, message)
        if (log.size > 40) log.removeAt(log.lastIndex)
    }
}

class MainActivity : ComponentActivity() {
    internal lateinit var controller: PlayerController
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Match system-bar contrast to the existing light MaterialTheme and keep controls in safe insets.
        // https://developer.android.com/develop/ui/compose/system/setup-e2e
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.BLACK),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.BLACK),
        )
        controller = PlayerController(this, licenseKey(), analyticsLicenseKey(), lifecycle = lifecycle)
        setContent { MaterialTheme { Surface(modifier = Modifier.fillMaxSize()) { PlayerLabScreen(controller) } } }
        Sources.all.firstOrNull()?.let { controller.load(it) }
    }

    override fun onDestroy() {
        controller.release()
        super.onDestroy()
    }
    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: android.content.res.Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (::controller.isInitialized) controller.pictureInPictureChanged(isInPictureInPictureMode, newConfig)
    }

    private fun licenseKey(): String = metaData("BITMOVIN_PLAYER_LICENSE_KEY")

    private fun analyticsLicenseKey(): String = metaData("BITMOVIN_ANALYTICS_LICENSE_KEY")

    private fun metaData(name: String): String =
        packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
            .metaData?.getString(name).orEmpty()
}

@Composable
private fun PlayerLabScreen(controller: PlayerController) {
    var uiMode by remember { mutableStateOf(UiMode.DEFAULT) }
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    androidx.compose.runtime.DisposableEffect(controller, focus) {
        controller.apiClearFocus = { focus.clearFocus(force = true) }
        onDispose { controller.apiClearFocus = {} }
    }
    val videoOnly = controller.apiFullscreen || controller.apiPictureInPicture
    androidx.activity.compose.BackHandler(enabled = controller.apiFullscreen) { controller.currentView()?.exitFullscreen() }

    Column(
        modifier = if (videoOnly) Modifier.fillMaxSize().clipToBounds().testTag("player-lab-scroll") else
            Modifier.safeDrawingPadding().clipToBounds().testTag("player-lab-scroll").verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Recreate the PlayerView when the UI mode changes — the UI is fixed at view-construction
        // time via PlayerViewConfig, so swapping factories means a fresh view (the Player persists).
        val displayedPlayer = controller.player
        val vrRenderer = controller.apiVrRenderer
        if (vrRenderer != null) key(vrRenderer) {
            AndroidView(factory = { vrRenderer }, onRelease = { it.close() },
                modifier = if (videoOnly) Modifier.fillMaxSize() else Modifier.fillMaxWidth().height(220.dp))
        } else key(displayedPlayer, uiMode, controller.apiViewRevision) {
            AndroidView(
                factory = { context ->
                    PlayerTouchHost(context,
                        controller.attachView(PlayerView(context, displayedPlayer, controller.apiOverrides.view(playerViewConfig(uiMode)))))
                },
                // Detach the shared player BEFORE releasing the view: PlayerView.onDestroy()
                // destroys its attached player, but `controller` owns the player's lifecycle
                // (it persists across UI-mode switches and is destroyed in onDestroy/release).
                onRelease = { host ->
                    host.releaseTouchOwnership()
                    controller.releaseView(host.content as PlayerView)
                },
                modifier = if (videoOnly) Modifier.fillMaxSize() else Modifier.fillMaxWidth().height(220.dp),
            )
        }
        // Keep editors composed during fullscreen/PiP so returning does not discard their drafts.
        Column(modifier = if (videoOnly) Modifier.height(0.dp) else Modifier,
            verticalArrangement = Arrangement.spacedBy(10.dp)) {

        // Player UI: the SDK default vs. our shared @showcase/ui-shared custom factories (§12).
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("UI:")
            UiMode.entries.forEach { mode ->
                Button(onClick = { uiMode = mode }, enabled = uiMode != mode) { Text(mode.label) }
            }
        }

        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Sources.all.forEach { source ->
                Button(onClick = { controller.load(source) }) { Text(source.label) }
            }
        }

        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Button(onClick = { controller.goToLiveEdge() }, enabled = controller.dvr.isLive) { Text("Live edge") }
            listOf(-10.0, -30.0, -60.0).forEach { offset ->
                Button(onClick = { controller.seek(offset) }, enabled = controller.dvr.dvrAvailable) {
                    Text("${offset.toInt()}s")
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Allow DVR")
            Switch(
                checked = controller.timeShiftEnabled, onCheckedChange = { controller.toggleDvr(it) },
                modifier = Modifier.testTag("allow-dvr"),
            )
        }

        val dvr = controller.dvr
        Text(
            "mode=${dvr.mode.raw}  dvrAvailable=${dvr.dvrAvailable}  " +
                "behindLive=${"%.1f".format(dvr.behindLive)}s  window=${"%.0f".format(dvr.windowDuration)}s",
            style = MaterialTheme.typography.bodySmall,
        )

        ConfigurationPanel(controller, uiMode)
        ApiConfigurationPanel(controller)
        controller.apiCompanionHosts.forEach { host ->
            key(host.view) {
                Text("Companion: ${host.name} (${host.width} × ${host.height})", style = MaterialTheme.typography.labelMedium)
                AndroidView(factory = { host.view }, onRelease = { (it.parent as? android.view.ViewGroup)?.removeView(it) },
                    modifier = if (host.width == -1) Modifier.fillMaxWidth().heightIn(min = 50.dp, max = 500.dp)
                        else Modifier.width(host.width.dp).height(host.height.dp))
            }
        }
        ApiRuntimePanel(controller)
        ApiOfflinePanel(controller)
        ApiAnalyticsPanel(controller)

        Column(modifier = Modifier.height(140.dp).verticalScroll(rememberScrollState())) {
            controller.log.take(12).forEach { line ->
                Text(line, style = MaterialTheme.typography.bodySmall)
            }
        }
        }
    }
}
