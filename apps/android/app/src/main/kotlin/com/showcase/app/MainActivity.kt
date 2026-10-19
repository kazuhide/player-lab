package com.showcase.app

import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.bitmovin.analytics.api.AnalyticsConfig
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.analytics.AnalyticsPlayerConfig
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.ui.PlayerViewConfig
import com.bitmovin.player.api.ui.UiConfig
import com.showcase.dvr.Dvr
import com.showcase.dvr.DvrConfig
import com.showcase.dvr.DvrState
import com.showcase.dvr.PlayerSnapshot

/**
 * Which UI renders over the player. `DEFAULT` is the SDK's own Web UI (loaded from Bitmovin's
 * CDN); the rest load our shared `@showcase/ui-shared` bundle (synced into assets/ — see
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
 * Build a [PlayerViewConfig] for a [UiMode]. `DEFAULT` uses the SDK default (CDN Web UI); the
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
 * as Compose state. Compiles against Bitmovin Player 3.155.0 — `:app:assembleDebug`
 * produces a debug APK (built in CI). On-device DVR behaviour still needs a real
 * device and a license-allow-listed build.
 */
class PlayerController(context: Context, licenseKey: String, analyticsLicenseKey: String = "") {
    // §15: the bundled analytics collector reports QoE to the Bitmovin dashboard
    // when a key is configured (repo-root .env → sync-env.sh → local.properties).
    val player: Player =
        if (analyticsLicenseKey.isEmpty()) {
            Player(context, PlayerConfig(key = licenseKey))
        } else {
            Player(
                context,
                PlayerConfig(key = licenseKey),
                AnalyticsPlayerConfig.Enabled(AnalyticsConfig(licenseKey = analyticsLicenseKey)),
            )
        }

    var dvr: DvrState by mutableStateOf(Dvr.deriveState(snapshot(), DvrConfig(timeShiftEnabled = true)))
        private set
    var timeShiftEnabled: Boolean by mutableStateOf(true)
        private set
    val log = mutableStateListOf<String>()
    var lastErrorCode: Int? by mutableStateOf(null)
        private set

    init {
        player.on(PlayerEvent.Error::class) { lastErrorCode = it.code.value; append("PlayerError ${it.code.value}") }
        player.on(SourceEvent.Error::class) { lastErrorCode = it.code.value; append("SourceError ${it.code.value}") }
        player.on(PlayerEvent.TimeChanged::class) { refresh() }
        player.on(SourceEvent.Loaded::class) { lastErrorCode = null; append("SourceLoaded"); refresh() }
        player.on(PlayerEvent.TimeShifted::class) { append("TimeShifted"); refresh() }
        // §5.3: recover from DVRWindowExceeded by snapping to the live edge.
        player.on(PlayerEvent.DvrWindowExceeded::class) {
            append("DVRWindowExceeded → recover")
            player.timeShift(0.0)
        }
    }

    fun load(source: ShowcaseSource) {
        append("load ${source.label}")
        player.load(source.toSourceConfig())
    }

    fun goToLiveEdge() {
        player.timeShift(0.0)
    }

    fun seek(offsetFromEdge: Double) {
        player.timeShift(if (timeShiftEnabled) Dvr.clampToWindow(offsetFromEdge, player.maxTimeShift) else 0.0)
    }

    fun toggleDvr(enabled: Boolean) {
        timeShiftEnabled = enabled
        refresh()
    }

    fun release() {
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
        dvr = Dvr.deriveState(snapshot(), DvrConfig(timeShiftEnabled = timeShiftEnabled))
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
        controller = PlayerController(this, licenseKey(), analyticsLicenseKey())
        setContent { MaterialTheme { ShowcaseScreen(controller) } }
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
private fun ShowcaseScreen(controller: PlayerController) {
    var uiMode by remember { mutableStateOf(UiMode.DEFAULT) }

    Column(
        modifier = Modifier.padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Recreate the PlayerView when the UI mode changes — the UI is fixed at view-construction
        // time via PlayerViewConfig, so swapping factories means a fresh view (the Player persists).
        key(uiMode) {
            AndroidView(
                factory = { context -> PlayerView(context, controller.player, playerViewConfig(uiMode)) },
                // Detach the shared player BEFORE releasing the view: PlayerView.onDestroy()
                // destroys its attached player, but `controller` owns the player's lifecycle
                // (it persists across UI-mode switches and is destroyed in onDestroy/release).
                onRelease = {
                    it.player = null
                    it.onDestroy()
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
            Button(onClick = { controller.goToLiveEdge() }) { Text("Live edge") }
            listOf(-10.0, -30.0, -60.0).forEach { offset ->
                Button(onClick = { controller.seek(offset) }, enabled = controller.dvr.dvrAvailable) {
                    Text("${offset.toInt()}s")
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Allow DVR")
            Switch(checked = controller.timeShiftEnabled, onCheckedChange = { controller.toggleDvr(it) })
        }

        val dvr = controller.dvr
        Text(
            "mode=${dvr.mode.raw}  dvrAvailable=${dvr.dvrAvailable}  " +
                "behindLive=${"%.1f".format(dvr.behindLive)}s  window=${"%.0f".format(dvr.windowDuration)}s",
            style = MaterialTheme.typography.bodySmall,
        )

        Column(modifier = Modifier.height(140.dp).verticalScroll(rememberScrollState())) {
            controller.log.take(12).forEach { line ->
                Text(line, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
