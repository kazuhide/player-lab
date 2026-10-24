package com.playerlab.android

import android.content.Context
import android.content.res.Configuration
import android.view.KeyEvent
import androidx.activity.OnBackPressedCallback

/** Return from SDK spatial navigation without changing the current player, source or drafts. */
internal fun MainActivity.installTelevisionBackNavigation() {
    if (!televisionInput()) return
    val activity = this
    val dispatcher = onBackPressedDispatcher
    dispatcher.addCallback(this, object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val controller = activity.controller
            val view = controller.currentView()
            if (!controller.apiFullscreen && !controller.apiPictureInPicture && view?.hasFocus() == true) {
                // The SDK TV UI closes and resets its menu on Escape key-up. Deliver both before leaving its view.
                view.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE))
                view.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE))
                view.clearFocus()
                controller.requestWorkspaceFocus()
            } else {
                isEnabled = false
                try { dispatcher.onBackPressed() } finally { isEnabled = true }
            }
        }
    })
}

/** An active SDK MediaSession already owns the system media-key route. */
internal fun Context.handleTelevisionMediaKey(controller: PlayerController, event: KeyEvent): Boolean {
    if (!televisionInput()) return false
    when (event.keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> Unit
        else -> return false
    }
    if (controller.apiMediaSession?.isReleased == false) return false
    val player = controller.player
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 && !player.isDestroyed) {
        when (event.keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> if (player.isPlaying) player.pause() else player.play()
            KeyEvent.KEYCODE_MEDIA_PLAY -> player.play()
            KeyEvent.KEYCODE_MEDIA_PAUSE -> player.pause()
        }
    }
    // Consume key-up and repeats as part of the same fallback press.
    return true
}

private fun Context.televisionInput(): Boolean =
    resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION
