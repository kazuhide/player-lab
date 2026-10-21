package com.playerlab.android

import org.mozilla.javascript.Context
import org.mozilla.javascript.ContextFactory
import org.mozilla.javascript.Function
import org.mozilla.javascript.NativeArray
import org.mozilla.javascript.Scriptable
import org.mozilla.javascript.Script
import org.mozilla.javascript.ScriptableObject
import org.mozilla.javascript.Undefined

internal class ApiScriptBudgetException(val phase: String, val elapsedMillis: Long, val cpuMillis: Long?, val convertedItems: Int, val phases: Map<String, Long>) : IllegalArgumentException("Callback exceeded its execution budget ($phase).")
internal class ApiScriptExecutionException : IllegalArgumentException("Invalid JavaScript callback or return value.")

internal data class ApiScriptTiming(val wallMillis: Long, val cpuMillis: Long?, val phasesMillis: Map<String, Long>)

/** Pure value callbacks. No SDK object, Java wrapper, file, URL or Android object enters the script scope. */
internal class ApiScriptProgram(private val body: String) {
    private class Limit(val phase: String) : Error()
    private class Budget {
        val started = System.nanoTime()
        val deadline = started + 75_000_000L
        val cpuStarted = runCatching { android.os.Debug.threadCpuTimeNanos() }.getOrNull()
        var convertedItems = 0
        var instructions = 50_000
        var phase = "scope initialization"
        var phaseStarted = started
        val phases = linkedMapOf<String, Long>()
        fun next(value: String) { val now = System.nanoTime(); phases[phase] = (now - phaseStarted) / 1_000_000; phase = value; phaseStarted = now }
        fun elapsedPhases() = phases + (phase to (System.nanoTime() - phaseStarted) / 1_000_000)
    }
    private val budget = ThreadLocal<Budget>()
    private val factory = object : ContextFactory() {
        // Callback inputs are plain values; disable E4X and its platform XML parser.
        override fun hasFeature(context: Context, featureIndex: Int): Boolean =
            if (featureIndex == Context.FEATURE_E4X) false else super.hasFeature(context, featureIndex)
        override fun makeContext(): Context = super.makeContext().apply {
            optimizationLevel = -1
            languageVersion = Context.VERSION_ES6
            instructionObserverThreshold = 500
            maximumInterpreterStackDepth = 64
            setClassShutter { false }
        }
        override fun observeInstructionCount(context: Context, count: Int) {
            val current = budget.get() ?: throw Limit("missing budget")
            current.instructions -= count
            if (current.instructions < 0 || System.nanoTime() > current.deadline) throw Limit(current.phase)
        }
    }
    // Sealed standard objects are shared; each invocation receives its own writable global.
    // https://rhino.github.io/docs/scopes_and_contexts/
    private val standardScope = factory.call { context ->
        context.initSafeStandardObjects(null, true).also { it.sealObject() }
    }
    private val compiled: Script
    init {
        require(body.length in 1..8192) { "Enter a JavaScript function body of at most 8192 characters." }
        compiled = try {
            factory.call { context -> context.compileString("(function(input) { 'use strict';\n$body\n})", "local-callback", 1, null) }
        } catch (_: org.mozilla.javascript.RhinoException) {
            throw ApiScriptExecutionException()
        }
    }

