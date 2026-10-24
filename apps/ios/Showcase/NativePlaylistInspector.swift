import SwiftUI
#if !os(tvOS)
import UIKit
#endif

private enum NativePlaylistPane: String, CaseIterable, Identifiable {
    case drafts = "Sources"
    case options = "Options"
    case operations = "Operations"
    case state = "State"
    case code = "Code"
    var id: String { rawValue }
}

struct NativePlaylistInspector: View {
    @ObservedObject var model: PlayerModel
    @ObservedObject var workbench: NativePlaylistWorkbench
    @Environment(\.dismiss) private var dismiss
    @State private var operation = NativePlaylistOperation.load
    @State private var editing: NativePlaylistEntry?
    @State private var error: String?
    @State private var pane = NativePlaylistPane.drafts

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Playlist APIs").font(.title2).bold()
                Spacer()
                Button("Close") { dismiss() }.accessibilityIdentifier("playlist.close")
            }
            WorkspaceChoice(title: "Section", selection: $pane, options: NativePlaylistPane.allCases, label: { $0.rawValue })
            .accessibilityIdentifier("playlist.section")
            Form {
                if pane == .drafts {
                Section(header: Text("Source drafts")) {
                    Text("Draft edits take effect with Load, Add or Insert.").font(.caption)
                    Button("Add a copy of the applied source") {
                        if let source = model.sourceSettings { workbench.add(source) }
                    }
                    .disabled(model.sourceSettings == nil)
                    .accessibilityIdentifier("playlist.addDraft")
                    if let entry = workbench.entries.first(where: { $0.id == workbench.selectedEntry }) ?? workbench.entries.first {
                        Picker("Source draft", selection: $workbench.selectedEntry) {
                            ForEach(workbench.entries) { row in Text(row.source.title.isEmpty ? "Untitled" : row.source.title).tag(Optional(row.id)) }
                        }
                        .accessibilityIdentifier("playlist.selectedDraft")
                        Text(entry.source.title.isEmpty ? "Untitled source" : entry.source.title)
                        HStack {
                            Button("Edit") { editing = entry }.accessibilityIdentifier("playlist.edit.\(entry.id)")
                            Button("Remove") { workbench.removeDraft(entry.id) }.accessibilityIdentifier("playlist.removeDraft.\(entry.id)")
                            Button("Move up") { move(entry.id, offset: -1) }.disabled(workbench.entries.first?.id == entry.id)
                            Button("Move down") { move(entry.id, offset: 1) }.disabled(workbench.entries.last?.id == entry.id)
                        }
                        .buttonStyle(.bordered)
                    }
                    Picker("Source factory", selection: $workbench.sourceFactory) { ForEach(NativeSourceFactory.allCases) { Text($0.rawValue).tag($0) } }
                        .accessibilityIdentifier("playlist.sourceFactory")
                }
                }
                if pane == .options {
                Section(header: Text("PlaylistConfig options")) {
                    Toggle("Preload all sources", isOn: $workbench.preloadAllSources).accessibilityIdentifier("playlist.preload")
                    Picker("Replay mode", selection: $workbench.replayMode) {
                        Text("Last source").tag("lastSource")
                        Text("Whole playlist").tag("playlist")
                    }
                    .accessibilityIdentifier("playlist.replayMode")
                    Text("Preloading uses extra memory and network.").font(.caption)
                }
                }
                if pane == .operations {
                Section(header: Text("SDK operation")) {
                    Picker("Operation", selection: $operation) { ForEach(NativePlaylistOperation.allCases) { Text($0.rawValue).tag($0) } }
                        #if os(tvOS)
                        .pickerStyle(.inline)
                        #endif
                        .accessibilityIdentifier("playlist.operation")
                    if [.insert, .remove, .seek].contains(operation) { input("SDK source index (zero-based)", value: $workbench.index, id: "playlist.index") }
                    if operation == .seek { input("Position (seconds)", value: $workbench.time, id: "playlist.time") }

                }
                }
                if pane == .state {
                Section(header: Text("Result and current SDK playlist")) {
                    Button("Refresh playlist state") { workbench.refresh(model: model) }.accessibilityIdentifier("playlist.refresh")
                    ForEach(workbench.state) { row in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.id).font(.caption).foregroundStyle(Color.workspaceSecondary)
                            Text(row.value).font(.system(.caption, design: .monospaced))
                                .accessibilityIdentifier("playlist.state." + row.id)
                        }
                    }
                }
                }
                if pane == .code {
                Section(header: Text("Operation code")) {
                    Text(workbench.code).font(.system(.caption, design: .monospaced))
                        #if !os(tvOS)
                        .textSelection(.enabled)
                        #endif
                        .accessibilityIdentifier("playlist.code")
                }
                }
            }
            .accessibilityIdentifier("playlist.form")
            VStack(alignment: .leading, spacing: 6) {
                Text("Run target: \(operation.rawValue)").font(.caption.weight(.semibold))
                Button("Run playlist API") {
                        do { try workbench.run(operation, model: model); error = nil }
                        catch { self.error = error.localizedDescription }
                    }
                    .accessibilityIdentifier("playlist.run")
                if let error { Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier("playlist.error") }
                Text(NativeLocalization.operationResult(workbench.result)).font(.caption).accessibilityIdentifier("playlist.result")
            }
            .padding(10)
            .background(.background, in: RoundedRectangle(cornerRadius: 12))
        }
        .padding()
        .onAppear { workbench.refresh(model: model) }
        #if os(tvOS)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
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
