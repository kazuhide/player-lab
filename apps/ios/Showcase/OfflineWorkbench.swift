#if !os(tvOS)
import Foundation
import Combine
import BitmovinPlayer

enum OfflineOperation: String, CaseIterable, Identifiable {
    case download = "OfflineContentManager.download()"
    case configuredDownload = "OfflineContentManager.download(downloadConfig:)"
    case selectedDownload = "OfflineContentManager.download(tracks:downloadConfig:)"
    case fetchTracks = "OfflineContentManager.fetchAvailableTracks()"
    case suspend = "OfflineContentManager.suspendDownload()"
    case resume = "OfflineContentManager.resumeDownload()"
    case cancel = "OfflineContentManager.cancelDownload()"
    case delete = "OfflineContentManager.deleteOfflineData()"
    case renewLicense = "OfflineContentManager.renewOfflineLicense()"
    case syncLicense = "OfflineContentManager.syncOfflineDrmLicenseInformation()"
    case migrate = "OfflineContentManagerTweaksApi.migrateDownload(remoteAssetUrl:resourceIdentifierCallback:)"
    var id: String { rawValue }
}

struct OfflineTrackRow: Identifiable {
    let id: String
    let generation: UUID
    let audio: Bool
    let index: Int
    let label: String
    let action: OfflineTrackAction
}

struct NativeOfflineMigrationDraft {
    let url: URL
    let script: String
    init(urlText: String, script: String) throws {
        let canonical = try ConfigurationInput.url.validate(urlText, field: "Migration URL")
        guard !canonical.isEmpty, let url = URL(string: canonical) else { throw ConfigurationValidationError(message: "Enter the remote asset URL to migrate.") }
        try NativeScriptRuntime.validate(script, id: "OfflineContentManagerTweaksApi.resourceIdentifierCallback")
        self.url = url; self.script = script
    }
    func callback(journal: NativeCallbackJournal) -> (String) -> String {
        let runtime = NativeScriptRuntime(sources: ["identifier": script], journal: journal)
        let canonical = url.absoluteString
        return { original in runtime.call("identifier", input: ["identifier": original, "url": canonical], fallback: original, convert: NativeScriptRuntime.string) }
    }
    var code: String {
        (["import JavaScriptCore"] + NativeScriptRuntime.codePreamble(["identifier": script], name: "migrationScript") + [
            "let resourceIdentifierCallback: (String) -> String = { original in",
            "    migrationScript(\"identifier\", [\"identifier\": original, \"url\": \(swiftString(url.absoluteString))]) as? String ?? original", "}",
            "offline.tweaks.migrateDownload(remoteAssetUrl: URL(string: \(swiftString(url.absoluteString)))!, resourceIdentifierCallback: resourceIdentifierCallback)"]).joined(separator: "\n")
    }
}

/// One explicitly selected asset owns the listener, fetched tracks and displayed state.
final class OfflineWorkbench: ObservableObject {
    @Published private(set) var state: [ApiStateValue] = []
    @Published private(set) var events: [ApiEventRecord] = []
    @Published private(set) var tracks: [OfflineTrackRow] = []
    @Published private(set) var result = "Initialize the offline manager, then select an on-demand HLS source."
    @Published private(set) var generatedCode = ""
    @Published private(set) var cachedSource: OfflineSourceConfig?
    @Published private(set) var progress: Double?
    @Published var identifier = "player-lab-offline"
    @Published var usesExplicitIdentifier = true
    @Published var restrictToWifi = true
    @Published var minimumFreeSpace = String(OfflineManager.minimumAvailableSpaceThreshold)
    @Published var minimumBitrate = ""
    @Published var supportClearKey = false
    @Published var insertPlaylistType = false
    @Published var restrictedToAssetCache = true
    @Published var migrationUrl = ""
    @Published var migrationScript = "return input.identifier;"
    private(set) var migrationJournal = NativeCallbackJournal()
    private(set) var manager: OfflineContentManager?
    private var listener: OfflineWorkbenchListener?
    private var restoreListener: OfflineRestoreListener?
    private var selection: OfflineTrackSelection?
    private var generation = UUID()

