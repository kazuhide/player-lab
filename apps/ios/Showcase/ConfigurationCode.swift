import Foundation

private func swiftString(_ value: String) -> String {
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
        "import BitmovinPlayer",
        "",
        "let playerConfig = PlayerConfig()",
        "playerConfig.key = \"YOUR_PLAYER_KEY\"",
        "playerConfig.playbackConfig.isAutoplayEnabled = \(player.autoplay)",
        "playerConfig.playbackConfig.isMuted = \(player.startMuted)",
        "playerConfig.playbackConfig.isTimeShiftEnabled = \(player.sdkTimeShiftEnabled)",
        "playerConfig.adaptationConfig.maxSelectableBitrate = \(player.maximumBitrate)",
        "playerConfig.bufferConfig.audioAndVideo.forwardDuration = \(player.forwardBuffer)",
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
        "",
        "let player = PlayerFactory.createPlayer(playerConfig: playerConfig)",
        "// Attach the player to your PlayerView before loading the source.",
        "player.load(sourceConfig: sourceConfig)",
        "",
        "// Player and Analytics license values are not included.",
        "// The app's Allow DVR control is separate from SDK configuration.",
    ]
    return lines.joined(separator: "\n")
}
