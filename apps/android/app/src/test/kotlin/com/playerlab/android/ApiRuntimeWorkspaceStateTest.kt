package com.playerlab.android

import org.junit.Assert.*
import org.junit.Test

class ApiRuntimeWorkspaceStateTest {
    @Test fun posterImagesAreDisplayOperationsRatherThanImaAdvertising() {
        assertEquals("UI and display", apiPurpose("android:com.bitmovin.player.PlayerView.setPosterImage()"))
        assertEquals("Advertising", apiPurpose("android:com.bitmovin.player.api.advertising.AdvertisingApi.schedule()"))
    }

    private data class EqualSource(val name: String)
    private fun context(source: Any, view: Int = 3) = ApiRuntimeContext(
        2, 7, ApiRuntimeOwnerIdentity(source), view, ApiRuntimeOwnerIdentity(null), UiMode.DEFAULT,
    )

    @Test fun manualSsaiOptInBelongsToOneSourceAndPlayerButNotItsView() {
        val source = Any()
        val state = ApiRuntimeWorkspaceState()
        assertFalse(state.manualSsaiEnabled(context(source)))
        state.setManualSsaiEnabled(true, context(source))
        assertTrue(state.manualSsaiEnabled(context(source, view = 4)))
        assertFalse(state.manualSsaiEnabled(context(Any())))
        assertFalse(state.manualSsaiEnabled(context(source).copy(sourceRevision = 8)))
        assertFalse(state.manualSsaiEnabled(context(source).copy(playerGeneration = 3)))
        state.invalidateFor(context(source).copy(sourceRevision = 8))
        assertFalse("Returning to an old source must not revive its opt-in", state.manualSsaiEnabled(context(source)))
        state.setManualSsaiEnabled(true, context(source))
        state.setManualSsaiEnabled(false, context(source))
        assertFalse(state.manualSsaiEnabled(context(source)))
    }

    @Test fun equalSourceValuesDoNotKeepAReceiptOrSnapshotForADifferentNativeSource() {
        val previous = EqualSource("same public source values")
        val replacement = EqualSource(previous.name)
        assertEquals(previous, replacement)
        assertNotSame(previous, replacement)
        val state = ApiRuntimeWorkspaceState().apply {
            result = "Command submitted"
            resultContext = context(previous)
            observed = "Old playback observation"
            observations = mapOf("source-state" to "old source")
        }
        state.invalidateFor(context(replacement))
        assertEquals("", state.result)
        assertNull(state.resultContext)
        assertEquals("", state.observed)
        assertTrue(state.observations.isEmpty())
    }

    @Test fun aReceiptBoundAfterItsOwnViewReplacementSurvivesButAnExternalReplacementClearsIt() {
        val source = Any()
        val resultingContext = context(source, view = 4)
        val state = ApiRuntimeWorkspaceState().apply {
            result = "Command submitted"
            resultContext = resultingContext
            observed = "Observation before the new view attached"
            observations = mapOf("view-state" to "old view")
        }
        state.invalidateFor(context(source, view = 4))
        assertEquals("Command submitted", state.result)
        assertEquals(resultingContext, state.resultContext)
        assertEquals("", state.observed)
        assertTrue(state.observations.isEmpty())
        state.invalidateFor(context(source, view = 5))
        assertEquals("", state.result)
        assertNull(state.resultContext)
    }

    @Test fun changingTheFeatureFilterPreservesTheExplicitTargetAndItsDraftButBlocksAMismatch() {
        val pause = ApiRuntime.commands.first { it.id.endsWith("api.Player.pause()") }
        val state = ApiRuntimeWorkspaceState().apply {
            select(pause.id)
            argument = "retained argument selection"
            result = "Previous pause call"
            observed = "Previous pause observation"
        }
        state.filterByPurpose("Casting")
        assertEquals("Filtering must never select a replacement operation", pause.id, state.selected)
        assertEquals("Casting", state.purpose)
        assertEquals("retained argument selection", state.argument)
        assertEquals("Previous pause call", state.result)
        assertEquals("Previous pause observation", state.observed)
        assertFalse("An out-of-feature target cannot run", state.selectedMatchesFeature)
    }

    @Test fun onlyExplicitOperationSelectionChangesTheTargetAndAllFeaturesPreservesIt() {
        val pause = ApiRuntime.commands.first { it.id.endsWith("api.Player.pause()") }
        val volume = ApiRuntime.commands.first { it.id.endsWith("api.Player.volume") }
        val state = ApiRuntimeWorkspaceState().apply { select(pause.id) }
        state.filterByPurpose("Casting")
        state.filterByPurpose("Playback")
        assertEquals(pause.id, state.selected)
        assertTrue(state.selectedMatchesFeature)
        state.select(volume.id)
        state.setArgument(volume, "volume", "42")
        assertEquals(volume.id, state.selected)
        assertTrue(state.selectedMatchesFeature)
        state.filterByPurpose("All features")
        assertEquals(volume.id, state.selected)
        assertEquals("42", state.arguments(volume)["volume"])
        assertTrue(state.selectedMatchesFeature)
    }
}
