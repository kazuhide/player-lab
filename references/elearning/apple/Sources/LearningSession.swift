import SwiftUI
import BitmovinPlayer

@MainActor
final class LearningSession: Playback {
    @Published var catalog: CourseCatalog?
    @Published var course: Course?
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
    private var transcriptTask: Task<Void, Never>?

    var lessons: [Lesson] { catalog?.orderedLessons(in: course) ?? [] }

    override init() {
        super.init()
        replacePlayer(learnerId: "demo-learner-a")
    }

    func fetchCatalog() async {
        do {
            let result = try await Media.fetch("catalog.json", as: CourseCatalog.self)
            guard !result.courses.isEmpty else { throw URLError(.cannotDecodeContentData) }
            catalog = result
            course = result.courses.first
            problem = nil
        } catch { problem = "Course catalog unavailable." }
    }

    func selectLearner(_ next: String) {
        guard next != learner else { return }
        closeLesson()
        learner = next
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

    func save() {
        guard let player, ready, owns(player), !invalidResume, pendingResume == nil, let lesson,
              player.duration.isFinite else { return }
        let position = player.currentTime(.relativeTime)
        guard position.isFinite, position > 0, position < player.duration else { return }
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
        player?.unload()
    }

    func open(_ next: Lesson, resume: Bool, origin: String = "catalog") {
        guard let player, let index = lessons.firstIndex(where: { $0.id == next.id }) else { return }
        closeLesson()
        lesson = next
        let preferences = saved(next)
        pendingResume = resume ? preferences : nil
        invalidResume = false
        lastSaved = nil
        standardControls = preferences?.standard ?? true
        speed = preferences?.speed ?? 1
        captionLanguage = preferences?.language ?? transcriptLanguage
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

    override func onSeeked(_ event: SeekedEvent, player: Player) {
        guard owns(player), let target = pendingResume, let play = resumeSeekPlaying,
              abs(player.currentTime(.relativeTime) - target.seconds) < 1 else { return }
        pendingResume = nil
        resumeSeekPlaying = nil
        desiredPlayback = play
        super.prepared(player)
    }

    override func onPlay(_ event: PlayEvent, player: Player) {
        if owns(player), invalidResume { player.pause() }
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
        position = nil
        lastSaved = nil
        let previousPrefs = saved(next.1)
        standardControls = previousPrefs?.standard ?? standardControls
        speed = previousPrefs?.speed ?? speed
        captionLanguage = previousPrefs?.language ?? captionLanguage
        applyPreferences(player)
        fetchTranscript()
        record("Next lesson")
    }

    override func onPlaybackFinished(_ event: PlaybackFinishedEvent, player: Player) {
        guard owns(player), let lesson else { return }
        playing = false
        ready = false
        persist(lesson, position: 0)
        captionText = nil
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
