import SwiftUI

struct TranscriptPanel: View {
    @ObservedObject var session: LearningSession
    @State private var search = ""
    @State private var follow = true
    @FocusState private var focusedCue: Int?
    @AccessibilityFocusState private var accessibleCue: Int?

    var body: some View {
        Text("Transcript").font(.headline)
        HStack {
            Button("English") { session.transcriptLanguage = "en" }
            Button("日本語") { session.transcriptLanguage = "ja" }
        }
        TextField("Search transcript", text: $search)
            .accessibilityLabel("Search transcript")
        Toggle("Follow current line", isOn: $follow)
            .accessibilityIdentifier("transcript.follow")
        if session.transcriptError {
            Text("Transcript unavailable.")
            Button("Retry transcript") { session.fetchTranscript() }
        } else if let transcript = session.transcript {
            let view = transcript.view(query: search, language: session.transcriptLanguage,
                                       seconds: session.ready ? session.position : nil, follow: follow)
            if view.rows.isEmpty { Text("No matching cues") }
            else {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading) {
                            ForEach(view.rows) { row in
                                cueButton(row, active: view.activeIDs.contains(row.id))
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    // Scroll the transcript independently of the video and transport.
                    .frame(height: panelHeight)
                    #if os(iOS)
                    .simultaneousGesture(DragGesture(minimumDistance: 4).onChanged { _ in follow = false })
                    #endif
                    .onAppear { if let target = view.followID { proxy.scrollTo(target, anchor: .top) } }
                    .onChange(of: view.followID) { target in
                        if let target { proxy.scrollTo(target, anchor: .top) }
                    }
                }
            }
        } else if session.lesson?.transcriptUrl != nil { ProgressView() }
        Color.clear.frame(height: 0)
            .onChange(of: session.lesson?.id) { _ in search = "" }
            .onChange(of: focusedCue) { if $0 != nil { follow = false } }
            .onChange(of: accessibleCue) { if $0 != nil { follow = false } }
    }

    private var panelHeight: CGFloat {
        #if os(tvOS)
        return 400
        #else
        return 240
        #endif
    }

    private func cueButton(_ row: Transcript.Row, active: Bool) -> some View {
        Button {
            follow = false
            session.seek(to: row.cue.startMs / 1000)
        } label: {
            HStack(alignment: .firstTextBaseline) {
                if active { Image(systemName: "play.fill").accessibilityHidden(true) }
                Text(verbatim: "\(Media.clock(row.cue.startMs / 1000))  \(row.cue.text)")
            }
            .multilineTextAlignment(.leading)
        }
        .id(row.id)
        .background(active ? Color.accentColor.opacity(0.16) : Color.clear)
        .accessibilityIdentifier("transcript.cue.\(row.id)")
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityValue(active ? Text("Current line") : Text(""))
        .focused($focusedCue, equals: row.id)
        .accessibilityFocused($accessibleCue, equals: row.id)
        .disabled(!session.ready)
    }
}
