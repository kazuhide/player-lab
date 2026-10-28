package com.playerlab.sportsstreaming.core

import java.net.URI

/** Tokens bind asynchronous results to the selection and actual playback destination. */
data class PlaybackRequest(val generation: Long, val assetId: String, val destination: String)

class PlaybackCoordinator {
    private var generation = 0L
    private var active: PlaybackRequest? = null
    private var handoffClaimed = false
    val current get() = active

    fun select(assetId: String, destination: String): PlaybackRequest {
        require(assetId.isNotBlank() && destination.isNotBlank())
        handoffClaimed = false
        return PlaybackRequest(++generation, assetId, destination).also { active = it }
    }
    fun changeDestination(destination: String): PlaybackRequest? =
        active?.let { select(it.assetId, destination) }
    fun isCurrent(request: PlaybackRequest) = request == active
    fun acceptLoaded(request: PlaybackRequest, actualAssetId: String) =
        isCurrent(request) && request.assetId == actualAssetId
    fun claimHandoff(request: PlaybackRequest): Boolean {
        if (!isCurrent(request) || handoffClaimed) return false
        handoffClaimed = true
        return true
    }
}

enum class EventStatus { SCHEDULED, LIVE, ENDED, CANCELLED }
enum class ArchiveStatus { NOT_READY, PROCESSING, READY, FAILED }
data class EventPlaybackState(val eventStatus: EventStatus, val archiveStatus: ArchiveStatus) {
    val canOfferArchive get() = archiveStatus == ArchiveStatus.READY
    val shouldInterruptLive get() = false
    fun shouldAutoContinue(optedIn: Boolean, position: ArchivePosition) =
        optedIn && eventStatus == EventStatus.ENDED && canOfferArchive && position is ArchivePosition.Available
}
object ReadinessRetry {
    val delaysMs = listOf(2_000L, 5_000L, 10_000L)
    fun delayMs(attempt: Int): Long? = delaysMs.getOrNull(attempt)
}

data class LiveWindow(val earliestOffsetSeconds: Double, val currentOffsetSeconds: Double) {
    init {
        require(earliestOffsetSeconds.isFinite() && earliestOffsetSeconds <= 0)
        require(currentOffsetSeconds.isFinite())
    }
    fun returnToUtc(viewedUtcMs: Long?, liveEdgeUtcMs: Long?): LiveReturn {
        if (viewedUtcMs == null || liveEdgeUtcMs == null) return LiveReturn.Unknown
        val offset = (viewedUtcMs.toDouble() - liveEdgeUtcMs) / 1_000.0
        return if (offset < earliestOffsetSeconds || offset > 0) LiveReturn.Expired else LiveReturn.Available(offset)
    }
}
sealed interface LiveReturn {
    data class Available(val offsetSeconds: Double) : LiveReturn
    data object Expired : LiveReturn
    data object Unknown : LiveReturn
}
class LiveSeekController(private val readCurrentWindow: () -> LiveWindow) {
    fun seekBy(deltaSeconds: Double): Double {
        require(deltaSeconds.isFinite())
        val fresh = readCurrentWindow()
        return (fresh.currentOffsetSeconds + deltaSeconds).coerceIn(fresh.earliestOffsetSeconds, 0.0)
    }
}

data class DiagnosticEntry(val timestampMs: Long, val event: String, val detail: String)
class DiagnosticLog {
    private val buffer = ArrayDeque<DiagnosticEntry>(200)
    val entries: List<DiagnosticEntry> get() = buffer.toList()
    fun add(event: String, detail: String, timestampMs: Long = System.currentTimeMillis()) {
        val safe = Regex("https?://[^\\s]+").replace(detail) { match ->
            runCatching {
                val uri = URI(match.value)
                URI(uri.scheme, null, uri.host, uri.port, uri.path, null, null).toASCIIString()
            }.getOrDefault("[redacted-url]")
        }.take(500)
        if (buffer.size == 200) buffer.removeFirst()
        buffer.addLast(DiagnosticEntry(timestampMs, event.take(80), safe))
    }
}

/** A second generation prevents reordered refreshes for the same selection from regressing state. */
data class StatusRequest(val selection: PlaybackRequest, val refreshGeneration: Long)
class StatusRequestGuard {
    private var generation = 0L
    private var latest: StatusRequest? = null
    fun begin(selection: PlaybackRequest): StatusRequest =
        StatusRequest(selection, ++generation).also { latest = it }
    fun isCurrent(request: StatusRequest, selection: PlaybackRequest?) =
        request == latest && request.selection == selection
}
