package com.playerlab.sportsstreaming.core

data class ReceiverStopProof(
    val connectionId: String, val statusRevision: Long, val mediaSessionId: Long?, val sourceLoadToken: String?,
    val cancelled: Boolean, val mediaCleared: Boolean,
)

/** A new SDK load waits for an actual post-unload receiver status, not a local unload callback. */
class ReceiverStopGate(
    private val connectionId: String, private val previousMediaSessionId: Long?, private val previousLoadToken: String?,
    private val afterRevision: Long, private val startedAtMs: Long, private val timeoutMs: Long = 20_000,
) {
    fun expired(nowMs: Long) = nowMs - startedAtMs >= timeoutMs
    fun accepts(proof: ReceiverStopProof, current: PlaybackRequest?, expected: PlaybackRequest, nowMs: Long): Boolean {
        if (current != expected || expired(nowMs) || nowMs < startedAtMs || proof.connectionId != connectionId ||
            proof.statusRevision <= afterRevision) return false
        if (proof.mediaCleared) return true
        if (!proof.cancelled) return false
        return (previousLoadToken != null && proof.sourceLoadToken == previousLoadToken) ||
            (previousMediaSessionId != null && proof.mediaSessionId == previousMediaSessionId)
    }
}
