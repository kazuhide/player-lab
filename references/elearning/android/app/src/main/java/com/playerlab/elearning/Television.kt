package com.playerlab.elearning

import android.content.Context
import android.content.res.Configuration
import android.view.KeyEvent
import android.view.View

internal val Context.isTelevision: Boolean
    get() = resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION

/** Return the D-pad from the SDK's spatial navigation to the application's controls. */
internal fun View.leaveTelevisionPlayer(): Boolean {
    if (!context.isTelevision || !hasFocus()) return false
    dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE))
    dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE))
    clearFocus()
    return true
}

private val transportKeys = setOf(
    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE,
    KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
)

internal fun PlaybackSession.handleTransportKey(event: KeyEvent): Boolean {
    if (event.keyCode !in transportKeys || screen != AppScreen.LESSON || !playbackReady) return false
    // Consume repeats and key-up so a single press applies exactly one command.
    if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0) return true
    when (event.keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> setPlaying(!player.isPlaying)
        KeyEvent.KEYCODE_MEDIA_PLAY -> setPlaying(true)
        KeyEvent.KEYCODE_MEDIA_PAUSE -> setPlaying(false)
        KeyEvent.KEYCODE_MEDIA_REWIND -> seekBy(-10_000L)
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> seekBy(10_000L)
    }
    return true
}
