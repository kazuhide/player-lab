#if !os(tvOS)
import Foundation
import Combine
import BitmovinPlayer
import GoogleCastDynamic

enum NativeCastOperation: String, CaseIterable, Identifiable {
    case initialize = "initializeCasting()"
    case initializeApplication = "initializeCasting(applicationId:) (deprecated)"
    case initializeNamespace = "initializeCasting(applicationId:messageNamespace:) (deprecated)"
    case initializeOptions = "initializeCasting(options:)"
    case addListener = "add(listener:)", removeListener = "remove(listener:)"
    case load = "loadMedia()", loadAutoplay = "loadMedia(autoplay:)", loadPosition = "loadMedia(autoplay:position:)"
    case play = "play()", pause = "pause()", unload = "unload()", dialog = "showDialog()"
    case seek = "seek(time:)", seekItem = "seekToItem(itemId:time:)", itemId = "getItemId(index:)"
    case metadata = "send(metadata:)", message = "sendMessage(_:)", namespacedMessage = "sendMessage(_:withNamespace:)"
    case refresh = "Read current Cast manager state"
    var id: String { rawValue }
}

struct NativeCastSettings: Codable, Equatable {
    var operation = NativeCastOperation.initializeOptions.rawValue
    var applicationId = ""
    var messageNamespace = ""
    var backgroundSessions = false
    var discoveryMode = "castButtonInteraction"
    var stopReceiver = true

    func validated(for operation: NativeCastOperation = .initializeOptions) throws -> Self {
        var copy = self
        copy.applicationId = applicationId.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.messageNamespace = messageNamespace.trimmingCharacters(in: .whitespacesAndNewlines)
        let needsApplication = [.initializeApplication, .initializeNamespace, .initializeOptions].contains(operation)
        let needsNamespace = [.initializeNamespace, .initializeOptions, .namespacedMessage].contains(operation)
        guard !needsApplication || copy.applicationId.isEmpty || (copy.applicationId.count == 8 && copy.applicationId.allSatisfy({ $0.isASCII && $0.isHexDigit })) else {
            throw ConfigurationValidationError(message: "A custom Cast receiver application ID must contain eight hexadecimal characters. Leave it empty for the SDK default.")
        }
        guard !needsNamespace || copy.messageNamespace.isEmpty || (copy.messageNamespace.hasPrefix("urn:x-cast:") && copy.messageNamespace.utf8.count <= 128) else {
            throw ConfigurationValidationError(message: "A custom Cast namespace must start with urn:x-cast: and contain at most 128 UTF-8 bytes.")
        }
        guard operation != .initializeOptions || ["castManagerInitialization", "castButtonInteraction"].contains(discoveryMode) else { throw ConfigurationValidationError(message: "Choose a valid Cast discovery mode.") }
        return copy
    }

    func makeOptions() -> BitmovinCastManagerOptions {
        let options = BitmovinCastManagerOptions()
        options.applicationId = applicationId.isEmpty ? nil : applicationId
        options.messageNamespace = messageNamespace.isEmpty ? nil : messageNamespace
        options.enableBackgroundSessions = backgroundSessions
        options.deviceDiscoveryMode = discoveryMode == "castManagerInitialization" ? .castManagerInitialization : .castButtonInteraction
        options.stopReceiverApplicationWhenEndingSession = stopReceiver
        return options
    }

    @MainActor
    func initialize() throws {
        guard let operation = NativeCastOperation(rawValue: operation) else { throw ConfigurationValidationError(message: "Choose an initialization overload.") }
        let value = try validated(for: operation)
        switch operation {
        case .initialize: BitmovinCastManager.initializeCasting()
        case .initializeApplication:
            guard !value.applicationId.isEmpty else { throw ConfigurationValidationError(message: "Enter an application ID for this overload.") }
            BitmovinCastManager.initializeCasting(applicationId: value.applicationId)
        case .initializeNamespace:
            guard !value.applicationId.isEmpty else { throw ConfigurationValidationError(message: "Enter an application ID for this overload.") }
            BitmovinCastManager.initializeCasting(applicationId: value.applicationId, messageNamespace: value.messageNamespace.isEmpty ? nil : value.messageNamespace)
        case .initializeOptions: BitmovinCastManager.initializeCasting(options: value.makeOptions())
        default: throw ConfigurationValidationError(message: "Choose an initialization overload.")
        }
    }

