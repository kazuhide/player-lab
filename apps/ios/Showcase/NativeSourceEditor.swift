import SwiftUI
#if !os(tvOS)
import UIKit
#endif

/// Playlist drafts share the main configuration validation without changing active playback.
struct NativeSourceEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ConfigurationDraft
    @State private var setting = "Source URL"
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
                Text("Playlist source").font(.headline)
                Spacer()
                Button("Cancel") { dismiss() }.accessibilityIdentifier("playlist.source.cancel")
            }
            Picker("Setting", selection: $setting) {
                ForEach(["Source URL", "Source type", "Title", "Poster URL", "Start offset", "Offset reference", "Audio language", "Subtitles", "Subtitle language", "Advanced SDK"], id: \.self) { Text(LocalizedStringKey($0)).tag($0) }
            }
            .accessibilityIdentifier("playlist.source.setting")
            if setting == "Advanced SDK" {
                AdvancedConfigurationFields(values: $draft.advancedValues, owners: [.source])
                    .accessibilityIdentifier("playlist.source.advanced")
            } else {
                Form {
                    if setting == "Source URL" { field("Source URL", text: $draft.sourceURL, id: "url") }
                    if setting == "Source type" {
                        Picker("Source type", selection: $draft.sourceType) { ForEach(SourceFormat.allCases) { Text(LocalizedStringKey($0.rawValue)).tag($0) } }
                    }
                    if setting == "Title" { field("Title", text: $draft.title, id: "title") }
                    if setting == "Poster URL" { field("Poster URL", text: $draft.posterURL, id: "poster") }
                    if setting == "Start offset" { field("Start offset (seconds; blank uses SDK default)", text: $draft.startOffset, id: "offset") }
                    if setting == "Offset reference" {
                        Picker("Offset reference", selection: $draft.timelineReference) { ForEach(OffsetReference.allCases) { Text(LocalizedStringKey($0.rawValue)).tag($0) } }
                    }
                    if setting == "Audio language" { field("Audio language", text: $draft.audioLanguage, id: "audio") }
                    if setting == "Subtitles" {
                        Picker("Subtitles", selection: $draft.subtitleMode) { ForEach(InitialSubtitleMode.allCases) { Text(LocalizedStringKey($0.rawValue)).tag($0) } }
                    }
                    if setting == "Subtitle language" { field("Subtitle language", text: $draft.subtitleLanguage, id: "subtitle") }
                    if ["Audio language", "Subtitles", "Subtitle language"].contains(setting) {
                        Text("Applied once at readiness. Preloaded transitions wait for this source's clock to advance. Later track-menu choices remain active.").font(.caption)
                    }
                }
                .accessibilityIdentifier("playlist.source.form")
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier("playlist.source.error") }
            Button("Save source draft") {
                if let validated { save(validated); dismiss() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(validated == nil)
            .accessibilityIdentifier("playlist.source.save")
        }
        .padding()
        #if os(tvOS)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        #else
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
            Text(LocalizedStringKey(label)).font(.caption)
            TextField("Value", text: text).disableAutocorrection(true)
                #if !os(tvOS)
                .textInputAutocapitalization(.never)
                #endif
                .accessibilityIdentifier("playlist.source." + id)
        }
    }
}
