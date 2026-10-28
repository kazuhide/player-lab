package com.playerlab.elearning

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import com.bitmovin.player.PlayerView
import com.bitmovin.player.SubtitleView
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.ui.PlayerViewConfig
import com.bitmovin.player.api.ui.SurfaceType
import com.bitmovin.player.api.ui.UiConfig
import com.bitmovin.player.api.ui.FullscreenHandler

class PlayerSurface(context: Context, private val player: Player, private val subtitleView: SubtitleView) : FrameLayout(context) {
    private var playerView: PlayerView? = null
    private var started = false
    private var resumed = false
    private var mode: UiMode? = null
    var fullscreen = false
    var onFullscreenRequested: ((Boolean) -> Unit)? = null
    private val fullscreenHandler = object : FullscreenHandler {
        override val isFullscreen get() = fullscreen
        override fun onFullscreenRequested() { onFullscreenRequested?.invoke(true) }
        override fun onFullscreenExitRequested() { onFullscreenRequested?.invoke(false) }
        override fun onPause() {}
        override fun onResume() {}
        override fun onDestroy() {}
    }

    init { setBackgroundColor(Color.BLACK) }

    fun show(mode: UiMode) {
        checkMainThread()
        if (this.mode == mode && playerView != null) return
        detachPlayerView()
        this.mode = mode
        val config = PlayerViewConfig(
            uiConfig = if (mode == UiMode.DEFAULT) UiConfig.WebUi(playbackSpeedSelectionEnabled = true) else UiConfig.Disabled,
            surfaceType = SurfaceType.TextureView,
        )
        val view = PlayerView(context, player, config)
        view.setFullscreenHandler(fullscreenHandler)
        playerView = view
        addView(view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        // Keep this one SDK renderer subscribed while hidden so an in-progress cue survives a UI-only switch.
        subtitleView.setFractionalTextSize(0.0533f * resources.configuration.fontScale)
        if (subtitleView.parent == null) addView(subtitleView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.BOTTOM))
        subtitleView.bringToFront()
        subtitleView.visibility = if (mode == UiMode.LEARNING) View.VISIBLE else View.GONE
        if (started) view.onStart()
        if (resumed) view.onResume()
    }

    private fun detachPlayerView() {
        playerView?.let {
            // A PlayerView destroys its attached player. Detach before destroying the old view.
            it.player = null
            it.onDestroy()
            removeView(it)
        }
        playerView = null
    }

    fun onStart() { started = true; playerView?.onStart() }
    fun onResume() { resumed = true; playerView?.onResume() }
    fun onPause() { resumed = false; playerView?.onPause() }
    fun onStop() { started = false; playerView?.onStop() }
    fun release() {
        checkMainThread()
        subtitleView.visibility = View.GONE
        removeView(subtitleView)
        detachPlayerView()
    }
    val playerViewCount get() = (0 until childCount).count { getChildAt(it) is PlayerView }
    val subtitleViewCount get() = (0 until childCount).count { getChildAt(it) is SubtitleView && getChildAt(it).visibility == View.VISIBLE }
    fun requestSdkFullscreenForTest(enabled: Boolean) {
        check(BuildConfig.DEBUG)
        if (enabled) playerView?.enterFullscreen() else playerView?.exitFullscreen()
    }
}
