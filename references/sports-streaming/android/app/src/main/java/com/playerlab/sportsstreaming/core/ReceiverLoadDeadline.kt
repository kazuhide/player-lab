package com.playerlab.sportsstreaming.core

data class ReceiverRequestScope(val request: PlaybackRequest, val connectionId: String, val sourceToken: String)

/** A receiver LOAD must settle for one current Source and destination within a bounded interval. */
class ReceiverLoadDeadline(val startedAtMs: Long, private val timeoutMs: Long = 45_000,
                           initialScope: ReceiverRequestScope) {
    var scope = initialScope
        private set
    fun rebind(previous: ReceiverRequestScope, current: ReceiverRequestScope) {
        if (scope == previous && current.sourceToken == previous.sourceToken) scope = current
    }
    fun expired(current: ReceiverRequestScope, nowMs: Long, waiting: Boolean): Boolean =
        waiting && current == scope && nowMs >= startedAtMs && nowMs - startedAtMs >= timeoutMs
}