    deinit {
        if let manager, let listener { DispatchQueue.main.async { manager.remove(listener: listener) } }
    }

    @MainActor
    func initialize(useConfig: Bool) throws {
        guard let space = UInt(minimumFreeSpace) else { throw invalid("Minimum free space must be a nonnegative whole number of megabytes.") }
        OfflineManager.minimumAvailableSpaceThreshold = space
        OfflineStartup.remember(useConfig: useConfig, restrictToWifi: restrictToWifi, minimumFreeSpace: space)
        generatedCode = "OfflineManager.minimumAvailableSpaceThreshold = \(space)\n" + (useConfig
            ? "OfflineManager.initializeOfflineManager(offlineConfig: OfflineConfig(restrictMediaDownloadsToWiFi: \(restrictToWifi)))"
            : "OfflineManager.initializeOfflineManager()")
        guard !OfflineManager.isOfflineManagerInitialized else {
            bindRestoration()
            result = "The process-wide manager is already initialized. Free-space threshold updated; initialization options saved for the next launch. Use Apply Wi-Fi restriction for the active manager."
            refresh(); return
        }
        if useConfig { OfflineManager.initializeOfflineManager(offlineConfig: OfflineConfig(restrictMediaDownloadsToWiFi: restrictToWifi)) }
        else { OfflineManager.initializeOfflineManager() }
        bindRestoration()
        result = "OfflineManager initialized. This is process-wide; changing initialization options requires a new process."
        refresh()
    }

    @MainActor
    func create(source: SourceSettings) throws {
        guard OfflineManager.isOfflineManagerInitialized else { throw invalid("Initialize OfflineManager first.") }
        guard source.type == .hls else { throw invalid("Offline downloads require HLS; progressive MP4 is not accepted here.") }
        let id = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !usesExplicitIdentifier || !id.isEmpty else { throw invalid("Enter an offline asset identifier.") }
        let config = source.makeSourceConfig()
        let next = try usesExplicitIdentifier
            ? OfflineManager.sharedInstance().offlineContentManager(for: config, id: id)
            : OfflineManager.sharedInstance().offlineContentManager(for: config)
        if let manager, let listener { manager.remove(listener: listener) }
        generation = UUID()
        let token = generation
        manager = next
        selection = nil
        tracks = []; cachedSource = nil; progress = nil; events = []
        migrationJournal = NativeCallbackJournal()
        let listener = OfflineWorkbenchListener { [weak self, weak next] api, timestamp in
            guard let self, let next, self.generation == token, self.manager === next else { return }
            self.events.insert(.init(api: api, timestamp: timestamp, owner: "Offline asset"), at: 0)
            if self.events.count > 80 { self.events.removeLast(self.events.count - 80) }
            self.refresh()
        }
        listener.receivedTracks = { [weak self, weak next] tracks in
            guard let self, let next, self.generation == token, self.manager === next else { return }
            self.selection = tracks; self.refreshTracks()
        }
        listener.receivedProgress = { [weak self, weak next] value in
            guard let self, let next, self.generation == token, self.manager === next else { return }
            self.progress = value
        }
        listener.receivedError = { [weak self, weak next] code in
            guard let self, let next, self.generation == token, self.manager === next else { return }
            self.result = "OfflineErrorEvent: SDK error code \(code)."
        }
        self.listener = listener
        next.add(listener: listener)
        bindRestoration()
        generatedCode = usesExplicitIdentifier
            ? "let offline = try OfflineManager.sharedInstance().offlineContentManager(for: sourceConfig, id: \(swiftString(id)))"
            : "let offline = try OfflineManager.sharedInstance().offlineContentManager(for: sourceConfig)"
        result = "Offline asset selected. Methods may be no-ops in an ineligible SDK state; inspect state and callbacks."
        refresh()
    }

