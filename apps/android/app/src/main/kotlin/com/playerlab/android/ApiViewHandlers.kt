package com.playerlab.android

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.Build
import android.util.Rational
import android.webkit.JavascriptInterface
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.ui.FullscreenHandler
import com.bitmovin.player.api.ui.PictureInPictureHandler
import com.bitmovin.player.ui.CustomMessageHandler

internal fun Context.apiActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.apiActivity()
    else -> null
}

/** Host window behavior is installed explicitly; the SDK remains responsible for requesting transitions. */
internal class ApiFullscreenHandler(
    private val activity: Activity,
    private val owns: () -> Boolean,
    private val changed: (Boolean) -> Unit,
) : FullscreenHandler {
    override var isFullscreen = false
        private set
    private var closed = false
    private fun show(fullscreen: Boolean) {
        if (android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
            activity.runOnUiThread { show(fullscreen) }
            return
        }
        if (closed || !owns()) return
        update(fullscreen)
    }
    private fun update(fullscreen: Boolean) {
        isFullscreen = fullscreen
        changed(fullscreen)
        WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if (fullscreen) hide(WindowInsetsCompat.Type.systemBars()) else show(WindowInsetsCompat.Type.systemBars())
        }
    }
    override fun onFullscreenRequested() = show(true)
    override fun onFullscreenExitRequested() = show(false)
    override fun onResume() { if (isFullscreen) show(true) }
    override fun onPause() = Unit
    override fun onDestroy() = close()
    fun close() { if (!closed) { if (isFullscreen) update(false); closed = true } }
}

internal class ApiPictureInPictureHandler(
    private val activity: Activity,
    private val view: PlayerView,
    private val width: Int,
    private val height: Int,
    private val owns: () -> Boolean,
) : PictureInPictureHandler {
    override val isPictureInPictureAvailable: Boolean
        get() = Build.VERSION.SDK_INT >= 26 && activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    override val isPictureInPicture: Boolean
        get() = isPictureInPictureAvailable && activity.isInPictureInPictureMode
    override fun enterPictureInPicture() {
        check(owns()) { "The PlayerView has been retired." }
        check(isPictureInPictureAvailable) { "Picture in picture is unavailable on this device." }
        if (Build.VERSION.SDK_INT >= 26 && !isPictureInPicture) {
            val source = Rect()
            view.getGlobalVisibleRect(source)
            val params = PictureInPictureParams.Builder().setAspectRatio(Rational(width, height))
            if (!source.isEmpty) params.setSourceRectHint(source)
            check(activity.enterPictureInPictureMode(params.build())) { "Android declined picture in picture." }
        }
    }
    override fun exitPictureInPicture() {
        if (owns() && isPictureInPicture) activity.startActivity(
            Intent(activity, activity.javaClass).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }
}

/** The bridge exposes only a named message endpoint; it does not provide arbitrary JavaScript evaluation. */
internal class ApiCustomMessages(reply: String, private val received: (String) -> Unit) {
    private val reply = reply.take(2048)
    val handler = CustomMessageHandler(this)
    @JavascriptInterface fun playerLabMessage(data: String): String {
        received(data.take(2048))
        return reply
    }
}
