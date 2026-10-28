package com.playerlab.sportsstreaming

import android.content.Intent
import android.content.Context
import android.content.res.Configuration
import androidx.core.net.toUri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.os.LocaleListCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.ui.FullscreenHandler
import com.bitmovin.player.api.ui.PictureInPictureHandler
import com.bitmovin.player.casting.BitmovinCastManager
import com.bitmovin.player.ui.DefaultPictureInPictureHandler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {
    private lateinit var playback: PlaybackSession
    private lateinit var surface: PlayerSurfaceHost
    private var fullscreen by mutableStateOf(false)
    private var pictureInPicture by mutableStateOf(false)
    private var pipRequested = false
    private val export = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) {
            val text = playback.handoffs.exportJson()
            lifecycleScope.launch {
                val saved = withContext(Dispatchers.IO) {
                    runCatching { contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { it.write(text) } != null }.getOrDefault(false)
                }
                Toast.makeText(this@MainActivity, if (saved) R.string.records_saved else R.string.export_failed, Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun attachBaseContext(newBase: Context) {
        val scale = if (BuildConfig.DEBUG) DebugAppearance.fontScale else null
        // Override only the requested field; copying a full configuration would pin orientation and window size.
        val context = if (scale != null) newBase.createConfigurationContext(
            Configuration().apply { fontScale = scale }) else newBase
        super.attachBaseContext(context)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        BitmovinCastManager.getInstance().updateContext(this)
        playback = ViewModelProvider(this)[PlaybackSession::class.java]
        if (BuildConfig.DEBUG) intent.getStringExtra("mediaBaseUrl")?.let(playback::overrideMediaBaseForDebug)
        surface = PlayerSurfaceHost(this, playback.player, playback.subtitleRenderer)
        val pip = DefaultPictureInPictureHandler(this, playback.player)
        surface.configureHandlers(object : FullscreenHandler {
            override val isFullscreen get() = fullscreen
            override fun onFullscreenRequested() { applyFullscreen(true) }
            override fun onFullscreenExitRequested() { applyFullscreen(false) }
            override fun onPause() = Unit
            override fun onResume() = Unit
            override fun onDestroy() = Unit
        }, object : PictureInPictureHandler {
            override val isPictureInPicture get() = pip.isPictureInPicture
            override val isPictureInPictureAvailable get() = pip.isPictureInPictureAvailable
            override fun enterPictureInPicture() {
                pipRequested = true
                pip.enterPictureInPicture()
                Handler(Looper.getMainLooper()).postDelayed({ pipRequested = false }, 1_000)
            }
            override fun exitPictureInPicture() = pip.exitPictureInPicture()
        })
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (fullscreen) applyFullscreen(false)
                else { isEnabled = false; onBackPressedDispatcher.onBackPressed(); isEnabled = true }
            }
        })
        setContent {
            val state by playback.state.collectAsStateWithLifecycle()
            SportsTheme {
                SportsScreen(state, playback, surface, fullscreen, pictureInPicture,
                    onFullscreen = { applyFullscreen(!fullscreen) }, onPip = { surface.enterPictureInPicture() },
                    onCast = playback::toggleCasting,
                    onExport = { export.launch("sports-handoff-records.json") },
                    onAnalytics = { openUrl(BuildConfig.ANALYTICS_URL) },
                    onDashboard = { openUrl("https://dashboard.bitmovin.com/analytics/") },
                    onLanguage = { AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(it)) })
            }
        }
        if (BuildConfig.DEBUG && savedInstanceState == null) {
            intent.getStringExtra("testSourceUrl")?.let { url ->
                playback.load(url, "sports:ownership-spike", if (url.substringBefore('?').endsWith(".mpd")) SourceType.Dash else SourceType.Hls, intent.getStringExtra("testSubtitleUrl"))
            }
        }
    }
    private fun applyFullscreen(enabled: Boolean) {
        fullscreen = enabled
        WindowInsetsControllerCompat(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if (enabled) hide(WindowInsetsCompat.Type.systemBars()) else show(WindowInsetsCompat.Type.systemBars())
        }
    }
    private fun openUrl(url: String) {
        val parsed = url.toUri()
        if (parsed.scheme in listOf("http", "https")) startActivity(Intent(Intent.ACTION_VIEW, parsed))
    }
    fun playbackForTest() = playback
    fun switchUiForTest(sports: Boolean) { playback.setSportsUi(sports); surface.showUi(sports) }
    fun nativeSubtitleViewForTest() = surface.subtitleViewForTest()
    fun attachedPlayerViewCountForTest() = surface.attachedPlayerViewCount
    override fun onStart() { super.onStart(); playback.setScreenActive(true); surface.onStart() }
    override fun onResume() { super.onResume(); surface.onResume() }
    override fun onPause() {
        if (!playback.player.isCasting && !isInPictureInPictureMode && !pipRequested) playback.player.pause()
        surface.onPause()
        super.onPause()
    }
    override fun onStop() { playback.setScreenActive(isInPictureInPictureMode); surface.onStop(); super.onStop() }
    override fun onDestroy() { surface.detach(); super.onDestroy() }
    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        pictureInPicture = isInPictureInPictureMode
        surface.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    }
}
