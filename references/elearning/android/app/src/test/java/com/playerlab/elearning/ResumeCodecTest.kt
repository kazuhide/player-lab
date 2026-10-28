package com.playerlab.elearning

import org.junit.Assert.*
import org.junit.Test

class ResumeCodecTest {
    @Test fun roundTripRetainsLearnerLessonAndPlaybackChoices() {
        val record = ResumeRecord(Learner.B, "EDU-FX-02", 754_000,
            PlaybackPreferences(1.5f, SubtitlePreference(false, "ja", "subtitle"), UiMode.LEARNING, true), 1200)
        val serialized = ResumeCodec.encode(record)
        assertEquals(record, ResumeCodec.decode(serialized, Learner.B, "EDU-FX-02"))
        assertNull(ResumeCodec.decode(serialized, Learner.A, "EDU-FX-02"))
        assertNull(ResumeCodec.decode(serialized, Learner.B, "EDU-FX-01"))
    }

    @Test fun corruptStorageDoesNotPreventOpeningTheCatalog() {
        assertNull(ResumeCodec.decode("not-json", Learner.A, "EDU-FX-01"))
        val record = ResumeRecord(Learner.A, "EDU-FX-01", -1, PlaybackPreferences(), 1200)
        assertNull(ResumeCodec.decode(ResumeCodec.encode(record), Learner.A, "EDU-FX-01"))
        val valid = ResumeCodec.encode(record.copy(positionMs = 0))
        assertNull(ResumeCodec.decode(org.json.JSONObject(valid).put("speed", 30).toString(), Learner.A, "EDU-FX-01"))
        assertNull(ResumeCodec.decode(valid.replace("\"schemaVersion\":1", "\"schemaVersion\":2"), Learner.A, "EDU-FX-01"))
    }

    @Test fun sdkCaptionUsageRolesSurviveStorageAlongWithLanguage() {
        for (role in listOf("main", "caption", "commentary")) {
            val record = ResumeRecord(Learner.A, "EDU-FX-01", 10_000,
                PlaybackPreferences(subtitle = SubtitlePreference(true, "ja", role)), 1200)
            assertEquals(record, ResumeCodec.decode(ResumeCodec.encode(record), Learner.A, "EDU-FX-01"))
        }
    }
}
