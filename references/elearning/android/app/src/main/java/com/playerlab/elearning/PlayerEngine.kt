package com.playerlab.elearning

import android.content.Context
import android.view.View
import android.os.Handler
import android.os.Looper
import com.bitmovin.player.SubtitleView
import com.bitmovin.analytics.api.AnalyticsConfig
import com.bitmovin.analytics.api.CustomData
import com.bitmovin.analytics.api.DefaultMetadata
import com.bitmovin.analytics.api.SourceMetadata
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.TweaksConfig
import com.bitmovin.player.api.analytics.AnalyticsApi.Companion.analytics
import com.bitmovin.player.api.analytics.AnalyticsPlayerConfig
import com.bitmovin.player.api.analytics.AnalyticsSourceConfig
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.media.subtitle.SubtitleTrack
import com.bitmovin.player.api.media.subtitle.Cue
import com.bitmovin.player.api.network.HttpRequestType
import com.bitmovin.player.api.network.NetworkConfig
import com.bitmovin.player.api.network.PreprocessHttpResponseCallback
import com.bitmovin.player.api.playlist.PlaylistConfig
import com.bitmovin.player.api.source.Source
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceOptions
import com.bitmovin.player.api.source.SourceType
import java.util.IdentityHashMap
import java.util.concurrent.ConcurrentHashMap

interface PlaybackObserver {
    fun changed()
    fun saveRequested(lesson: Lesson, positionMs: Long, preferences: PlaybackPreferences)
    fun lessonChanged(item: PlannedLesson)
    fun diagnostic(kind: DiagnosticKind)
    fun issue(issue: PlaybackIssue)
}

class PlayerEngine(context: Context, learner: Learner) {
    private data class CaptionOwner(val generation: Long, val source: Source, val lessonId: String)
    private val captionOwners = ConcurrentHashMap<String, CaptionOwner>()
    private val captionIssues = IdentityHashMap<Source, PlaybackIssue>()
    private val captionMain = Handler(Looper.getMainLooper())
    private var requestGeneration = 0L
    private var closed = false
    private val analyticsEnabled = BuildConfig.ANALYTICS_LICENSE_KEY.isNotBlank()
    val player = createPlayer(context, learner)
    val subtitleRenderer = SubtitleView(context.applicationContext).apply {
        setUserDefaultStyle()
        setUserDefaultTextSize()
        setPlayer(player)
        visibility = View.GONE
    }
    private fun createPlayer(context: Context, learner: Learner): Player {
        checkMainThread()
        // Isolate failed external captions from the media pipeline using the SDK's rendering-time parser.
        val network = NetworkConfig(preprocessHttpResponseCallback = PreprocessHttpResponseCallback { type, response ->
            val owner = captionOwners[response.httpRequest.url]
            if (owner != null && response.status in 200..299 && !hasWebVttSignature(response.body)) {
                captionMain.post {
                    if (!closed && owner.generation == requestGeneration) {
                        reportIssue(owner.source, PlaybackIssue(PlaybackIssueKind.SUBTITLE_INVALID_FORMAT, null, owner.lessonId))
                    }
                }
            }
            // Inspect the SDK's existing response; do not fetch again, alter its body, or keep the payload.
            null
        })
        return Player(context, PlayerConfig(networkConfig = network, tweaksConfig = TweaksConfig(
            parseSubtitlesDuringExtraction = false,
            // Side-loaded captions can be classified as Unknown; validate only the exact registered caption URLs.
            httpResponseTypesToPreprocess = listOf(HttpRequestType.MediaSubtitles, HttpRequestType.Unknown),
        )), analyticsConfig = if (analyticsEnabled) AnalyticsPlayerConfig.Enabled(
        AnalyticsConfig(BuildConfig.ANALYTICS_LICENSE_KEY, adTrackingDisabled = true), DefaultMetadata(customUserId = learner.analyticsId),
        ) else AnalyticsPlayerConfig.Disabled)
    }
    var observer: PlaybackObserver? = null
    var preferences = PlaybackPreferences()
    var activeItem: PlannedLesson? = null
        private set
    private var activeSource: Source? = null
    private val itemsBySource = IdentityHashMap<Source, PlannedLesson>()
    private var expectedSubtitleId: String? = null
    private var playWhenReady = false
    private var preparing = false
    var loads = 0
        private set
    var seeks = 0
        private set
    var frames = 0L
        private set
    var errorCode: String? = null
        private set
    private val activeCues = java.util.Collections.newSetFromMap(IdentityHashMap<Cue, Boolean>())
    val activeCueCount get() = activeCues.size
    val positionMs get() = player.currentTime.takeIf { it.isFinite() && it >= 0 }?.times(1000)?.toLong() ?: 0L

