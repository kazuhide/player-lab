package com.playerlab.android

import com.bitmovin.player.api.vr.VrRenderer
import com.bitmovin.player.api.vr.orientation.Vector3
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

internal data class ApiVrCallbackResult(val text: String?, val move: Vector3?)
internal class ApiVrUserCallback(
    val renderer: ApiVrRenderer,
    body: String,
    private val everyFrames: Int,
    private val snapshot: (Double) -> Map<String, Any?>,
    private val publish: (ApiVrUserCallback, ApiVrCallbackResult) -> Unit,
) : VrRenderer.UpdateCallback {
    private val program = ApiScriptProgram(body)
    val context = ApiCallbackContext()
    val calls = AtomicLong()
    private val pending = AtomicBoolean()
    private val latest = AtomicReference<ApiVrCallbackResult>()
    init { require(everyFrames in 1..3600) }
    override fun update(delta: Double) {
        val count = calls.incrementAndGet()
        if (!context.active || count % everyFrames != 0L) return
        val result = context.apply("VrRenderer.UpdateCallback", program, snapshot(delta), null as ApiVrCallbackResult?) { value ->
            if (value == null) null else {
                val fields = value as? Map<*, *> ?: error("Return {text?, move?} or null.")
                require(fields.keys.all { it in setOf("text", "move") })
                val text = fields["text"]?.let { (it as? String ?: error("Text must be a string.")).also { s -> require(s.length <= 256) } }
                val move = fields["move"]?.let {
                    val vector = it as? Map<*, *> ?: error("Move must be {phi, x, y}.")
                    require(vector.keys == setOf("phi", "x", "y"))
                    fun number(key: String) = (vector[key] as? Number)?.toDouble()?.also { n -> require(n.isFinite()) } ?: error("Move values must be finite numbers.")
                    Vector3(number("phi"), number("x"), number("y"))
                }
                ApiVrCallbackResult(text, move)
            }
        } ?: return
        latest.set(result)
        if (pending.compareAndSet(false, true)) publish(this, result)
    }
    fun takeResult(): ApiVrCallbackResult? { val result = latest.getAndSet(null); pending.set(false); return result }
    fun close() { context.close(); latest.set(null) }
}
internal object ApiVrRuntime {
    private fun renderer(c: PlayerController) = requireNotNull(c.apiVrRenderer) { "Enable the host VR renderer first." }
    val commands = listOf(
        ApiCommand("android:com.bitmovin.player.api.vr.VrApi.setVrRenderer()", listOf(ApiArgument("enabled", "true", listOf("true", "false")))) { c, i -> c.setApiVrRendererActive(i.bool("enabled")) },
        ApiCommand("android:com.bitmovin.player.api.vr.VrRenderer.setSourceConfig()", listOf(ApiArgument("source", "Active", listOf("Active", "Configured", "None")))) { c, i ->
            renderer(c).setSourceConfig(when (i.text("source")) { "Active" -> c.player.source?.config; "Configured" -> c.configuredSource?.config; else -> null })
        },
        ApiCommand("android:com.bitmovin.player.api.vr.VrRenderer.addUpdateCallback()", listOf(ApiArgument("handle", "frame-observer"), ApiArgument("everyFrames", "15"),
            ApiArgument("body", "return {text: input.delta.toFixed(3)};", multiline = true))) { c, i -> c.addApiVrCallback(i.text("handle"), i.int("everyFrames", 1, 3600), i.text("body")) },
        ApiCommand("android:com.bitmovin.player.api.vr.VrRenderer.removeUpdateCallback()", listOf(ApiArgument("handle", "frame-observer"))) { c, i -> c.removeApiVrCallback(i.text("handle")) },
    )
    val reads = listOf(ApiRead("app:vr-renderer") { c -> c.apiVrRenderer?.let { mapOf("decodedFrames" to it.decodedFrames, "drawnFrames" to it.drawnFrames,
        "callbackCalls" to it.callbackCalls, "callbackCount" to it.callbackCount, "sourceUpdates" to it.sourceUpdates, "hasFailed" to it.hasFailed, "userCallbacks" to c.apiVrCallbackStates.toMap()) } },
        ApiRead("app:native-factory-resources") { ApiNativeFactories.snapshot() })
}
