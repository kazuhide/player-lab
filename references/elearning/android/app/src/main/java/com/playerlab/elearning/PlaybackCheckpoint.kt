package com.playerlab.elearning

/** A selected offset becomes a playback checkpoint only after its Source is ready. */
internal class PlaybackCheckpoint(initialPositionMs: Long) {
    init { require(initialPositionMs >= 0) }
    var positionMs = initialPositionMs
        private set
    var isReady = false
        private set

    fun ready() { isReady = true }
    fun unavailable() { isReady = false }

    fun sample(seconds: Double, durationSeconds: Double) {
        if (isReady && seconds.isFinite() && durationSeconds.isFinite() && durationSeconds > 0 && seconds in 0.0..durationSeconds) {
            positionMs = (seconds * 1000).toLong()
        }
    }
}
