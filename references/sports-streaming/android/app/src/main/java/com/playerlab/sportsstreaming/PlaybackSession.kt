package com.playerlab.sportsstreaming

import android.app.Application
import android.os.Looper
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.bitmovin.analytics.api.AnalyticsConfig
import com.bitmovin.analytics.api.SourceMetadata
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.analytics.AnalyticsApi.Companion.analytics
import com.bitmovin.player.api.analytics.AnalyticsPlayerConfig
import com.bitmovin.player.api.analytics.AnalyticsSourceConfig
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.media.subtitle.SubtitleTrack
import com.bitmovin.player.api.source.Source
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceOptions
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.source.TimelineReferencePoint
import com.playerlab.sportsstreaming.core.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlin.math.roundToLong
import java.net.URI
import android.os.SystemClock
import android.os.Handler
import com.bitmovin.player.casting.BitmovinCastManager
import org.json.JSONObject
import com.google.android.gms.cast.MediaStatus
import java.security.MessageDigest

class PlaybackSession(application: Application) : AndroidViewModel(application) {
    val player: Player = Player(application, PlayerConfig(key = BuildConfig.PLAYER_LICENSE_KEY),
        if (BuildConfig.ANALYTICS_LICENSE_KEY.isBlank()) AnalyticsPlayerConfig.Disabled
        else AnalyticsPlayerConfig.Enabled(AnalyticsConfig(BuildConfig.ANALYTICS_LICENSE_KEY)))
    private val repository = CatalogRepository(application)
    private val mutableState = MutableStateFlow(PlaybackUiState())
    val state = mutableState.asStateFlow()
    val diagnostics = DiagnosticLog()
    val handoffs = HandoffLedger()
    internal val coordinator = PlaybackCoordinator()
    private val statusGuard = StatusRequestGuard()
    private var statusJob: Job? = null
    private var catalogJob: Job? = null
    private var catalogGeneration = 0L
    private var savedLive: SavedLivePosition? = null
    private var pendingLiveReturn: PendingLiveReturn? = null
    private var pendingHandoff: PendingHandoff? = null
    private val castRecovery = CastRecovery()
    private var castController: CastController? = null
    private var activeCastId: String? = null
    private var lastReceiverIntent: Boolean? = null
    private var lastReceiverUtcMs: Long? = null
    private var lastReceiverPosition: Long? = null
    private var pendingRemoteLoad: RemoteLoad? = null
    private var lastReceiverObservation: ReceiverObservation? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastTransportDispatch: JSONObject? = null
    private var receiverEvidence = ReceiverEvidence(null, null, null, null, 0)
    private var activeSource: Source? = null
    private var screenActive = true
    internal var desiredPlaying = false
    var loadCount = 0
        private set
    var lastErrorCode: Int? = null
        private set

    init {
        player.on(PlayerEvent.Error::class) {
            lastErrorCode = it.code.value
            diagnostics.add("player-error", "code=${it.code.value}")
            mutableState.update { current -> current.copy(notice = PlaybackNotice.MEDIA_FAILED, errorCode = it.code.value, loadingSource = false) }
        }
        player.on(SourceEvent.Loaded::class) {
            if (it.source !== activeSource) return@on
            diagnostics.add("source-loaded", coordinator.current?.assetId ?: "debug-source")
            if (pendingRemoteLoad == null) mutableState.update { current -> current.copy(loadingSource = false) }
        }
        player.on(PlayerEvent.Play::class) { if (pendingRemoteLoad == null) desiredPlaying = true }
        player.on(PlayerEvent.Paused::class) { if (pendingRemoteLoad == null) desiredPlaying = false }
        player.on(PlayerEvent.PlaybackFinished::class) {
            if (state.value.activeAsset?.kind == AssetKind.CLIP && state.value.selectedEvent?.status == EventStatus.LIVE) returnToLive(false)
        }
        castController = CastController(application, ::onCastConnection, ::onReceiverMedia) {
            mutableState.update { it.copy(notice = PlaybackNotice.CAST_FAILED) }
        }
        player.on(PlayerEvent.CastStopped::class) {
            activeCastId?.let { id -> onCastConnection(CastConnection.DISCONNECTED, id, null) }
        }
        player.on(PlayerEvent.CastTimeUpdated::class) { castController?.refresh() }
        player.on(PlayerEvent.CastStart::class) { recordCastRequest() }
        reloadCatalog()
        viewModelScope.launch {
            while (isActive) {
                if (screenActive) updatePlaybackState()
                delay(if (screenActive) 250 else 1_000)
            }
        }
    }

