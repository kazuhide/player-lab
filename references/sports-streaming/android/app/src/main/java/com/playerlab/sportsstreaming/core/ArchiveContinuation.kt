package com.playerlab.sportsstreaming.core

data class SourceUtcReading(val request: PlaybackRequest?, val sourceIsCurrent: Boolean, val viewedUtcMs: Long?)

/** Resolve the selected archive at dispatch, after validating the current Source and request. */
object ArchiveContinuation {
    fun resolve(mapping: ArchiveMapping, request: PlaybackRequest?, readCurrent: () -> SourceUtcReading): ArchivePosition {
        val reading = readCurrent()
        return if (request != null && reading.request == request && reading.sourceIsCurrent)
            mapping.resolve(reading.viewedUtcMs) else ArchivePosition.Unknown
    }
}