    @MainActor
    func run(_ operation: OfflineOperation) throws {
        guard let manager else { throw invalid("Select an offline asset first.") }
        var appliedDownloadConfig: DownloadConfig?
        var appliedMigration: NativeOfflineMigrationDraft?
        switch operation {
        case .download: manager.download()
        case .configuredDownload:
            let config = try makeDownloadConfig(); manager.download(downloadConfig: config); appliedDownloadConfig = config
        case .selectedDownload:
            guard let selection else { throw invalid("Fetch available tracks, then select their actions before downloading.") }
            let config = try makeDownloadConfig(); manager.download(tracks: selection, downloadConfig: config); appliedDownloadConfig = config
        case .fetchTracks: manager.fetchAvailableTracks()
        case .suspend: manager.suspendDownload()
        case .resume: manager.resumeDownload()
        case .cancel: manager.cancelDownload()
        case .delete: manager.deleteOfflineData(); cachedSource = nil
        case .renewLicense: manager.renewOfflineLicense()
        case .syncLicense: manager.syncOfflineDrmLicenseInformation()
        case .migrate:
            let migration = try makeMigrationConfiguration()
            manager.tweaks.migrateDownload(remoteAssetUrl: migration.url, resourceIdentifierCallback: migration.callback(journal: migrationJournal))
            appliedMigration = migration
        }
        let call: String
        switch operation {
        case .configuredDownload: call = "offline.download(downloadConfig: downloadConfig)"
        case .selectedDownload: call = "// Use tracks returned by AvailableTracksFetchedEvent; edit each track.action first.\noffline.download(tracks: selectedTracks, downloadConfig: downloadConfig)"
        case .migrate:
            guard let migration = appliedMigration else { throw invalid("No validated migration configuration was applied.") }
            call = migration.code
        default: call = operation.rawValue.replacingOccurrences(of: "OfflineContentManager.", with: "offline.")
        }
        generatedCode = (appliedDownloadConfig.map { Self.code(for: $0) + "\n" } ?? "") + call
        result = operation.rawValue + " invoked. Check the SDK state and completion/error events."
        refresh()
    }

    func makeMigrationConfiguration() throws -> NativeOfflineMigrationDraft {
        try NativeOfflineMigrationDraft(urlText: migrationUrl, script: migrationScript)
    }

    func makeMigrationCallback(remoteAssetUrl: String) throws -> (String) -> String {
        try NativeOfflineMigrationDraft(urlText: remoteAssetUrl, script: migrationScript).callback(journal: migrationJournal)
    }

    @MainActor
    func makeDownloadConfig() throws -> DownloadConfig {
        let config = DownloadConfig()
        let value = minimumBitrate.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty {
            guard let bitrate = UInt64(value) else { throw invalid("Minimum bitrate must be a nonnegative whole number of bit/s, or blank for the SDK default.") }
            config.minimumBitrate = NSNumber(value: bitrate)
        }
        config.supportClearKeyContent = supportClearKey
        config.tweaksConfig.shouldInsertPlaylistTypeTagIfMissing = insertPlaylistType
        return config
    }

    @MainActor
    func makeCachedSource() throws {
        guard let manager else { throw invalid("Select an offline asset first.") }
        cachedSource = manager.createOfflineSourceConfig(restrictedToAssetCache: restrictedToAssetCache)
        generatedCode = "let offlineSource = offline.createOfflineSourceConfig(restrictedToAssetCache: \(restrictedToAssetCache))\nif let offlineSource { player.load(sourceConfig: offlineSource) }"
        result = cachedSource == nil ? "The SDK returned no cached source. Complete a download first." : "OfflineSourceConfig created; use Load cached source to play it."
        refresh()
    }

    @MainActor
    func setWifiRestriction() throws {
        guard OfflineManager.isOfflineManagerInitialized else { throw invalid("Initialize OfflineManager first.") }
        OfflineManager.sharedInstance().restrictMediaDownloadsToWiFi = restrictToWifi
        UserDefaults.standard.set(restrictToWifi, forKey: OfflineStartup.wifiKey)
        generatedCode = "OfflineManager.sharedInstance().restrictMediaDownloadsToWiFi = \(restrictToWifi)"
        refresh()
    }

