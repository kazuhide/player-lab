import AVFoundation
import CoreMedia
import BitmovinPlayer
import XCTest

final class NativeRichConfigurationTests: XCTestCase {
    func testMultipleClearKeysReachTypedConfigWithoutExportingContentKeys() throws {
        let first = String(repeating: "a", count: 32), second = String(repeating: "b", count: 32)
        var draft = ConfigurationDraft()
        draft.advancedValues = ["SourceConfig.drmConfig": "clearKey", "ClearKeyConfig.decryptionKeys": "[{\"key\":\"\(first)\",\"kid\":\"0011\"},{\"key\":\"\(second)\",\"kid\":\"2233\"}]"]
        let applied = try draft.validated()
        let clearKey = try XCTUnwrap(applied.source.makeSourceConfig().drmConfig as? ClearKeyConfig)
        XCTAssertEqual(clearKey.decryptionKeys.count, 2)
        XCTAssertEqual(clearKey.decryptionKeys.map(\.key), [first, second])
        let code = configurationCode(source: applied.source, player: applied.player, uiMode: .default)
        XCTAssertFalse(code.contains(first)); XCTAssertFalse(code.contains(second))
        attach(code, name: "multiple-clear-keys.swift")
    }

    func testReceiverDrmFieldsReachWidevineAndPlayReadyConstructors() throws {
        for (kind, owner) in [("widevine", "WidevineConfig"), ("playReady", "PlayReadyConfig")] {
            var draft = ConfigurationDraft()
            draft.advancedValues = ["SourceConfig.drmConfig": kind, "DrmConfig.licenseUrl": "https://example.com/license", owner + ".licenseRequestHeaders": "{\"X-Example\":\"local-test-header\"}",
                owner + ".licenseRequestRetryDelay": String(UInt.max), owner + ".maxLicenseRequestRetries": "4", owner + ".mediaKeySystemConfig": "{\"persistentState\":\"optional\"}"]
            let applied = try draft.validated()
            let drm = try XCTUnwrap(applied.source.makeSourceConfig().drmConfig)
            if let value = drm as? WidevineConfig {
                XCTAssertEqual(value.licenseRequestHeaders["X-Example"], "local-test-header")
                XCTAssertEqual(value.licenseRequestRetryDelay, UInt.max)
                XCTAssertEqual(value.maxLicenseRequestRetries, 4)
                XCTAssertEqual(value.mediaKeySystemConfig, "{\"persistentState\":\"optional\"}")
            } else {
                let value = try XCTUnwrap(drm as? PlayReadyConfig)
                XCTAssertEqual(value.licenseRequestHeaders["X-Example"], "local-test-header")
                XCTAssertEqual(value.licenseRequestRetryDelay, UInt.max)
                XCTAssertEqual(value.maxLicenseRequestRetries, 4)
            }
            let code = configurationCode(source: applied.source, player: applied.player, uiMode: .default)
            XCTAssertFalse(code.contains("local-test-header"))
            attach(code, name: "receiver-drm-\(kind).swift")
        }
    }

