package com.playerlab.sportsstreaming

import android.app.Application
import android.os.Looper
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.bitmovin.analytics.api.AnalyticsConfig
import com.bitmovin.analytics.api.SourceMetadata
import com.bitmovin.player.api.Player
import com.bitmovin.player.SubtitleView
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
import java.util.UUID

class PlaybackSession(application: Application) : AndroidViewModel(application) {
    val player: Player = Player(application, PlayerConfig(key = BuildConfig.PLAYER_LICENSE_KEY),
        if (BuildConfig.ANALYTICS_LICENSE_KEY.isBlank()) AnalyticsPlayerConfig.Disabled
        else AnalyticsPlayerConfig.Enabled(AnalyticsConfig(BuildConfig.ANALYTICS_LICENSE_KEY)))
    val subtitleRenderer = SubtitleView(application).apply {
        setPlayer(player)
        setUserDefaultStyle()
        setUserDefaultTextSize()
    }
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
    private var pendingRemoteReplacement: RemoteReplacement? = null
    private var lastReceiverObservation: ReceiverObservation? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastTransportDispatch: JSONObject? = null
    private var lastRemoteLoadDispatch: JSONObject? = null
    private var receiverEvidence = ReceiverEvidence(null, null, null, null, 0)
    private var activeSource: Source? = null
    private var activeSourceRequest: PlaybackRequest? = null
    private var receiverLoadGuard: ReceiverLoadGuard? = null
    private var sourceReadiness: SourceReadiness? = null
    private var sourceUtcClock: SourceUtcClock? = null
    private var screenActive = true
    internal var desiredPlaying = false
    var loadCount = 0
        private set
    var lastErrorCode: Int? = null
        private set

