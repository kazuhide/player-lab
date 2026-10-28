package com.playerlab.elearning

import java.io.File
import org.junit.Assert.*
import org.junit.Test

class FixtureCatalogTest {
    @Test fun ownedFixtureCatalogAndTimedTranscriptsCanBeConsumedByTheAndroidModels() {
        val directory = File(requireNotNull(System.getProperty("reference.fixtureDir")))
        val catalog = Catalog.parse(File(directory, "catalog.json").readText())
        assertEquals(listOf("EDU-FX-01", "EDU-FX-02", "EDU-FX-03"), catalog.courses.single().lessonIds)
        assertEquals(listOf(180_000L, 780_000L, 8_000L), catalog.lessons.map { it.durationMs })
        catalog.lessons.forEach { lesson ->
            val media = MediaLocator("https://media.example.test/")
            lesson.streams.values.forEach { media.resolve(it) }
            lesson.subtitleTracks.forEach { subtitle ->
                media.resolve(subtitle.url)
                assertTrue("Missing subtitle ${subtitle.url}", File(directory, subtitle.url).isFile)
            }
            lesson.transcriptUrl?.let { path ->
                val transcript = Transcript.parse(File(directory, path).readText(), lesson.durationMs)
                if (lesson.subtitleTracks.isNotEmpty()) {
                    assertTrue(transcript.cues("en").isNotEmpty())
                    assertTrue(transcript.cues("ja").isNotEmpty())
                }
            }
        }
        assertTrue(catalog.lesson("EDU-FX-03").subtitleTracks.isEmpty())
    }
}
