package com.playerlab.elearning

import android.content.Context
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Switch

class CourseScreen(context: Context, private val session: PlaybackSession, private val openLesson: (String) -> Unit) : ScrollView(context) {
    private val content = context.column().apply { setPadding(context.dp(16), context.dp(12), context.dp(16), context.dp(24)) }
    private var lastKey: List<Any?>? = null

    init { isFillViewport = true; addView(content) }

    fun update() {
        val key = listOf(session.catalog, session.catalogFailed, session.progressLoading, session.learner, session.resumes, session.autoAdvanceDraft, session.format, session.captionDelivery)
        if (key == lastKey) return
        lastKey = key
        content.removeAllViews()
        val catalog = session.catalog
        if (catalog == null) {
            content.addView(context.label(context.getString(if (session.catalogFailed) R.string.catalog_error else R.string.loading)))
            if (session.catalogFailed) content.addView(context.action(context.getString(R.string.retry)) { session.loadCatalog() })
            return
        }
        val course = catalog.course(session.courseId)
        content.addView(context.heading(course.localizedTitle(context)))
        content.addView(context.row().apply {
            weighted(Switch(context).apply {
                text = context.getString(R.string.auto_advance)
                textSize = 16f
                minHeight = context.dp(48)
                isChecked = session.autoAdvanceDraft
                setOnCheckedChangeListener { _, enabled -> session.setAutoAdvance(enabled) }
            })
            addView(RadioGroup(context).apply {
                orientation = LinearLayout.HORIZONTAL
                StreamFormat.entries.forEach { format ->
                    addView(RadioButton(context).apply {
                        id = android.view.View.generateViewId()
                        text = format.name
                        minHeight = context.dp(48)
                        isChecked = session.format == format
                        setOnClickListener { session.setFormat(format) }
                    })
                }
            })
        })
        content.addView(context.divider())
        if (session.format == StreamFormat.HLS && course.lessonIds.map(catalog::lesson).filter { it.subtitleTracks.isNotEmpty() }.all { it.hlsWithSubtitles != null }) {
            content.addView(context.label(context.getString(R.string.caption_source), 14f))
            content.addView(context.row().apply {
                weighted(context.action(context.getString(R.string.external_captions), session.captionDelivery == CaptionDelivery.EXTERNAL) { session.setCaptionDelivery(CaptionDelivery.EXTERNAL) })
                weighted(context.action(context.getString(R.string.manifest_captions), session.captionDelivery == CaptionDelivery.MANIFEST) { session.setCaptionDelivery(CaptionDelivery.MANIFEST) })
            })
            content.addView(context.divider())
        }
        val recent = session.resumes.values.filter { it.positionMs > 0 && it.canResume(catalog.lesson(it.lessonId).durationMs) }.maxByOrNull { it.savedAtMs }
        if (recent != null) {
            content.addView(context.label(catalog.lesson(recent.lessonId).localizedTitle(context), 17f, true))
            content.addView(context.label(context.getString(R.string.saved_position, formatTime(recent.positionMs)), 14f))
            content.addView(context.action(context.getString(R.string.continue_lesson), primary = true) { session.startLesson(recent.lessonId, resume = true) }
                .apply { isEnabled = !session.progressLoading })
            content.addView(context.divider())
        }
        content.addView(context.heading(context.getString(R.string.lessons), 18f))
        if (session.progressLoading) content.addView(context.label(context.getString(R.string.loading), 14f))
        course.lessonIds.forEachIndexed { index, id ->
            val lesson = catalog.lesson(id)
            val saved = session.resumes[id]
            val subtitleText = context.getString(if (lesson.subtitleTracks.isEmpty()) R.string.captions_none else R.string.captions_available)
            val metadata = "${formatTime(lesson.durationMs)}  $subtitleText"
            val resumeText = saved?.takeIf { it.positionMs > 0 && it.canResume(lesson.durationMs) }
                ?.let { "\n" + context.getString(R.string.saved_position, formatTime(it.positionMs)) }.orEmpty()
            content.addView(context.action("${index + 1}. ${lesson.localizedTitle(context)}\n$metadata$resumeText") { openLesson(id) }.apply {
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                isEnabled = !session.progressLoading
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = context.dp(6)
                    bottomMargin = context.dp(6)
                }
                setPadding(context.dp(16), context.dp(14), context.dp(16), context.dp(14))
            })
        }
    }
}
