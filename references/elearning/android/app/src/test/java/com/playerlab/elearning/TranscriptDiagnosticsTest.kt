package com.playerlab.elearning

import org.junit.Assert.*
import org.junit.Test

class TranscriptDiagnosticsTest {
    private val text = """{"cues":[
      {"startMs":10000,"endMs":15000,"text":"First line\nSecond line (123)","language":"en"},
      {"startMs":10000,"endMs":15000,"text":"最初の行\n次の行（123）","language":"ja"},
      {"startMs":12000,"endMs":16000,"text":"Overlapping cue","language":"en"},
      {"startMs":178000,"endMs":180000,"text":"Last cue","language":"en"}]}"""

    @Test fun searchUsesTranscriptIndependentlyOfSubtitlesAndRetainsOverlap() {
        val transcript = Transcript.parse(text, 180_000)
        assertEquals(3, transcript.cues("en").size)
        assertEquals(2, transcript.activeAt(12_500, "en").size)
        assertEquals(1, transcript.search("FIRST LINE", "en").size)
        assertEquals(1, transcript.search("（１２３）", "ja").size)
        assertEquals(10_000L, transcript.search("最初", "ja").single().startMs)
        assertTrue(transcript.activeAt(16_000, "en").isEmpty())
        assertTrue(transcript.activeAt(180_000, "en").isEmpty())
        assertEquals(1, transcript.activeAt(179_999, "en").size)
    }

    @Test fun invalidCueBoundsAndOversizedInputAreRejected() {
        assertThrows(IllegalArgumentException::class.java) { Transcript.parse(text.replace("\"endMs\":15000", "\"endMs\":10000"), 180_000) }
        assertThrows(IllegalArgumentException::class.java) { Transcript.parse(text, 170_000) }
        assertThrows(IllegalArgumentException::class.java) { Transcript.parse(" ".repeat(2_000_001), 180_000) }
    }

    @Test fun diagnosticsAreBoundedAndContainOnlyStructuredSafeValues() {
        val buffer = DiagnosticBuffer(200)
        repeat(250) { buffer.add(DiagnosticKind.SAVE_SUCCESS, "EDU-FX-01", it.toLong(), UiMode.DEFAULT) }
        assertEquals(200, buffer.entries().size)
        assertEquals(50L, buffer.entries().first().positionMs)
        assertThrows(IllegalArgumentException::class.java) { buffer.add(DiagnosticKind.ERROR, "https://secret.example/?token=private", 0, UiMode.DEFAULT) }
        buffer.clear()
        assertTrue(buffer.entries().isEmpty())
    }
}
