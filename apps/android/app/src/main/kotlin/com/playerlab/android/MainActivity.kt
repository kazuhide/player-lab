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
import com.bitmovin.analytics.api.AnalyticsConfig
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.analytics.AnalyticsPlayerConfig
import com.bitmovin.player.api.event.Event
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.source.Source
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.ui.PlayerViewConfig
import com.bitmovin.player.api.ui.UiConfig
import com.playerlab.android.dvr.Dvr
import com.playerlab.android.dvr.DvrConfig
import com.playerlab.android.dvr.DvrState
import com.playerlab.android.dvr.PlayerSnapshot
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
 * Holds the Bitmovin Player and exposes DVR state (via the `:dvr` Kotlin module)
 * as Compose state. Compiles against Bitmovin Player 3.171.0 — `:app:assembleDebug`
 * produces a debug APK (built in CI). On-device DVR behaviour still needs a real
 * device and a license-allow-listed build.
 */
internal class PlayerController(
    private val context: Context,
    private val licenseKey: String,
    private val analyticsLicenseKey: String = "",
    private val playerFactory: ((PlayerConfig) -> Player)? = null,
    private val sourceFactory: (SourceConfig) -> Source = { Source(it) },
    lifecycle: Lifecycle,
) {
    // §15: the bundled analytics collector reports QoE to the Bitmovin dashboard
    // when a key is configured (repo-root .env → sync-env.sh → local.properties).
    private fun createPlayer(settings: PlayerSettings, overrides: ApiOverrides = ApiOverrides()): Player {
        val config = overrides.player(settings.toPlayerConfig(licenseKey))
        return playerFactory?.invoke(config) ?: if (analyticsLicenseKey.isEmpty()) {
            Player(context, config)
        } else {
            Player(
                context,
                config,
                AnalyticsPlayerConfig.Enabled(AnalyticsConfig(licenseKey = analyticsLicenseKey)),
            )
        }
    }

    var player: Player by mutableStateOf(createPlayer(PlayerSettings()))
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
    private val viewLifecycle = PlayerViewLifecycle(lifecycle)
    private val playerSubscriptions = mutableListOf<() -> Unit>()
    private var sourceSubscription: (() -> Unit)? = null
    private val apiMain = android.os.Handler(android.os.Looper.getMainLooper())
    private var apiQuerySequence = 0L
    private var apiQueryTimeout: Runnable? = null
    internal val apiEvents = androidx.compose.runtime.mutableStateMapOf<String, Int>()
    internal val apiEventTimes = androidx.compose.runtime.mutableStateMapOf<String, Long>()
    internal val apiSsaiAds = androidx.compose.runtime.mutableStateMapOf<String, com.bitmovin.player.api.ssai.SsaiAd>()
    internal val apiSsaiBreaks = androidx.compose.runtime.mutableStateMapOf<String, com.bitmovin.player.api.ssai.SsaiAdBreak>()
    internal var apiSelectedSsaiAd: String? by mutableStateOf(null)
    internal var apiSelectedSsaiBreak: String? by mutableStateOf(null)
    internal var apiEventRecording by mutableStateOf(true)
    internal var apiAsyncResult by mutableStateOf("")
        private set
    internal fun currentView(): PlayerView? = views.firstOrNull { it.player === player }
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
        val query = apiQuerySequence
        fun ownsQuery() = !released && player === owner && generation == playerGeneration &&
            source == sourceGeneration && query == apiQuerySequence
        apiAsyncResult = "Waiting for target playback latency."
        val timeout = Runnable {
            if (ownsQuery()) {
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
                    if (ownsQuery()) {
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

    var dvr: DvrState by mutableStateOf(Dvr.deriveState(snapshot(), DvrConfig(timeShiftEnabled = true)))
        private set
    var timeShiftEnabled: Boolean by mutableStateOf(true)
        private set
    val log = mutableStateListOf<String>()
    var lastErrorCode: Int? by mutableStateOf(null)
        private set

    init {
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
        sourceSettings = SourceSettings.from(source)
        // Also replace a dirty editor when the same catalog preset is selected again.
        sourceRevision++
        append("load ${source.label}")
        loadCurrentSource()
    }

    internal fun applySource(settings: SourceSettings) {
        if (released) return
        sourceSettings = settings
        sourceRevision++
        loadCurrentSource()
        configurationStatus = "Source applied; current player reloaded."
        append("Source configuration applied")
    }

    private fun loadCurrentSource() {
        invalidateApiQuery()
        sourceSubscription?.invoke()
        val owner = player
        val generation = ++sourceGeneration
        val source = sourceFactory(apiOverrides.source(sourceSettings.toSourceConfig()))
        configuredSource = source
        fun ownsSource() = !released && player === owner && sourceGeneration == generation
        val error: (SourceEvent.Error) -> Unit = {
            if (ownsSource()) { lastErrorCode = it.code.value; append("SourceError ${it.code.value}") }
        }
        val loaded: (SourceEvent.Loaded) -> Unit = {
            if (ownsSource()) { append("SourceLoaded"); refresh() }
        }
        source.on(SourceEvent.Error::class, error)
        source.on(SourceEvent.Loaded::class, loaded)
        val apiSubscriptions = ApiEvents.source.map { entry ->
            entry.subscribe(source) { id, timestamp -> apiEvent(id, timestamp, ::ownsSource) }
        }
        sourceSubscription = {
            source.off(SourceEvent.Error::class, error)
            source.off(SourceEvent.Loaded::class, loaded)
            apiSubscriptions.forEach { it() }
        }
        lastErrorCode = null
        owner.load(source)
        refresh()
    }

    internal fun applyPlayerSettings(settings: PlayerSettings, overrides: ApiOverrides = apiOverrides) {
        if (released) return
        // PlayerConfig and its nested configs are fixed at construction time in SDK 3.171.0.
        // https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api/-player-config/index.html
        val replacement = runCatching { createPlayer(settings, overrides) }.getOrElse {
            configurationStatus = "Unable to create a player; current settings kept."
            append("Player recreation failed")
            return
        }
        playerGeneration++
        sourceGeneration++
        sourceSubscription?.invoke()
        sourceSubscription = null
        playerSubscriptions.forEach { it() }
        playerSubscriptions.clear()
        val previous = player
        // Detach synchronously, even if another Apply occurs before Compose disposes the old view.
        views.forEach { viewLifecycle.detach(it); it.player = null }
        player = replacement
        playerSettings = settings
        apiOverrides = overrides
        invalidateApiQuery()
        apiSsaiAds.clear()
        apiSsaiBreaks.clear()
        apiSelectedSsaiAd = null
        apiSelectedSsaiBreak = null
        observePlayer()
        previous.destroy()
        loadCurrentSource()
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
        player.timeShift(if (timeShiftEnabled && playerSettings.timeShift) Dvr.clampToWindow(offsetFromEdge, player.maxTimeShift) else 0.0)
    }

    fun toggleDvr(enabled: Boolean) {
        if (released) return
        timeShiftEnabled = enabled
        refresh()
    }

    fun release() {
        if (released) return
        released = true
        invalidateApiQuery()
        apiMain.removeCallbacksAndMessages(null)
        apiSsaiAds.clear()
        apiSsaiBreaks.clear()
        apiSelectedSsaiAd = null
        apiSelectedSsaiBreak = null
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
        dvr = Dvr.deriveState(snapshot(), DvrConfig(timeShiftEnabled = timeShiftEnabled && playerSettings.timeShift))
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

    private fun licenseKey(): String = metaData("BITMOVIN_PLAYER_LICENSE_KEY")

    private fun analyticsLicenseKey(): String = metaData("BITMOVIN_ANALYTICS_LICENSE_KEY")

    private fun metaData(name: String): String =
        packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
            .metaData?.getString(name).orEmpty()
}

@Composable
private fun PlayerLabScreen(controller: PlayerController) {
    var uiMode by remember { mutableStateOf(UiMode.DEFAULT) }

    Column(
        modifier = Modifier.safeDrawingPadding().clipToBounds().testTag("player-lab-scroll")
            .verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Recreate the PlayerView when the UI mode changes — the UI is fixed at view-construction
        // time via PlayerViewConfig, so swapping factories means a fresh view (the Player persists).
        val displayedPlayer = controller.player
        key(displayedPlayer, uiMode) {
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
                modifier = Modifier.fillMaxWidth().height(220.dp),
            )
        }

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
        ApiRuntimePanel(controller)

        Column(modifier = Modifier.height(140.dp).verticalScroll(rememberScrollState())) {
            controller.log.take(12).forEach { line ->
                Text(line, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
