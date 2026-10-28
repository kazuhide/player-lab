package com.playerlab.elearning

import android.content.Context
import android.view.View
import android.widget.LinearLayout

class PlaybackProblemBanner(context: Context, private val session: PlaybackSession) : LinearLayout(context) {
    private val message = context.label(size = 14f).apply { id = R.id.playback_problem_message; setTextColor(LearningColors.error) }
    init {
        id = R.id.playback_problem
        orientation = VERTICAL
        addView(message)
        addView(context.row().apply {
            weighted(context.action(context.getString(R.string.retry)) { session.retry() }.apply { id = R.id.playback_retry })
            weighted(context.action(context.getString(R.string.lessons)) { session.returnToCourse() }.apply { id = R.id.playback_library })
        })
    }
    fun update() {
        visibility = if (session.errorCode != null || session.captionIssue != null) View.VISIBLE else View.GONE
        val issue = session.captionIssue
        message.text = when {
            session.errorCode != null -> context.getString(R.string.error_playback)
            issue?.kind == PlaybackIssueKind.SUBTITLE_INVALID_FORMAT -> context.getString(R.string.error_caption_format)
            issue?.httpStatus != null -> context.getString(R.string.error_caption_http, issue.httpStatus)
            else -> context.getString(R.string.error_captions)
        }
    }
}
