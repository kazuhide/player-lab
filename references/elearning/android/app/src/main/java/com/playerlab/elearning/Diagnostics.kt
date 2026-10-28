package com.playerlab.elearning

import java.util.ArrayDeque

enum class DiagnosticKind {
    LESSON_SELECTED, SOURCE_LOADED, PLAY, PAUSE, SEEK, SUBTITLE, SPEED, UI_MODE,
    SAVE_SUCCESS, SAVE_FAILED, MANUAL_PREVIOUS, MANUAL_NEXT, PLAYLIST_TRANSITION,
    FOREGROUND, BACKGROUND, ROTATION, AUDIO_ROUTE_LOST, PLAYBACK_FINISHED,
    SESSION_ACTIVE, SESSION_INACTIVE, ANALYTICS_ENABLED, ANALYTICS_SKIPPED, ERROR, WARNING, CUE_ENTER, CUE_EXIT,
    CAPTION_HTTP_FAILURE, CAPTION_INVALID_FORMAT,
}
data class DiagnosticEntry(val kind: DiagnosticKind, val lessonId: String?, val positionMs: Long, val uiMode: UiMode, val sdkCode: Int? = null, val httpStatus: Int? = null)
class DiagnosticBuffer(private val capacity: Int = 200) {
    private val items = ArrayDeque<DiagnosticEntry>()
    init { require(capacity in 1..200) }
    fun add(kind: DiagnosticKind, lessonId: String?, positionMs: Long, mode: UiMode, sdkCode: Int? = null, httpStatus: Int? = null) {
        require(lessonId == null || lessonId.matches(Regex("EDU-FX-[0-9]{2}"))) { "Only stable fixture IDs may be logged" }
        require(sdkCode == null || sdkCode in 0..99_999) { "Only bounded public SDK codes may be logged" }
        require(httpStatus == null || httpStatus in 100..599) { "Only HTTP status codes may be logged" }
        if (items.size == capacity) items.removeFirst()
        items.addLast(DiagnosticEntry(kind, lessonId, positionMs.coerceAtLeast(0), mode, sdkCode, httpStatus))
    }
    fun entries(): List<DiagnosticEntry> = items.toList()
    fun clear() = items.clear()
}
