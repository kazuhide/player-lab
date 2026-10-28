package com.playerlab.elearning

import java.net.URI
import org.json.JSONObject

data class Course(val id: String, val title: String, val titleJa: String, val lessonIds: List<String>)
data class SubtitleAsset(val url: String, val language: String, val label: String)
data class Lesson(
    val id: String, val videoId: String, val title: String, val titleJa: String,
    val durationMs: Long, val streams: Map<StreamFormat, String>,
    val subtitleTracks: List<SubtitleAsset>, val transcriptUrl: String?, val hlsWithSubtitles: String? = null,
)
enum class StreamFormat { HLS, DASH }
enum class CaptionDelivery { EXTERNAL, MANIFEST }
enum class StartOrigin(val analyticsValue: String) { CATALOG("catalog"), PLAYLIST("playlist") }

class Catalog(val courses: List<Course>, val lessons: List<Lesson>) {
    private val byId = lessons.associateBy { it.id }

    init {
        require(courses.isNotEmpty() && lessons.isNotEmpty()) { "Catalog is empty" }
        require(byId.size == lessons.size && courses.map { it.id }.distinct().size == courses.size) { "Duplicate catalog IDs" }
        require(lessons.all { it.id.matches(Regex("EDU-FX-[0-9]{2}")) && it.id == it.videoId && it.durationMs > 0 }) { "Invalid lesson identity or duration" }
        require(courses.all { course -> course.lessonIds.isNotEmpty() && course.lessonIds.distinct().size == course.lessonIds.size && course.lessonIds.all { it in byId } }) { "Unknown or duplicate course lesson" }
    }

    fun lesson(id: String): Lesson = requireNotNull(byId[id]) { "Unknown lesson" }
    fun course(id: String): Course = requireNotNull(courses.find { it.id == id }) { "Unknown course" }
    fun plan(courseId: String, lessonId: String, autoAdvance: Boolean): List<Lesson> {
        val ids = course(courseId).lessonIds
        val index = ids.indexOf(lessonId)
        require(index >= 0) { "Lesson is not in this course" }
        return (if (autoAdvance) ids.drop(index) else listOf(lessonId)).map(::lesson)
    }
    fun adjacent(courseId: String, lessonId: String, offset: Int): Lesson? {
        require(offset == -1 || offset == 1)
        val ids = course(courseId).lessonIds
        val index = ids.indexOf(lessonId)
        require(index >= 0)
        return ids.getOrNull(index + offset)?.let(::lesson)
    }

    companion object {
        fun parse(text: String): Catalog = try {
            require(text.length <= 1_000_000) { "Catalog is too large" }
            val json = JSONObject(text)
            require(json.getInt("schemaVersion") == 1) { "Unsupported catalog schema" }
            val courses = json.getJSONArray("courses").let { array ->
                List(array.length()) { index -> array.getJSONObject(index).let { item ->
                    Course(item.getString("id"), item.getString("title"), item.optString("titleJa", item.getString("title")),
                        item.getJSONArray("lessonIds").let { ids -> List(ids.length()) { ids.getString(it) } })
                } }
            }
            val lessons = json.getJSONArray("lessons").let { array ->
                require(array.length() <= 1000) { "Too many lessons" }
                List(array.length()) { index -> array.getJSONObject(index).let { item ->
                    val subtitles = item.optJSONArray("subtitleTracks")
                    Lesson(item.getString("id"), item.getString("videoId"), item.getString("title"), item.optString("titleJa", item.getString("title")),
                        item.getLong("durationMs"), StreamFormat.entries.associateWith { item.getJSONObject("streams").getString(it.name.lowercase()) },
                        if (subtitles == null) emptyList() else List(subtitles.length()) { subIndex -> subtitles.getJSONObject(subIndex).let {
                            SubtitleAsset(it.getString("url"), it.getString("language"), it.getString("label"))
                        } }, item.optString("transcriptUrl", "").takeIf { it.isNotBlank() }, item.getJSONObject("streams").optString("hlsWithSubtitles", "").takeIf { it.isNotBlank() })
                } }
            }
            Catalog(courses, lessons)
        } catch (error: Exception) {
            throw IllegalArgumentException("Invalid lesson catalog", error)
        }
    }
}

class MediaLocator(baseUrl: String) {
    private val base = URI(baseUrl)
    init {
        require(base.scheme in listOf("https", "http") && base.host != null && base.userInfo == null && base.query == null && base.fragment == null && base.path.endsWith('/')) { "Media base must be an HTTP(S) directory URL without credentials" }
    }
    fun resolve(path: String): String {
        val relative = URI(path)
        require(!relative.isAbsolute && relative.authority == null && !relative.path.startsWith('/') && relative.query == null && relative.fragment == null) { "Expected a relative media path" }
        require(relative.path.split('/').none { it == "." || it == ".." }) { "Media path escapes the fixture directory" }
        return base.resolve(relative).toASCIIString()
    }
}