    private fun <T> evaluate(observed: (ApiScriptTiming) -> Unit, block: (Context, Scriptable) -> T): T {
        budget.set(Budget())
        try {
            return factory.call { context ->
                val scope = context.newObject(standardScope).apply { prototype = standardScope; parentScope = null }
                block(context, scope)
            }
        } catch (error: Limit) {
            val current = requireNotNull(budget.get())
            throw ApiScriptBudgetException(error.phase, (System.nanoTime() - current.started) / 1_000_000,
                current.cpuStarted?.let { start -> runCatching { (android.os.Debug.threadCpuTimeNanos() - start) / 1_000_000 }.getOrNull() }, current.convertedItems, current.elapsedPhases())
        } catch (_: org.mozilla.javascript.RhinoException) {
            throw ApiScriptExecutionException()
        } finally {
            val current = requireNotNull(budget.get())
            val timing = ApiScriptTiming((System.nanoTime() - current.started) / 1_000_000,
                current.cpuStarted?.let { start -> runCatching { (android.os.Debug.threadCpuTimeNanos() - start) / 1_000_000 }.getOrNull() }, current.elapsedPhases())
            budget.remove()
            observed(timing)
        }
    }
    fun run(input: Any?, observed: (ApiScriptTiming) -> Unit = {}): Any? = evaluate(observed) { context, scope ->
        val function = compiled.exec(context, scope) as Function
        requireNotNull(budget.get()).next("input conversion")
        val converted = toScript(context, scope, input, 0)
        requireNotNull(budget.get()).next("script execution")
        val returned = function.call(context, scope, scope, arrayOf(converted))
        requireNotNull(budget.get()).next("output conversion")
        fromScript(returned, 0)
    }
    private fun checkDepth(depth: Int) {
        val current = budget.get() ?: throw Limit("missing budget")
        if (depth > 8 || System.nanoTime() > current.deadline) throw Limit(current.phase)
    }
    private fun toScript(context: Context, scope: Scriptable, value: Any?, depth: Int): Any? {
        checkDepth(depth)
        return when (value) {
            null, is Boolean, is Number -> value
            is String -> value.also { require(it.length <= 131_072) }
            is Map<*, *> -> context.newObject(scope).also { objectValue ->
                require(value.size <= 128)
                value.forEach { (key, item) ->
                    require(key is String && key.length <= 256)
                    ScriptableObject.putProperty(objectValue, key, toScript(context, scope, item, depth + 1))
                }
            }
            is List<*> -> {
                require(value.size <= 65_536)
                val items = arrayOfNulls<Any>(value.size)
                if (items.isNotEmpty()) checkDepth(depth + 1)
                value.forEachIndexed { index, item ->
                    if (index % 32 == 0) checkDepth(depth + 1)
                    items[index] = when (item) {
                        null, is Boolean, is Number -> item
                        is String -> item.also { require(it.length <= 131_072) }
                        else -> toScript(context, scope, item, depth + 1)
                    }
                }
                checkDepth(depth)
                context.newArray(scope, items)
            }
            else -> error("Unsupported callback input type.")
        }
    }
    private fun fromScript(value: Any?, depth: Int): Any? {
        checkDepth(depth)
        return when (value) {
            null, is Undefined -> null
            is Boolean -> value
            is Number -> value.toDouble().also { require(it.isFinite()) }
            is CharSequence -> value.toString().also { require(it.length <= 131_072) }
            is NativeArray -> {
                require(value.length <= 65_536)
                val length = value.length.toInt()
                if (length > 0) checkDepth(depth + 1)
                val items = ArrayList<Any?>(length)
                repeat(length) { index ->
                    // Batch checks avoid a clock/thread-local lookup for every media byte.
                    // User-defined getters still execute under the interpreter instruction observer.
                    if (index % 32 == 0) { requireNotNull(budget.get()).convertedItems = index; checkDepth(depth + 1) }
                    val item = value.get(index, value).let { if (it === Scriptable.NOT_FOUND) null else it }
                    items.add(when (item) {
                        null, is Undefined -> null
                        is Boolean -> item
                        is Number -> item.toDouble().also { require(it.isFinite()) }
                        is CharSequence -> item.toString().also { require(it.length <= 131_072) }
                        else -> fromScript(item, depth + 1)
                    })
                }
                checkDepth(depth)
                items
            }
            is Scriptable -> {
                require(value.className == "Object") { "Return a plain value object." }
                val keys = value.ids
                require(keys.size <= 128)
                keys.associate { key ->
                    require(key is String && key.length <= 256)
                    key to fromScript(value.get(key, value), depth + 1)
                }
            }
            else -> error("Return a boolean, finite number, string, array, plain object or null.")
        }
    }
}

/** Each live Player/Source owns its callback context; retirement prevents script results from being applied. */
internal class ApiCallbackContext {
    @Volatile var active = true
        private set
    private val counts = linkedMapOf<String, Pair<Int, Int>>()
    private val failureKinds = linkedMapOf<String, String>()
    private val byteCounts = linkedMapOf<String, Int>()
    private val timings = linkedMapOf<String, ApiScriptTiming>()
    fun close() { active = false }
    @Synchronized fun snapshot(): Map<String, Pair<Int, Int>> = counts.toMap()
    @Synchronized fun fallbackReasons(): Map<String, String> = failureKinds.toMap()
    @Synchronized fun byteInputSizes(): Map<String, Int> = byteCounts.toMap()
    @Synchronized fun performanceSnapshot(): Map<String, ApiScriptTiming> = timings.toMap()
    @Synchronized fun recordByteInput(id: String, size: Int) { if (active) byteCounts[id] = size }
    fun <T> apply(id: String, program: ApiScriptProgram, input: Any?, fallback: T, decode: (Any?) -> T): T {
        if (!active) return fallback
        return try {
            val result = decode(program.run(input) { timing -> synchronized(this) { if (active) timings[id] = timing } })
            if (!active) fallback else { record(id, false); result }
        } catch (error: Exception) {
            if (active) {
                val kind = when (error) {
                    is ApiScriptBudgetException -> "execution budget (${error.phase}; wall=${error.elapsedMillis}ms; cpu=${error.cpuMillis ?: "unavailable"}ms; convertedItems=${error.convertedItems}; phases=${error.phases})"
                    is ApiScriptExecutionException -> "script execution"
                    else -> "return contract"
                }
                synchronized(this) { if (active) failureKinds[id] = kind }
                record(id, true)
            }
            fallback
        }
    }
    @Synchronized private fun record(id: String, failed: Boolean) {
        if (!active) return
        val old = counts[id] ?: (0 to 0)
        counts[id] = (old.first.toLong() + 1).coerceAtMost(Int.MAX_VALUE.toLong()).toInt() to
            (old.second.toLong() + if (failed) 1 else 0).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }
}
