package com.playerlab.elearning

enum class LessonPanel { LESSONS, TRANSCRIPT }
class LessonViewState(var transcriptLanguage: String) {
    var panel = LessonPanel.TRANSCRIPT
    var query = ""
    var followPlayback = true
    var fullscreen = false
}
