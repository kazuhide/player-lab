package com.playerlab.elearning

import android.content.Context
import android.widget.LinearLayout
import android.widget.SeekBar

class LearningControls(context: Context, private val session: PlaybackSession, settings: () -> Unit, fullscreen: () -> Unit) : LinearLayout(context) {
    private val play = context.iconAction(R.drawable.ic_play, R.string.play) { if (session.player.isPlaying) session.player.pause() else session.player.play() }.apply { id = R.id.learning_play }
    private val time = context.label(size = 14f)
    private val slider = SeekBar(context).apply {
        id = R.id.learning_position
        contentDescription = context.getString(R.string.seek_position)
        minimumHeight = context.dp(48)
        max = 1000
    }
    private var dragging = false
    private var lastPlaying: Boolean? = null
    private val full = context.iconAction(R.drawable.ic_fullscreen, R.string.fullscreen, onClick = fullscreen).apply { id = R.id.learning_fullscreen }

    init {
        orientation = VERTICAL
        addView(context.row().apply {
            addView(time)
            weighted(slider)
            (slider.layoutParams as LayoutParams).height = context.dp(48)
            addView(play)
        })
        addView(context.row().apply {
            weighted(context.action("−10") { session.seek((session.positionMs - 10_000).coerceAtLeast(0)) }
                .apply { id = R.id.learning_backward; contentDescription = context.getString(R.string.seek_backward) })
            weighted(context.action("+10") { session.seek(session.positionMs + 10_000) }
                .apply { id = R.id.learning_forward; contentDescription = context.getString(R.string.seek_forward) })
            addView(context.iconAction(R.drawable.ic_settings, R.string.settings, onClick = settings).apply { id = R.id.learning_settings })
            addView(full)
        })
        slider.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(seekBar: SeekBar) { dragging = true }
            override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) {}
            override fun onStopTrackingTouch(seekBar: SeekBar) {
                dragging = false
                val duration = session.player.duration
                if (duration.isFinite() && duration > 0) session.seek((seekBar.progress / 1000.0 * duration * 1000).toLong())
            }
        })
    }

    fun update() {
        val duration = session.player.duration.takeIf { it.isFinite() && it > 0 }?.times(1000)?.toLong() ?: 0L
        val timeText = if (resources.configuration.fontScale > 1.3) "${formatTime(session.positionMs)}\n${formatTime(duration)}"
            else context.getString(R.string.playback_time, formatTime(session.positionMs), formatTime(duration))
        if (time.text.toString() != timeText) time.text = timeText
        if (lastPlaying != session.player.isPlaying) {
            lastPlaying = session.player.isPlaying
            play.setImageResource(if (session.player.isPlaying) R.drawable.ic_pause else R.drawable.ic_play)
            play.contentDescription = context.getString(if (session.player.isPlaying) R.string.pause else R.string.play)
        }
        full.contentDescription = context.getString(if (session.viewState.fullscreen) R.string.exit_fullscreen else R.string.fullscreen)
        slider.isEnabled = duration > 0 && session.errorCode == null
        play.isEnabled = duration > 0 && session.errorCode == null
        if (!dragging) slider.progress = if (duration > 0) (session.positionMs * 1000 / duration).toInt() else 0
    }
}