    init {
        checkMainThread()
        player.isFrameAboutToBeRenderedEventEnabled = BuildConfig.DEBUG
        player.on(SourceEvent.Load::class) { loads++ }
        player.on(SourceEvent.Loaded::class) {
            observer?.diagnostic(DiagnosticKind.SOURCE_LOADED)
            if (it.source == player.source) applyPreferences()
            observer?.changed()
        }
        player.on(PlayerEvent.Ready::class) {
            if (activeSource != null && player.source !== activeSource) return@on
            applyPreferences()
            preparing = false
            if (playWhenReady) { playWhenReady = false; player.play() }
            observer?.changed()
        }
        player.on(PlayerEvent.Seek::class) { seeks++; observer?.diagnostic(DiagnosticKind.SEEK) }
        player.on(PlayerEvent.Seeked::class) { observer?.changed() }
        player.on(PlayerEvent.FrameAboutToBeRendered::class) { frames++ }
        player.on(PlayerEvent.Error::class) {
            activeCues.clear()
            errorCode = it.code.value.toString()
            observer?.issue(PlaybackIssue(PlaybackIssueKind.MEDIA_ERROR, it.code.value, activeItem?.lesson?.id))
            observer?.changed()
        }
        player.on(PlayerEvent.Warning::class) { observer?.issue(PlaybackIssue(PlaybackIssueKind.SDK_WARNING, it.code.value, activeItem?.lesson?.id)) }
        player.on(PlayerEvent.CueEnter::class) {
            activeCues.add(it.cue)
            observer?.diagnostic(DiagnosticKind.CUE_ENTER)
        }
        player.on(PlayerEvent.CueExit::class) {
            activeCues.remove(it.cue)
            observer?.diagnostic(DiagnosticKind.CUE_EXIT)
        }
        player.on(PlayerEvent.Play::class) { observer?.diagnostic(DiagnosticKind.PLAY); observer?.changed() }
        player.on(PlayerEvent.Paused::class) { saveCurrent(); observer?.diagnostic(DiagnosticKind.PAUSE); observer?.changed() }
        player.on(PlayerEvent.Active::class) { observer?.diagnostic(DiagnosticKind.SESSION_ACTIVE) }
        player.on(PlayerEvent.Inactive::class) { observer?.diagnostic(DiagnosticKind.SESSION_INACTIVE) }
        player.on(PlayerEvent.PlaybackFinished::class) {
            activeCues.clear()
            // A final cue may have no CueExit event at end of media. Clear only this app-owned renderer.
            subtitleRenderer.setPlayer(player)
            saveCurrent()
            observer?.diagnostic(DiagnosticKind.PLAYBACK_FINISHED)
            observer?.changed()
        }
        player.on(PlayerEvent.PlaylistTransition::class) { event ->
            activeCues.clear()
            itemsBySource[event.from]?.let { observer?.saveRequested(it.lesson, it.lesson.durationMs, preferences) }
            itemsBySource[event.to]?.let { item ->
                activeSource = event.to
                activeItem = item
                preparing = true
                applyPreferences()
                preparing = false
                observer?.lessonChanged(item)
                captionIssues[event.to]?.let { observer?.issue(it.copy(currentSource = true)) }
            }
            observer?.diagnostic(DiagnosticKind.PLAYLIST_TRANSITION)
            observer?.changed()
        }
        player.on(PlayerEvent.PlaybackSpeedChanged::class) {
            if (!preparing && player.source === activeSource && it.to in 0.25f..2f) preferences = preferences.copy(speed = it.to)
            observer?.diagnostic(DiagnosticKind.SPEED)
            observer?.changed()
        }
        player.on(SourceEvent.SubtitleTrackChanged::class) {
            if (!preparing && player.source == activeSource && it.newSubtitleTrack?.id != expectedSubtitleId) {
                val track = it.newSubtitleTrack
                preferences = preferences.copy(subtitle = if (track == null) preferences.subtitle.copy(enabled = false)
                    else SubtitlePreference(true, track.language ?: preferences.subtitle.language, role(track)))
                expectedSubtitleId = track?.id
                observer?.diagnostic(DiagnosticKind.SUBTITLE)
                observer?.changed()
            }
        }
    }

