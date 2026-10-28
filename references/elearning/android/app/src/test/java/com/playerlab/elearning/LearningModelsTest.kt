package com.playerlab.elearning

import org.junit.Assert.*
import org.junit.Test

class LearningModelsTest {
    private val catalogJson = """{"schemaVersion":1,"courses":[{"id":"course","title":"Number line","titleJa":"数直線","lessonIds":["EDU-FX-01","EDU-FX-02","EDU-FX-03"]}],"lessons":[
        {"id":"EDU-FX-01","videoId":"EDU-FX-01","title":"Basics","titleJa":"基本","durationMs":180000,"streams":{"hls":"EDU-FX-01/hls/master.m3u8","dash":"EDU-FX-01/dash/manifest.mpd"},"subtitleTracks":[],"transcriptUrl":""},
        {"id":"EDU-FX-02","videoId":"EDU-FX-02","title":"Exercises","durationMs":780000,"streams":{"hls":"EDU-FX-02/hls/master.m3u8","dash":"EDU-FX-02/dash/manifest.mpd"},"subtitleTracks":[],"transcriptUrl":""},
        {"id":"EDU-FX-03","videoId":"EDU-FX-03","title":"Summary","durationMs":8000,"streams":{"hls":"EDU-FX-03/hls/master.m3u8","dash":"EDU-FX-03/dash/manifest.mpd"},"subtitleTracks":[],"transcriptUrl":""}]}"""

    @Test fun playlistUsesSelectedLessonThroughEndOnlyWhenEnabled() {
        val catalog = Catalog.parse(catalogJson)
        assertEquals(listOf("EDU-FX-02"), catalog.plan("course", "EDU-FX-02", false).map { it.id })
        assertEquals(listOf("EDU-FX-02", "EDU-FX-03"), catalog.plan("course", "EDU-FX-02", true).map { it.id })
        assertNull(catalog.adjacent("course", "EDU-FX-01", -1))
        assertNull(catalog.adjacent("course", "EDU-FX-03", 1))
        assertEquals("EDU-FX-02", catalog.adjacent("course", "EDU-FX-01", 1)?.id)
    }

    @Test fun duplicateIdsAndMissingCourseReferencesAreRejected() {
        assertThrows(IllegalArgumentException::class.java) { Catalog.parse(catalogJson.replace("\"id\":\"EDU-FX-02\"", "\"id\":\"EDU-FX-01\"")) }
        assertThrows(IllegalArgumentException::class.java) { Catalog.parse(catalogJson.replace("\"lessonIds\":[\"EDU-FX-01\"", "\"lessonIds\":[\"missing\"")) }
    }

    @Test fun mediaLocatorKeepsRelativeFixturePathsWithinBase() {
        val media = MediaLocator("http://10.0.2.2:8621/media/")
        assertEquals("http://10.0.2.2:8621/media/EDU-FX-01/hls/master.m3u8", media.resolve("EDU-FX-01/hls/master.m3u8"))
        listOf("../secret", "https://other.example/media", "//other.example/media", "/escape", "asset?token=secret").forEach { path ->
            assertThrows(path, IllegalArgumentException::class.java) { media.resolve(path) }
        }
        assertThrows(IllegalArgumentException::class.java) { MediaLocator("https://user:password@example.test/") }
    }

    @Test fun savedPositionValidationDoesNotClampChangedMedia() {
        val saved = ResumeRecord(Learner.A, "EDU-FX-02", 754_000, PlaybackPreferences(), 1_000)
        assertTrue(saved.canResume(780_000))
        assertFalse(saved.canResume(700_000))
        assertFalse(saved.copy(positionMs = 780_000).canResume(780_000))
        assertTrue(saved.copy(positionMs = 0).canResume(780_000))
        assertFalse(saved.copy(positionMs = -1).canResume(780_000))
        assertNotEquals(saved.storageKey, saved.copy(learner = Learner.B).storageKey)
    }

    @Test fun staleAsyncSelectionCannotApplyToAnotherLearnerOrLesson() {
        val requests = SelectionRequests()
        val old = requests.begin(Learner.A, "EDU-FX-01")
        val fresh = requests.begin(Learner.B, "EDU-FX-01")
        assertFalse(requests.isCurrent(old))
        assertTrue(requests.isCurrent(fresh))
        requests.cancel()
        assertFalse(requests.isCurrent(fresh))
    }

    @Test fun subtitlePreferenceReacquiresLanguageAndRoleWithoutUsingOldTrackIds() {
        val subtitles = listOf(
            SubtitleOption("new-en", "en", "subtitle"),
            SubtitleOption("new-ja-caption", "ja", "caption"),
            SubtitleOption("new-ja", "ja", "subtitle"),
        )
        assertEquals("new-ja", SubtitlePreference(true, "ja", "subtitle").select(subtitles)?.id)
        assertNull(SubtitlePreference(false, "ja", "subtitle").select(subtitles))
        assertNull(SubtitlePreference(true, "fr", "subtitle").select(subtitles))
        assertNull(SubtitlePreference(true, "ja", "description").select(subtitles))
    }
}
