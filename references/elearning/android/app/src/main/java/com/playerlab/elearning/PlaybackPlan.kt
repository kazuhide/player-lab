package com.playerlab.elearning

data class PlannedLesson(val lesson: Lesson, val origin: StartOrigin, val startPositionMs: Long)
data class PlaybackPlan(
    val learner: Learner, val courseId: String, val format: StreamFormat,
    val preferences: PlaybackPreferences, val items: List<PlannedLesson>, val captionDelivery: CaptionDelivery = CaptionDelivery.EXTERNAL,
) {
    val isPlaylist get() = preferences.autoAdvance

    companion object {
        fun create(
            catalog: Catalog, learner: Learner, courseId: String, lessonId: String,
            format: StreamFormat, preferences: PlaybackPreferences, origin: StartOrigin,
            resume: ResumeRecord? = null, captionDelivery: CaptionDelivery = CaptionDelivery.EXTERNAL,
        ): PlaybackPlan {
            val lessons = catalog.plan(courseId, lessonId, preferences.autoAdvance)
            if (resume != null) {
                require(resume.learner == learner && resume.lessonId == lessonId && resume.canResume(lessons.first().durationMs)) { "Saved position does not match this selection" }
            }
            require(format == StreamFormat.HLS || captionDelivery == CaptionDelivery.EXTERNAL)
            return PlaybackPlan(learner, courseId, format, preferences, lessons.mapIndexed { index, lesson ->
                PlannedLesson(lesson, if (index == 0) origin else StartOrigin.PLAYLIST,
                    if (index == 0) resume?.positionMs ?: 0 else 0)
            }, captionDelivery)
        }
    }
}
