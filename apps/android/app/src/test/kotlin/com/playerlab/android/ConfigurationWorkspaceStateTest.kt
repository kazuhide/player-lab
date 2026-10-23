package com.playerlab.android

import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Test

class ConfigurationWorkspaceStateTest {
    @Test
    fun unrelatedAppliedChangesDoNotDiscardDraftEdits() {
        val initial = SourceSettings("https://example.com/master.m3u8", SourceType.Hls)
        val state = ConfigurationWorkspaceState(initial, PlayerSettings())
        state.source = state.source.copy(title = "Unapplied title")
        state.player = state.player.copy(httpRetryDelays = "0,0.25")
        state.select("config-http-retries")
        state.synchronize(initial.copy(startOffset = 10.0), PlayerSettings(muted = true))
        assertEquals("Unapplied title", state.source.title)
        assertEquals("0,0.25", state.player.httpRetryDelays)
        assertEquals("config-http-retries", state.selected)
        assertEquals("Player", state.group)
    }

    @Test
    fun untouchedDraftTracksAppliedValues() {
        val initial = SourceSettings("https://example.com/old.mpd", SourceType.Dash)
        val state = ConfigurationWorkspaceState(initial, PlayerSettings())
        val updated = initial.copy(url = "https://example.com/new.mpd", startOffset = 10.0)
        state.synchronize(updated, PlayerSettings(muted = true))
        assertEquals(SourceDraft.from(updated), state.source)
        assertEquals(PlayerDraft.from(PlayerSettings(muted = true)), state.player)
    }

    @Test
    fun invalidFieldsHaveDirectEditorDestinations() {
        val state = ConfigurationWorkspaceState(SourceSettings("https://example.com/master.m3u8", SourceType.Hls), PlayerSettings())
        state.source = state.source.copy(subtitleUrl = "https://example.com/sub.vtt", subtitleLanguage = "en,de")
        val errors = state.source.validate().errors
        assertTrue("The fixture must exercise validation", "subtitleLanguage" in errors)
        state.select(sourceErrorItem("subtitleLanguage"))
        assertEquals("source-subtitle-language", state.selected)
        assertEquals("Source", state.group)
        state.player = state.player.copy(httpRetryDelays = "NaN")
        assertTrue("httpRetryDelays" in state.player.validate().errors)
        state.select(playerErrorItem("httpRetryDelays"))
        assertEquals("config-http-retries", state.selected)
        assertEquals("Player", state.group)
    }

    @Test
    fun apiSelectionRetainsArgumentDraftButInvalidatesPriorObservation() {
        val state = ApiRuntimeWorkspaceState()
        val seek = ApiRuntime.commands.first { it.id.endsWith("api.Player.seek()") }
        state.select(seek.id)
        state.setArgument(seek, "time", "37")
        state.observed = "Prior state"
        state.select(ApiRuntime.commands.first { it.id.endsWith("api.Player.pause()") }.id)
        assertEquals("", state.observed)
        state.select(seek.id)
        assertEquals("37", state.arguments(seek)["time"])
    }
}