    fun overrideMediaBaseForDebug(url: String) {
        check(BuildConfig.DEBUG)
        repository.overrideMediaBaseForDebug(url)
        reloadCatalog()
    }
    fun receiverEvidenceForTest() = receiverEvidence
    fun setScreenActive(active: Boolean) { screenActive = active }
    fun reloadCatalog() {
        val generation = ++catalogGeneration
        catalogJob?.cancel()
        mutableState.update { it.copy(loadingCatalog = true) }
        catalogJob = viewModelScope.launch {
            runCatching { repository.catalog() }.onSuccess { result ->
                if (generation != catalogGeneration) return@onSuccess
                mutableState.update { current -> current.copy(catalog = result.catalog, loadingCatalog = false,
                    selectedEventId = current.selectedEventId ?: result.catalog.events.first().id,
                    notice = if (result.offline) PlaybackNotice.CATALOG_OFFLINE else PlaybackNotice.NONE) }
            }.onFailure { error ->
                if (error is CancellationException) throw error
                if (generation == catalogGeneration) mutableState.update { it.copy(loadingCatalog = false, notice = PlaybackNotice.CATALOG_FAILED) }
            }
        }
    }
    fun selectAsset(assetId: String, protocol: StreamProtocol = state.value.protocol,
                    startMs: Long? = null, playWhenReady: Boolean = true) {
        checkMainThread()
        if (!state.value.acceptsPlaybackCommands) return
        if (BuildConfig.PLAYER_LICENSE_KEY.isBlank()) {
            mutableState.update { it.copy(notice = PlaybackNotice.LICENSE_MISSING) }; return
        }
        val asset = state.value.catalog?.asset(assetId) ?: return
        if (asset.kind == AssetKind.ARCHIVE && state.value.catalog?.event(asset.eventId)?.archiveStatus != ArchiveStatus.READY) return
        val previous = state.value
        val previousAsset = previous.activeAsset
        if (asset.kind == AssetKind.CLIP && previousAsset?.kind == AssetKind.LIVE) {
            savedLive = SavedLivePosition(previousAsset.eventId, previous.viewedUtcMs, desiredPlaying)
        }
        pendingHandoff = null
        pendingLiveReturn = null
        val chosenProtocol = protocol.takeIf { asset.streams.containsKey(it) } ?: asset.streams.keys.first()
        val request = coordinator.select(asset.id, destination())
        receiverEvidence = ReceiverEvidence(null, null, null, null, receiverEvidence.samples)
        val config = SourceConfig(asset.streams.getValue(chosenProtocol),
            if (chosenProtocol == StreamProtocol.HLS) SourceType.Hls else SourceType.Dash,
            title = asset.title, subtitleTracks = asset.subtitleTracks.mapIndexed { index, caption ->
                SubtitleTrack(caption.url, mimeType = "text/vtt", label = caption.label,
                    id = "caption-$index-${caption.language}", language = caption.language)
            }, options = SourceOptions(startMs?.let { it / 1_000.0 }, TimelineReferencePoint.Start))
        mutableState.update { it.copy(activeAssetId = asset.id, selectedEventId = asset.eventId,
            protocol = chosenProtocol, loadingSource = true, notice = PlaybackNotice.NONE,
            archiveTargetId = if (asset.eventId == it.selectedEventId) it.archiveTargetId else null,
            errorCode = null, viewedUtcMs = null, archivePosition = ArchivePosition.Unknown) }
        loadSource(config, asset.videoId, asset.title, playWhenReady)
        diagnostics.add("load-requested", "${request.generation}:${asset.id}:${request.destination.substringBefore(':')}")
        if (player.isCasting) {
            val position = startMs ?: if (asset.kind == AssetKind.LIVE) null else 0L
            val record = handoffs.begin(asset.eventId, "cast", asset.videoId, position, playWhenReady)
            pendingHandoff = PendingHandoff(request, activeSource ?: return, record, asset.videoId)
        }
        startStatusPolling(request)
    }
    fun setProtocol(protocol: StreamProtocol) {
        val current = state.value
        if (current.protocol == protocol) return
        val asset = current.activeAsset
        if (asset == null) mutableState.update { it.copy(protocol = protocol) }
        else if (current.isLive && current.viewedUtcMs != null) {
            val wanted = desiredPlaying
            selectAsset(asset.id, protocol, playWhenReady = false)
            pendingLiveReturn = PendingLiveReturn(coordinator.current ?: return, current.viewedUtcMs, wanted)
        } else selectAsset(asset.id, protocol, current.positionMs, desiredPlaying)
    }
    fun setSportsUi(sports: Boolean) { mutableState.update { it.copy(sportsUi = sports) } }
    fun togglePlayback() {
        if (!state.value.canControlPlayback || player.source == null) return
        if (player.isPlaying) player.pause() else player.play()
        updatePlaybackState()
    }
    fun seekBy(deltaSeconds: Double) {
        if (!state.value.canControlPlayback || player.source == null) return
        if (player.isLive) {
            val target = LiveSeekController { LiveWindow(player.maxTimeShift, player.timeShift) }.seekBy(deltaSeconds)
            player.timeShift(target)
        } else {
            val range = player.source?.seekableRange ?: return
            if (!range.start.isFinite() || !range.end.isFinite() || range.end <= range.start) return
            player.seek((player.currentTime + deltaSeconds).coerceIn(range.start, range.end))
        }
    }
    fun goLive() { if (state.value.canControlPlayback && player.isLive) player.timeShift(0.0) }
    fun seekTo(positionMs: Long) {
        if (state.value.canControlPlayback && !player.isLive && player.source != null) {
            val range = player.source?.seekableRange ?: return
            if (range.start.isFinite() && range.end.isFinite() && range.end > range.start) {
                player.seek((positionMs / 1_000.0).coerceIn(range.start, range.end))
            }
        }
    }
    fun setSpeed(speed: Float) { if (state.value.canControlPlayback && speed.isFinite() && speed > 0) player.playbackSpeed = speed }
    fun setSubtitle(id: String) {
        if (!state.value.canControlPlayback) return
        val source = player.source ?: return
        if (source.availableSubtitleTracks.any { it.id == id }) source.setSubtitleTrack(id)
    }
    fun clearNotice() { mutableState.update { it.copy(notice = PlaybackNotice.NONE, errorCode = null) } }

