package com.playerlab.sportsstreaming.core

enum class ReceiverTransport { PLAY, PAUSE }

/** A remote load can complete after an immediate transport command; apply intent to its actual target. */
class ReceiverLoadIntent(val request: PlaybackRequest, val playWhenReady: Boolean) {
    var fulfilled = false
        private set
    var commandSent = false
        private set
    var commandQueued = false
        private set

    fun observe(current: PlaybackRequest?, sourceMatches: Boolean, playing: Boolean, paused: Boolean): ReceiverTransport? {
        if (current != request || !sourceMatches || (!playing && !paused) || fulfilled) return null
        if ((playWhenReady && playing) || (!playWhenReady && paused)) {
            fulfilled = true
            commandQueued = false
            return null
        }
        if (commandSent || commandQueued) return null
        commandQueued = true
        return if (playWhenReady) ReceiverTransport.PLAY else ReceiverTransport.PAUSE
    }

    /** Revalidate after the receiver callback has returned before issuing an SDK command. */
    fun dispatch(current: PlaybackRequest?, sourceMatches: Boolean, playing: Boolean, paused: Boolean): ReceiverTransport? {
        if (!commandQueued) return null
        commandQueued = false
        if (current != request || !sourceMatches || (!playing && !paused) || fulfilled || commandSent) return null
        if ((playWhenReady && playing) || (!playWhenReady && paused)) {
            fulfilled = true
            return null
        }
        commandSent = true
        return if (playWhenReady) ReceiverTransport.PLAY else ReceiverTransport.PAUSE
    }
}
