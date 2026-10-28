package com.playerlab.elearning

import android.app.AlertDialog
import android.content.Context

fun showPlaybackSettings(context: Context, session: PlaybackSession) {
    val choices = arrayOf(context.getString(R.string.caption_settings), context.getString(R.string.speed))
    AlertDialog.Builder(context).setTitle(R.string.settings).setItems(choices) { _, index ->
        if (index == 0) {
            val tracks = session.player.source?.availableSubtitleTracks.orEmpty()
            val captions = arrayOf(context.getString(R.string.off)) + tracks.map { it.label ?: it.language ?: it.id }
            val selectedId = session.player.source?.selectedSubtitleTrack?.id
            val current = tracks.indexOfFirst { it.id == selectedId } + 1
            AlertDialog.Builder(context).setTitle(R.string.caption_settings).setSingleChoiceItems(captions, current) { dialog, selected ->
                val track = tracks.getOrNull(selected - 1)
                session.setSubtitle(if (track == null) session.preferences.subtitle.copy(enabled = false)
                    else SubtitlePreference(true, track.language ?: "en", track.roles.firstOrNull()?.value ?: "subtitle"))
                dialog.dismiss()
            }.setNegativeButton(R.string.cancel, null).show()
        } else {
            val speeds = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)
            AlertDialog.Builder(context).setTitle(R.string.speed).setSingleChoiceItems(speeds.map { "${it}×" }.toTypedArray(),
                speeds.indexOf(session.player.playbackSpeed)) { dialog, selected -> session.setSpeed(speeds[selected]); dialog.dismiss() }
                .setNegativeButton(R.string.cancel, null).show()
        }
    }.setNegativeButton(R.string.cancel, null).show()
}