    private fun loadSource(config: SourceConfig, videoId: String, title: String, playWhenReady: Boolean) {
        checkMainThread()
        activeSource = Source(config, AnalyticsSourceConfig.Enabled(SourceMetadata(videoId = videoId, title = title)))
        loadCount++
        lastErrorCode = null
        desiredPlaying = playWhenReady
        val source = activeSource!!
        source.on(SourceEvent.Error::class) {
            if (activeSource !== source) return@on
            lastErrorCode = it.code.value
            pendingHandoff?.let { pending -> handoffs.fail(pending.recordId, HandoffFailure.LOAD_FAILED) }
            diagnostics.add("source-error", "code=${it.code.value}")
            mutableState.update { current -> current.copy(notice = PlaybackNotice.MEDIA_FAILED, errorCode = it.code.value, loadingSource = false) }
        }
        val remote = player.isCasting
        pendingRemoteLoad = if (remote) coordinator.current?.let { RemoteLoad(source, ReceiverLoadIntent(it, playWhenReady)) } else null
        player.load(source)
        if (!remote) {
            if (playWhenReady) player.play() else player.pause()
        }
    }
    fun load(url: String, videoId: String, type: SourceType, subtitleUrl: String? = null) {
        val captions = subtitleUrl?.let { listOf(SubtitleTrack(it, mimeType = "text/vtt", label = "English", id = "test-en", language = "en")) }.orEmpty()
        loadSource(SourceConfig(url, type, subtitleTracks = captions), videoId, videoId, true)
    }
    private fun startStatusPolling(request: PlaybackRequest) {
        statusJob?.cancel()
        statusJob = viewModelScope.launch {
            var attempt = 0
            while (isActive && coordinator.isCurrent(request)) {
                if (!screenActive && !player.isCasting) { delay(1_000); continue }
                refreshStatusNow(request)
                val event = state.value.selectedEvent ?: break
                if (event.status == EventStatus.ENDED && event.archiveStatus == ArchiveStatus.READY) break
                val wait = if (event.status == EventStatus.ENDED) ReadinessRetry.delayMs(attempt++) ?: break else 5_000L
                delay(wait)
            }
        }
    }
    fun refreshStatus() { coordinator.current?.let { startStatusPolling(it) } }
    private suspend fun refreshStatusNow(selection: PlaybackRequest) {
        val event = state.value.selectedEvent ?: return
        val url = event.statusUrl ?: return
        val request = statusGuard.begin(selection)
        runCatching { EventStatusParser.parse(repository.status(url), event.id, event.liveAssetId, event.archiveAssetId) }
            .onSuccess { update ->
                if (!statusGuard.isCurrent(request, coordinator.current)) return@onSuccess
                mutableState.update { current ->
                    val catalog = current.catalog ?: return@update current
                    val saved = savedLive
                    current.copy(canReturnOriginal = saved != null && saved.eventId == update.eventId &&
                        update.eventStatus == EventStatus.LIVE && update.containsSeekableUtc(saved.utcMs),
                        catalog = catalog.copy(events = catalog.events.map {
                        if (it.id == update.eventId) it.copy(status = update.eventStatus, archiveStatus = update.archiveStatus) else it
                    }, assets = catalog.assets.map { asset ->
                        when {
                            asset.id == event.liveAssetId -> asset.copy(utcStartMs = update.liveUtcStartMs)
                            asset.id == update.archive?.assetId -> asset.copy(durationMs = update.archive.durationMs,
                                utcStartMs = update.archive.utcStartMs, utcMappings = update.archive.intervals)
                            else -> asset
                        }
                    }))
                }
            }.onFailure { error ->
                if (error is CancellationException) throw error
                if (statusGuard.isCurrent(request, coordinator.current)) {
                    mutableState.update { it.copy(notice = PlaybackNotice.STATUS_FAILED) }
                    diagnostics.add("status-failed", event.id)
                }
            }
    }
    private fun updatePlaybackState() {
        if (player.isCasting && state.value.castConnection == CastConnection.CONNECTED) {
            val current = state.value
            val proof = receiverEvidence.takeIf { it.assetId == current.activeAssetId }
            val live = proof != null && lastReceiverObservation?.live == true
            mutableState.update { value ->
                val archive = value.catalog?.asset(value.archiveTargetId ?: value.selectedEvent?.archiveAssetId)
                value.copy(isPlaying = proof?.playing == true, isPaused = proof?.paused == true, isLive = live,
                    positionMs = proof?.positionMs, viewedUtcMs = if (proof == null) null else lastReceiverUtcMs,
                    durationMs = if (live) null else value.activeAsset?.durationMs,
                    timeShiftSeconds = if (live) player.timeShift else 0.0,
                    earliestTimeShiftSeconds = if (live) player.maxTimeShift else 0.0,
                    archivePosition = archive?.mapping?.resolve(if (proof == null) null else lastReceiverUtcMs) ?: ArchivePosition.Unknown)
            }
            completeLiveReturn()
            maybeAutoContinue()
            return
        }
        val asset = state.value.activeAsset
        val source = player.source
        val matches = source != null && source === activeSource
        val isLive = matches && player.isLive
        val raw = player.currentTime
        val absolute = (raw + player.playbackTimeOffsetToAbsoluteTime) * 1_000.0
        val utc = if (matches && asset?.kind == AssetKind.LIVE && absolute.isFinite() &&
            asset.utcStartMs != null && absolute >= asset.utcStartMs) absolute.roundToLong() else null
        val position = if (!matches || !raw.isFinite()) null else if (isLive) {
            if (utc != null && asset?.utcStartMs != null) utc - asset.utcStartMs else null
        } else (raw * 1_000).roundToLong().coerceAtLeast(0)
        val sdkDuration = if (matches) source.duration else null
        val duration = sdkDuration?.takeIf { it.isFinite() && it >= 0 }?.let { (it * 1_000).roundToLong() }
        mutableState.update { current ->
            val archive = current.catalog?.asset(current.archiveTargetId ?: current.selectedEvent?.archiveAssetId)
            current.copy(isLive = isLive, isPlaying = matches && player.isPlaying, isPaused = matches && player.isPaused,
                positionMs = position, durationMs = if (isLive) null else duration,
                timeShiftSeconds = if (isLive) player.timeShift else 0.0,
                earliestTimeShiftSeconds = if (isLive) player.maxTimeShift else 0.0,
                viewedUtcMs = utc, archivePosition = archive?.mapping?.resolve(utc) ?: ArchivePosition.Unknown,
                diagnosticRevision = diagnostics.entries.size)
        }
        completeLiveReturn()
        observeLocalHandoff()
        maybeAutoContinue()
    }

