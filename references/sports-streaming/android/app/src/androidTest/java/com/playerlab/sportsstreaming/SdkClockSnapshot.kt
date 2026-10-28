package com.playerlab.sportsstreaming

import android.os.Bundle
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.Player
import com.playerlab.sportsstreaming.core.SOURCE_LOAD_TOKEN_METADATA_KEY
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

internal object SdkClockSnapshot {
    fun capture(session: PlaybackSession, stage: String): JSONObject {
        val player = session.player
        val source = player.source
        val range = source?.seekableRange
        val request = session.coordinator.current
        fun hash(value: String?) = value?.let { text ->
            MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
        } ?: JSONObject.NULL
        val result = JSONObject().put("stage", stage).put("observedAtEpochMs", System.currentTimeMillis())
            .put("elapsedRealtimeMs", SystemClock.elapsedRealtime()).put("sdkVersion", "3.172.0")
            .put("protocol", session.state.value.protocol.name).put("sdkLive", player.isLive)
            .put("playing", player.isPlaying).put("paused", player.isPaused)
            .put("assetId", session.state.value.activeAssetId ?: JSONObject.NULL)
            .put("sourceObjectId", source?.let(System::identityHashCode) ?: JSONObject.NULL)
            .put("sourceUrlSha256", hash(source?.config?.url))
            .put("sourceLoadTokenSha256", hash(source?.config?.metadata?.get(SOURCE_LOAD_TOKEN_METADATA_KEY)))
            .put("impressionSha256", hash(session.snapshot().impressionId))
            .put("requestGeneration", request?.generation ?: JSONObject.NULL)
            .put("requestDestinationKind", request?.destination?.substringBefore(':') ?: JSONObject.NULL)
            .put("requestDestinationSha256", hash(request?.destination))
            .put("verifiedUtcStartMs", session.state.value.activeAsset?.utcStartMs ?: JSONObject.NULL)
            .put("freshMappedUtcMs", session.viewedUtcForCurrentSource() ?: JSONObject.NULL)
        fun number(name: String, value: Double?) {
            result.put(name, value?.takeIf { it.isFinite() } ?: JSONObject.NULL)
            result.put(name + "Kind", when {
                value == null -> "unavailable"
                value.isNaN() -> "nan"
                value == Double.POSITIVE_INFINITY -> "positive-infinity"
                value == Double.NEGATIVE_INFINITY -> "negative-infinity"
                else -> "finite"
            })
        }
        number("currentTimeSeconds", player.currentTime)
        number("playerDurationSeconds", player.duration)
        number("sourceDurationSeconds", source?.duration)
        number("absoluteOffsetSeconds", player.playbackTimeOffsetToAbsoluteTime)
        number("relativeOffsetSeconds", player.playbackTimeOffsetToRelativeTime)
        number("seekableStartSeconds", range?.start)
        number("seekableEndSeconds", range?.end)
        number("timeShiftSeconds", player.timeShift)
        number("maxTimeShiftSeconds", player.maxTimeShift)
        val timeMethods = Player::class.java.methods.filter { it.name == "getCurrentTime" }
            .map { method -> "${method.name}(${method.parameterTypes.joinToString { it.name }})" }
        result.put("publicCurrentTimeMethods", JSONArray(timeMethods))
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.filesDir, "endurance/${session.state.value.protocol.name.lowercase()}-clock-snapshots.json")
        file.parentFile?.mkdirs()
        val existing = runCatching { JSONObject(file.readText()) }.getOrDefault(JSONObject())
        if (stage.endsWith("before")) existing.remove("after")
        existing.put(if (stage.endsWith("before")) "before" else "after", result)
        file.writeText(existing.toString(2))
        InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
            putString("sdkClockSnapshot", result.toString())
        })
        return result
    }
}
