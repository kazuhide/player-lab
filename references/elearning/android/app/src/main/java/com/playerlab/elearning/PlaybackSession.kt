package com.playerlab.elearning

import android.app.Application
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class AppScreen { COURSE, LESSON }

class PlaybackSession(application: Application) : AndroidViewModel(application), PlaybackObserver {
    private val progress = ProgressRepository(application)
    private val main = Handler(Looper.getMainLooper())
    private val requests = SelectionRequests()
    private var media = MediaLocator(BuildConfig.MEDIA_BASE_URL)
    private var engine = newEngine(Learner.A)
    private var identityGeneration = 0L
    private var closed = false
    private var lastPeriodicSaveMs = 0L
    private var spike = false
    private var ownedFault = OwnedTestFault.NONE
    var onChanged: (() -> Unit)? = null
    var beforePlayerReplacement: (() -> Unit)? = null
    var catalog: Catalog? = null
        private set
    var catalogFailed = false
        private set
    var progressLoading = true
        private set
    var saveFailed = false
        private set
    var learner = Learner.A
        private set
    var courseId = ""
        private set
    var screen = AppScreen.COURSE
        private set
    var autoAdvanceDraft = false
        private set
    var format = StreamFormat.HLS
        private set
    var captionDelivery = CaptionDelivery.EXTERNAL
        private set
    var resumes = emptyMap<String, ResumeRecord>()
        private set
    var transcript = Transcript.EMPTY
        private set
    var transcriptLoading = false
        private set
    var transcriptFailed = false
        private set
    val diagnostics = DiagnosticBuffer()
    val viewState = LessonViewState(if (Locale.getDefault().language == "ja") "ja" else "en")
    val player get() = engine.player
    val activeItem get() = engine.activeItem
    val positionMs get() = engine.positionMs
    val preferences get() = engine.preferences
    val errorCode get() = engine.errorCode
    val subtitleRenderer get() = engine.subtitleRenderer
    val activeCueCount get() = engine.activeCueCount
    var captionIssue: PlaybackIssue? = null
        private set
    var uiMode: UiMode
        get() = engine.preferences.uiMode
        set(value) {
            checkMainThread()
            engine.preferences = engine.preferences.copy(uiMode = value)
            diagnostic(DiagnosticKind.UI_MODE)
            engine.saveCurrent()
        }
    private val tick = object : Runnable {
        override fun run() {
            if (closed) return
            val now = android.os.SystemClock.elapsedRealtime()
            if (player.isPlaying && now - lastPeriodicSaveMs >= 5_000) { lastPeriodicSaveMs = now; engine.saveCurrent() }
            changed()
            main.postDelayed(this, 500)
        }
    }

    init { loadCatalog() }

