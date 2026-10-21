import SwiftUI
#if !os(tvOS)
import UIKit
#endif

/// The playlist drafts reuse the same validation and typed SourceConfig consumers as the main editor.
struct NativeSourceEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ConfigurationDraft
    @State private var showsAdvanced = false
    let save: (SourceSettings) -> Void

    init(source: SourceSettings, save: @escaping (SourceSettings) -> Void) {
        _draft = State(initialValue: ConfigurationDraft(source: source, player: PlayerSettings()))
        self.save = save
    }

    private var validated: SourceSettings? { try? draft.validated().source }
    private var error: String? {
        do { _ = try draft.validated(); return nil } catch { return error.localizedDescription }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Playlist source").font(.title2).bold()
                Spacer()
                Button("Cancel") { dismiss() }.accessibilityIdentifier("playlist.source.cancel")
            }
            Form {
                Section(header: Text("SourceConfig")) {
                    field("Source URL", text: $draft.sourceURL, id: "url")
                    Picker("Source type", selection: $draft.sourceType) { ForEach(SourceFormat.allCases) { Text($0.rawValue).tag($0) } }
                    field("Title", text: $draft.title, id: "title")
                    field("Poster URL", text: $draft.posterURL, id: "poster")
                    field("Start offset (seconds; blank uses SDK default)", text: $draft.startOffset, id: "offset")
                    Picker("Offset reference", selection: $draft.timelineReference) { ForEach(OffsetReference.allCases) { Text($0.rawValue).tag($0) } }
                }
                Section(header: Text("Initial track preferences (app)")) {
                    field("Audio language", text: $draft.audioLanguage, id: "audio")
                    Picker("Subtitles", selection: $draft.subtitleMode) { ForEach(InitialSubtitleMode.allCases) { Text($0.rawValue).tag($0) } }
                    if draft.subtitleMode == .language { field("Subtitle language", text: $draft.subtitleLanguage, id: "subtitle") }
                    Text("Applied once at readiness. For a preloaded playlist transition, the app waits until this source's playback clock advances. Later track-menu choices are retained.").font(.caption)
                }
                Section(header: Text("Additional source settings")) {
                    Toggle("Edit Source API overrides", isOn: $showsAdvanced)
                        .accessibilityIdentifier("playlist.source.advanced")
                    if showsAdvanced { AdvancedConfigurationFields(values: $draft.advancedValues, owners: [.source]) }
                }
            }
            .accessibilityIdentifier("playlist.source.form")
            if let error { Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier("playlist.source.error") }
            Button("Save source draft") {
                if let validated { save(validated); dismiss() }
            }
            .disabled(validated == nil)
            .accessibilityIdentifier("playlist.source.save")
        }
        .padding()
        #if !os(tvOS)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                    .accessibilityIdentifier("playlist.source.keyboard.done")
            }
        }
        #endif
    }

    private func field(_ label: String, text: Binding<String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption)
            TextField("Value", text: text).disableAutocorrection(true)
                #if !os(tvOS)
                .textInputAutocapitalization(.never)
                #endif
                .accessibilityIdentifier("playlist.source." + id)
        }
    }
}
