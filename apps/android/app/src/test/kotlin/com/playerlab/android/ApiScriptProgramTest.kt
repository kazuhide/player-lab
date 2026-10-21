package com.playerlab.android

import org.junit.Assert.*
import org.junit.Test

class ApiScriptProgramTest {
    private class CheckpointClock(private val elapsedWallMs: Long, private val elapsedCpuMs: Long?, private val cpuInitiallyAvailable: Boolean = elapsedCpuMs != null) : ApiScriptClock {
        private var wallReads = 0
        private var cpuReads = 0
        override fun wallNanos() = (if (wallReads++ == 0) 0L else elapsedWallMs) * 1_000_000L
        override fun threadCpuNanos(): Long? = if (cpuReads++ == 0) {
            if (cpuInitiallyAvailable) 0L else null
        } else elapsedCpuMs?.times(1_000_000L)
    }

    @Test fun independentCpuAndWallLimitsDoNotRejectLowCpuElapsedTime() {
        var timing: ApiScriptTiming? = null
        assertEquals(7.0, ApiScriptProgram("return 7;", CheckpointClock(80, 1)).run(null) { timing = it })
        assertEquals(80L, timing!!.wallMillis)
        assertEquals(1L, timing!!.cpuMillis)
    }

    @Test fun cpuWorkBeyondItsLimitRetainsTheNativeFallback() {
        val context = ApiCallbackContext()
        assertEquals("native", context.apply("cpu", ApiScriptProgram("return 'edited';", CheckpointClock(30, 26)), null, "native") { it as String })
        assertEquals(1 to 1, context.snapshot()["cpu"])
    }

    @Test fun independentWallLimitRejectsLongNonCpuDelay() {
        try { ApiScriptProgram("return 7;", CheckpointClock(251, 1)).run(null); fail("Expected wall limit") }
        catch (error: ApiScriptBudgetException) { assertEquals(251L, error.elapsedMillis); assertEquals(1L, error.cpuMillis) }
    }

    @Test fun unavailableOrLostCpuClockUsesTheShorterWallFallback() {
        listOf(false, true).forEach { initiallyAvailable ->
            assertEquals(7.0, ApiScriptProgram("return 7;", CheckpointClock(74, null, initiallyAvailable)).run(null))
            try { ApiScriptProgram("return 7;", CheckpointClock(76, null, initiallyAvailable)).run(null); fail("Expected fallback wall limit") }
            catch (error: ApiScriptBudgetException) { assertEquals(76L, error.elapsedMillis); assertNull(error.cpuMillis) }
        }
    }

    @Test fun editedAndSparseByteArraysRemainValueSnapshots() {
        val bytes = (0 until 4096).map { it % 256 }
        val p = ApiScriptProgram("input.bytes[0] = 255; input.bytes[4095] = 7; return input.bytes;")
        val returned = p.run(mapOf("bytes" to bytes)) as List<*>
        assertEquals(255.0, returned.first()); assertEquals(7.0, returned.last())
        assertEquals(0, bytes.first()); assertEquals(255, bytes.last())
        assertEquals(listOf(1.0, null, 3.0), ApiScriptProgram("return [1,,3];").run(null))
    }

    @Test fun cachedProgramCreatesAFreshScopeForEveryCallAndThread() {
        val program = ApiScriptProgram("this.counter = (this.counter || 0) + 1; return [this.counter, input];")
        assertEquals(listOf(1.0, 2.0), program.run(2))
        assertEquals(listOf(1.0, 3.0), program.run(3))
        val results = java.util.Collections.synchronizedList(mutableListOf<Any?>())
        val threads = (4..5).map { value -> Thread { results.add(program.run(value)) }.apply { start() } }
        threads.forEach { it.join(2000); assertFalse(it.isAlive) }
        assertEquals(setOf(listOf(1.0, 4.0), listOf(1.0, 5.0)), results.toSet())
    }

    @Test fun userBodyTransformsTypedValuesWithoutAJavaBridge() {
        val result = ApiScriptProgram("return {label: input.language.toUpperCase(), delays: input.delays.map(function(x) { return x * 2; })};")
            .run(mapOf("language" to "en", "delays" to listOf(0.25, 1))) as Map<*, *>
        assertEquals("EN", result["label"])
        assertEquals(listOf(0.5, 2.0), result["delays"])
        assertEquals("undefined:undefined:undefined:undefined", ApiScriptProgram("return typeof Packages + ':' + typeof java + ':' + typeof JavaAdapter + ':' + typeof XML;").run(null))
    }
    @Test fun infiniteAndRecursiveProgramsTerminateAndCannotCatchTheInstructionLimit() {
        listOf("while(true) {}", "try { while(true) {} } catch(e) { while(true) {} }", "function recurse() { return recurse(); } return recurse();").forEach { body ->
            val start = System.nanoTime()
            try { ApiScriptProgram(body).run(null); fail("Expected an execution bound") } catch (_: IllegalArgumentException) { }
            assertTrue("Instruction/stack bound", System.nanoTime() - start < 2_000_000_000L)
        }
    }
    @Test fun invalidSyntaxAndUnboundedReturnShapesAreRejected() {
        listOf("return (", "return new Array(65537);", "return function() {};").forEach { body ->
            try { ApiScriptProgram(body).run(null); fail("Expected rejection") } catch (_: IllegalArgumentException) { } catch (_: IllegalStateException) { }
        }
    }
    @Test fun retiredContextNeverRunsUserCodeAndInvalidOutputUsesNativeFallback() {
        val c = ApiCallbackContext()
        assertEquals(true, c.apply("enabled", ApiScriptProgram("return input.allowed;"), mapOf("allowed" to true), false) { it as Boolean })
        assertEquals(false, c.apply("invalid", ApiScriptProgram("return 'not boolean';"), null, false) { it as Boolean })
        assertEquals(1 to 1, c.snapshot()["invalid"])
        c.close()
        assertEquals(false, c.apply("retired", ApiScriptProgram("while(true){}"), null, false) { it as Boolean })
        assertFalse(c.snapshot().containsKey("retired"))
    }
    @Test fun retirementWhileConvertingResultRejectsThatResult() {
        val c = ApiCallbackContext()
        val entered = java.util.concurrent.CountDownLatch(1)
        val released = java.util.concurrent.CountDownLatch(1)
        val result = java.util.concurrent.atomic.AtomicReference<Boolean>()
        val thread = Thread {
            result.set(c.apply("retiring", ApiScriptProgram("return true;"), null, false) {
                entered.countDown()
                check(released.await(2, java.util.concurrent.TimeUnit.SECONDS))
                it as Boolean
            })
        }
        thread.start()
        assertTrue(entered.await(2, java.util.concurrent.TimeUnit.SECONDS))
        c.close()
        released.countDown()
        thread.join(2000)
        assertFalse(thread.isAlive)
        assertEquals(false, result.get())
        assertTrue(c.snapshot().isEmpty())
    }
}
