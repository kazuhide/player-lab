package com.playerlab.sportsstreaming.core

import kotlin.math.abs

sealed interface ArchivePosition {
    data class Available(val positionMs: Long) : ArchivePosition
    data object End : ArchivePosition
    data object Unmapped : ArchivePosition
    data object Unknown : ArchivePosition
}

data class UtcInterval(val utcStartMs: Long, val utcEndMs: Long, val archiveStartMs: Long) {
    init {
        require(utcStartMs >= 0 && utcEndMs > utcStartMs && archiveStartMs >= 0)
        require(archiveStartMs <= Long.MAX_VALUE - (utcEndMs - utcStartMs))
    }
    val archiveEndMs get() = archiveStartMs + utcEndMs - utcStartMs
}

class ArchiveMapping(
    private val durationMs: Long?,
    private val utcStartMs: Long?,
    private val intervals: List<UtcInterval> = emptyList(),
) {
    init {
        require(durationMs == null || durationMs >= 0)
        require(utcStartMs == null || utcStartMs >= 0)
        intervals.zipWithNext().forEach { (a, b) ->
            require(a.utcEndMs <= b.utcStartMs && a.archiveEndMs <= b.archiveStartMs)
        }
        require(durationMs == null || intervals.all { it.archiveEndMs <= durationMs })
    }

    fun resolve(viewedUtcMs: Long?): ArchivePosition {
        if (viewedUtcMs == null || durationMs == null) return ArchivePosition.Unknown
        val offset = if (intervals.isNotEmpty()) {
            val interval = intervals.firstOrNull { viewedUtcMs >= it.utcStartMs && viewedUtcMs < it.utcEndMs }
            if (interval == null) {
                val last = intervals.last()
                return if (viewedUtcMs == last.utcEndMs && last.archiveEndMs == durationMs) {
                    ArchivePosition.End
                } else ArchivePosition.Unmapped
            }
            interval.archiveStartMs + viewedUtcMs - interval.utcStartMs
        } else {
            if (utcStartMs == null) return ArchivePosition.Unknown
            if (viewedUtcMs < utcStartMs) return ArchivePosition.Unmapped
            viewedUtcMs - utcStartMs
        }
        return when {
            offset < durationMs -> ArchivePosition.Available(offset)
            offset == durationMs -> ArchivePosition.End
            else -> ArchivePosition.Unmapped
        }
    }
}

data class HandoffExpectation(val assetId: String, val positionMs: Long, val playWhenReady: Boolean) {
    init { require(assetId.isNotBlank() && positionMs >= 0) }
    fun isConfirmed(
        actualAssetId: String?, actualPositionMs: Long?, isPlaying: Boolean,
        isPaused: Boolean, advancing: Boolean,
    ): Boolean {
        if (!matchesPosition(actualAssetId, actualPositionMs)) return false
        return if (playWhenReady) isPlaying && advancing else isPaused && !isPlaying
    }
    fun matchesPosition(actualAssetId: String?, actualPositionMs: Long?) =
        actualAssetId == assetId && actualPositionMs != null && actualPositionMs >= 0 &&
            abs(actualPositionMs.toDouble() - positionMs) <= 1_000.0
}
