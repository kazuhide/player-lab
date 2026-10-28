package com.playerlab.sportsstreaming.core

/** Prevents the SDK's source comparison from waiting on a missing cached queue item or deduplicating an old load. */
data class ReceiverQueueReadiness(val count: Int, val headCached: Boolean, val headMatchesTarget: Boolean?) {
    val permitsLoad: Boolean get() = count == 0 || (count == 1 && headCached && headMatchesTarget == false)
}
