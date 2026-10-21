import Foundation
import Combine
import BitmovinPlayer

struct NativePlaylistEntry: Identifiable {
    let id = UUID()
    var source: SourceSettings
}

struct NativePlaylistSourceContext {
    let source: Source
    let settings: SourceSettings
    let journal: NativeCallbackJournal
}

enum NativeSourceFactory: String, CaseIterable, Identifiable {
    case current = "SourceFactory.createSource(from:)"
    case legacy = "SourceFactory.create(from:) (deprecated)"
    var id: String { rawValue }
    func make(_ config: SourceConfig) -> Source {
        switch self {
        case .current: return SourceFactory.createSource(from: config)
        case .legacy: return SourceFactory.create(from: config)
        }
    }
    var code: String { self == .current ? "SourceFactory.createSource(from: sourceConfig)" : "SourceFactory.create(from: sourceConfig)" }
}

enum NativePlaylistOperation: String, CaseIterable, Identifiable {
    case load = "Player.load(playlistConfig:)"
    case append = "PlaylistApi.add(source:)"
    case insert = "PlaylistApi.add(source:at:)"
    case remove = "PlaylistApi.remove(sourceAt:)"
    case seek = "PlaylistApi.seek(source:time:)"
    case refresh = "PlaylistApi.sources"
    var id: String { rawValue }
}

final class NativePlaylistWorkbench: ObservableObject {
    @Published var entries: [NativePlaylistEntry] = []
    @Published var selectedEntry: UUID?
    @Published var preloadAllSources = false
    @Published var replayMode = "lastSource"
    @Published var sourceFactory = NativeSourceFactory.current
    @Published var index = "0"
    @Published var time = "0"
    @Published private(set) var result = "Add source drafts, configure playlist options, then load the playlist."
    @Published private(set) var code = ""
    @Published private(set) var state: [ApiStateValue] = []