    func testNativeMetadataFactoryCreatesActualAVMetadataItems() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = ["SourceConfig.metadata": """
        {"title":{"$avMetadataItem":{"identifier":"common/title","value":"Example title","languageTag":"en","locale":"en_US","time":1,"duration":5}},"category":"example"}
        """]
        let applied = try draft.validated()
        let config = applied.source.makeSourceConfig()
        let item = try XCTUnwrap(config.metadata["title"] as? AVMetadataItem)
        XCTAssertEqual(item.identifier, .commonIdentifierTitle)
        XCTAssertEqual(item.stringValue, "Example title")
        // The locale setter normalizes AVFoundation's language tag after languageTag is set.
        XCTAssertEqual(item.extendedLanguageTag, "en-US")
        XCTAssertEqual(item.locale?.identifier, "en_US")
        XCTAssertEqual(item.time.seconds, 1)
        XCTAssertEqual(item.duration.seconds, 5)
        XCTAssertEqual(config.metadata["category"] as? String, "example")
        let languageOnly = try NativeMetadataDraft(json: "{\"title\":{\"$avMetadataItem\":{\"identifier\":\"common/title\",\"value\":\"Example\",\"languageTag\":\"en\"}}}")
        XCTAssertEqual((languageOnly.values["title"] as? AVMetadataItem)?.extendedLanguageTag, "en")
        attach(configurationCode(source: applied.source, player: applied.player, uiMode: .default), name: "native-av-metadata.swift")
    }

    func testNativeMetadataRejectsInputsThatWouldRaiseOrLoseNativePrecision() {
        for input in ["{\"title\":{\"$avMetadataItem\":{\"identifier\":\"missing-slash\"}}}", "{\"title\":{\"$avMetadataItem\":{\"keySpace\":\"too-long\"}}}",
            "{\"title\":{\"$avMetadataItem\":{\"value\":{\"$base64\":\"invalid\"}}}}", "{\"title\":{\"$avMetadataItem\":{\"time\":{\"value\":\"1\",\"timescale\":0,\"flags\":1}}}}"] {
            XCTAssertThrowsError(try NativeMetadataDraft(json: input))
        }
    }

    func testSubtitleStyleArraysAndExplicitNilReachBothUiConfigurations() throws {
        let rules: [[String: Any]] = [[kCMTextMarkupAttribute_RelativeFontSize as String: 110], [kCMTextMarkupAttribute_ForegroundColorARGB as String: [1.0, 1.0, 0.8, 0.2]]]
        let json = String(decoding: try JSONSerialization.data(withJSONObject: rules, options: [.sortedKeys]), as: UTF8.self)
        for (kind, owner) in [("system", "SystemUserInterfaceConfig"), ("subtitle", "SubtitleUserInterfaceConfig")] {
            var draft = ConfigurationDraft()
            draft.advancedValues = ["StyleConfig.userInterfaceType": kind, owner + ".subtitleStyles": json]
            let applied = try draft.validated()
            let config = PlayerConfig(); applied.player.apply(to: config); applied.player.advanced.applyUI(to: config)
            if let ui = config.styleConfig.userInterfaceConfig as? SystemUserInterfaceConfig { XCTAssertEqual(ui.subtitleStyles?.count, 2) }
            else { XCTAssertEqual((config.styleConfig.userInterfaceConfig as? SubtitleUserInterfaceConfig)?.subtitleStyles?.count, 2) }
            attach(configurationCode(source: applied.source, player: applied.player, uiMode: .default), name: "\(kind)-multiple-styles.swift")
            draft.advancedValues[owner + ".subtitleStyles"] = "null"
            let reset = try draft.validated(); let resetConfig = PlayerConfig(); reset.player.apply(to: resetConfig); reset.player.advanced.applyUI(to: resetConfig)
            if let ui = resetConfig.styleConfig.userInterfaceConfig as? SystemUserInterfaceConfig { XCTAssertNil(ui.subtitleStyles) }
            else { XCTAssertNil((resetConfig.styleConfig.userInterfaceConfig as? SubtitleUserInterfaceConfig)?.subtitleStyles) }
        }
    }

    func testPlayerKeyCanBeOverriddenLocallyAndIsRedactedFromCode() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = ["PlayerConfig.key": "local-unit-test-value"]
        let applied = try draft.validated(); let config = PlayerConfig(); applied.player.apply(to: config)
        XCTAssertEqual(config.key, "local-unit-test-value")
        XCTAssertFalse(configurationCode(source: applied.source, player: applied.player, uiMode: .default).contains("local-unit-test-value"))
        draft.advancedValues["PlayerConfig.key"] = ""
        XCTAssertThrowsError(try draft.validated())
    }

    private func attach(_ value: String, name: String) {
        let attachment = XCTAttachment(data: Data(value.utf8), uniformTypeIdentifier: "public.swift-source")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
