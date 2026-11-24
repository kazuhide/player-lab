import SwiftUI
import Combine
import BitmovinPlayer

@MainActor
final class LearningSession: Playback {
    @Published var catalog: CourseCatalog?
    @Published private(set) var course: Course?
    private var courseIDs: [String: String] = [:]
    @Published var learner = "A"
    @Published var autoAdvance = false
    @Published var embeddedCaptions = false
    @Published var lesson: Lesson?
    @Published var transcript: Transcript?
    @Published var transcriptError = false
    @Published var resumeChoice: Lesson?
    @Published var invalidResume = false
    @Published var transcriptLanguage = Locale.current.language.languageCode?.identifier == "ja" ? "ja" : "en"
    private var orderedSources: [(Source, Lesson)] = []
    private struct OpenRequest {
        let lesson: Lesson
        let progress: Progress
        let play: Bool
        let origin: String
        var isViewerSeek = false
    }
    private var currentRequest: OpenRequest?
    private var established = false
    private let seekResume: (Player, Double) -> Void
    private var pendingResume: Progress?
    private var resumeSeekPlaying: Bool?
    private var seekStart: AnyCancellable?
    private var resumeDeadline: Task<Void, Never>?
    private var observedPositivePosition = false
    private var lastSaved: Double?
    private var finished = false
    private var transcriptTask: Task<Void, Never>?

    var lessons: [Lesson] { catalog?.orderedLessons(in: course) ?? [] }

    init(seekResume: @escaping (Player, Double) -> Void = { $0.seek(time: $1) }) {
        self.seekResume = seekResume
        super.init()
        captionLanguage = transcriptLanguage
        replacePlayer(learnerId: "demo-learner-a")
    }

    func fetchCatalog() async {
        do {
            let result = try await Media.fetch("catalog.json", as: CourseCatalog.self)
            guard !result.courses.isEmpty else { throw URLError(.cannotDecodeContentData) }
            catalog = result
            restoreCourse()
            problem = nil
        } catch { problem = "Course catalog unavailable." }
    }

    func chooseCourse(_ next: Course) {
        guard let selected = catalog?.courses.first(where: { $0.id == next.id }) else { return }
        courseIDs[learner] = selected.id
        course = selected
    }

    private func restoreCourse() {
        let remembered = courseIDs[learner]
        course = catalog?.courses.first { $0.id == remembered } ?? catalog?.courses.first
    }

    func selectLearner(_ next: String) {
        guard next != learner else { return }
        closeLesson()
        learner = next
        restoreCourse()
        diagnostics.removeAll()
        standardControls = true
        speed = 1
        transcriptLanguage = Locale.current.language.languageCode?.identifier == "ja" ? "ja" : "en"
        captionLanguage = transcriptLanguage
        autoAdvance = false
        replacePlayer(learnerId: "demo-learner-" + next.lowercased())
    }

    func saved(_ lesson: Lesson) -> Progress? {
        let key = Progress.key(learner: learner, lesson: lesson.id)
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(Progress.self, from: data)
    }

    func choose(_ lesson: Lesson) {
        if (saved(lesson)?.seconds ?? 0) > 0 { resumeChoice = lesson }
        else { open(lesson, resume: false) }
    }

    func save(allowZero: Bool = false) {
        guard let player, ready, owns(player), !invalidResume, !finished, pendingResume == nil, let lesson,
              player.duration.isFinite else { return }
        let position = player.currentTime(.relativeTime)
        guard position.isFinite, position >= 0, position < player.duration, allowZero || position > 0 else { return }
        persist(lesson, position: position)
        lastSaved = position
    }

    private func persist(_ lesson: Lesson, position: Double) {
        if let data = try? JSONEncoder().encode(progress(at: position)) {
            UserDefaults.standard.set(data, forKey: Progress.key(learner: learner, lesson: lesson.id))
        }
    }

    private func progress(at position: Double) -> Progress {
        Progress(seconds: position, speed: speed, language: captionLanguage, standard: standardControls)
    }

    func closeLesson() {
        if currentRequest?.isViewerSeek == true, let player, let lesson, let landing = pendingLanding(player) {
            persist(lesson, position: landing.atEnd ? 0 : landing.seconds)
        } else {
            save(allowZero: established && observedPositivePosition)
        }
        resumeDeadline?.cancel()
        seekStart = nil
        observedPositivePosition = false
        resetSelection()
        transcriptTask?.cancel()
        orderedSources = []
        currentRequest = nil
        established = false
        lesson = nil
        pendingResume = nil
        resumeSeekPlaying = nil
        resumeChoice = nil
        transcript = nil
        invalidResume = false
        finished = false
        player?.unload()
    }