    @MainActor
    func setTrackAction(_ row: OfflineTrackRow, download: Bool) {
        guard row.generation == generation, let selection else { return }
        if row.audio, selection.audioTracks.indices.contains(row.index) { selection.audioTracks[row.index].action = download ? .download : .none }
        if !row.audio, selection.textTracks.indices.contains(row.index) { selection.textTracks[row.index].action = download ? .download : .none }
        generatedCode = "selectedTracks.\(row.audio ? "audioTracks" : "textTracks")[\(row.index)].action = .\(download ? "download" : "none")"
        refreshTracks()
    }

    @MainActor
    func refresh() {
        state = [.init(id: "OfflineManager.isOfflineManagerInitialized", value: String(OfflineManager.isOfflineManagerInitialized)),
            .init(id: "OfflineManager.minimumAvailableSpaceThreshold", value: "\(OfflineManager.minimumAvailableSpaceThreshold) MB")]
        if OfflineManager.isOfflineManagerInitialized {
            let shared = OfflineManager.sharedInstance()
            state += [.init(id: "OfflineManager.sharedInstance()", value: "Object \(ObjectIdentifier(shared).hashValue)"),
                .init(id: "OfflineManager.delegate", value: shared.delegate.map { "Object \(ObjectIdentifier($0).hashValue)" } ?? "None"),
                .init(id: "OfflineManager.restrictMediaDownloadsToWiFi", value: String(shared.restrictMediaDownloadsToWiFi)),
                .init(id: "OfflineManager.areSuspendedDownloadsRestored", value: String(shared.areSuspendedDownloadsRestored))]
        }
        if let manager {
            state += [.init(id: "OfflineContentManager.offlineState", value: Self.stateName(manager.offlineState)),
                .init(id: "OfflineContentManager.sourceConfig", value: manager.sourceConfig.title ?? "Untitled"),
                .init(id: "OfflineContentManager.usedStorage", value: "\(manager.usedStorage) bytes"),
                .init(id: "OfflineContentManager.tweaks", value: "Object \(ObjectIdentifier(manager.tweaks).hashValue)")]
            if let info = manager.offlineDrmLicenseInformation {
                state.append(.init(id: "OfflineContentManager.offlineDrmLicenseInformation", value: "Available"))
                state += [.init(id: "DrmLicenseInformation.licenseDuration", value: "\(info.licenseDuration) seconds"),
                    .init(id: "DrmLicenseInformation.playbackDuration", value: "\(info.playbackDuration) seconds"),
                    .init(id: "DrmLicenseInformation.remainingLicenseDuration()", value: "\(info.remainingLicenseDuration()) seconds")]
            } else { state.append(.init(id: "OfflineContentManager.offlineDrmLicenseInformation", value: "Unavailable")) }
        }
        if let cachedSource { state.append(.init(id: "OfflineSourceConfig.isRestrictedToAssetCache", value: String(cachedSource.isRestrictedToAssetCache))) }
        if let selection {
            state += [.init(id: "OfflineTrackSelection.audioTracks", value: "\(selection.audioTracks.count) SDK tracks; selection actions shown above"),
                .init(id: "OfflineTrackSelection.textTracks", value: "\(selection.textTracks.count) SDK tracks; selection actions shown above")]
        }
    }

    @MainActor
    private func refreshTracks() {
        guard let selection else { tracks = []; return }
        let token = generation
        tracks = selection.audioTracks.enumerated().map { .init(id: "\(token):audio:\($0.offset)", generation: token, audio: true, index: $0.offset, label: "\($0.element.label) [\($0.element.language ?? "und")]", action: $0.element.action) }
        tracks += selection.textTracks.enumerated().map { .init(id: "\(token):text:\($0.offset)", generation: token, audio: false, index: $0.offset, label: "\($0.element.label) [\($0.element.language ?? "und")]", action: $0.element.action) }
    }

    @MainActor
    private func bindRestoration() {
        guard OfflineManager.isOfflineManagerInitialized else { return }
        let listener = OfflineRestoreListener { [weak self] in self?.result = "OfflineManager restored suspended downloads."; self?.refresh() }
        restoreListener = listener
        OfflineManager.sharedInstance().delegate = listener
    }

