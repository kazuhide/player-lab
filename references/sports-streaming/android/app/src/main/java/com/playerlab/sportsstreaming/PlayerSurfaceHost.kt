package com.playerlab.sportsstreaming

import android.content.Context
import android.content.res.Configuration
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import com.bitmovin.player.PlayerView
import com.bitmovin.player.SubtitleView
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.ui.PlayerViewConfig
import com.bitmovin.player.api.ui.FullscreenHandler
import com.bitmovin.player.api.ui.PictureInPictureHandler
import com.bitmovin.player.api.ui.UiConfig

/** Owns views only. The ViewModel owns and destroys the sole Player. */
class PlayerSurfaceHost(context: Context, private val player: Player) : FrameLayout(context) {
    private var playerView: PlayerView? = null
    private val subtitles = SubtitleView(context).apply {
        setPlayer(player)
        setBottomPaddingFraction(0.12f)
        setUserDefaultStyle()
        setUserDefaultTextSize()
        visibility = View.GONE
    }
    private var fullscreenHandler: FullscreenHandler? = null
    private var pipHandler: PictureInPictureHandler? = null
    private var started = false
    private var resumed = false
    var sportsUi = false
        private set
    val attachedPlayerViewCount get() = if (playerView?.player === player) 1 else 0

    init {
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
            uiConfig = if (sports) UiConfig.Disabled else UiConfig.WebUi(), enableComposeSurfaceSyncWorkaround = true))
        playerView = view
        addView(view, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        fullscreenHandler?.let(view::setFullscreenHandler)
        pipHandler?.let(view::setPictureInPictureHandler)
        view.player = player
        // Keep the renderer subscribed while hidden so a paused cue survives UI changes.
        subtitles.visibility = if (sports) View.VISIBLE else View.GONE
        if (started) view.onStart()
        if (resumed) view.onResume()
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
        subtitles.setUserDefaultTextSize()
        playerView?.onResume()
    }
    fun subtitleViewForTest() = subtitles
    fun onPause() { resumed = false; playerView?.onPause() }
    fun onStop() { started = false; playerView?.onStop() }
    fun detach() {
        subtitles.setPlayer(null)
        playerView?.let { it.player = null; it.onDestroy() }
        playerView = null
        removeAllViews()
    }
}
