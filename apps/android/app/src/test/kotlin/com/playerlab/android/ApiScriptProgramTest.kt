package com.playerlab.android

import org.junit.Assert.*
import org.junit.Test

class ApiScriptProgramTest {
    @Test fun userBodyTransformsTypedValuesWithoutAJavaBridge() {
        val result = ApiScriptProgram("return {label: input.language.toUpperCase(), delays: input.delays.map(function(x) { return x * 2; })};")
            .run(mapOf("language" to "en", "delays" to listOf(0.25, 1))) as Map<*, *>
        assertEquals("EN", result["label"])
        assertEquals(listOf(0.5, 2.0), result["delays"])
        assertEquals("undefined:undefined:undefined", ApiScriptProgram("return typeof Packages + ':' + typeof java + ':' + typeof JavaAdapter;").run(null))
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
