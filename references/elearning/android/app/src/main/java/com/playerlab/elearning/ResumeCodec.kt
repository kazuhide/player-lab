package com.playerlab.elearning

import org.json.JSONObject

object ResumeCodec {
    fun encode(record: ResumeRecord): String = JSONObject().apply {
        put("schemaVersion", 1)
        put("learner", record.learner.name)
        put("lessonId", record.lessonId)
        put("positionMs", record.positionMs)
        put("savedAtMs", record.savedAtMs)
        put("speed", record.preferences.speed.toDouble())
        put("subtitleEnabled", record.preferences.subtitle.enabled)
        put("subtitleLanguage", record.preferences.subtitle.language)
        put("subtitleRole", record.preferences.subtitle.role)
        put("uiMode", record.preferences.uiMode.name)
        put("autoAdvance", record.preferences.autoAdvance)
    }.toString()

    fun decode(text: String, learner: Learner, lessonId: String): ResumeRecord? = try {
        require(text.length <= 4096)
        val json = JSONObject(text)
        require(json.getInt("schemaVersion") == 1)
        require(json.getString("learner") == learner.name && json.getString("lessonId") == lessonId)
        val position = json.getLong("positionMs")
        require(position >= 0)
        val subtitle = SubtitlePreference(json.getBoolean("subtitleEnabled"), json.getString("subtitleLanguage"), json.getString("subtitleRole"))
        require(subtitle.language in listOf("en", "ja") && subtitle.role.isNotBlank() && subtitle.role.length <= 80 && subtitle.role.none { it.isISOControl() })
        ResumeRecord(learner, lessonId, position,
            PlaybackPreferences(json.getDouble("speed").toFloat(), subtitle, UiMode.valueOf(json.getString("uiMode")), json.getBoolean("autoAdvance")),
            json.getLong("savedAtMs"))
    } catch (_: Exception) { null }
}
