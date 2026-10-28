package com.playerlab.sportsstreaming.core

import kotlin.math.roundToLong
import kotlin.math.abs

data class UtcClockSample(
    val sourceToken: String, val destination: String, val positionSeconds: Double,
    val absoluteOffsetSeconds: Double, val sdkLive: Boolean, val verifiedUtcStartMs: Long?,
    val elapsedRealtimeMs: Long, val playbackSpeed: Double = 1.0, val relativeOffsetSeconds: Double = 0.0,
)

/** A Source's verified relative-to-UTC transform survives its final live-to-VoD classification. */
class SourceUtcClock(private val sourceToken: String) {
    private var context: Pair<String, Long?>? = null
    private var lastLive: UtcClockSample? = null
    private var finalizedOffset: Double? = null
    private var finalizationRejected = false
    fun invalidateAfterUnmappedSeek() {
        lastLive = null
        finalizedOffset = null
        finalizationRejected = true
    }

    fun read(sample: UtcClockSample): Long? {
        if (sample.sourceToken != sourceToken) return null
        val sampleContext = sample.destination to sample.verifiedUtcStartMs
        if (context != sampleContext) {
            context = sampleContext
            lastLive = null
            finalizedOffset = null
            finalizationRejected = false
        }
        val origin = sample.verifiedUtcStartMs ?: return null
        if (!sample.positionSeconds.isFinite() || sample.elapsedRealtimeMs < 0) return null
        val absolute = (sample.positionSeconds + sample.absoluteOffsetSeconds) * 1_000.0
        if (absolute.isFinite() && absolute >= origin && absolute < Long.MAX_VALUE.toDouble()) {
            if (sample.sdkLive) lastLive = sample
            return absolute.roundToLong()
        }
        if (sample.sdkLive || finalizationRejected) return null
        if (finalizedOffset == null) {
            val previous = lastLive ?: return null
            val elapsed = sample.elapsedRealtimeMs - previous.elapsedRealtimeMs
            val speed = sample.playbackSpeed.takeIf { it.isFinite() && it > 0 } ?: return null
            // A long background gap cannot establish which coordinate system survived the transition.
            val previousRelative = previous.positionSeconds + previous.relativeOffsetSeconds
            val currentRelative = sample.positionSeconds + sample.relativeOffsetSeconds
            val continuous = elapsed in 0..2_000 && previousRelative.isFinite() && currentRelative.isFinite() &&
                abs(currentRelative - previousRelative) <= elapsed / 1_000.0 * speed + 1.0
            if (!continuous) { finalizationRejected = true; return null }
            // Both offsets came from one SDK snapshot; this is a UTC-to-relative origin, not a double conversion.
            finalizedOffset = previous.absoluteOffsetSeconds - previous.relativeOffsetSeconds
        }
        val mapped = (sample.positionSeconds + sample.relativeOffsetSeconds + requireNotNull(finalizedOffset)) * 1_000.0
        return mapped.takeIf { it.isFinite() && it >= origin && it < Long.MAX_VALUE.toDouble() }?.roundToLong()
    }
}