    private fun newEngine(learner: Learner) = PlayerEngine(getApplication(), learner).also {
        it.preferences = PlaybackPreferences(subtitle = SubtitlePreference(language = if (Locale.getDefault().language == "ja") "ja" else "en"))
        it.observer = this
    }
    fun loadCatalog() {
        catalogFailed = false
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { getApplication<Application>().assets.open("fixtures/catalog.json").bufferedReader().use { Catalog.parse(it.readText()) } } }
            result.onSuccess { catalog = it; courseId = it.courses.first().id; loadProgress() }
                .onFailure { catalogFailed = true; progressLoading = false }
            changed()
        }
    }
    private fun loadProgress() {
        val ids = catalog?.lessons?.map { it.id } ?: return
        val selectedLearner = learner
        val generation = identityGeneration
        progressLoading = true
        viewModelScope.launch {
            val loaded = progress.read(selectedLearner, ids)
            if (generation != identityGeneration || selectedLearner != learner) return@launch
            resumes = (loaded.keys + resumes.keys).associateWith { key -> listOfNotNull(loaded[key], resumes[key]).maxBy { it.savedAtMs } }
            progressLoading = false
            changed()
        }
    }

    fun startLesson(id: String, resume: Boolean = false, origin: StartOrigin = StartOrigin.CATALOG, play: Boolean = true) {
        checkMainThread()
        val catalog = requireNotNull(catalog)
        val saved = if (resume) resumes[id] else null
        if (resume) require(saved != null && saved.canResume(catalog.lesson(id).durationMs)) { "Saved position is outside this lesson" }
        val chosen = (saved?.preferences ?: preferences).copy(autoAdvance = autoAdvanceDraft)
        val plan = PlaybackPlan.create(catalog, learner, courseId, id, format, chosen, origin, saved, captionDelivery)
        screen = AppScreen.LESSON
        diagnostic(DiagnosticKind.LESSON_SELECTED)
        captionIssue = null
        val fault = ownedFault
        ownedFault = OwnedTestFault.NONE
        engine.load(plan, media, play, fault)
        changed()
    }

    fun adjacent(offset: Int) {
        val id = activeItem?.lesson?.id ?: return
        val lesson = catalog?.adjacent(courseId, id, offset) ?: return
        diagnostic(if (offset < 0) DiagnosticKind.MANUAL_PREVIOUS else DiagnosticKind.MANUAL_NEXT)
        startLesson(lesson.id, origin = StartOrigin.PLAYLIST)
    }
    fun setAutoAdvance(value: Boolean) { check(screen == AppScreen.COURSE); autoAdvanceDraft = value; changed() }
    fun setFormat(value: StreamFormat) { check(screen == AppScreen.COURSE); format = value; if (value == StreamFormat.DASH) captionDelivery = CaptionDelivery.EXTERNAL; changed() }
    fun setCaptionDelivery(value: CaptionDelivery) { check(screen == AppScreen.COURSE && format == StreamFormat.HLS); captionDelivery = value; changed() }
    fun setSpeed(value: Float) {
        engine.preferences = preferences.copy(speed = value)
        engine.applyPreferences()
        engine.saveCurrent()
        changed()
    }
    fun setSubtitle(value: SubtitlePreference) {
        engine.preferences = preferences.copy(subtitle = value)
        engine.applyPreferences()
        diagnostic(DiagnosticKind.SUBTITLE)
        engine.saveCurrent()
        changed()
    }
    fun seek(positionMs: Long) = engine.seek(positionMs)
    fun returnToCourse() {
        engine.pause()
        engine.saveCurrent()
        autoAdvanceDraft = preferences.autoAdvance
        screen = AppScreen.COURSE
        changed()
    }
    fun retry() {
        val item = activeItem ?: return
        ownedFault = OwnedTestFault.NONE
        val retryPreferences = if (captionIssue != null) preferences.copy(subtitle = preferences.subtitle.copy(enabled = true)) else preferences
        val saved = ResumeRecord(learner, item.lesson.id, positionMs, retryPreferences, System.currentTimeMillis())
            .takeIf { it.canResume(item.lesson.durationMs) }
        val plan = PlaybackPlan.create(requireNotNull(catalog), learner, courseId, item.lesson.id, format, retryPreferences, item.origin, saved, captionDelivery)
        val playing = player.isPlaying || errorCode != null
        captionIssue = null
        engine.load(plan, media, playing)
        changed()
    }
    fun switchLearner(value: Learner) {
        if (value == learner) return
        engine.saveCurrent()
        requests.cancel()
        identityGeneration++
        beforePlayerReplacement?.invoke()
        engine.close()
        learner = value
        engine = newEngine(value)
        captionIssue = null
        ownedFault = OwnedTestFault.NONE
        screen = AppScreen.COURSE
        resumes = emptyMap()
        transcript = Transcript.EMPTY
        viewState.fullscreen = false
        autoAdvanceDraft = false
        diagnostics.clear()
        loadProgress()
        changed()
    }

    override fun lessonChanged(item: PlannedLesson) {
        captionIssue = null
        viewState.query = ""
        viewState.transcriptLanguage = preferences.subtitle.language
        transcript = Transcript.EMPTY
        transcriptFailed = false
        val path = item.lesson.transcriptUrl
        transcriptLoading = path != null
        val request = requests.begin(learner, item.lesson.id)
        if (path == null) return
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { getApplication<Application>().assets.open("fixtures/$path").bufferedReader().use { Transcript.parse(it.readText(), item.lesson.durationMs) } }
            }
            if (!requests.isCurrent(request)) return@launch
            result.onSuccess { transcript = it }.onFailure { transcriptFailed = true }
            transcriptLoading = false
            changed()
        }
    }
    override fun saveRequested(lesson: Lesson, positionMs: Long, preferences: PlaybackPreferences) {
        if (spike) return
        val record = ResumeRecord(learner, lesson.id, positionMs, preferences, System.currentTimeMillis())
        progress.save(record) { success ->
            if (closed || record.learner != learner) return@save
            saveFailed = !success
            if (success && (resumes[lesson.id]?.savedAtMs ?: 0) <= record.savedAtMs) resumes = resumes + (lesson.id to record)
            diagnostics.add(if (success) DiagnosticKind.SAVE_SUCCESS else DiagnosticKind.SAVE_FAILED, record.lessonId, record.positionMs, record.preferences.uiMode)
            changed()
        }
    }
    override fun diagnostic(kind: DiagnosticKind) { diagnostics.add(kind, activeItem?.lesson?.id, positionMs, uiMode) }
    override fun issue(issue: PlaybackIssue) {
        val kind = when (issue.kind) {
            PlaybackIssueKind.MEDIA_ERROR -> DiagnosticKind.ERROR
            PlaybackIssueKind.SUBTITLE_HTTP_FAILURE -> DiagnosticKind.CAPTION_HTTP_FAILURE
            PlaybackIssueKind.SUBTITLE_INVALID_FORMAT -> DiagnosticKind.CAPTION_INVALID_FORMAT
            else -> DiagnosticKind.WARNING
        }
        diagnostics.add(kind, issue.lessonId, if (issue.currentSource) positionMs else 0, uiMode, issue.sdkCode, issue.httpStatus)
        if (issue.currentSource && issue.lessonId == activeItem?.lesson?.id && issue.kind in setOf(PlaybackIssueKind.SUBTITLE_LOAD_WARNING, PlaybackIssueKind.SUBTITLE_PARSE_WARNING, PlaybackIssueKind.SUBTITLE_HTTP_FAILURE, PlaybackIssueKind.SUBTITLE_INVALID_FORMAT)) captionIssue = issue
        changed()
    }
    override fun changed() { if (!closed) onChanged?.invoke() }
    fun onForeground() { diagnostic(DiagnosticKind.FOREGROUND); main.removeCallbacks(tick); main.post(tick) }
    fun onBackground() { diagnostic(DiagnosticKind.BACKGROUND); engine.pause(); engine.saveCurrent(); main.removeCallbacks(tick) }
    fun onRotation() { diagnostic(DiagnosticKind.ROTATION) }
    fun onAudioRouteLost() { diagnostic(DiagnosticKind.AUDIO_ROUTE_LOST); engine.pause(); engine.saveCurrent() }
    fun loadSpike(url: String, subtitleUrl: String?) { spike = true; screen = AppScreen.LESSON; engine.loadSpike(url, subtitleUrl) }
    fun configureMediaForTest(baseUrl: String) { check(BuildConfig.DEBUG && player.source == null); media = MediaLocator(baseUrl) }
    fun setOwnedFaultForTest(fault: OwnedTestFault) { check(BuildConfig.DEBUG && screen == AppScreen.COURSE); ownedFault = fault }
    fun snapshot(playerViews: Int, subtitleViews: Int) = engine.snapshot(playerViews, subtitleViews)
    override fun onCleared() { closed = true; main.removeCallbacks(tick); engine.close(); progress.close() }
}

internal fun checkMainThread() = check(Looper.myLooper() == Looper.getMainLooper()) {
    "Player, Source, Collector and view ownership must be accessed on the main thread"
}
