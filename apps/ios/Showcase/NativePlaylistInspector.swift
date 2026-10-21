import SwiftUI
#if !os(tvOS)
import UIKit
#endif

struct NativePlaylistInspector: View {
    @ObservedObject var model: PlayerModel
    @ObservedObject var workbench: NativePlaylistWorkbench
    @Environment(\.dismiss) private var dismiss
    @State private var operation = NativePlaylistOperation.load
    @State private var editing: NativePlaylistEntry?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Playlist APIs").font(.title2).bold()
                Spacer()
                Button("Close") { dismiss() }.accessibilityIdentifier("playlist.close")
            }
            Form {
                Section(header: Text("Source drafts")) {
                    Text("Each source has its own URL, offsets, metadata, subtitles and DRM settings. Editing a draft does not change the active SDK playlist until Load, Add or Insert. Applying the main player configuration recreates its normal single-source setup.").font(.caption)
                    Button("Add a copy of the applied source") {
                        if let source = model.sourceSettings { workbench.add(source) }
                    }
                    .disabled(model.sourceSettings == nil)
                    .accessibilityIdentifier("playlist.addDraft")
                    ForEach(workbench.entries) { entry in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(entry.source.title.isEmpty ? "Untitled source" : entry.source.title)
                            HStack {
                                Button("Edit") { editing = entry }.accessibilityIdentifier("playlist.edit.\(entry.id)")
                                Button("Remove draft") { workbench.removeDraft(entry.id) }.accessibilityIdentifier("playlist.removeDraft.\(entry.id)")
                                Button("Move up") { move(entry.id, offset: -1) }
                                    .disabled(workbench.entries.first?.id == entry.id)
                                Button("Move down") { move(entry.id, offset: 1) }
                                    .disabled(workbench.entries.last?.id == entry.id)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if !workbench.entries.isEmpty {
                        Picker("Source draft for Add/Insert", selection: $workbench.selectedEntry) {
                            ForEach(workbench.entries) { entry in Text(entry.source.title.isEmpty ? "Untitled" : entry.source.title).tag(Optional(entry.id)) }
                        }
                        .accessibilityIdentifier("playlist.selectedDraft")
                    }
                    Picker("Source factory", selection: $workbench.sourceFactory) { ForEach(NativeSourceFactory.allCases) { Text($0.rawValue).tag($0) } }
                        .accessibilityIdentifier("playlist.sourceFactory")
                }
                Section(header: Text("PlaylistConfig options")) {
                    Toggle("Preload all sources", isOn: $workbench.preloadAllSources).accessibilityIdentifier("playlist.preload")
                    Picker("Replay mode", selection: $workbench.replayMode) {
                        Text("Last source").tag("lastSource")
                        Text("Whole playlist").tag("playlist")
                    }
                    .accessibilityIdentifier("playlist.replayMode")
                    Text("Preloading more sources can increase memory and network use. Only enable it when testing that SDK behavior.").font(.caption)
                }
                Section(header: Text("SDK operation")) {
                    Picker("Operation", selection: $operation) { ForEach(NativePlaylistOperation.allCases) { Text($0.rawValue).tag($0) } }
                        #if os(tvOS)
                        .pickerStyle(.inline)
                        #endif
                        .accessibilityIdentifier("playlist.operation")
                    if [.insert, .remove, .seek].contains(operation) { input("SDK source index (zero-based)", value: $workbench.index, id: "playlist.index") }
                    if operation == .seek { input("Position (seconds)", value: $workbench.time, id: "playlist.time") }
                    Button("Run playlist API") {
                        do { try workbench.run(operation, model: model); error = nil }
                        catch { self.error = error.localizedDescription }
                    }
                    .accessibilityIdentifier("playlist.run")
                }
                Section(header: Text("Result and current SDK playlist")) {
                    if let error { Text(error).foregroundStyle(.red).accessibilityIdentifier("playlist.error") }
                    Text(workbench.result).font(.caption).accessibilityIdentifier("playlist.result")
                    Button("Refresh playlist state") { workbench.refresh(model: model) }.accessibilityIdentifier("playlist.refresh")
                    ForEach(workbench.state) { row in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.id).font(.caption).foregroundStyle(.secondary)
                            Text(row.value).font(.system(.caption, design: .monospaced))
                                .accessibilityIdentifier("playlist.state." + row.id)
                        }
                    }
                }
                Section(header: Text("Operation code")) {
                    Text(workbench.code).font(.system(.caption, design: .monospaced))
                        #if !os(tvOS)
                        .textSelection(.enabled)
                        #endif
                        .accessibilityIdentifier("playlist.code")
                }
            }
            .accessibilityIdentifier("playlist.form")
        }
        .padding()
        .onAppear { workbench.refresh(model: model) }
        #if os(tvOS)
        .fullScreenCover(item: $editing) { entry in NativeSourceEditor(source: entry.source) { workbench.save($0, for: entry.id) } }
        #else
        .sheet(item: $editing) { entry in NativeSourceEditor(source: entry.source) { workbench.save($0, for: entry.id) } }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
            }
        }
        #endif
    }

    private func move(_ id: UUID, offset: Int) {
        guard let index = workbench.entries.firstIndex(where: { $0.id == id }), workbench.entries.indices.contains(index + offset) else { return }
        workbench.entries.swapAt(index, index + offset)
    }
    private func input(_ label: String, value: Binding<String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption)
            TextField("Value", text: value).disableAutocorrection(true).accessibilityIdentifier(id)
        }
    }
}