    func open(_ next: Lesson, resume: Bool, origin: String = "catalog") {
        let bookmark = resume ? saved(next) : nil
        let checkpoint = bookmark.flatMap { $0.seconds != 0 ? $0 : nil } ?? progress(at: 0)
        load(OpenRequest(lesson: next, progress: checkpoint, play: true, origin: origin))
    }

    func retry() {
        guard problem != nil, let request = currentRequest, request.lesson.id == lesson?.id else { return }
        let checkpoint = progress(at: request.progress.seconds)
        load(OpenRequest(lesson: request.lesson, progress: checkpoint, play: request.play,
                         origin: request.origin, isViewerSeek: request.isViewerSeek))
    }

    private func load(_ request: OpenRequest) {
        let next = request.lesson
        guard let player, let index = lessons.firstIndex(where: { $0.id == next.id }) else { return }
        closeLesson()
        currentRequest = request
        lesson = next
        pendingResume = request.progress.seconds == 0 ? nil : request.progress
        invalidResume = false
        lastSaved = nil
        standardControls = request.progress.standard ?? standardControls
        speed = request.progress.speed
        captionLanguage = request.progress.language
        desiredPlayback = request.play
        do {
            let queue = autoAdvance ? Array(lessons[index...]) : [next]
            orderedSources = try queue.enumerated().map { offset, lesson in
                let useEmbedded = embeddedCaptions && !lesson.subtitleTracks.isEmpty && lesson.streams.hlsWithSubtitles != nil
                let tracks = useEmbedded ? [] : lesson.subtitleTracks.map { Caption(url: $0.url, language: $0.language, label: $0.label) }
                let source = try Media.source(path: useEmbedded ? lesson.streams.hlsWithSubtitles! : lesson.streams.hls,
                    title: lesson.title, videoId: lesson.videoId, captions: tracks, isLive: false,
                    origin: offset == 0 ? request.origin : "playlist")
                return (source, lesson)
            }
            activeSource = orderedSources.first?.0
            fetchTranscript()
            let config = PlaylistConfig(sources: orderedSources.map { $0.0 }, options: PlaylistOptions())
            observe(player)
            player.load(playlistConfig: config)
        } catch { failed("Invalid lesson media address.") }
    }

    func fetchTranscript() {
        transcriptTask?.cancel()
        transcript = nil
        transcriptError = false
        guard let lesson, let path = lesson.transcriptUrl else { return }
        transcriptTask = Task {
            do {
                let result = try await Media.fetch(path, as: Transcript.self)
                guard !Task.isCancelled, self.lesson?.id == lesson.id else { return }
                transcript = result
            } catch { if !Task.isCancelled { transcriptError = true } }
        }
    }

    override func observe(_ player: Player) {
        super.observe(player)
        seekStart = player.events.on(SeekEvent.self).receive(on: DispatchQueue.main).sink { [weak self, weak player] event in
            guard let self, let player else { return }
            self.onSeekStarted(event, player: player)
        }
    }

    func onSeekStarted(_ event: SeekEvent, player: Player) {
        guard owns(player), event.to.source === activeSource else { return }
        replacePendingSeek(with: event.to.time)
    }

    override func seek(by delta: Double) {
        guard let player, player.duration.isFinite else { return }
        seek(to: min(player.duration, max(0, player.currentTime(.relativeTime) + delta)))
    }

    func seek(to seconds: Double) {
        guard let player, ready, owns(player), seconds.isFinite, seconds >= 0, seconds <= player.duration else { return }
        replacePendingSeek(with: seconds)
        player.seek(time: seconds)
    }

    private func replacePendingSeek(with seconds: Double) {
        guard let pendingResume, resumeSeekPlaying != nil, abs(pendingResume.seconds - seconds) > 0.001,
              let player, seconds.isFinite, seconds >= 0, seconds <= player.duration, let request = currentRequest else { return }
        let checkpoint = progress(at: seconds)
        self.pendingResume = checkpoint
        currentRequest = OpenRequest(lesson: request.lesson, progress: checkpoint,
                                     play: desiredPlayback, origin: request.origin, isViewerSeek: true)
        startResumeDeadline()
    }

