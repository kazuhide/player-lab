import BitmovinPlayer
import XCTest

final class AdvancedConfigurationTests: XCTestCase {
    func testMachineGeneratedSubtitlesFieldFollowsActualOsAvailability() throws {
        let id = "TweaksConfig.includeMachineGeneratedSubtitles"
        if #available(iOS 27, tvOS 27, *) {
            XCTAssertTrue(AdvancedConfiguration.fields.contains { $0.id == id })
            var draft = ConfigurationDraft(); draft.advancedValues[id] = "false"
            let configuration = try draft.validated()
            let player = PlayerConfig(); configuration.player.apply(to: player)
            XCTAssertFalse(player.tweaksConfig.includeMachineGeneratedSubtitles)
            let code = configurationCode(source: configuration.source, player: configuration.player, uiMode: .default)
            XCTAssertTrue(code.contains("if #available(iOS 27, tvOS 27, *)"))
            XCTAssertTrue(code.contains("includeMachineGeneratedSubtitles = false"))
        } else {
            XCTAssertFalse(AdvancedConfiguration.fields.contains { $0.id == id })
        }
    }

    func testFieldInventoryAndNumericCodeUseValidSwiftLiterals() throws {
        let fields = AdvancedConfiguration.fields
        XCTAssertEqual(Set(fields.map(\.id)).count, fields.count)
        var draft = ConfigurationDraft()
        draft.advancedValues["SourceLiveConfig.targetLatency"] = ".25"
        let applied = try draft.validated()
        XCTAssertEqual(applied.source.makeSourceConfig().liveConfig.targetLatency, 0.25)
        XCTAssertTrue(configurationCode(source: applied.source, player: applied.player, uiMode: .default)
            .contains("sourceConfig.liveConfig.targetLatency = 0.25"))
        let inventory = fields.map { ["id": "BitmovinPlayerCore." + $0.id, "owner": $0.owner.rawValue, "path": $0.path] }
        let data = try JSONSerialization.data(withJSONObject: inventory, options: [.sortedKeys, .prettyPrinted])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "advanced-configuration-api-inventory.json"
        attachment.lifetime = .keepAlways
        add(attachment)
        print("Advanced configuration API fields: \(fields.count)")
    }

    func testAdvancedSourceValuesReachTheSdkAndGeneratedCode() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues["SourceConfig.sourceDescription"] = "A \"quoted\" description"
        draft.advancedValues["SourceConfig.isPosterPersistent"] = "true"
        draft.advancedValues["SourceLiveConfig.targetLatency"] = "8.5"
        draft.advancedValues["SourceLiveConfig.minTimeshiftBufferDepth"] = "-12"
        let applied = try draft.validated()
        let source = applied.source.makeSourceConfig()
        XCTAssertEqual(source.sourceDescription, "A \"quoted\" description")
        XCTAssertTrue(source.isPosterPersistent)
        XCTAssertEqual(source.liveConfig.targetLatency, 8.5)
        XCTAssertEqual(source.liveConfig.minTimeshiftBufferDepth, -12)
        let code = configurationCode(source: applied.source, player: applied.player, uiMode: .default)
        XCTAssertTrue(code.contains("sourceConfig.liveConfig.targetLatency = 8.5"))
        XCTAssertTrue(code.contains("A \\\"quoted\\\" description"))
    }

    func testAdvancedPlayerValuesAndUnsetPreserveSdkDefaults() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues["TweaksConfig.timeChangedInterval"] = "0.25"
        draft.advancedValues["TweaksConfig.isCustomHlsLoadingEnabled"] = "true"
        draft.advancedValues["NowPlayingConfig.isNowPlayingInfoEnabled"] = "true"
        let configuration = try draft.validated()
        let player = PlayerConfig()
        configuration.player.apply(to: player)
        XCTAssertEqual(player.tweaksConfig.timeChangedInterval, 0.25)
        XCTAssertTrue(player.tweaksConfig.isCustomHlsLoadingEnabled)
        XCTAssertTrue(player.nowPlayingConfig.isNowPlayingInfoEnabled)
        draft.advancedValues.removeAll()
        let reset = PlayerConfig()
        try draft.validated().player.apply(to: reset)
        XCTAssertEqual(reset.tweaksConfig.timeChangedInterval, PlayerConfig().tweaksConfig.timeChangedInterval)
    }

    func testMinimumTimeshiftDepthUsesTheSdkNonPositiveOffsetContract() throws {
        for value in ["0", "-40", "-120.5"] {
            var draft = ConfigurationDraft(); draft.advancedValues["SourceLiveConfig.minTimeshiftBufferDepth"] = value
            let config = try draft.validated()
            XCTAssertEqual(config.source.makeSourceConfig().liveConfig.minTimeshiftBufferDepth, Double(value))
            XCTAssertTrue(configurationCode(source: config.source, player: config.player, uiMode: .default).contains("minTimeshiftBufferDepth = " + String(Double(value)!)))
            let legacy = try AdvancedConfiguration(validating: ["LiveConfig.minTimeshiftBufferDepth": value])
            let player = PlayerConfig(); legacy.apply(to: player)
            XCTAssertEqual(player.liveConfig.minTimeshiftBufferDepth, Double(value))
        }
        var invalid = ConfigurationDraft(); invalid.advancedValues["SourceLiveConfig.minTimeshiftBufferDepth"] = "1"
        XCTAssertThrowsError(try invalid.validated())
    }

    func testUnknownAndMalformedAdvancedValuesFailBeforeApplyingAnything() {
        for values in [
            ["UnknownConfig.value": "true"],
            ["TweaksConfig.timeChangedInterval": "NaN"],
            ["TweaksConfig.timeChangedInterval": "-1"],
            ["SourceConfig.isPosterPersistent": "yes"],
            ["SourceLiveConfig.targetLatency": "infinity"]
        ] {
            var draft = ConfigurationDraft()
            draft.advancedValues = values
            XCTAssertThrowsError(try draft.validated(), "Accepted malformed advanced settings")
        }
    }
}
