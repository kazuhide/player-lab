package com.playerlab.elearning

import android.content.Context
import android.graphics.Color
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView

class LessonScreen(
    context: Context, private val session: PlaybackSession,
    private val openLesson: (String) -> Unit, private val fullscreen: (Boolean) -> Unit,
) : LinearLayout(context) {
    val surface = PlayerSurface(context, session.player, session.subtitleRenderer)
    private val modes = context.row()
    private val default = context.action(context.getString(R.string.default_ui)) { setMode(UiMode.DEFAULT) }
    private val learning = context.action(context.getString(R.string.learning_ui)) { setMode(UiMode.LEARNING) }
    private val controls = LearningControls(context, session, { showPlaybackSettings(context, session) }) { fullscreen(!session.viewState.fullscreen) }
    private val video = VideoFrame(context).apply { addView(surface, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)) }
    private val playerPane = context.column()
    private val details = context.column()
    private val body = context.row()
    private val transcript = TranscriptPanel(context, session)
    private val lessons = context.column()
    private val lessonScroll = ScrollView(context).apply { addView(lessons) }
    private val lessonTab = context.action(context.getString(R.string.lessons)) { session.viewState.panel = LessonPanel.LESSONS; update() }
    private val transcriptTab = context.action(context.getString(R.string.transcript)) { session.viewState.panel = LessonPanel.TRANSCRIPT; update() }
    private val previous = context.action(context.getString(R.string.previous)) { session.adjacent(-1) }
    private val next = context.action(context.getString(R.string.next)) { session.adjacent(1) }
    private val status = context.label(size = 13f)
    private val error = PlaybackProblemBanner(context, session)
    private val footer = context.column()
    private var lessonKey: Pair<Catalog?, String?>? = null
    private var layoutState: Pair<Boolean, Boolean>? = null
    private var searching = false
    private val wide = resources.configuration.screenWidthDp >= 760

    init {
        orientation = VERTICAL
        isFocusableInTouchMode = true
        requestFocus()
        setPadding(context.dp(12), context.dp(8), context.dp(12), context.dp(8))
        modes.weighted(default); modes.weighted(learning)
        playerPane.addView(modes)
        playerPane.addView(video, if (wide) LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f) else LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        playerPane.addView(controls)
        playerPane.addView(error)
        details.addView(context.row().apply { weighted(lessonTab); weighted(transcriptTab) })
        details.addView(FrameLayout(context).apply {
            addView(lessonScroll, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            addView(transcript, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
        if (wide) {
            body.weighted(playerPane)
            body.weighted(details)
            (playerPane.layoutParams as LayoutParams).height = LayoutParams.MATCH_PARENT
            (details.layoutParams as LayoutParams).height = LayoutParams.MATCH_PARENT
            addView(body, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
        } else {
            addView(playerPane)
            addView(details, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
        }
        footer.addView(status)
        footer.addView(context.row().apply { weighted(previous); weighted(next) })
        addView(footer)
        surface.onFullscreenRequested = fullscreen
        transcript.onSearchFocusChanged = { focused ->
            searching = focused
            if (!focused) requestFocus()
            update()
        }
        update()
    }

    private fun setMode(mode: UiMode) { session.uiMode = mode; update() }
    fun update() {
        surface.show(session.uiMode)
        surface.fullscreen = session.viewState.fullscreen
        controls.visibility = if (session.uiMode == UiMode.LEARNING && (!searching || session.viewState.fullscreen)) View.VISIBLE else View.GONE
        controls.update()
        styleSelection(default, session.uiMode == UiMode.DEFAULT)
        styleSelection(learning, session.uiMode == UiMode.LEARNING)
        styleSelection(lessonTab, session.viewState.panel == LessonPanel.LESSONS)
        styleSelection(transcriptTab, session.viewState.panel == LessonPanel.TRANSCRIPT)
        transcript.visibility = if (session.viewState.panel == LessonPanel.TRANSCRIPT) View.VISIBLE else View.GONE
        lessonScroll.visibility = if (session.viewState.panel == LessonPanel.LESSONS) View.VISIBLE else View.GONE
        if (transcript.visibility == View.VISIBLE) transcript.update()
        error.update()
        val catalog = session.catalog
        val id = session.activeItem?.lesson?.id
        previous.isEnabled = catalog != null && id != null && catalog.adjacent(session.courseId, id, -1) != null
        next.isEnabled = catalog != null && id != null && catalog.adjacent(session.courseId, id, 1) != null
        status.text = context.getString(R.string.auto_advance_status, context.getString(if (session.preferences.autoAdvance) R.string.on else R.string.off))
        val key = Pair(catalog, id)
        if (key != lessonKey) {
            lessonKey = key
            lessons.removeAllViews()
            catalog?.course(session.courseId)?.lessonIds?.forEach { lessonId ->
                val item = catalog.lesson(lessonId)
                lessons.addView(context.action("${item.localizedTitle(context)}\n${formatTime(item.durationMs)}") {
                    if (lessonId != session.activeItem?.lesson?.id) openLesson(lessonId)
                }.apply {
                    if (lessonId == id) background = context.rounded(LearningColors.selected, LearningColors.primary)
                    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { topMargin = context.dp(6) }
                })
            }
        }
        applyFullscreen()
    }

    private fun applyFullscreen() {
        val full = session.viewState.fullscreen
        val key = Pair(full, searching)
        if (key == layoutState) return
        layoutState = key
        modes.visibility = if (full || searching) View.GONE else View.VISIBLE
        details.visibility = if (full) View.GONE else View.VISIBLE
        footer.visibility = if (full || searching) View.GONE else View.VISIBLE
        video.fill = wide || full
        video.compact = searching && !full
        if (!wide) {
            playerPane.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, if (full) 0 else LayoutParams.WRAP_CONTENT, if (full) 1f else 0f)
            video.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, if (full) 0 else LayoutParams.WRAP_CONTENT, if (full) 1f else 0f)
        }
        video.requestLayout()
    }

    private fun styleSelection(button: android.widget.Button, selected: Boolean) {
        if (button.tag == selected) return
        button.tag = selected
        button.isSelected = selected
        button.setTextColor(if (selected) Color.WHITE else LearningColors.ink)
        val states = android.graphics.drawable.StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), context.rounded(if (selected) LearningColors.primary else LearningColors.selected, LearningColors.primary, 2))
            addState(intArrayOf(), context.rounded(if (selected) LearningColors.primary else Color.WHITE, LearningColors.border))
        }
        button.background = android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(Color.argb(50, 23, 110, 145)), states, context.rounded(Color.WHITE))
    }
    fun release() = surface.release()
}

private class VideoFrame(context: Context) : FrameLayout(context) {
    var fill = false
    var compact = false
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        if (fill) super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        else {
            val cap = if (compact) context.dp(88) else context.dp((resources.configuration.screenHeightDp * if (resources.configuration.fontScale > 1.3) 0.23 else 0.38).toInt())
            val height = (MeasureSpec.getSize(widthMeasureSpec) * 9 / 16).coerceAtMost(cap)
            super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
        }
    }
}
