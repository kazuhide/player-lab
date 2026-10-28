package com.playerlab.elearning

import android.content.Context
import android.view.View
import android.widget.LinearLayout

class PlaybackProblemBanner(context: Context, private val session: PlaybackSession) : LinearLayout(context) {
    private val message = context.label(size = 14f).apply { id = R.id.playback_problem_message; setTextColor(LearningColors.error) }
    private val retry = context.action(context.getString(R.string.retry)) {
        if (session.resumeOutsideDuration) session.restartFromBeginning() else session.retry()
    }.apply { id = R.id.playback_retry }
    init {
        id = R.id.playback_problem
        orientation = VERTICAL
        addView(message)
        addView(context.row().apply {
            weighted(retry)
            weighted(context.action(context.getString(R.string.lessons)) { session.returnToCourse() }.apply { id = R.id.playback_library })
        })
    }
    fun update() {
        visibility = if (session.errorCode != null || session.captionIssue != null || session.resumeOutsideDuration) View.VISIBLE else View.GONE
        retry.setText(if (session.resumeOutsideDuration) R.string.start_over else R.string.retry)
        val issue = session.captionIssue
        message.text = when {
            session.resumeOutsideDuration -> context.getString(R.string.resume_outside_actual_duration)
            session.errorCode != null -> context.getString(R.string.error_playback)
            issue?.kind == PlaybackIssueKind.SUBTITLE_INVALID_FORMAT -> context.getString(R.string.error_caption_format)
            issue?.httpStatus != null -> context.getString(R.string.error_caption_http, issue.httpStatus)
            else -> context.getString(R.string.error_captions)
        }
    }
}
