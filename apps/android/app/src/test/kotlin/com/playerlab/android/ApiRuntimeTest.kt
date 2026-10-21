package com.playerlab.android

import org.junit.Assert.*
import org.junit.Test

class ApiRuntimeTest {
    @Test fun typed_arguments_reject_nonfinite_and_out_of_range_values() {
        for (value in listOf("NaN", "Infinity", "-Infinity", "1e1000", "not-a-number")) {
            assertTrue(runCatching { ApiInputs(mapOf("time" to value)).number("time") }.isFailure)
        }
        assertTrue(runCatching { ApiInputs(mapOf("volume" to "101")).int("volume", 0, 100) }.isFailure)
        assertTrue(runCatching { ApiInputs(mapOf("speed" to "1e100")).float("speed") }.isFailure)
        assertEquals(-10.0, ApiInputs(mapOf("offset" to "-10")).number("offset"), 0.0)
        assertEquals(25, ApiInputs(mapOf("volume" to "25")).int("volume", 0, 100))
    }

    @Test fun unknown_sdk_objects_are_never_stringified_into_public_diagnostics() {
        val privateObject = object { override fun toString(): String = error("Must not stringify an opaque SDK object") }
        assertTrue(runCatching { apiValue(privateObject) }.isFailure)
        assertEquals("playing: true; volume: 25", apiValue(mapOf("playing" to true, "volume" to 25)))
        assertEquals(2048, apiValue("a".repeat(4096)).length)
    }

    @Test fun scaling_choices_match_the_installed_sdk_enum() {
        val command = ApiRuntime.commands.single { it.id == "android:com.bitmovin.player.PlayerView.scalingMode" }
        assertEquals(com.bitmovin.player.api.ui.ScalingMode.entries.map { it.name }, command.arguments.single().choices)
    }
}