    func add(_ source: SourceSettings) { let entry = NativePlaylistEntry(source: source); entries.append(entry); selectedEntry = entry.id }
    func save(_ source: SourceSettings, for id: UUID) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[index].source = source
    }
    func removeDraft(_ id: UUID) {
        entries.removeAll { $0.id == id }
        if selectedEntry == id { selectedEntry = entries.first?.id }
    }

    func makeConfiguration() throws -> (PlaylistConfig, [NativePlaylistSourceContext]) {
        guard !entries.isEmpty else { throw invalid("Add at least one source before loading a playlist.") }
        guard ["lastSource", "playlist"].contains(replayMode) else { throw invalid("Choose a valid playlist replay mode.") }
        let contexts = entries.map { entry -> NativePlaylistSourceContext in
            let journal = NativeCallbackJournal()
            let source = sourceFactory.make(entry.source.makeSourceConfig(callbackJournal: journal))
            return .init(source: source, settings: entry.source, journal: journal)
        }
        let options = PlaylistOptions(preloadAllSources: preloadAllSources, replayMode: replayMode == "playlist" ? .playlist : .lastSource)
        return (PlaylistConfig(sources: contexts.map(\.source), options: options), contexts)
    }

    @MainActor
    func run(_ operation: NativePlaylistOperation, model: PlayerModel) throws {
        guard !model.player.isDestroyed else { throw invalid("Create a player first.") }
        switch operation {
        case .load:
            let (config, contexts) = try makeConfiguration()
            model.loadApiPlaylist(config, contexts: contexts)
            code = configurationCode()
        case .append, .insert:
            guard let entry = entries.first(where: { $0.id == selectedEntry }) else { throw invalid("Select a source draft to add.") }
            let position = operation == .insert ? try validatedIndex(upper: model.player.playlist.sources.count, allowEnd: true) : model.player.playlist.sources.count
            let journal = NativeCallbackJournal()
            let source = sourceFactory.make(entry.source.makeSourceConfig(callbackJournal: journal))
            model.registerApiPlaylistContext(.init(source: source, settings: entry.source, journal: journal))
            if operation == .append { model.player.playlist.add(source: source) }
            else { model.player.playlist.add(source: source, at: position) }
            model.followApiPlaylistSource()
            code = sourceOperationCode(entry.source, operation: operation, position: position)
        case .remove:
            let position = try validatedIndex(upper: model.player.playlist.sources.count)
            model.player.playlist.remove(sourceAt: position)
            model.pruneApiPlaylistContexts()
            model.followApiPlaylistSource()
            code = "player.playlist.remove(sourceAt: \(position))"
        case .seek:
            let position = try validatedIndex(upper: model.player.playlist.sources.count)
            guard let seconds = Double(time), seconds.isFinite, seconds >= 0 else { throw invalid("Playlist seek time must be finite nonnegative seconds.") }
            let source = model.player.playlist.sources[position]
            model.player.playlist.seek(source: source, time: seconds)
            model.followApiPlaylistSource()
            code = "let source = player.playlist.sources[\(position)]\nplayer.playlist.seek(source: source, time: \(seconds))"
        case .refresh: code = "let sources = player.playlist.sources"
        }
        result = operation.rawValue + " invoked. Inspect SDK state and PlaylistTransitionEvent for completion."
        refresh(model: model)
    }

    @MainActor
    func refresh(model: PlayerModel) {
        let sources = model.player.playlist.sources
        state = [.init(id: "PlaylistApi.sources", value: "\(sources.count) SDK sources")]
        state += sources.enumerated().map { index, source in
            .init(id: "Source \(index)", value: "\(source.sourceConfig.title ?? "Untitled"); active=\(source.isActive); attached=\(source.isAttachedToPlayer); state=\(source.loadingState)")
        }
        model.refreshApiState()
    }

    private func validatedIndex(upper: Int, allowEnd: Bool = false) throws -> Int {
        guard let value = Int(index.trimmingCharacters(in: .whitespacesAndNewlines)), value >= 0,
              (allowEnd ? value <= upper : value < upper) else { throw invalid("Enter an existing SDK source index, or the end index when inserting.") }
        return value
    }

    func configurationCode() -> String {
        var lines = ["import Foundation", "import AVFoundation", "import JavaScriptCore", "import BitmovinPlayer", "", "func loadConfiguredPlaylist(on player: Player) {", "    var sources: [Source] = []"]
        for entry in entries {
            lines.append("    do {")
            lines += sourceCode(entry.source).map { "        " + $0 }
            lines += ["        let source = \(sourceFactory.code)", "        sources.append(source)", "    }"]
        }
        lines += ["    let options = PlaylistOptions(preloadAllSources: \(preloadAllSources), replayMode: .\(replayMode))",
            "    let playlistConfig = PlaylistConfig(sources: sources, options: options)", "    player.load(playlistConfig: playlistConfig)",
            "    // The app additionally applies initial track preferences once when the active source is ready or its playback clock advances.", "}"]
        return lines.joined(separator: "\n")
    }

    private func sourceOperationCode(_ source: SourceSettings, operation: NativePlaylistOperation, position: Int) -> String {
        (sourceCode(source) + ["let source = \(sourceFactory.code)", operation == .append ? "player.playlist.add(source: source)" : "player.playlist.add(source: source, at: \(position))"]).joined(separator: "\n")
    }

    private func sourceCode(_ source: SourceSettings) -> [String] {
        var lines = ["let sourceConfig = SourceConfig(url: URL(string: \(swiftString(source.url.absoluteString)))!, type: .\(source.type == .hls ? "hls" : "progressive"))",
            "sourceConfig.title = \(source.title.isEmpty ? "nil" : swiftString(source.title))",
            "sourceConfig.posterSource = \(source.posterURL.map { "URL(string: \(swiftString($0.absoluteString)))" } ?? "nil")"]
        if let offset = source.startOffset { lines.append("sourceConfig.options.startOffset = \(offset)") }
        lines.append("sourceConfig.options.startOffsetTimelineReference = .\(source.timelineReference == .automatic ? "auto" : source.timelineReference == .start ? "start" : "end")")
        return lines + source.advanced.code
    }
    private func invalid(_ message: String) -> ConfigurationValidationError { .init(message: message) }
}