    var code: String {
        switch NativeCastOperation(rawValue: operation) {
        case .initialize: return "BitmovinCastManager.initializeCasting()"
        case .initializeApplication: return "BitmovinCastManager.initializeCasting(applicationId: \(swiftString(applicationId)))"
        case .initializeNamespace: return "BitmovinCastManager.initializeCasting(applicationId: \(swiftString(applicationId)), messageNamespace: \(messageNamespace.isEmpty ? "nil" : swiftString(messageNamespace)))"
        default:
            return ["let options = BitmovinCastManagerOptions()", "options.applicationId = \(applicationId.isEmpty ? "nil" : swiftString(applicationId))",
                "options.messageNamespace = \(messageNamespace.isEmpty ? "nil" : swiftString(messageNamespace))", "options.enableBackgroundSessions = \(backgroundSessions)",
                "options.deviceDiscoveryMode = .\(discoveryMode)", "options.stopReceiverApplicationWhenEndingSession = \(stopReceiver)",
                "BitmovinCastManager.initializeCasting(options: options)"].joined(separator: "\n")
        }
    }
}

enum NativeCastStartup {
    static let key = "player-lab.cast.initialization.v1"
    static var saved: NativeCastSettings? { UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(NativeCastSettings.self, from: $0) } }
    static func save(_ settings: NativeCastSettings) throws { UserDefaults.standard.set(try JSONEncoder().encode(settings), forKey: key) }
    @MainActor static func restore() {
        guard !BitmovinCastManager.isInitialized(), let saved else { return }
        try? saved.initialize()
    }
}

final class NativeCastWorkbench: ObservableObject {
    @Published var settings = NativeCastStartup.saved ?? NativeCastSettings()
    @Published var autoplay = true
    @Published var time = "0"
    @Published var item = "0"
    @Published var message = "Example message"
    @Published var metadata = "{}"
    @Published private(set) var result = "Configure initialization, then run an API. Receiver playback requires a compatible receiver on the same network."
    @Published private(set) var code = ""
    @Published private(set) var state: [ApiStateValue] = []
    @Published private(set) var events: [String] = []
    private var listener: NativeCastEventListener?
    private var listenerManager: BitmovinCastManager?

    @MainActor func run(_ operation: NativeCastOperation) throws {
        if [.initialize, .initializeApplication, .initializeNamespace, .initializeOptions].contains(operation) {
            var value = settings; value.operation = operation.rawValue; value = try value.validated(for: operation)
            if [.initializeApplication, .initializeNamespace].contains(operation), value.applicationId.isEmpty { throw invalid("Enter an application ID for this overload.") }
            try NativeCastStartup.save(value); settings = value; code = value.code
            if BitmovinCastManager.isInitialized() { result = "The Cast SDK is already initialized. These options are saved for the next app launch; the current manager was not reconfigured." }
            else { try value.initialize(); result = operation.rawValue + " invoked. Enable RemoteControlConfig.isCastEnabled in player settings to use player casting." }
            refresh(); return
        }
        if operation == .refresh { code = "let initialized = BitmovinCastManager.isInitialized()"; refresh(); return }
        guard BitmovinCastManager.isInitialized() else { throw invalid("Initialize the Cast SDK first.") }
        let manager = BitmovinCastManager.sharedInstance()
        let requiresReceiver: [NativeCastOperation] = [.load, .loadAutoplay, .loadPosition, .play, .pause, .unload, .seek, .seekItem, .itemId]
        if requiresReceiver.contains(operation), !manager.isConnected { throw invalid("Connect a compatible Cast receiver through showDialog before invoking this operation.") }
        var suffix = " invoked. Check SDK state and receiver playback for completion."
        switch operation {
        case .addListener:
            detachListener()
            let listener = NativeCastEventListener { [weak self] event in
                guard let self else { return }
                self.events.insert(event, at: 0)
                if self.events.count > 80 { self.events.removeLast(self.events.count - 80) }
            }
            self.listener = listener; listenerManager = manager; manager.add(listener: listener)
            code = "manager.add(listener: listener)"
        case .removeListener: detachListener(); code = "manager.remove(listener: listener)"
        case .load: manager.loadMedia(); code = "manager.loadMedia()"
        case .loadAutoplay: manager.loadMedia(autoplay: autoplay); code = "manager.loadMedia(autoplay: \(autoplay))"
        case .loadPosition:
            let time = try seconds(); manager.loadMedia(autoplay: autoplay, position: time)
            code = "manager.loadMedia(autoplay: \(autoplay), position: \(time))"
        case .play: manager.play(); code = "manager.play()"
        case .pause: manager.pause(); code = "manager.pause()"
        case .unload: manager.unload(); code = "manager.unload()"
        case .dialog: manager.showDialog(); code = "manager.showDialog()"
        case .seek: let time = try seconds(); manager.seek(time: time); code = "manager.seek(time: \(time))"
        case .seekItem:
            guard let id = UInt(item) else { throw invalid("Item ID needs an unsigned whole number.") }
            let time = try seconds(); manager.seekToItem(itemId: id, time: time); code = "manager.seekToItem(itemId: \(id), time: \(time))"
        case .itemId:
            guard let index = UInt(item), let status = manager.currentMediaStatus, index < status.queueItemCount else { throw invalid("Choose an existing receiver queue index.") }
            let id = manager.getItemId(index: index); suffix = " returned \(id)."; code = "let itemId = manager.getItemId(index: \(index))"
        case .metadata:
            guard let object = try JSONSerialization.jsonObject(with: Data(metadata.utf8)) as? [String: Any] else { throw invalid("Metadata must be a JSON object.") }
            suffix = " returned \(manager.send(metadata: object))."
            code = "let metadata = try! JSONSerialization.jsonObject(with: Data(\(swiftString(metadata)).utf8)) as! [String: Any]\nlet sent = manager.send(metadata: metadata)"
        case .message: suffix = " returned \(manager.sendMessage(message))."; code = "let sent = manager.sendMessage(\(swiftString(message)))"
        case .namespacedMessage:
            let value = try settings.validated(for: .namespacedMessage)
            suffix = " returned \(manager.sendMessage(message, withNamespace: value.messageNamespace.isEmpty ? nil : value.messageNamespace))."
            code = "let sent = manager.sendMessage(\(swiftString(message)), withNamespace: \(value.messageNamespace.isEmpty ? "nil" : swiftString(value.messageNamespace)))"
        default: break
        }
        result = operation.rawValue + suffix
        refresh()
    }

