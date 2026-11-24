import SwiftUI
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
    private var pendingResume: Progress?
    private var resumeSeekPlaying: Bool?
    private var lastSaved: Double?
    private var finished = false
    private var transcriptTask: Task<Void, Never>?

    var lessons: [Lesson] { catalog?.orderedLessons(in: course) ?? [] }

    override init() {
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
        let progress = Progress(seconds: position, speed: speed, language: captionLanguage, standard: standardControls)
        if let data = try? JSONEncoder().encode(progress) {
            UserDefaults.standard.set(data, forKey: Progress.key(learner: learner, lesson: lesson.id))
        }
    }

    func closeLesson() {
        save()
        resetSelection()
        transcriptTask?.cancel()
        orderedSources = []
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
        guard let player, let index = lessons.firstIndex(where: { $0.id == next.id }) else { return }
        closeLesson()
        lesson = next
        pendingResume = resume ? saved(next) : nil
        invalidResume = false
        lastSaved = nil
        if let saved = pendingResume {
            standardControls = saved.standard ?? standardControls
            speed = saved.speed
            captionLanguage = saved.language
        }
        desiredPlayback = true
        do {
            let queue = autoAdvance ? Array(lessons[index...]) : [next]
            orderedSources = try queue.enumerated().map { offset, lesson in
                let useEmbedded = embeddedCaptions && !lesson.subtitleTracks.isEmpty && lesson.streams.hlsWithSubtitles != nil
                let tracks = useEmbedded ? [] : lesson.subtitleTracks.map { Caption(url: $0.url, language: $0.language, label: $0.label) }
                let source = try Media.source(path: useEmbedded ? lesson.streams.hlsWithSubtitles! : lesson.streams.hls,
                    title: lesson.title, videoId: lesson.videoId, captions: tracks, isLive: false,
                    origin: offset == 0 ? origin : "playlist")
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

    override func prepared(_ player: Player) {
        if let saved = pendingResume {
            guard saved.canResume(duration: player.duration) else {
                invalidResume = true
                player.pause()
                return
            }
            resumeSeekPlaying = desiredPlayback
            player.seek(time: saved.seconds)
            return
        }
        super.prepared(player)
    }

    override func suspendPlayback() {
        if resumeSeekPlaying != nil { resumeSeekPlaying = false }
        super.suspendPlayback()
    }

    override func onSeeked(_ event: SeekedEvent, player: Player) {
        guard owns(player) else { return }
        let seconds = player.currentTime(.relativeTime)
        position = seconds.isFinite && seconds >= 0 ? seconds : nil
        if pendingResume == nil {
            guard ready, !invalidResume, seconds.isFinite, seconds >= 0, seconds < player.duration else { return }
            finished = false
            save(allowZero: true)
            return
        }
        guard let target = pendingResume, let play = resumeSeekPlaying,
              abs(seconds - target.seconds) < 1 else { return }
        pendingResume = nil
        resumeSeekPlaying = nil
        desiredPlayback = play
        super.prepared(player)
    }

    override func onPlay(_ event: PlayEvent, player: Player) {
        if owns(player), invalidResume { player.pause() }
    }

    override func onPlaying(_ event: PlayingEvent, player: Player) {
        super.onPlaying(event, player: player)
        if playing, owns(player) { finished = false }
    }

    override func onTimeChanged(_ event: TimeChangedEvent, player: Player) {
        super.onTimeChanged(event, player: player)
        if let position, abs(position - (lastSaved ?? 0)) >= 5 { save() }
    }

    override func onPaused(_ event: PausedEvent, player: Player) {
        super.onPaused(event, player: player)
        save()
    }

    override func onPlaylistTransition(_ event: PlaylistTransitionEvent, player: Player) {
        guard player === self.player, player.source === event.to,
              let next = orderedSources.first(where: { $0.0 === event.to }) else { return }
        if let previous = lesson { persist(previous, position: 0) }
        lesson = next.1
        activeSource = next.0
        finished = false
        position = nil
        lastSaved = nil
        applyPreferences(player)
        fetchTranscript()
        record("Next lesson")
    }

    override func onPlaybackFinished(_ event: PlaybackFinishedEvent, player: Player) {
        guard owns(player), let lesson else { return }
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
