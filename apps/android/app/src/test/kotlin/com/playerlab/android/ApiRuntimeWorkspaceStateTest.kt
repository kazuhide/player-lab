package com.playerlab.android

import org.junit.Assert.*
import org.junit.Test

class ApiRuntimeWorkspaceStateTest {
    private data class EqualSource(val name: String)
    private fun context(source: Any, view: Int = 3) = ApiRuntimeContext(
        2, 7, ApiRuntimeOwnerIdentity(source), view, ApiRuntimeOwnerIdentity(null), UiMode.DEFAULT,
    )

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
}
