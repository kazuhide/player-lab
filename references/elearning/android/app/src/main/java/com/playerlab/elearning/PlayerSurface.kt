package com.playerlab.elearning

import android.content.Context
import android.graphics.Color
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.KeyEvent
import android.view.MotionEvent
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
    var playbackBlocked = false
        set(value) {
            field = value
            playerView?.importantForAccessibility = if (value) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        }
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
        if (this.mode == mode && playerView != null) { updateCaptionPadding(); return }
        (subtitleView.parent as? ViewGroup)?.removeView(subtitleView)
        detachPlayerView()
        this.mode = mode
        val config = PlayerViewConfig(
            uiConfig = if (mode == UiMode.DEFAULT) UiConfig.WebUi(playbackSpeedSelectionEnabled = true, supplementalCssLocation = "file:///android_asset/shared-subtitles.css") else UiConfig.Disabled,
            surfaceType = SurfaceType.TextureView,
        )
        val view = PlayerView(context, player, config)
        view.setFullscreenHandler(fullscreenHandler)
        playerView = view
        view.importantForAccessibility = if (playbackBlocked) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        addView(view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        // One application-owned SDK renderer displays current cues in both control layouts.
        subtitleView.setFixedTextSize(TypedValue.COMPLEX_UNIT_DIP, 18f * resources.configuration.fontScale)
        if (subtitleView.parent == null) addView(subtitleView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.BOTTOM))
        subtitleView.bringToFront()
        subtitleView.visibility = View.VISIBLE
        subtitleView.isClickable = false
        subtitleView.isFocusable = false
        updateCaptionPadding()
        if (started) view.onStart()
        if (resumed) view.onResume()
    }

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        updateCaptionPadding()
    }

    private fun updateCaptionPadding() {
        if (height <= 0 || subtitleView.parent !== this) return
        // Keep captions above the standard controls without padding the SDK's wrapper view.
        val bottomFraction = if (mode == UiMode.DEFAULT) (context.dp(72).toFloat() / height + 0.08f).coerceAtMost(0.6f) else 0.08f
        subtitleView.setPadding(0, 0, 0, 0)
        subtitleView.setBottomPaddingFraction(bottomFraction)
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

    override fun onInterceptTouchEvent(event: MotionEvent) = playbackBlocked || super.onInterceptTouchEvent(event)
    override fun onTouchEvent(event: MotionEvent) = playbackBlocked || super.onTouchEvent(event)
    override fun dispatchKeyEvent(event: KeyEvent) = (playbackBlocked && event.keyCode != KeyEvent.KEYCODE_BACK) || super.dispatchKeyEvent(event)

    fun onStart() { started = true; playerView?.onStart() }
    fun onResume() { resumed = true; playerView?.onResume() }
    fun onPause() { resumed = false; playerView?.onPause() }
    fun onStop() { started = false; playerView?.onStop() }
    fun release() {
        checkMainThread()
        if (subtitleView.parent === this) {
            subtitleView.visibility = View.GONE
            removeView(subtitleView)
        }
        detachPlayerView()
    }
    val playerViewCount get() = (0 until childCount).count { getChildAt(it) is PlayerView }
    val subtitleViewCount get() = if (subtitleView.parent === this && subtitleView.isShown) 1 else 0
    fun requestSdkFullscreenForTest(enabled: Boolean) {
        check(BuildConfig.DEBUG)
        if (enabled) playerView?.enterFullscreen() else playerView?.exitFullscreen()
    }
}