    fun setArchiveTarget(assetId: String) {
        val asset = state.value.catalog?.asset(assetId) ?: return
        if (asset.kind == AssetKind.ARCHIVE && asset.eventId == state.value.selectedEventId) {
            mutableState.update { it.copy(archiveTargetId = assetId) }
        }
    }
    fun setAutoContinue(enabled: Boolean) { mutableState.update { it.copy(autoContinue = enabled) } }
    fun continueInArchive(fromStart: Boolean = false) {
        val current = state.value
        val event = current.selectedEvent ?: return
        if (current.activeAsset?.kind != AssetKind.LIVE || event.archiveStatus != ArchiveStatus.READY ||
            !current.acceptsPlaybackCommands) return
        val archive = current.catalog?.asset(current.archiveTargetId ?: event.archiveAssetId) ?: return
        val position = if (fromStart) 0L else (current.archivePosition as? ArchivePosition.Available)?.positionMs ?: return
        val play = if (fromStart) true else desiredPlaying
        val recordId = handoffs.begin(event.id, "live-to-archive", archive.videoId, position, play)
        selectAsset(archive.id, startMs = position, playWhenReady = play)
        val request = coordinator.current ?: return
        val source = activeSource ?: return
        pendingHandoff = PendingHandoff(request, source, recordId, archive.videoId)
    }
    private fun maybeAutoContinue() {
        val current = state.value
        val event = current.selectedEvent ?: return
        val request = coordinator.current ?: return
        if (current.activeAsset?.kind == AssetKind.LIVE &&
            EventPlaybackState(event.status, event.archiveStatus).shouldAutoContinue(current.autoContinue, current.archivePosition) &&
            current.acceptsPlaybackCommands && coordinator.claimHandoff(request)) continueInArchive()
    }
    fun returnToLive(originalPosition: Boolean) {
        val current = state.value
        val event = current.selectedEvent ?: return
        val live = current.catalog?.asset(event.liveAssetId) ?: return
        if (event.status != EventStatus.LIVE || !current.acceptsPlaybackCommands) return
        if (!originalPosition) { selectAsset(live.id); return }
        val saved = savedLive?.takeIf { it.eventId == event.id } ?: return
        val utc = saved.utcMs ?: return
        selectAsset(live.id, playWhenReady = false)
        pendingLiveReturn = PendingLiveReturn(coordinator.current ?: return, utc, saved.playWhenReady)
    }
    private fun completeLiveReturn() {
        val pending = pendingLiveReturn ?: return
        if (!coordinator.isCurrent(pending.request)) { pendingLiveReturn = null; return }
        val current = state.value
        val utc = current.viewedUtcMs ?: return
        if (!player.isLive || player.source !== activeSource) return
        val edgeUtc = utc - (player.timeShift * 1_000).roundToLong()
        val result = LiveWindow(player.maxTimeShift, player.timeShift).returnToUtc(pending.utcMs, edgeUtc)
        pendingLiveReturn = null
        when (result) {
            is LiveReturn.Available -> {
                player.timeShift(result.offsetSeconds)
                if (pending.playWhenReady) player.play() else player.pause()
            }
            LiveReturn.Expired -> mutableState.update { it.copy(notice = PlaybackNotice.POSITION_EXPIRED) }
            LiveReturn.Unknown -> mutableState.update { it.copy(notice = PlaybackNotice.POSITION_UNKNOWN) }
        }
    }
    private fun observeLocalHandoff() {
        val pending = pendingHandoff ?: return
        if (!coordinator.isCurrent(pending.request)) { pendingHandoff = null; return }
        if (player.isCasting || player.source !== pending.source) return
        val position = state.value.positionMs ?: return
        val advanced = pending.lastPositionMs?.let { position > it } ?: false
        pending.lastPositionMs = position
        if (handoffs.observe(pending.recordId, pending.videoId, position, player.isPlaying, player.isPaused, advanced)) {
            diagnostics.add("handoff-confirmed", pending.request.assetId)
            pendingHandoff = null
        }
    }
    fun toggleCasting() {
        checkMainThread()
        if (player.isCasting) { disconnectCasting(); return }
        if (player.source == null || !player.isCastAvailable) {
            mutableState.update { it.copy(notice = PlaybackNotice.CAST_FAILED) }; return
        }
        val host = URI(player.source!!.config.url).host?.lowercase().orEmpty()
        if (host in setOf("localhost", "127.0.0.1", "::1", "10.0.2.2")) {
            mutableState.update { it.copy(notice = PlaybackNotice.CAST_MEDIA_UNREACHABLE) }; return
        }
        // The SDK opens its route chooser and owns the eventual media load.
        // https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api.casting/-remote-control-api/cast-video.html
        player.castVideo()
    }
    fun disconnectCasting() { BitmovinCastManager.getInstance().disconnect() }
    fun castDiagnosticsForTest(expectedReceiver: String? = null): String {
        val manager = BitmovinCastManager.getInstance()
        val details = castController?.diagnostics(expectedReceiver) ?: JSONObject()
        return details.put("sdkManagerInitialized", BitmovinCastManager.isInitialized())
            .put("sdkCastAvailable", manager.isCastAvailable).put("playerCastAvailable", player.isCastAvailable)
            .put("remoteControlEnabled", player.config.remoteControlConfig.isCastEnabled)
            .put("receiverApplicationId", manager.applicationId)
            .put("sourcePresent", player.source != null).put("isPlaying", player.isPlaying)
            .put("positionSeconds", player.currentTime.takeIf { it.isFinite() } ?: JSONObject.NULL)
            .put("protocol", state.value.protocol.name).put("receiverSamples", receiverEvidence.samples)
            .put("expectedAssetId", state.value.activeAssetId ?: JSONObject.NULL)
            .put("observedAssetId", receiverEvidence.assetId ?: JSONObject.NULL)
            .put("observedPositionMs", receiverEvidence.positionMs ?: JSONObject.NULL)
            .put("observedPlaying", receiverEvidence.playing ?: JSONObject.NULL)
            .put("observedPaused", receiverEvidence.paused ?: JSONObject.NULL)
            .put("pendingPlayIntent", pendingRemoteLoad?.intent?.playWhenReady ?: JSONObject.NULL)
            .put("transportCommandSent", pendingRemoteLoad?.intent?.commandSent ?: JSONObject.NULL)
            .put("transportCommandQueued", pendingRemoteLoad?.intent?.commandQueued ?: JSONObject.NULL)
            .put("lastTransportDispatch", lastTransportDispatch ?: JSONObject.NULL)
            .put("receiverPlayerState", lastReceiverObservation?.playerState ?: JSONObject.NULL)
            .put("receiverIdleReason", lastReceiverObservation?.idleReason ?: JSONObject.NULL)
            .put("receiverContentMatches", lastReceiverObservation?.let { sameContent(activeSource?.config?.url, it.contentId) } ?: JSONObject.NULL)
            .put("receiverContentSha256", lastReceiverObservation?.contentId?.let { content ->
                MessageDigest.getInstance("SHA-256").digest(content.toByteArray()).joinToString("") { "%02x".format(it) }
            } ?: JSONObject.NULL)
            .put("elapsedRealtimeMs", SystemClock.elapsedRealtime()).toString()
    }
    private fun recordCastRequest() {
        val current = state.value
        val asset = current.activeAsset ?: return
        val request = coordinator.current ?: return
        val source = activeSource ?: return
        val record = handoffs.begin(asset.eventId, "cast", asset.videoId, current.positionMs, desiredPlaying)
        pendingHandoff = PendingHandoff(request, source, record, asset.videoId)
    }
    private fun onCastConnection(connection: CastConnection, sessionId: String, name: String?) {
        checkMainThread()
        when (connection) {
            CastConnection.CONNECTING -> {
                activeCastId = sessionId
                castRecovery.connecting(sessionId)
                coordinator.changeDestination("cast:$sessionId")
            }
            CastConnection.CONNECTED -> {
                if (activeCastId != sessionId) castRecovery.connecting(sessionId)
                activeCastId = sessionId
                castRecovery.connected(sessionId)
                val request = coordinator.changeDestination("cast:$sessionId")
                if (request != null) {
                    pendingHandoff = pendingHandoff?.copy(request = request)
                    startStatusPolling(request)
                }
            }
            CastConnection.RECONNECTING -> {
                if (activeCastId != sessionId) return
                castRecovery.reconnecting(sessionId)
                coordinator.changeDestination("cast:$sessionId")
            }
            CastConnection.DISCONNECTED -> {
                if (activeCastId != sessionId || state.value.castConnection == CastConnection.DISCONNECTED) return
                castRecovery.disconnected(sessionId)
                pendingHandoff?.let { handoffs.fail(it.recordId, HandoffFailure.DISCONNECTED) }
                pendingHandoff = null
                pendingRemoteLoad = null
                activeCastId = null
                coordinator.changeDestination("local:awaiting-choice")
                if (castRecovery.needsLocalReturnChoice || player.isCasting) player.pause()
            }
        }
        diagnostics.add("cast-state", connection.name.lowercase())
        mutableState.update { it.copy(castConnection = connection, castName = name,
            needsLocalReturnChoice = castRecovery.needsLocalReturnChoice) }
    }
    private fun onReceiverMedia(observation: ReceiverObservation) {
        checkMainThread()
        if (observation.sessionId != activeCastId || state.value.castConnection != CastConnection.CONNECTED) return
        lastReceiverObservation = observation
        val asset = state.value.activeAsset ?: return
        val source = activeSource ?: return
        if (!sameContent(source.config.url, observation.contentId)) return
        val rawPosition = observation.positionMs ?: run {
            if (observation.playerState == MediaStatus.PLAYER_STATE_IDLE && observation.idleReason == MediaStatus.IDLE_REASON_ERROR) {
                mutableState.update { it.copy(notice = PlaybackNotice.MEDIA_FAILED, errorCode = null, loadingSource = false) }
                diagnostics.add("receiver-error", "idleReason=${observation.idleReason}:${asset.id}")
            }
            return
        }
        pendingRemoteLoad?.takeIf { it.source === source }?.let { pending ->
            if (pending.intent.observe(coordinator.current, true, observation.playing, observation.paused) != null) {
                // SDK receiver-state processing must finish before its public transport API changes that state.
                mainHandler.post { dispatchRemoteIntent(pending) }
            }
            if (pending.intent.fulfilled) {
                desiredPlaying = pending.intent.playWhenReady
                pendingRemoteLoad = null
            }
        }
        val utc = if (asset.kind == AssetKind.LIVE) {
            val offset = player.playbackTimeOffsetToAbsoluteTime
            (rawPosition + offset * 1_000).takeIf { value ->
                value.isFinite() && asset.utcStartMs != null && value >= asset.utcStartMs
            }?.roundToLong()
        } else null
        val position = if (asset.kind == AssetKind.LIVE) {
            if (utc != null && asset.utcStartMs != null) utc - asset.utcStartMs else null
        } else rawPosition
        if (position == null || !castRecovery.observe(observation.sessionId, asset.id, position)) return
        lastReceiverIntent = observation.playing
        lastReceiverUtcMs = utc
        val advanced = lastReceiverPosition?.let { position > it } ?: false
        lastReceiverPosition = position
        receiverEvidence = ReceiverEvidence(asset.id, position, observation.playing, observation.paused, receiverEvidence.samples + 1)
        mutableState.update { it.copy(positionMs = position, viewedUtcMs = utc, isPlaying = observation.playing,
            isPaused = observation.paused, loadingSource = pendingRemoteLoad != null) }
        val pending = pendingHandoff
        if (pending != null && coordinator.isCurrent(pending.request) && pending.source === source &&
            handoffs.observe(pending.recordId, asset.videoId, position, observation.playing, observation.paused, advanced)) {
            diagnostics.add("receiver-handoff-confirmed", asset.id)
            pendingHandoff = null
        }
    }
    private fun sameContent(expected: String?, actual: String): Boolean =
        expected != null && runCatching { URI(expected).normalize() == URI(actual).normalize() }.getOrDefault(false)
    private fun dispatchRemoteIntent(pending: RemoteLoad) {
        if (pendingRemoteLoad !== pending || activeSource !== pending.source || player.isDestroyed || lastErrorCode != null) return
        val observed = lastReceiverObservation
        val matching = player.isCasting && state.value.castConnection == CastConnection.CONNECTED &&
            observed?.sessionId == activeCastId && sameContent(pending.source.config.url, observed?.contentId.orEmpty())
        val command = pending.intent.dispatch(coordinator.current, matching, observed?.playing == true, observed?.paused == true)
        if (command != null) {
            val details = JSONObject().put("command", command.name).put("assetId", coordinator.current?.assetId ?: JSONObject.NULL)
                .put("sdkPlayingBefore", player.isPlaying).put("sdkPausedBefore", player.isPaused)
                .put("receiverState", observed?.playerState ?: JSONObject.NULL).put("elapsedRealtimeMs", SystemClock.elapsedRealtime())
            lastTransportDispatch = details
            diagnostics.add("receiver-transport-dispatched", "${command.name}:${coordinator.current?.assetId}")
            when (command) {
                ReceiverTransport.PLAY -> player.play()
                ReceiverTransport.PAUSE -> player.pause()
            }
            mainHandler.post {
                if (!player.isDestroyed && lastTransportDispatch === details) {
                    details.put("sdkPlayingAfter", player.isPlaying).put("sdkPausedAfter", player.isPaused)
                }
            }
        }
        if (pending.intent.fulfilled) {
            desiredPlaying = pending.intent.playWhenReady
            pendingRemoteLoad = null
        }
    }
    fun receiverRecoveryPositionMs() = castRecovery.localResumePosition()
    fun canResumeReceiverPosition(): Boolean {
        val asset = state.value.catalog?.asset(castRecovery.lastObservedAssetId) ?: return false
        return castRecovery.localResumePosition() != null && (asset.kind != AssetKind.LIVE || lastReceiverUtcMs != null)
    }
    fun recoverLocally(resume: Boolean) {
        if (!state.value.needsLocalReturnChoice) return
        val current = state.value
        val asset = current.catalog?.asset(castRecovery.lastObservedAssetId) ?: current.activeAsset ?: return
        val position = castRecovery.localResumePosition()
        val utc = lastReceiverUtcMs
        if (resume && (position == null || (asset.kind == AssetKind.LIVE && utc == null))) return
        castRecovery.acknowledgeLocalChoice()
        mutableState.update { it.copy(needsLocalReturnChoice = false, castConnection = CastConnection.DISCONNECTED) }
        val play = if (resume) lastReceiverIntent ?: false else true
        if (asset.kind == AssetKind.LIVE && resume) {
            if (utc == null) { mutableState.update { it.copy(notice = PlaybackNotice.POSITION_UNKNOWN) }; return }
            selectAsset(asset.id, playWhenReady = false)
            pendingLiveReturn = PendingLiveReturn(coordinator.current ?: return, utc, play)
        } else selectAsset(asset.id, startMs = if (resume) position else if (asset.kind == AssetKind.LIVE) null else 0L,
            playWhenReady = play)
    }
    fun keepLocalPaused() {
        if (!state.value.needsLocalReturnChoice) return
        castRecovery.acknowledgeLocalChoice()
        player.pause()
        player.unload()
        activeSource = null
        statusJob?.cancel()
        mutableState.update { it.copy(needsLocalReturnChoice = false, activeAssetId = null, isPlaying = false,
            isPaused = true, positionMs = null, viewedUtcMs = null) }
    }
    private fun destination() = activeCastId?.let { "cast:$it" } ?: "local"
    private fun checkMainThread() { check(Looper.myLooper() == Looper.getMainLooper()) }
    fun snapshot() = OwnershipSnapshot(player, player.source, player.analytics?.impressionId,
        loadCount, player.currentTime, player.isPaused, player.playbackSpeed, player.source?.selectedSubtitleTrack?.id)
    override fun onCleared() { castController?.close(); catalogJob?.cancel(); statusJob?.cancel(); player.destroy() }
}

data class OwnershipSnapshot(
    val player: Player, val source: Source?, val impressionId: String?, val loadCount: Int,
    val positionSeconds: Double, val paused: Boolean, val speed: Float, val subtitleId: String?,
)

private data class SavedLivePosition(val eventId: String, val utcMs: Long?, val playWhenReady: Boolean)
private data class PendingLiveReturn(val request: PlaybackRequest, val utcMs: Long, val playWhenReady: Boolean)
private data class PendingHandoff(val request: PlaybackRequest, val source: Source, val recordId: String,
    val videoId: String, var lastPositionMs: Long? = null)

data class ReceiverEvidence(val assetId: String?, val positionMs: Long?, val playing: Boolean?, val paused: Boolean?, val samples: Long)

private data class RemoteLoad(val source: Source, val intent: ReceiverLoadIntent)