    private func startResumeDeadline() {
        resumeDeadline?.cancel()
        resumeDeadline = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 5_000_000_000) } catch { return }
            guard let self, pendingResume != nil, let player, owns(player) else { return }
            player.pause()
            failed("Could not reach the requested lesson position.")
        }
    }

    override func prepared(_ player: Player) {
        guard problem == nil else { return }
        if let saved = pendingResume {
            let requestedEnd = currentRequest?.isViewerSeek == true && saved.seconds == player.duration
            guard saved.canResume(duration: player.duration) || requestedEnd else {
                invalidResume = true
                player.pause()
                return
            }
            resumeSeekPlaying = desiredPlayback
            startResumeDeadline()
            seekResume(player, saved.seconds)
            return
        }
        established = true
        super.prepared(player)
    }

    override func failed(_ reason: String) {
        if established, let request = currentRequest, let lesson {
            let current = finished ? 0 : position ?? request.progress.seconds
            currentRequest = OpenRequest(lesson: lesson, progress: progress(at: current),
                                         play: desiredPlayback, origin: request.origin)
        }
        established = false
        cancelPendingSeek()
        super.failed(reason)
    }

    override func suspendPlayback() {
        if resumeSeekPlaying != nil { resumeSeekPlaying = false }
        super.suspendPlayback()
    }

    private func pendingLanding(_ player: Player) -> (seconds: Double, atEnd: Bool)? {
        guard ready, owns(player), problem == nil, !invalidResume, resumeSeekPlaying != nil,
              let target = pendingResume?.seconds, player.duration.isFinite, player.duration > 0 else { return nil }
        let seconds = player.currentTime(.relativeTime)
        guard seconds.isFinite, seconds >= 0, abs(seconds - target) < 1,
              seconds != 0 || target == 0 else { return nil }
        return (seconds, seconds >= player.duration)
    }

    override func onSeeked(_ event: SeekedEvent, player: Player) {
        guard ready, owns(player), problem == nil else { return }
        if pendingResume == nil {
            let seconds = player.currentTime(.relativeTime)
            position = seconds.isFinite && seconds >= 0 ? seconds : nil
            guard !invalidResume, seconds.isFinite, seconds >= 0, seconds < player.duration else { return }
            finished = false
            observedPositivePosition = observedPositivePosition || seconds > 0
            save(allowZero: true)
            return
        }
        guard let play = resumeSeekPlaying, let lesson, let landing = pendingLanding(player) else { return }
        cancelPendingSeek()
        established = true
        position = landing.seconds
        if landing.atEnd {
            finishLesson()
            return
        }
        observedPositivePosition = landing.seconds > 0
        persist(lesson, position: landing.seconds)
        lastSaved = landing.seconds
        desiredPlayback = play
        super.prepared(player)
    }

    override func onPlay(_ event: PlayEvent, player: Player) {
        if owns(player), invalidResume || problem != nil || pendingResume != nil { player.pause() }
    }

    override func onPlaying(_ event: PlayingEvent, player: Player) {
        super.onPlaying(event, player: player)
        if playing, owns(player) { finished = false }
    }

    override func onTimeChanged(_ event: TimeChangedEvent, player: Player) {
        super.onTimeChanged(event, player: player)
        guard established, owns(player), let position else { return }
        if position > 0 { observedPositivePosition = true }
        if abs(position - (lastSaved ?? 0)) >= 5 { save() }
    }

    override func onPaused(_ event: PausedEvent, player: Player) {
        super.onPaused(event, player: player)
        save()
    }

    override func onPlaylistTransition(_ event: PlaylistTransitionEvent, player: Player) {
        guard player === self.player, player.source === event.to,
              let next = orderedSources.first(where: { $0.0 === event.to }) else { return }
        cancelPendingSeek()
        if let previous = lesson { persist(previous, position: 0) }
        lesson = next.1
        activeSource = next.0
        currentRequest = OpenRequest(lesson: next.1, progress: progress(at: 0), play: desiredPlayback, origin: "playlist")
        established = true
        observedPositivePosition = false
        finished = false
        position = nil
        lastSaved = nil
        applyPreferences(player)
        fetchTranscript()
        record("Next lesson")
    }

    override func onPlaybackFinished(_ event: PlaybackFinishedEvent, player: Player) {
        guard owns(player) else { return }
        finishLesson()
    }

    private func cancelPendingSeek() {
        resumeDeadline?.cancel()
        pendingResume = nil
        resumeSeekPlaying = nil
    }

    private func finishLesson() {
        guard let lesson, !finished else { return }
        cancelPendingSeek()
        established = true
        playing = false
        finished = true
        persist(lesson, position: 0)
        clearCaptions()
        record("Finished")
    }

    func setSpeed(_ value: Float) {
        guard let player, player.canPlay(atPlaybackSpeed: value) else { return }
        speed = value
        player.playbackSpeed = value
        save()
    }
    func setCaptions(_ language: String) {
        guard let player else { return }
        captionLanguage = language
        applyPreferences(player)
        save()
    }
}