    @MainActor
    var downloadCode: String {
        guard let config = try? makeDownloadConfig() else { return "// Correct the download settings before exporting code." }
        return Self.code(for: config)
    }
    private static func code(for config: DownloadConfig) -> String {
        let bitrate = config.minimumBitrate.map { "NSNumber(value: \($0.uint64Value) as UInt64)" } ?? "nil"
        return "let downloadConfig = DownloadConfig()\ndownloadConfig.minimumBitrate = \(bitrate)\ndownloadConfig.supportClearKeyContent = \(config.supportClearKeyContent)\ndownloadConfig.tweaksConfig.shouldInsertPlaylistTypeTagIfMissing = \(config.tweaksConfig.shouldInsertPlaylistTypeTagIfMissing)"
    }
    private func invalid(_ message: String) -> ConfigurationValidationError { .init(message: message) }
    private static func stateName(_ state: OfflineState) -> String {
        switch state {
        case .notDownloaded: return "notDownloaded"
        case .downloading: return "downloading"
        case .downloaded: return "downloaded"
        case .suspended: return "suspended"
        case .canceling: return "canceling"
        @unknown default: return "Unknown SDK state \(state.rawValue)"
        }
    }
}

private final class OfflineWorkbenchListener: OfflineApiEventListener {
    var receivedTracks: ((OfflineTrackSelection) -> Void)?
    var receivedProgress: ((Double) -> Void)?
    var receivedError: ((Int) -> Void)?
    override func onAvailableTracksFetched(_ event: AvailableTracksFetchedEvent, offlineContentManager: OfflineContentManager) {
        let tracks = event.tracks
        DispatchQueue.main.async { [weak self] in self?.receivedTracks?(tracks) }
        super.onAvailableTracksFetched(event, offlineContentManager: offlineContentManager)
    }
    override func onContentDownloadProgressChanged(_ event: ContentDownloadProgressChangedEvent, offlineContentManager: OfflineContentManager) {
        let progress = event.progress
        DispatchQueue.main.async { [weak self] in self?.receivedProgress?(progress) }
        super.onContentDownloadProgressChanged(event, offlineContentManager: offlineContentManager)
    }
    override func onOfflineError(_ event: OfflineErrorEvent, offlineContentManager: OfflineContentManager) {
        let code = event.errorCode
        DispatchQueue.main.async { [weak self] in self?.receivedError?(code) }
        super.onOfflineError(event, offlineContentManager: offlineContentManager)
    }
}

private final class OfflineRestoreListener: NSObject, OfflineManagerDelegate {
    private let receive: () -> Void
    init(receive: @escaping () -> Void) { self.receive = receive }
    func offlineManagerDidRestoreSuspendedDownloads(_ offlineManager: OfflineManager) {
        DispatchQueue.main.async { [weak self] in self?.receive() }
    }
}

enum OfflineStartup {
    static let enabledKey = "player-lab.offline.initialized"
    static let wifiKey = "player-lab.offline.wifi"
    private static let configuredKey = "player-lab.offline.configured"
    private static let freeSpaceKey = "player-lab.offline.minimum-free-space"

    static func remember(useConfig: Bool, restrictToWifi: Bool, minimumFreeSpace: UInt) {
        let defaults = UserDefaults.standard
        defaults.set(true, forKey: enabledKey)
        defaults.set(useConfig, forKey: configuredKey)
        defaults.set(restrictToWifi, forKey: wifiKey)
        defaults.set(String(minimumFreeSpace), forKey: freeSpaceKey)
    }

    static func restore() {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: enabledKey), !OfflineManager.isOfflineManagerInitialized else { return }
        if let value = defaults.string(forKey: freeSpaceKey).flatMap(UInt.init) { OfflineManager.minimumAvailableSpaceThreshold = value }
        if defaults.bool(forKey: configuredKey) { OfflineManager.initializeOfflineManager(offlineConfig: OfflineConfig(restrictMediaDownloadsToWiFi: defaults.bool(forKey: wifiKey))) }
        else { OfflineManager.initializeOfflineManager() }
    }
}
#endif
