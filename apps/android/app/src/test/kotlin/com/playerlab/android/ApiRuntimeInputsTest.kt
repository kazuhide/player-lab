package com.playerlab.android

import com.bitmovin.player.api.vr.orientation.ViewingDirection
import org.junit.Assert.*
import org.junit.Test

class ApiRuntimeInputsTest {
    @Test fun command_choices_are_validated_before_a_gui_operation_can_mutate_the_sdk() {
        val command = ApiRuntime.commands.first { it.id.endsWith("Player.setSurface()") }
        command.validate(ApiInputs(mapOf("target" to "SurfaceHolder")))
        assertTrue(runCatching { command.validate(ApiInputs(mapOf("target" to "invented"))) }.isFailure)
        assertTrue(runCatching { command.validate(ApiInputs(emptyMap())) }.isFailure)
        for (entry in ApiRuntime.commands) entry.validate(ApiInputs(entry.arguments.associate { it.name to it.example }))
    }

    @Test fun manual_orientation_uses_the_actual_sdk_direction_and_tracks_enable_state() {
        val direction = ViewingDirection(10.0, 20.0, 30.0)
        val provider = ApiManualOrientation(direction, false)
        assertFalse(provider.isEnabled())
        assertSame(direction, provider.getViewingDirection())
        provider.enable()
        assertTrue(provider.isEnabled())
        provider.disable()
        assertFalse(provider.isEnabled())
    }
}
