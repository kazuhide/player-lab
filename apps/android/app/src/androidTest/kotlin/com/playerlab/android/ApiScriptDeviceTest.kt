package com.playerlab.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Does not start an Activity or alter the device UI. Uses synthetic public byte values. */
@RunWith(AndroidJUnit4::class)
class ApiScriptDeviceTest {
    @Test fun plainByteSnapshotsRunOnTheAndroidInterpreter() {
        for (length in listOf(1, 256, 4096)) {
            val started = System.nanoTime()
            val program = ApiScriptProgram("return input.bytes;")
            val initialized = System.nanoTime()
            val input = (0 until length).map { it % 256 }
            val result = runCatching { program.run(mapOf("bytes" to input)) }
            val ended = System.nanoTime()
            println("SYNTHETIC_CALLBACK length=$length initMs=${(initialized - started) / 1_000_000} runMs=${(ended - initialized) / 1_000_000} status=${if (result.isSuccess) "ok" else result.exceptionOrNull()?.message}")
            assertEquals(input.map { it.toDouble() }, result.getOrThrow())
        }
    }
}
