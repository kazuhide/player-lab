package com.playerlab.elearning

import java.text.Normalizer
import java.util.Locale
import org.json.JSONObject

data class TranscriptCue(val startMs: Long, val endMs: Long, val text: String, val language: String) {
    val searchableText = normalize(text)
}
class Transcript(private val all: List<TranscriptCue>) {
    private val byLanguage = all.groupBy { it.language }
    fun cues(language: String) = byLanguage[language].orEmpty()
    fun search(query: String, language: String): List<TranscriptCue> {
        val normalized = normalize(query.trim())
        return cues(language).filter { normalized.isEmpty() || it.searchableText.contains(normalized) }
    }
    fun activeAt(positionMs: Long, language: String) = cues(language).filter { positionMs >= it.startMs && positionMs < it.endMs }

    companion object {
        val EMPTY = Transcript(emptyList())
        fun parse(text: String, durationMs: Long): Transcript = try {
            require(text.length <= 2_000_000 && durationMs > 0) { "Transcript exceeds the input limit" }
            val array = JSONObject(text).getJSONArray("cues")
            require(array.length() <= 10_000) { "Too many transcript cues" }
            val cues = List(array.length()) { index -> array.getJSONObject(index).let {
                TranscriptCue(it.getLong("startMs"), it.getLong("endMs"), it.getString("text"), it.getString("language"))
            } }
            require(cues.all { it.startMs >= 0 && it.endMs > it.startMs && it.endMs <= durationMs && it.text.length <= 10_000 && it.language in setOf("en", "ja") }) { "Invalid transcript cue" }
            Transcript(cues.sortedBy { it.startMs })
        } catch (error: Exception) {
            throw IllegalArgumentException("Invalid timed transcript", error)
        }
    }
}

private fun normalize(text: String) = Normalizer.normalize(text, Normalizer.Form.NFKC).lowercase(Locale.ROOT)
