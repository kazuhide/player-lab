package com.playerlab.android.playback

import kotlin.math.abs

/**
 * Playback timing and live seek-window calculations, independent of the Player SDK.
 * The live edge is `0`, the past is negative, and the lower window bound is
 * `maxTimeShift` (`<= 0`).
 */

enum class PlaybackMode(val raw: String) {
    VOD("vod"),
    LIVE_DVR("live-dvr"),
    LIVE_NO_DVR("live-no-dvr"),
}

data class PlayerSnapshot(
    val isLive: Boolean,
    /** `Double.POSITIVE_INFINITY` for live, finite for VOD. */
    val duration: Double,
    /** `<= 0`; may be `0` for HLS until the buffer fills. */
    val maxTimeShift: Double,
    /** Offset in `[maxTimeShift, 0]`; `0` is the live edge. */
    val timeShift: Double,
    val currentTime: Double,
)

data class TimelineConfig(
    val timeShiftEnabled: Boolean,
    val liveEdgeEpsilon: Double = 1.0,
)

data class TimelineState(
    val mode: PlaybackMode,
    val isLive: Boolean,
    val dvrAvailable: Boolean,
    val windowDuration: Double,
    val behindLive: Double,
    val atLiveEdge: Boolean,
    val seekProgress: Double,
)

object PlaybackTimeline {
    /** Clamp a requested offset into the legal window `[maxTimeShift, 0]`. */
    fun clampToWindow(requested: Double, maxTimeShift: Double): Double {
        if (!requested.isFinite()) return 0.0
        if (!maxTimeShift.isFinite() || maxTimeShift >= 0) return 0.0
        return minOf(0.0, maxOf(maxTimeShift, requested))
    }

    /** True within `epsilon` seconds of the live edge (offset `0`). */
    fun isAtLiveEdge(timeShift: Double, epsilon: Double = 1.0): Boolean =
        timeShift.isFinite() && abs(timeShift) <= epsilon

    /** Window length in seconds (`>= 0`). For HLS this is `0` until the buffer fills. */
    fun windowDuration(maxTimeShift: Double): Double =
        if (maxTimeShift.isFinite() && maxTimeShift < 0) -maxTimeShift else 0.0

    /** Distance behind the live edge in seconds (`>= 0`). */
    fun behindLive(timeShift: Double): Double =
        if (timeShift.isFinite() && timeShift < 0) -timeShift else 0.0

    /** Normalized scrubber position in `[0, 1]`: `0` = oldest, `1` = live edge. */
    fun seekProgress(timeShift: Double, maxTimeShift: Double): Double {
        val win = windowDuration(maxTimeShift)
        if (win <= 0) return 1.0
        val offset = clampToWindow(timeShift, maxTimeShift)
        return (win + offset) / win
    }

    /** Whether the DVR window has settled (HLS reads `0` until the buffer fills). */
    fun isWindowSettled(maxTimeShift: Double): Boolean = maxTimeShift < 0

    /** Finite, positive duration ⇒ VOD (live duration is `Infinity`; `0`/`NaN` ⇒ "not yet known" ⇒ live). */
    fun isLiveStream(s: PlayerSnapshot): Boolean {
        if (s.duration.isFinite() && s.duration > 0) return false
        return true
    }

    fun deriveState(s: PlayerSnapshot, config: TimelineConfig): TimelineState {
        val live = isLiveStream(s)
        val win = windowDuration(s.maxTimeShift)
        val dvrAvailable = live && config.timeShiftEnabled && win > 0
        val mode = when {
            !live -> PlaybackMode.VOD
            dvrAvailable -> PlaybackMode.LIVE_DVR
            else -> PlaybackMode.LIVE_NO_DVR
        }
        val offset = clampToWindow(s.timeShift, s.maxTimeShift)
        return TimelineState(
            mode = mode,
            isLive = live,
            dvrAvailable = dvrAvailable,
            windowDuration = win,
            behindLive = if (live) behindLive(offset) else 0.0,
            atLiveEdge = if (live) isAtLiveEdge(offset, config.liveEdgeEpsilon) else false,
            seekProgress = if (live) seekProgress(offset, s.maxTimeShift) else 1.0,
        )
    }

    /**
     * True when a live stream has just finalized into VOD between two snapshots.
     * Android emits `DurationChanged`, but the snapshot poll keeps parity with iOS.
     */
    fun detectLiveToVod(prev: PlayerSnapshot, next: PlayerSnapshot): Boolean =
        isLiveStream(prev) && !isLiveStream(next)

    // Labels (§7)

    fun formatDuration(seconds: Double): String {
        if (!seconds.isFinite()) return "0s"
        val total = maxOf(0, seconds.toInt())
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return when {
            h > 0 -> "${h}h ${pad(m)}m"
            m > 0 -> "${m}m ${pad(s)}s"
            else -> "${s}s"
        }
    }

    /** `"LIVE"` at the edge, otherwise the behind-live offset, e.g. `"-1m 05s behind"`. */
    fun formatBehindLive(timeShift: Double, epsilon: Double = 1.0, liveLabel: String = "LIVE"): String =
        if (isAtLiveEdge(timeShift, epsilon)) liveLabel else "-${formatDuration(behindLive(timeShift))} behind"

    private fun pad(n: Int): String = if (n < 10) "0$n" else "$n"
}
