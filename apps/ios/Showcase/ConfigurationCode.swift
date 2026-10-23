import Foundation

func swiftString(_ value: String) -> String {
    let body = value.unicodeScalars.map { scalar -> String in
        switch scalar.value {
        case 0x22: return "\\\""
        case 0x5c: return "\\\\"
        case 0x0a: return "\\n"
        case 0x0d: return "\\r"
        case 0x09: return "\\t"
        case 0..<0x20, 0x7f: return "\\u{\(String(scalar.value, radix: 16))}"
        default: return String(scalar)
        }
    }.joined()
    return "\"\(body)\""
}

/// Generate from the model's applied values. The environment is never read here.
func configurationCode(source: SourceSettings?, player: PlayerSettings, uiMode: UiMode) -> String {
    guard let source else { return "// Select a source before exporting its configuration." }
    var lines = [
        "import Foundation",
        "import AVFoundation",
        "import UIKit",
        "import JavaScriptCore",
        "import BitmovinPlayer",
        "",
        "let playerConfig = PlayerConfig()",
        "playerConfig.key = \"YOUR_PLAYER_KEY\"",
        "playerConfig.playbackConfig.isAutoplayEnabled = \(player.autoplay)",
        "playerConfig.playbackConfig.isMuted = \(player.startMuted)",
        "playerConfig.playbackConfig.isTimeShiftEnabled = \(player.sdkTimeShiftEnabled)",
        "playerConfig.adaptationConfig.maxSelectableBitrate = \(player.maximumBitrate)",
        "playerConfig.bufferConfig.audioAndVideo.forwardDuration = \(player.forwardBuffer)",
        "playerConfig.styleConfig.scalingMode = .\(player.videoScaling.sdkCode)",
    ]
    #if os(tvOS)
    lines.append("playerConfig.styleConfig.userInterfaceType = .system")
    #else
    if let factory = uiMode.factoryFunction {
        lines += [
            "// Include the shared UI resources in your app bundle.",
            "if let js = Bundle.main.url(forResource: \"bitmovinplayer-ui\", withExtension: \"js\"),",
            "   let css = Bundle.main.url(forResource: \"bitmovinplayer-ui\", withExtension: \"css\") {",
            "    playerConfig.styleConfig.playerUiJs = js",
            "    playerConfig.styleConfig.playerUiCss = css",
            "    let uiConfig = BitmovinUserInterfaceConfig()",
            "    uiConfig.uiManagerFactoryFunction = \(swiftString(factory))",
            "    playerConfig.styleConfig.userInterfaceConfig = uiConfig",
            "}",
        ]
    }
    #endif
    lines += [
        "",
        "let sourceConfig = SourceConfig(url: URL(string: \(swiftString(source.url.absoluteString)))!, type: .\(source.type == .hls ? "hls" : "progressive"))",
        "sourceConfig.title = \(source.title.isEmpty ? "nil" : swiftString(source.title))",
        "sourceConfig.posterSource = \(source.posterURL.map { "URL(string: \(swiftString($0.absoluteString)))" } ?? "nil")",
    ]
    if let offset = source.startOffset { lines.append("sourceConfig.options.startOffset = \(offset)") }
    let reference = source.timelineReference == .automatic ? "auto" : source.timelineReference == .start ? "start" : "end"
    lines += [
        "sourceConfig.options.startOffsetTimelineReference = .\(reference)",
        "let playerViewConfig = PlayerViewConfig()",
    ]
    lines += player.advanced.code + source.advanced.code
    lines += [
        "",
        "let source = SourceFactory.createSource(from: sourceConfig)",
        "let player = PlayerFactory.createPlayer(playerConfig: playerConfig)",
        "// Attach the player to your PlayerView before loading the source.",
    ]
    #if os(tvOS)
    if player.advanced.values["SystemUserInterfaceConfig.transportBarCustomMenuItems"] != nil { lines.append("menuPlayerReference.player = player") }
    #endif
    if source.initialTracks.usesSelectionApi {
        lines += initialTrackCode(source.initialTracks)
    }
    lines += [
        "player.load(source: source)",
        "",
        "// Player and Analytics license values are not included.",
        "// The app's Allow DVR control is separate from SDK configuration.",
    ]
    return lines.joined(separator: "\n")
}

private func initialTrackCode(_ preferences: InitialTrackPreferences) -> [String] {
    var lines = [
        "",
        "// App initial-selection preferences, not PlayerConfig language properties.",
        "// Wait for SourceLoaded and Ready in either order; select only once.",
        "final class InitialTracks: NSObject, PlayerListener {",
        "    private weak var source: Source?",
        "    private var applied = false",
        "    private var loaded = false",
        "    private var ready = false",
        "    init(source: Source) { self.source = source; super.init() }",
        "    func onSourceLoaded(_ event: SourceLoadedEvent, player: Player) {",
        "        guard source === event.source, player.source === event.source else { return }",
        "        loaded = true",
        "        applyInitialTracks(player)",
        "    }",
        "    func onReady(_ event: ReadyEvent, player: Player) {",
        "        guard source != nil, source === player.source else { return }",
        "        ready = true",
        "        applyInitialTracks(player)",
        "    }",
        "    private func applyInitialTracks(_ player: Player) {",
        "        guard loaded, ready, !applied, source != nil, source === player.source else { return }",
        "        applied = true",
    ]
    switch preferences.subtitleMode {
    case .automatic: break
    case .off: lines.append("        player.setSubtitle(trackIdentifier: nil)")
    case .language:
        if let language = preferences.subtitleLanguage {
            lines += [
                "        if let id = match(\(swiftString(language)), tracks: player.availableSubtitles.map { ($0.identifier, $0.language) }) {",
                "            player.setSubtitle(trackIdentifier: id)",
                "        } // No match keeps the SDK/OS choice.",
            ]
        }
    }
    if let language = preferences.audioLanguage {
        lines += [
            "        // Apply audio after the native subtitle-group selection.",
            "        if let id = match(\(swiftString(language)), tracks: player.availableAudio.map { ($0.identifier, $0.language) }) {",
            "            player.setAudio(trackIdentifier: id)",
            "        } // No match keeps the SDK/OS choice.",
        ]
    }
    lines += [
        "    }",
        "    private func match(_ language: String, tracks: [(String, String?)]) -> String? {",
        "        if let exact = tracks.first(where: { $0.1?.lowercased() == language }) { return exact.0 }",
        "        let primary = language.split(separator: \"-\").first",
        "        return tracks.first { $0.1?.lowercased().split(separator: \"-\").first == primary }?.0",
        "    }",
        "}",
        "let initialTracks = InitialTracks(source: source) // Retain alongside the player.",
        "player.add(listener: initialTracks)",
        "",
    ]
    return lines
}