    init {
        player.on(PlayerEvent.Error::class) {
            subtitleRenderer.setPlayer(null)
            sourceReadiness?.fail()
            lastErrorCode = it.code.value
            diagnostics.add("player-error", "code=${it.code.value}")
            mutableState.update { current -> current.copy(notice = PlaybackNotice.MEDIA_FAILED, errorCode = it.code.value, sourceFailed = true, loadingSource = false) }
        }
        player.on(SourceEvent.Loaded::class) {
            if (it.source !== activeSource) return@on
            diagnostics.add("source-loaded", coordinator.current?.assetId ?: "debug-source")
            sourceReadiness?.onLoaded(requireNotNull(receiverLoadGuard).loadToken, coordinator.current)
            finishSourceReadiness()
        }
        player.on(PlayerEvent.Ready::class) {
            diagnostics.add("source-ready-event", "current=${player.source === activeSource}:active=${activeSource?.isActive}:request=${activeSourceRequest == coordinator.current}")
            if (activeSource == null || player.source !== activeSource || activeSourceRequest != coordinator.current) return@on
            sourceReadiness?.onReady(requireNotNull(receiverLoadGuard).loadToken, coordinator.current)
            finishSourceReadiness()
        }
        player.on(PlayerEvent.Play::class) {
            if (pendingRemoteLoad == null) desiredPlaying = true
        }
        player.on(PlayerEvent.Paused::class) { if (pendingRemoteLoad == null) desiredPlaying = false }
        player.on(PlayerEvent.Seek::class) {
            if (player.source === activeSource && activeSourceRequest == coordinator.current &&
                state.value.activeAsset?.kind == AssetKind.LIVE && !player.isLive)
                sourceUtcClock?.invalidateAfterUnmappedSeek()
        }
        player.on(PlayerEvent.PlaybackFinished::class) {
            subtitleRenderer.setPlayer(player)
            if (state.value.activeAsset?.kind == AssetKind.CLIP && state.value.selectedEvent?.status == EventStatus.LIVE) returnToLive(false)
        }
        castController = CastController(application, ::onCastConnection, ::onReceiverMedia) {
            mutableState.update { it.copy(notice = PlaybackNotice.CAST_FAILED) }
        }
        player.on(PlayerEvent.CastStopped::class) {
            if (pendingRemoteReplacement != null && castController?.isConnected == true) return@on
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
            }, options = SourceOptions(startMs?.let { it / 1_000.0 }, TimelineReferencePoint.Start),
            metadata = newSourceMetadata())
        mutableState.update { it.copy(activeAssetId = asset.id, selectedEventId = asset.eventId,
            protocol = chosenProtocol, loadingSource = true, notice = PlaybackNotice.NONE,
            archiveTargetId = if (asset.eventId == it.selectedEventId) it.archiveTargetId else null,
            errorCode = null, sourceFailed = false, viewedUtcMs = null, archivePosition = ArchivePosition.Unknown) }
        loadSource(config, asset.videoId, asset.title, playWhenReady)
        diagnostics.add("load-requested", "${request.generation}:${asset.id}:${request.destination.substringBefore(':')}")
        if (player.isCasting || state.value.castConnection == CastConnection.CONNECTED) {
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
        if (!state.value.canControlPlayback || !state.value.hasUsableSeekTimeline || player.source == null ||
            (state.value.activeAsset?.kind == AssetKind.LIVE && !player.isLive)) return
        if (player.isLive) {
            val target = LiveSeekController { LiveWindow(player.maxTimeShift, player.timeShift) }.seekBy(deltaSeconds)
            player.timeShift(target)
        } else {
            val range = player.source?.seekableRange ?: return
            if (!range.start.isFinite() || !range.end.isFinite() || range.end <= range.start) return
            if (state.value.activeAsset?.kind == AssetKind.LIVE) sourceUtcClock?.invalidateAfterUnmappedSeek()
            player.seek((player.currentTime + deltaSeconds).coerceIn(range.start, range.end))
        }
    }
    fun goLive() { if (state.value.canControlPlayback && player.isLive) player.timeShift(0.0) }
    fun seekTo(positionMs: Long) {
        if (state.value.canControlPlayback && state.value.hasUsableSeekTimeline && state.value.activeAsset?.kind != AssetKind.LIVE &&
            !player.isLive && player.source != null) {
            val range = player.source?.seekableRange ?: return
            if (range.start.isFinite() && range.end.isFinite() && range.end > range.start) {
                if (state.value.activeAsset?.kind == AssetKind.LIVE) sourceUtcClock?.invalidateAfterUnmappedSeek()
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
    fun clearNotice() { mutableState.update { it.copy(notice = PlaybackNotice.NONE) } }

    private fun newSourceMetadata() = mapOf(SOURCE_LOAD_TOKEN_METADATA_KEY to UUID.randomUUID().toString())
    private fun finishSourceReadiness() {
        if (sourceReadiness?.isReady == true && pendingRemoteLoad == null && !state.value.sourceFailed)
            mutableState.update { it.copy(loadingSource = false) }
    }

    private fun loadSource(config: SourceConfig, videoId: String, title: String, playWhenReady: Boolean) {
        checkMainThread()
        subtitleRenderer.setPlayer(player)
        val previousSource = activeSource ?: player.source
        val loadToken = requireNotNull(config.metadata?.get(SOURCE_LOAD_TOKEN_METADATA_KEY))
        receiverLoadGuard = ReceiverLoadGuard(loadToken)
        sourceUtcClock = SourceUtcClock(loadToken)
        activeSourceRequest = coordinator.current
        sourceReadiness = SourceReadiness(loadToken, activeSourceRequest)
        mutableState.update { it.copy(sourceFailed = false, errorCode = null, loadingSource = true) }
        activeSource = Source(config, AnalyticsSourceConfig.Enabled(SourceMetadata(videoId = videoId, title = title)))
        loadCount++
        lastErrorCode = null
        desiredPlaying = playWhenReady
        val source = activeSource!!
        source.on(SourceEvent.Error::class) {
            if (activeSource !== source) return@on
            subtitleRenderer.setPlayer(null)
            sourceReadiness?.fail()
            lastErrorCode = it.code.value
            pendingHandoff?.let { pending -> handoffs.fail(pending.recordId, HandoffFailure.LOAD_FAILED) }
            diagnostics.add("source-error", "code=${it.code.value}")
            mutableState.update { current -> current.copy(notice = PlaybackNotice.MEDIA_FAILED, errorCode = it.code.value, sourceFailed = true, loadingSource = false) }
        }
        val remote = player.isCasting || state.value.castConnection == CastConnection.CONNECTED
        pendingRemoteLoad = if (remote) coordinator.current?.let { RemoteLoad(source, ReceiverLoadIntent(it, playWhenReady)) } else null
        if (remote) {
            val request = coordinator.current ?: return
            replaceRemoteSource(source, request, previousSource)
            return
        }
        player.load(source)
        if (playWhenReady) player.play() else player.pause()
    }
    private fun replaceRemoteSource(source: Source, request: PlaybackRequest, previousSource: Source?) {
        val connection = activeCastId ?: run { failRemoteReplacement(source, request); return }
        val existing = pendingRemoteReplacement
        if (existing != null && existing.connectionId == connection) {
            existing.source = source
            existing.request = request
            return
        }
        val previousToken = previousSource?.config?.metadata?.get(SOURCE_LOAD_TOKEN_METADATA_KEY)
        val previousMediaId = lastReceiverObservation?.takeIf {
            it.sessionId == connection && it.sourceLoadToken == previousToken
        }?.mediaSessionId
        val revision = castController?.statusRevision ?: 0L
        val waiting = RemoteReplacement(connection, source, request,
            ReceiverStopGate(connection, previousMediaId, previousToken, revision, SystemClock.elapsedRealtime()))
        pendingRemoteReplacement = waiting
        lastRemoteLoadDispatch = JSONObject().put("castingBeforeUnload", player.isCasting)
            .put("assetId", request.assetId).put("stopAfterRevision", revision).put("stopConfirmed", false)
        player.unload()
        lastRemoteLoadDispatch?.put("castingAfterUnload", player.isCasting)
        mainHandler.postDelayed({
            if (pendingRemoteReplacement === waiting && waiting.gate.expired(SystemClock.elapsedRealtime()))
                failRemoteReplacement(waiting.source, waiting.request)
        }, 20_000)
    }
    private fun failRemoteReplacement(source: Source, request: PlaybackRequest) {
        if (source !== activeSource || !coordinator.isCurrent(request)) return
        pendingRemoteReplacement = null
        pendingRemoteLoad = null
        sourceReadiness?.fail()
        pendingHandoff?.takeIf { it.source === source }?.let { handoffs.fail(it.recordId, HandoffFailure.LOAD_FAILED) }
        pendingHandoff = null
        mutableState.update { it.copy(sourceFailed = true, loadingSource = false, notice = PlaybackNotice.MEDIA_FAILED) }
        diagnostics.add("receiver-replacement-failed", request.assetId)
    }
    private fun observeRemoteStop(observed: ReceiverObservation): Boolean {
        val waiting = pendingRemoteReplacement ?: return false
        val proof = ReceiverStopProof(observed.sessionId, observed.statusRevision, observed.mediaSessionId,
            observed.sourceLoadToken, observed.playerState == MediaStatus.PLAYER_STATE_IDLE &&
                observed.idleReason == MediaStatus.IDLE_REASON_CANCELED,
            !observed.mediaPresent && observed.queueItemCount == 0)
        if (!waiting.dispatchPosted && waiting.gate.accepts(proof, coordinator.current, waiting.request, SystemClock.elapsedRealtime())) {
            waiting.dispatchPosted = true
            mainHandler.post {
                if (pendingRemoteReplacement !== waiting || waiting.source !== activeSource || !coordinator.isCurrent(waiting.request) ||
                    castController?.isConnected != true || activeCastId != waiting.connectionId || state.value.sourceFailed) return@post
                pendingRemoteReplacement = null
                lastRemoteLoadDispatch?.put("stopConfirmed", true)?.put("stopObservedRevision", observed.statusRevision)
                player.load(waiting.source)
                lastRemoteLoadDispatch?.put("castingAfterLoad", player.isCasting)
            }
        }
        return true
    }
    fun load(url: String, videoId: String, type: SourceType, subtitleUrl: String? = null) {
        val captions = subtitleUrl?.let { listOf(SubtitleTrack(it, mimeType = "text/vtt", label = "English", id = "test-en", language = "en")) }.orEmpty()
        loadSource(SourceConfig(url, type, subtitleTracks = captions, metadata = newSourceMetadata()), videoId, videoId, true)
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
        val utc = viewedUtcForCurrentSource()
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
            val position = archivePositionAtDispatch(asset)
            mutableState.update { it.copy(archiveTargetId = assetId, archivePosition = position) }
        }
    }
    private fun archivePositionAtDispatch(archive: MediaAsset): ArchivePosition =
        ArchiveContinuation.resolve(archive.mapping, coordinator.current) {
            val current = state.value
            val source = activeSource
            val matches = source != null && player.source === source && activeSourceRequest == coordinator.current &&
                current.activeAsset?.kind == AssetKind.LIVE && !current.loadingSource && !current.sourceFailed &&
                (!player.isCasting || lastReceiverObservation?.let { receiverMatches(it, source) } == true)
            val utc = if (matches) viewedUtcForCurrentSource() else null
            SourceUtcReading(activeSourceRequest, matches, utc)
        }
    internal fun viewedUtcForCurrentSource(): Long? {
        val current = state.value
        val source = activeSource ?: return null
        val token = receiverLoadGuard?.loadToken ?: return null
        val request = activeSourceRequest ?: return null
        if (player.source !== source || request != coordinator.current || current.activeAsset?.kind != AssetKind.LIVE ||
            current.loadingSource || current.sourceFailed) return null
        if (player.isCasting && lastReceiverObservation?.let { receiverMatches(it, source) } != true) return null
        return sourceUtcClock?.read(UtcClockSample(token, "${request.destination}:${request.generation}",
            player.currentTime, player.playbackTimeOffsetToAbsoluteTime, player.isLive, current.activeAsset?.utcStartMs,
            SystemClock.elapsedRealtime(), player.playbackSpeed.toDouble(), player.playbackTimeOffsetToRelativeTime))
    }
    fun setAutoContinue(enabled: Boolean) { mutableState.update { it.copy(autoContinue = enabled) } }
    fun continueInArchive(fromStart: Boolean = false) {
        val current = state.value
        val event = current.selectedEvent ?: return
        if (current.activeAsset?.kind != AssetKind.LIVE || event.archiveStatus != ArchiveStatus.READY ||
            !current.acceptsPlaybackCommands) return
        val archive = current.catalog?.asset(current.archiveTargetId ?: event.archiveAssetId) ?: return
        val resolved = archivePositionAtDispatch(archive)
        if (!fromStart && resolved !is ArchivePosition.Available) {
            mutableState.update { it.copy(archivePosition = resolved) }
            return
        }
        val position = if (fromStart) 0L else (resolved as ArchivePosition.Available).positionMs
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
        val archive = current.catalog?.asset(current.archiveTargetId ?: event.archiveAssetId)
        val position = archive?.let(::archivePositionAtDispatch) ?: ArchivePosition.Unknown
        if (current.activeAsset?.kind == AssetKind.LIVE &&
            EventPlaybackState(event.status, event.archiveStatus).shouldAutoContinue(current.autoContinue, position) &&
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
        val readyStopped = sourceReadiness?.localSdkReady == true && activeSource === pending.source &&
            activeSourceRequest == pending.request && !state.value.loadingSource && !desiredPlaying && !player.isPlaying
        if (handoffs.observe(pending.recordId, pending.videoId, position, player.isPlaying, player.isPaused, advanced,
                readyStopped = readyStopped, observedAtMs = SystemClock.elapsedRealtime())) {
            diagnostics.add("handoff-confirmed", pending.request.assetId)
            pendingHandoff = null
        }
    }
    fun toggleCasting() {
        checkMainThread()
        if (player.isCasting || state.value.castConnection != CastConnection.DISCONNECTED) { disconnectCasting(); return }
        if (!state.value.canControlPlayback) return
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
            .put("sourceFailed", state.value.sourceFailed)
            .put("sourceSdkReady", sourceReadiness?.localSdkReady ?: false)
            .put("sourcePlaybackReady", sourceReadiness?.isReady ?: false)
            .put("sourceReceiverPlayable", sourceReadiness?.receiverPlayable ?: false)
            .put("sdkSourceMatchesActive", player.source != null && player.source === activeSource)
            .put("sourceReadinessEvents", org.json.JSONArray(diagnostics.entries.filter { it.event == "source-ready-event" }.takeLast(4).map { it.detail }))
            .put("receiverMediaSessionId", lastReceiverObservation?.mediaSessionId ?: JSONObject.NULL)
            .put("receiverBoundMediaSessionId", receiverLoadGuard?.mediaSessionId ?: JSONObject.NULL)
            .put("receiverSourceTokenPresent", lastReceiverObservation?.sourceLoadToken != null)
            .put("receiverSourceTokenMatches", lastReceiverObservation?.sourceLoadToken != null &&
                lastReceiverObservation?.sourceLoadToken == receiverLoadGuard?.loadToken)
            .put("pendingPlayIntent", pendingRemoteLoad?.intent?.playWhenReady ?: JSONObject.NULL)
            .put("transportCommandSent", pendingRemoteLoad?.intent?.commandSent ?: JSONObject.NULL)
            .put("transportCommandQueued", pendingRemoteLoad?.intent?.commandQueued ?: JSONObject.NULL)
            .put("lastTransportDispatch", lastTransportDispatch ?: JSONObject.NULL)
            .put("lastRemoteLoadDispatch", lastRemoteLoadDispatch ?: JSONObject.NULL)
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
        if (pendingHandoff?.source === source) return
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
                pendingRemoteReplacement = null
                activeCastId = null
                coordinator.changeDestination("local:awaiting-choice")
                if (castRecovery.needsLocalReturnChoice || player.isCasting) player.pause()
            }
        }
        diagnostics.add("cast-state", connection.name.lowercase())
        if (connection != CastConnection.DISCONNECTED && player.source === activeSource) {
            val previous = activeSourceRequest
            activeSourceRequest = coordinator.current
            sourceReadiness?.rebind(previous, activeSourceRequest)
            val pending = pendingRemoteLoad
            val request = coordinator.current
            if (pending != null && request != null && pending.intent.request != request)
                pendingRemoteLoad = pending.copy(intent = pending.intent.rebind(request))
            if (request != null) pendingRemoteReplacement?.takeIf { it.source === activeSource }?.request = request
        }
        mutableState.update { it.copy(castConnection = connection, castName = name,
            loadingSource = connection != CastConnection.DISCONNECTED && activeSource != null &&
                (sourceReadiness?.isReady != true || pendingRemoteLoad != null || pendingRemoteReplacement != null),
            needsLocalReturnChoice = castRecovery.needsLocalReturnChoice) }
    }
    private fun onReceiverMedia(observation: ReceiverObservation) {
        checkMainThread()
        if (observation.sessionId != activeCastId || state.value.castConnection != CastConnection.CONNECTED) return
        lastReceiverObservation = observation
        if (observeRemoteStop(observation)) return
        val asset = state.value.activeAsset ?: return
        val source = activeSource ?: return
        val guard = receiverLoadGuard ?: return
        val request = activeSourceRequest ?: return
        val contentMatches = sameContent(source.config.url, observation.contentId)
        if (observation.playerState == MediaStatus.PLAYER_STATE_IDLE && observation.idleReason == MediaStatus.IDLE_REASON_ERROR) {
            if (guard.fail(coordinator.current, request, activeCastId, observation.sessionId,
                    observation.mediaSessionId, observation.sourceLoadToken, contentMatches)) {
                sourceReadiness?.fail()
                mutableState.update { it.copy(notice = PlaybackNotice.MEDIA_FAILED, sourceFailed = true, loadingSource = false) }
                pendingHandoff?.takeIf { it.source === source && it.request == request }?.let {
                    handoffs.fail(it.recordId, HandoffFailure.LOAD_FAILED)
                }
                pendingHandoff = null
                pendingRemoteLoad = null
                diagnostics.add("receiver-error", "idleReason=${observation.idleReason}:${asset.id}")
            }
            return
        }
        if (state.value.sourceFailed || !receiverMatches(observation, source)) return
        val rawPosition = observation.positionMs ?: run {
            return
        }
        sourceReadiness?.onReceiverPlayable(guard.loadToken, coordinator.current)
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
        receiverEvidence = ReceiverEvidence(asset.id, position, observation.playing, observation.paused,
            receiverEvidence.samples + 1, observation.mediaSessionId)
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
    private fun receiverMatches(observed: ReceiverObservation, source: Source): Boolean {
        val request = activeSourceRequest ?: return false
        return source === activeSource && player.source === source && receiverLoadGuard?.accepts(
            coordinator.current, request, activeCastId, observed.sessionId, observed.mediaSessionId,
            observed.sourceLoadToken, sameContent(source.config.url, observed.contentId)) == true
    }
    private fun dispatchRemoteIntent(pending: RemoteLoad) {
        if (pendingRemoteLoad !== pending || activeSource !== pending.source || player.isDestroyed || lastErrorCode != null || state.value.sourceFailed) return
        val observed = lastReceiverObservation
        val matching = player.isCasting && state.value.castConnection == CastConnection.CONNECTED &&
            observed != null && receiverMatches(observed, pending.source)
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
    override fun onCleared() {
        mainHandler.removeCallbacksAndMessages(null)
        pendingRemoteReplacement = null
        pendingRemoteLoad = null
        subtitleRenderer.setPlayer(null)
        castController?.close(); catalogJob?.cancel(); statusJob?.cancel(); player.destroy()
    }
}

data class OwnershipSnapshot(
    val player: Player, val source: Source?, val impressionId: String?, val loadCount: Int,
    val positionSeconds: Double, val paused: Boolean, val speed: Float, val subtitleId: String?,
)

private data class SavedLivePosition(val eventId: String, val utcMs: Long?, val playWhenReady: Boolean)
private data class PendingLiveReturn(val request: PlaybackRequest, val utcMs: Long, val playWhenReady: Boolean)
private data class PendingHandoff(val request: PlaybackRequest, val source: Source, val recordId: String,
    val videoId: String, var lastPositionMs: Long? = null)

data class ReceiverEvidence(val assetId: String?, val positionMs: Long?, val playing: Boolean?, val paused: Boolean?,
    val samples: Long, val mediaSessionId: Long? = null)

private data class RemoteLoad(val source: Source, val intent: ReceiverLoadIntent)
private data class RemoteReplacement(val connectionId: String, var source: Source, var request: PlaybackRequest,
    val gate: ReceiverStopGate, var dispatchPosted: Boolean = false)