    fun load(plan: PlaybackPlan, media: MediaLocator, play: Boolean = false, fault: OwnedTestFault = OwnedTestFault.NONE) {
        checkMainThread()
        check(BuildConfig.DEBUG || fault == OwnedTestFault.NONE)
        saveCurrent()
        preferences = plan.preferences
        preparing = true
        errorCode = null
        requestGeneration++
        captionOwners.clear()
        captionIssues.clear()
        activeCues.clear()
        // The SDK renderer detaches on a fatal error. An explicit reload restores its subscription.
        subtitleRenderer.setPlayer(player)
        playWhenReady = play
        val sources = plan.items.map { item ->
            val lesson = item.lesson
            val registered = plan.format == StreamFormat.HLS && plan.captionDelivery == CaptionDelivery.MANIFEST
            val path = fault.mediaPath ?: if (registered && lesson.subtitleTracks.isNotEmpty()) requireNotNull(lesson.hlsWithSubtitles) else lesson.streams.getValue(plan.format)
            val config = SourceConfig.Builder(media.resolve(path),
                if (plan.format == StreamFormat.HLS) SourceType.Hls else SourceType.Dash)
                .setTitle(lesson.title)
                .setOptions(SourceOptions(startOffset = item.startPositionMs / 1000.0))
                .setSubtitleTracks(if (registered) emptyList() else lesson.subtitleTracks.map { SubtitleTrack(url = media.resolve(if (it.language == "en") fault.subtitlePath ?: it.url else it.url), label = it.label,
                    id = "${lesson.id}-${it.language}", language = it.language, mimeType = "text/vtt") })
                .build()
            Source(config, AnalyticsSourceConfig.Enabled(SourceMetadata(title = lesson.title, videoId = lesson.videoId,
                customData = CustomData(customData1 = item.origin.analyticsValue)))).also { source ->
                config.subtitleTracks.forEach { track ->
                    track.url?.let { captionOwners[it] = CaptionOwner(requestGeneration, source, lesson.id) }
                }
                source.reportPublicIssues(lesson.id) { issue -> reportIssue(source, issue) }
            }
        }
        itemsBySource.clear()
        sources.zip(plan.items).forEach { (source, item) -> itemsBySource[source] = item }
        activeSource = sources.first()
        activeItem = plan.items.first()
        observer?.lessonChanged(plan.items.first())
        if (plan.isPlaylist) player.load(PlaylistConfig(sources)) else player.load(sources.single())
        observer?.diagnostic(if (analyticsEnabled) DiagnosticKind.ANALYTICS_ENABLED else DiagnosticKind.ANALYTICS_SKIPPED)
    }

    private fun reportIssue(source: Source, issue: PlaybackIssue) {
        // DownloadFinished can arrive on a loader thread. Keep all Source/state/view access on main.
        if (Looper.myLooper() != Looper.getMainLooper()) {
            captionMain.post { reportIssue(source, issue) }
            return
        }
        checkMainThread()
        if (closed || !itemsBySource.containsKey(source)) return
        if (issue.kind in setOf(PlaybackIssueKind.SUBTITLE_LOAD_WARNING, PlaybackIssueKind.SUBTITLE_PARSE_WARNING,
                PlaybackIssueKind.SUBTITLE_HTTP_FAILURE, PlaybackIssueKind.SUBTITLE_INVALID_FORMAT)) captionIssues[source] = issue
        if (issue.kind == PlaybackIssueKind.MEDIA_ERROR && source === activeSource) errorCode = requireNotNull(issue.sdkCode).toString()
        observer?.issue(issue.copy(currentSource = source === activeSource))
        observer?.changed()
    }

    fun loadSpike(url: String, subtitleUrl: String?) {
        if (player.source != null) return
        val config = SourceConfig.Builder.fromUrl(url).apply {
            subtitleUrl?.let { setSubtitleTracks(listOf(SubtitleTrack(url = it, label = "English", id = "edu-en", language = "en", mimeType = "text/vtt"))) }
        }.build()
        player.load(Source(config, AnalyticsSourceConfig.Enabled(SourceMetadata(videoId = "EDU-FX-01",
            title = "Number line basics", customData = CustomData(customData1 = "catalog")))))
    }

    fun applyPreferences() {
        checkMainThread()
        player.playbackSpeed = preferences.speed
        val source = player.source ?: return
        val options = source.availableSubtitleTracks.map { SubtitleOption(it.id, it.language, role(it)) }
        expectedSubtitleId = preferences.subtitle.select(options)?.id
        if (source.selectedSubtitleTrack?.id != expectedSubtitleId) source.setSubtitleTrack(expectedSubtitleId)
    }

    fun seek(positionMs: Long) {
        checkMainThread()
        val source = player.source ?: return
        val duration = source.duration.takeIf { it.isFinite() && it > 0 } ?: return
        val seconds = positionMs / 1000.0
        if (seconds < 0 || seconds >= duration) return
        if (preferences.autoAdvance) player.playlist.seek(source, seconds) else player.seek(seconds)
    }

    fun pause() { checkMainThread(); playWhenReady = false; player.pause() }
    fun saveCurrent() {
        if (player.source === activeSource && activeSource != null) activeItem?.let { observer?.saveRequested(it.lesson, positionMs, preferences) }
    }
    fun snapshot(playerViews: Int, subtitleViews: Int) = PlaybackSnapshot(
        System.identityHashCode(player), System.identityHashCode(player.source), player.currentTime, player.duration,
        player.playbackSpeed, player.source?.selectedSubtitleTrack?.id, player.isPlaying, player.isDestroyed,
        player.analytics?.impressionId, loads, seeks, frames, playerViews, subtitleViews, errorCode,
    )
    fun close() {
        checkMainThread()
        closed = true
        observer = null
        captionMain.removeCallbacksAndMessages(null)
        captionOwners.clear()
        captionIssues.clear()
        subtitleRenderer.setPlayer(null)
        player.destroy()
    }
    private fun role(track: SubtitleTrack) = track.roles.firstOrNull()?.value ?: "subtitle"
}
