package com.playerlab.elearning

import org.junit.Assert.*
import org.junit.Test

class PlaybackPlanTest {
    private fun lesson(id: String) = Lesson(id, id, id, id,
        if (id == "EDU-FX-02") 780_000 else 180_000,
        mapOf(StreamFormat.HLS to "$id/hls/master.m3u8", StreamFormat.DASH to "$id/dash/manifest.mpd"), emptyList(), null)
    private val catalog = Catalog(listOf(Course("course", "Numbers", "数直線", listOf("EDU-FX-01", "EDU-FX-02"))), listOf(lesson("EDU-FX-01"), lesson("EDU-FX-02")))

    @Test fun catalogStartAndRemainingPlaylistHaveSeparateFixedOrigins() {
        val plan = PlaybackPlan.create(catalog, Learner.A, "course", "EDU-FX-01", StreamFormat.HLS,
            PlaybackPreferences(autoAdvance = true), StartOrigin.CATALOG)
        assertEquals(listOf(StartOrigin.CATALOG, StartOrigin.PLAYLIST), plan.items.map { it.origin })
        assertEquals(listOf("EDU-FX-01", "EDU-FX-02"), plan.items.map { it.lesson.id })
        assertEquals(0L, plan.items[1].startPositionMs)
        assertTrue(plan.isPlaylist)
    }

    @Test fun manualPreviousOrNextStartsNewSourceAsPlaylistOriginEvenWhenAutoAdvanceIsOff() {
        val plan = PlaybackPlan.create(catalog, Learner.B, "course", "EDU-FX-02", StreamFormat.DASH,
            PlaybackPreferences(autoAdvance = false), StartOrigin.PLAYLIST)
        assertEquals(1, plan.items.size)
        assertEquals(StartOrigin.PLAYLIST, plan.items.single().origin)
        assertEquals(Learner.B, plan.learner)
        assertFalse(plan.isPlaylist)
    }

    @Test fun validResumeUsesTheSavedOffsetAndSettingsWithoutClamping() {
        val prefs = PlaybackPreferences(1.5f, SubtitlePreference(language = "ja"), UiMode.LEARNING, true)
        val saved = ResumeRecord(Learner.A, "EDU-FX-02", 754_000, prefs, 100)
        val plan = PlaybackPlan.create(catalog, Learner.A, "course", "EDU-FX-02", StreamFormat.HLS, prefs, StartOrigin.CATALOG, saved)
        assertEquals(754_000L, plan.items.single().startPositionMs)
        assertEquals(prefs, plan.preferences)
        assertThrows(IllegalArgumentException::class.java) {
            PlaybackPlan.create(catalog, Learner.B, "course", "EDU-FX-02", StreamFormat.HLS, prefs, StartOrigin.CATALOG, saved)
        }
        assertThrows(IllegalArgumentException::class.java) {
            PlaybackPlan.create(catalog, Learner.A, "course", "EDU-FX-02", StreamFormat.HLS, prefs, StartOrigin.CATALOG, saved.copy(positionMs = 780_000))
        }
    }
}
