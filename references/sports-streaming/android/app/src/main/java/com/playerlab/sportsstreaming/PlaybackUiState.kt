package com.playerlab.sportsstreaming

import com.playerlab.sportsstreaming.core.*

enum class PlaybackNotice {
    NONE, CATALOG_OFFLINE, CATALOG_FAILED, LICENSE_MISSING, MEDIA_FAILED, STATUS_FAILED,
    POSITION_UNKNOWN, POSITION_EXPIRED, CAST_MEDIA_UNREACHABLE, CAST_FAILED,
}
data class PlaybackUiState(
    val catalog: SportsCatalog? = null,
    val selectedEventId: String? = null,
    val activeAssetId: String? = null,
    val archiveTargetId: String? = null,
    val protocol: StreamProtocol = StreamProtocol.HLS,
    val sportsUi: Boolean = false,
    val loadingCatalog: Boolean = true,
    val loadingSource: Boolean = false,
    val isPlaying: Boolean = false,
    val isPaused: Boolean = false,
    val isLive: Boolean = false,
    val positionMs: Long? = null,
    val durationMs: Long? = null,
    val timeShiftSeconds: Double = 0.0,
    val earliestTimeShiftSeconds: Double = 0.0,
    val viewedUtcMs: Long? = null,
    val archivePosition: ArchivePosition = ArchivePosition.Unknown,
    val autoContinue: Boolean = false,
    val canReturnOriginal: Boolean = false,
    val notice: PlaybackNotice = PlaybackNotice.NONE,
    val errorCode: Int? = null,
    val sourceFailed: Boolean = false,
    val castConnection: CastConnection = CastConnection.DISCONNECTED,
    val castName: String? = null,
    val needsLocalReturnChoice: Boolean = false,
    val diagnosticRevision: Int = 0,
) {
    val selectedEvent get() = catalog?.event(selectedEventId)
    val activeAsset get() = catalog?.asset(activeAssetId)
    val canControlPlayback get() = acceptsPlaybackCommands && activeAssetId != null && !loadingSource && errorCode == null && !sourceFailed
    val hasUsableSeekTimeline get() = activeAsset?.kind != AssetKind.LIVE || isLive
    val canSeekBack get() = canControlPlayback && hasUsableSeekTimeline && if (isLive) earliestTimeShiftSeconds < timeShiftSeconds - 0.1 else (positionMs ?: 0) > 0
    val canSeekForward get() = canControlPlayback && hasUsableSeekTimeline && if (isLive) timeShiftSeconds < -0.1 else
        positionMs != null && durationMs != null && positionMs < durationMs
    val acceptsPlaybackCommands get() = !needsLocalReturnChoice &&
        castConnection !in setOf(CastConnection.CONNECTING, CastConnection.RECONNECTING)
}
