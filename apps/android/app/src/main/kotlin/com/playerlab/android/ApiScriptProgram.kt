package com.playerlab.android

import org.mozilla.javascript.Context
import org.mozilla.javascript.ContextFactory
import org.mozilla.javascript.Function
import org.mozilla.javascript.NativeArray
import org.mozilla.javascript.Scriptable
import org.mozilla.javascript.ScriptableObject
import org.mozilla.javascript.Undefined

/** Pure value callbacks. No SDK object, Java wrapper, file, URL or Android object enters the script scope. */
internal class ApiScriptProgram(private val body: String) {
    private class Limit : Error()
    private class Budget {
        val deadline = System.nanoTime() + 75_000_000L
        var instructions = 50_000
    }
    private val budget = ThreadLocal<Budget>()
    private val factory = object : ContextFactory() {
        override fun makeContext(): Context = super.makeContext().apply {
            optimizationLevel = -1
            languageVersion = Context.VERSION_ES6
            instructionObserverThreshold = 500
            maximumInterpreterStackDepth = 64
            setClassShutter { false }
        }
        override fun observeInstructionCount(context: Context, count: Int) {
            val current = budget.get() ?: throw Limit()
            current.instructions -= count
            if (current.instructions < 0 || System.nanoTime() > current.deadline) throw Limit()
        }
    }
    init {
        require(body.length in 1..8192) { "Enter a JavaScript function body of at most 8192 characters." }
        evaluate { context, scope -> compile(context, scope); Unit }
    }
    private fun compile(context: Context, scope: Scriptable) = context.evaluateString(
        scope, "(function(input) { 'use strict';\n$body\n})", "local-callback", 1, null) as Function

    private fun <T> evaluate(block: (Context, Scriptable) -> T): T {
        budget.set(Budget())
        try {
            return factory.call { context ->
                val scope = context.initSafeStandardObjects(null, true)
                block(context, scope)
            }
        } catch (_: Limit) {
            throw IllegalArgumentException("Callback exceeded its execution budget.")
        } catch (_: org.mozilla.javascript.RhinoException) {
            throw IllegalArgumentException("Invalid JavaScript callback or return value.")
        } finally { budget.remove() }
    }
    fun run(input: Any?): Any? = evaluate { context, scope ->
        val function = compile(context, scope)
        fromScript(function.call(context, scope, scope, arrayOf(toScript(context, scope, input, 0))), 0)
    }
    private fun checkDepth(depth: Int) {
        val current = budget.get() ?: throw Limit()
        if (depth > 8 || System.nanoTime() > current.deadline) throw Limit()
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
                context.newArray(scope, value.map { toScript(context, scope, it, depth + 1) }.toTypedArray())
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
                (0 until value.length.toInt()).map { fromScript(value.get(it, value), depth + 1) }
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
    fun close() { active = false }
    @Synchronized fun snapshot(): Map<String, Pair<Int, Int>> = counts.toMap()
    fun <T> apply(id: String, program: ApiScriptProgram, input: Any?, fallback: T, decode: (Any?) -> T): T {
        if (!active) return fallback
        return try {
            val result = decode(program.run(input))
            if (!active) fallback else { record(id, false); result }
        } catch (_: Exception) {
            if (active) record(id, true)
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
