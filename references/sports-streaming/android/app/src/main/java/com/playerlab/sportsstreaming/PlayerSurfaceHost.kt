package com.playerlab.sportsstreaming

import android.content.Context
import android.content.res.Configuration
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.bitmovin.player.PlayerView
import com.bitmovin.player.SubtitleView
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.ui.PlayerViewConfig
import com.bitmovin.player.api.ui.FullscreenHandler
import com.bitmovin.player.api.ui.PictureInPictureHandler
import com.bitmovin.player.api.ui.UiConfig

/** Owns views only. The ViewModel owns and destroys the sole Player. */
class PlayerSurfaceHost(context: Context, private val player: Player, private val subtitles: SubtitleView) : FrameLayout(context) {
    private var playerView: PlayerView? = null
    private var fullscreenHandler: FullscreenHandler? = null
    private var pipHandler: PictureInPictureHandler? = null
    private var started = false
    private var resumed = false
    var sportsUi = false
        private set
    val attachedPlayerViewCount get() = if (playerView?.player === player) 1 else 0

    init {
        (subtitles.parent as? ViewGroup)?.removeView(subtitles)
        subtitles.isClickable = false
        subtitles.isFocusable = false
        addView(subtitles, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.BOTTOM))
        showUi(false)
    }

    fun showUi(sports: Boolean) {
        if (playerView != null && sports == sportsUi) return
        playerView?.let { old ->
            // Retired view lifecycle methods forward to their attached Player, including pause and destruction.
            // Detach first so changing controls cannot change the shared Player's lifecycle or play intent.
            old.player = null
            if (resumed) old.onPause()
            if (started) old.onStop()
            // https://cdn.bitmovin.com/player/android/3/docs/player-ui-web/com.bitmovin.player/-player-view/player.html
            old.onDestroy()
            removeView(old)
        }
        sportsUi = sports
        val view = PlayerView(context, null, PlayerViewConfig(
            uiConfig = if (sports) UiConfig.Disabled else UiConfig.WebUi(
                supplementalCssLocation = "file:///android_asset/shared-subtitles.css"), enableComposeSurfaceSyncWorkaround = true))
        playerView = view
        addView(view, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        fullscreenHandler?.let(view::setFullscreenHandler)
        pipHandler?.let(view::setPictureInPictureHandler)
        view.player = player
        // One SDK renderer keeps the active cue visible when replacing the HTML controls.
        subtitles.visibility = View.VISIBLE
        subtitles.bringToFront()
        updateSubtitlePlacement()
        if (started) view.onStart()
        if (resumed) view.onResume()
    }
    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        updateSubtitlePlacement()
    }
    private fun updateSubtitlePlacement() {
        if (subtitles.parent !== this) return
        // A tall letterboxed surface must not enlarge text with its entire height.
        subtitles.setFixedTextSize(TypedValue.COMPLEX_UNIT_DIP, 18f * resources.configuration.fontScale)
        if (height <= 0) return
        // Use the renderer API; padding its wrapper can hide all caption glyphs.
        val controlHeight = 72f * resources.displayMetrics.density
        val bottom = if (sportsUi) 0.12f else (controlHeight / height + 0.08f).coerceAtMost(0.6f)
        subtitles.setBottomPaddingFraction(bottom)
    }
    fun configureHandlers(fullscreen: FullscreenHandler, pip: PictureInPictureHandler) {
        fullscreenHandler = fullscreen
        pipHandler = pip
        playerView?.setFullscreenHandler(fullscreen)
        playerView?.setPictureInPictureHandler(pip)
    }
    fun enterPictureInPicture() { playerView?.enterPictureInPicture() }
    fun onPictureInPictureModeChanged(enabled: Boolean, config: Configuration) {
        playerView?.onPictureInPictureModeChanged(enabled, config)
    }
    fun onStart() { started = true; playerView?.onStart() }
    fun onResume() {
        resumed = true
        subtitles.setUserDefaultStyle()
        updateSubtitlePlacement()
        playerView?.onResume()
    }
    fun subtitleViewForTest() = subtitles
    fun onPause() { resumed = false; playerView?.onPause() }
    fun onStop() { started = false; playerView?.onStop() }
    fun detach() {
        if (subtitles.parent === this) removeView(subtitles)
        playerView?.let { it.player = null; it.onDestroy() }
        playerView = null
        removeAllViews()
    }
}
