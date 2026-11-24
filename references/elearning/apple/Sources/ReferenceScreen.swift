import SwiftUI

struct ReferenceScreen: View {
    @StateObject private var session = LearningSession()
    @State private var search = ""
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Learning").font(.largeTitle.bold())
                HStack {
                    Text("Learner")
                    ForEach(["A", "B"], id: \.self) { person in
                        Button(person) { session.selectLearner(person) }.disabled(session.learner == person)
                    }
                }
                if let lesson = session.lesson {
                    lessonView(lesson)
                } else if let catalog = session.catalog {
                    ForEach(catalog.courses) { course in
                        Button(course.displayTitle) { session.course = course }.disabled(course.id == session.course?.id)
                    }
                    Toggle("Play next lesson automatically", isOn: $session.autoAdvance)
                    Toggle("Use embedded HLS subtitles", isOn: $session.embeddedCaptions)
                    ForEach(session.lessons) { lesson in
                        Button(lesson.displayTitle) { session.choose(lesson) }.disabled(session.player == nil)
                        if let saved = session.saved(lesson), saved.seconds > 0 {
                            Text("Saved at \(Media.clock(saved.seconds))")
                        }
                    }
                    if session.player == nil { Text("Set the Player license in Local.xcconfig and rebuild.") }
                } else if let error = session.problem {
                    Text(LocalizedStringKey(error))
                    Button("Retry") { Task { await session.fetchCatalog() } }
                } else { ProgressView() }
            }
            .frame(maxWidth: 1000, alignment: .leading).padding().frame(maxWidth: .infinity)
        }
        .task { if session.catalog == nil { await session.fetchCatalog() } }
        .onChange(of: session.lesson?.id) { _ in search = "" }
        .onChange(of: phase) { phase in
            if phase == .background { session.save(); session.player?.pause() }
        }
        .alert(item: $session.resumeChoice) { lesson in
            Alert(title: Text("Continue this lesson?"),
                  message: Text("Saved at \(Media.clock(session.saved(lesson)?.seconds ?? 0))"),
                  primaryButton: .default(Text("Resume")) { session.open(lesson, resume: true) },
                  secondaryButton: .default(Text("Start over")) { session.open(lesson, resume: false) })
        }
    }

    @ViewBuilder private func lessonView(_ lesson: Lesson) -> some View {
        Text(lesson.displayTitle).font(.title)
        Button("Back to course") { session.closeLesson() }
        PlaybackControls(session: session, modeName: "Learning controls", showsExternalCaptions: !session.embeddedCaptions)
        if session.invalidResume {
            Text("Saved position is outside the current lesson.")
            Button("Start over") { session.open(lesson, resume: false) }
        } else if session.problem != nil {
            Button("Retry") { session.open(lesson, resume: session.saved(lesson) != nil) }
        } else {
            HStack {
                Button("Previous lesson") { move(-1) }.disabled(session.lessons.first?.id == lesson.id)
                Button("Next lesson") { move(1) }.disabled(session.lessons.last?.id == lesson.id)
            }
            Picker("Playback speed", selection: Binding(get: { session.speed }, set: { session.setSpeed($0) })) {
                ForEach([0.5, 0.75, 1, 1.25, 1.5, 2] as [Float], id: \.self) { speed in
                    Text(verbatim: "\(speed.formatted())×").tag(speed)
                }
            }.disabled(!session.ready)
            if lesson.subtitleTracks.isEmpty { Text("No subtitles") }
            else {
                HStack {
                    Button("Subtitles off") { session.setCaptions("") }
                    ForEach(lesson.subtitleTracks, id: \.language) { track in
                        Button(track.label) { session.setCaptions(track.language) }
                    }
                }.disabled(!session.ready)
            }
            Text("Transcript").font(.headline)
            HStack {
                Button("English") { session.transcriptLanguage = "en" }
                Button("日本語") { session.transcriptLanguage = "ja" }
            }
            TextField("Search transcript", text: $search)
                .accessibilityLabel("Search transcript")
            if session.transcriptError {
                Text("Transcript unavailable.")
                Button("Retry transcript") { session.fetchTranscript() }
            } else if let transcript = session.transcript {
                let matches = transcript.search(search, in: session.transcriptLanguage)
                if matches.isEmpty { Text("No matching cues") }
                ForEach(Array(matches.enumerated()), id: \.offset) { _, cue in
                    Button("\(Media.clock(cue.startMs / 1000))  \(cue.text)") {
                        session.player?.seek(time: cue.startMs / 1000)
                    }.disabled(!session.ready)
                }
            } else if lesson.transcriptUrl != nil { ProgressView() }
        }
    }
    private func move(_ delta: Int) {
        guard let index = session.lessons.firstIndex(where: { $0.id == session.lesson?.id }),
              session.lessons.indices.contains(index + delta) else { return }
        session.open(session.lessons[index + delta], resume: false, origin: "playlist")
    }
}