    @MainActor func refresh() {
        state = [.init(id: "BitmovinCastManager.isInitialized()", value: String(BitmovinCastManager.isInitialized()))]
        guard BitmovinCastManager.isInitialized() else { return }
        let manager = BitmovinCastManager.sharedInstance()
        state += [.init(id: "BitmovinCastManager.sharedInstance()", value: "Object \(ObjectIdentifier(manager).hashValue)"),
            .init(id: "BitmovinCastManager.currentTime", value: "\(manager.currentTime) seconds"), .init(id: "BitmovinCastManager.duration", value: "\(manager.duration) seconds"),
            .init(id: "BitmovinCastManager.isCastAvailable", value: String(manager.isCastAvailable)), .init(id: "BitmovinCastManager.isConnected", value: String(manager.isConnected)),
            .init(id: "BitmovinCastManager.isConnecting", value: String(manager.isConnecting)), .init(id: "BitmovinCastManager.isMuted", value: String(manager.isMuted)),
            .init(id: "BitmovinCastManager.isPaused", value: String(manager.isPaused)), .init(id: "BitmovinCastManager.isPlaying", value: String(manager.isPlaying)),
            .init(id: "BitmovinCastManager.isStalled", value: String(manager.isStalled))]
    }
    @MainActor func stopAutomaticInitialization() { UserDefaults.standard.removeObject(forKey: NativeCastStartup.key); result = "Automatic Cast initialization is disabled for the next launch. The current manager remains initialized." }
    @MainActor private func detachListener() { if let listener { listenerManager?.remove(listener: listener) }; listener = nil; listenerManager = nil }
    private func seconds() throws -> Double { guard let value = Double(time), value.isFinite, value >= 0 else { throw invalid("Time must be finite nonnegative seconds.") }; return value }
    private func invalid(_ value: String) -> ConfigurationValidationError { .init(message: value) }
    deinit { if let listener, let manager = listenerManager { DispatchQueue.main.async { manager.remove(listener: listener) } } }
}

private final class NativeCastEventListener: NSObject, BitmovinCastManagerListener {
    let receive: (String) -> Void
    init(receive: @escaping (String) -> Void) { self.receive = receive }
    private func emit(_ event: String) { DispatchQueue.main.async { [weak self] in self?.receive(event) } }
    func updatedMediaStatus(_ mediaStatus: GCKMediaStatus?) { emit("updatedMediaStatus") }
    func updatedMediaMetadata(_ mediaMetadata: GCKMediaMetadata) { emit("updatedMediaMetadata") }
    func applicationWillConnect(_ deviceName: String) { emit("applicationWillConnect") }
    func applicationConnected(_ deviceName: String) { emit("applicationConnected") }
    func applicationDisconnected() { emit("applicationDisconnected") }
    func castAvailableChanged(_ castAvailable: Bool) { emit("castAvailableChanged: \(castAvailable)") }
    func castChannel(_ castChannel: GCKCastChannel, didReceiveTextMessage textMessage: String) { emit("castChannel didReceiveTextMessage (payload omitted)") }
    func queueDidUpdate(activeItemIndex: Int) { emit("queueDidUpdate: \(activeItemIndex)") }
}
#endif
