package com.playerlab.elearning

enum class Learner(val analyticsId: String) { A("demo-learner-a"), B("demo-learner-b") }
data class SubtitleOption(val id: String, val language: String?, val role: String)
data class SubtitlePreference(val enabled: Boolean = true, val language: String = "en", val role: String = "subtitle") {
    fun select(options: List<SubtitleOption>): SubtitleOption? =
        if (enabled) options.firstOrNull { it.language == language && it.role == role } else null
}
data class PlaybackPreferences(
    val speed: Float = 1f,
    val subtitle: SubtitlePreference = SubtitlePreference(),
    val uiMode: UiMode = UiMode.DEFAULT,
    val autoAdvance: Boolean = false,
) {
    init { require(speed.isFinite() && speed in 0.25f..2f) }
}
data class ResumeRecord(
    val learner: Learner, val lessonId: String, val positionMs: Long,
    val preferences: PlaybackPreferences, val savedAtMs: Long,
) {
    val storageKey get() = "resume.${learner.name}.$lessonId"
    fun canResume(durationMs: Long) = durationMs > 0 && positionMs >= 0 && positionMs < durationMs
}
data class SelectionRequest(val generation: Long, val learner: Learner, val lessonId: String)
class SelectionRequests {
    private var generation = 0L
    private var current: SelectionRequest? = null
    fun begin(learner: Learner, lessonId: String): SelectionRequest =
        SelectionRequest(++generation, learner, lessonId).also { current = it }
    fun isCurrent(request: SelectionRequest) = request == current
    fun cancel() { generation++; current = null }
}
