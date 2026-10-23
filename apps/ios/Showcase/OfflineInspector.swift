#if !os(tvOS)
import SwiftUI
import UIKit

private enum OfflinePane: String, CaseIterable, Identifiable {
    case manager = "Manager"
    case asset = "Asset"
    case download = "Download settings"
    case operations = "Operations"
    case playback = "Cached playback"
    case state = "State"
    case code = "Code"
    case events = "Events"
    var id: String { rawValue }
}

struct OfflineInspector: View {
    @ObservedObject var player: PlayerModel
    @ObservedObject var workbench: OfflineWorkbench
    @Environment(\.dismiss) private var dismiss
    @State private var operation = OfflineOperation.download
    @State private var error: String?
    @State private var pane = OfflinePane.manager
    @State private var downloadSetting = "Minimum bitrate"
    @State private var selectedTrack = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Offline HLS").font(.title2).bold()
                Spacer()
                Button("Close") { dismiss() }.accessibilityIdentifier("offline.close")
            }
            WorkspaceChoice(title: "Section", selection: $pane, options: OfflinePane.allCases, label: { $0.rawValue })
            .accessibilityIdentifier("offline.section")
            Form {
                if pane == .manager {
                Section(header: Text("Process-wide offline manager")) {
                    Toggle("Restrict media downloads to Wi-Fi", isOn: $workbench.restrictToWifi)
                        .accessibilityIdentifier("offline.wifi")
                    input("Minimum available free space (MB)", value: $workbench.minimumFreeSpace, id: "offline.minimumFreeSpace")
                    Text("Use on-demand HLS. Live sources do not provide a finite download. Initialization is shared by the process; the chosen initialization is restored on the next launch so background downloads can resume.")
                        .font(.caption)

                }
                }
                if pane == .asset {
                Section(header: Text("Selected asset")) {
                    Text("Applied source: \(player.sourceSettings?.title ?? "None")").font(.caption)
                    Text("Configure the source in the main player first, including its DRM settings. Selecting another offline asset removes its UI listener; SDK-managed downloads continue until you suspend or cancel them.")
                        .font(.caption)
                    Toggle("Use an explicit offline asset identifier", isOn: $workbench.usesExplicitIdentifier)
                        .accessibilityIdentifier("offline.explicitIdentifier")
                    input("Offline asset identifier", value: $workbench.identifier, id: "offline.identifier")

                }
                }
                if pane == .download {
                Section(header: Text("DownloadConfig")) {
                    WorkspaceChoice(title: "Download setting", selection: $downloadSetting, options: ["Minimum bitrate", "ClearKey support", "Playlist type", "Tracks"], label: { $0 })
                    .accessibilityIdentifier("offline.download.setting")
                    if downloadSetting == "Minimum bitrate" {
                        input("Minimum bitrate (bit/s; blank uses SDK default)", value: $workbench.minimumBitrate, id: "offline.minimumBitrate")
                    }
                    if downloadSetting == "ClearKey support" {
                        Toggle("Support ClearKey content", isOn: $workbench.supportClearKey).accessibilityIdentifier("offline.clearKey")
                    }
                    if downloadSetting == "Playlist type" {
                        Toggle("Insert PLAYLIST-TYPE when missing", isOn: $workbench.insertPlaylistType).accessibilityIdentifier("offline.playlistType")
                    }
                    if downloadSetting == "Tracks" {
                        Text("Fetch available tracks in Asset first. These are actual SDK track objects.").font(.caption)
                        if let row = workbench.tracks.first(where: { $0.id == selectedTrack }) ?? workbench.tracks.first {
                            Picker("Track", selection: Binding(get: { row.id }, set: { selectedTrack = $0 })) {
                                ForEach(workbench.tracks) { Text($0.label).tag($0.id) }
                            }
                            .accessibilityIdentifier("offline.track.selection")
                            Toggle(row.label, isOn: Binding(get: { workbench.tracks.first(where: { $0.id == row.id })?.action == .download },
                                set: { workbench.setTrackAction(row, download: $0) }))
                                .accessibilityIdentifier("offline.track.\(row.id)")
                        } else { Text("No tracks fetched yet.").font(.caption).foregroundStyle(Color.workspaceSecondary) }
                    }
                }
                }
                if pane == .operations {
                Section(header: Text("Offline API operation")) {
                    Picker("Operation", selection: $operation) {
                        ForEach(OfflineOperation.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .accessibilityIdentifier("offline.operation")
                    if operation == .migrate {
                        input("Remote asset URL for migration", value: $workbench.migrationUrl, id: "offline.migration.url")
                        Text("Resource identifier callback").font(.caption)
                        TextEditor(text: $workbench.migrationScript).font(.system(.caption, design: .monospaced)).frame(minHeight: 100)
                            .accessibilityIdentifier("offline.migration.callback")
                        Text("input.identifier and input.url are strings. Return a replacement identifier; errors preserve the original. Callbacks use the bounded plain-value script interpreter.").font(.caption).foregroundStyle(Color.workspaceSecondary)
                    }

                    Text("Delete removes only the selected asset's SDK-managed cached media. Invalid state transitions can be SDK no-ops. Renewing or syncing a FairPlay license needs an appropriate license service and DRM configuration.")
                        .font(.caption)
                }
                }
                if pane == .playback {
                Section(header: Text("Play downloaded content")) {
                    Toggle("Restrict playback to cached media", isOn: $workbench.restrictedToAssetCache)
                        .accessibilityIdentifier("offline.restrictToCache")

                    Text("Loading cached content uses the current player. The main configuration keeps its remote source, so Apply or recreating the player reloads that remote configuration.").font(.caption)
                }
                }
                if pane == .state {
                Section(header: Text("SDK result and state")) {
                    Button("Refresh offline state") { workbench.refresh() }.accessibilityIdentifier("offline.refresh")
                    if let progress = workbench.progress { Text("SDK download progress: \(progress)").font(.caption) }
                    ForEach(workbench.state) { row in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.id).font(.caption).foregroundStyle(Color.workspaceSecondary)
                            Text(row.value).font(.system(.caption, design: .monospaced))
                                .accessibilityIdentifier("offline.state.\(row.id)")
                        }
                    }
                }
                }
                if pane == .code {
                Section(header: Text("Last operation code")) {
                    Text(workbench.generatedCode).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                        .accessibilityIdentifier("offline.code")
                }
                }
                if pane == .events {
                Section(header: Text("Offline SDK events")) {
                    Text("Only event names, the selected asset owner and SDK timestamps are retained, up to 80 records. A registered callback is distinct from an event that has occurred.").font(.caption)
                    ForEach(workbench.events) { event in
                        Text("\(event.api)\nSDK timestamp: \(event.timestamp)")
                            .font(.caption).monospacedDigit()
                            .accessibilityIdentifier("offline.event.\(event.api)")
                    }
                }
                }
            }
            .accessibilityIdentifier("offline.form")
            VStack(alignment: .leading, spacing: 6) {
                if pane == .manager {
                    Button("Initialize with SDK defaults") { perform { try workbench.initialize(useConfig: false) } }
                        .accessibilityIdentifier("offline.initialize.default")
                    Button("Initialize with OfflineConfig") { perform { try workbench.initialize(useConfig: true) } }
                        .accessibilityIdentifier("offline.initialize.configured")
                    Button("Apply Wi-Fi restriction to initialized manager") { perform { try workbench.setWifiRestriction() } }
                        .accessibilityIdentifier("offline.wifi.apply")
                }
                if pane == .asset {
                    Button("Select applied HLS source as offline asset") {
                        perform {
                            guard let source = player.sourceSettings else { throw ConfigurationValidationError(message: "Apply a source first.") }
                            try workbench.create(source: source)
                        }
                    }
                    .accessibilityIdentifier("offline.create")
                    Button("Fetch available audio and subtitle tracks") { perform { try workbench.run(.fetchTracks) } }
                        .accessibilityIdentifier("offline.fetchTracks")
                }
                if pane == .operations {
                    Button("Run offline API") { perform { try workbench.run(operation) } }
                        .accessibilityIdentifier("offline.run")
                }
                if pane == .playback {
                    Button("Create OfflineSourceConfig") { perform { try workbench.makeCachedSource() } }
                        .accessibilityIdentifier("offline.cachedSource.create")
                    Button("Load cached source") {
                        if let config = workbench.cachedSource { player.loadApiSourceConfig(config) }
                    }
                    .disabled(workbench.cachedSource == nil)
                    .accessibilityIdentifier("offline.cachedSource.load")
                }
                if let error { Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier("offline.error") }
                Text(workbench.result).font(.caption).accessibilityIdentifier("offline.result")
            }
            .padding(10)
            .background(.background, in: RoundedRectangle(cornerRadius: 12))
        }
        .padding()
        .onAppear { workbench.refresh() }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                    .accessibilityIdentifier("offline.keyboard.done")
            }
        }
    }

    private func input(_ label: String, value: Binding<String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Color.workspaceSecondary)
            TextField("Value", text: value).disableAutocorrection(true).textInputAutocapitalization(.never)
                .accessibilityIdentifier(id)
        }
    }
    private func perform(_ action: () throws -> Void) {
        do { try action(); error = nil }
        catch { self.error = error.localizedDescription }
    }
}
#endif
