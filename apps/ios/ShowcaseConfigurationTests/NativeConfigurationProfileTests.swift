import XCTest

final class NativeConfigurationProfileTests: XCTestCase {
    private let sdk = "3.128.0"

    private func profile(_ name: String = "Study") throws -> NativeConfigurationProfile {
        try NativeConfigurationProfile.capture(name: name, draft: ConfigurationDraft(), sdkVersion: sdk)
    }

    func testRoundTripAndOnlyExactKnownPublicPresetIsSaved() throws {
        var draft = ConfigurationDraft()
        draft.autoplay = true
        draft.maximumBitrate = "2500000"
        draft.forwardBuffer = "12.5"
        draft.startOffset = "-30"
        draft.audioLanguage = "ja"
        draft.advancedValues["SourceLiveConfig.targetLatency"] = "8"
        draft.title = "PRIVATE_TITLE"
        draft.posterURL = "https://private.invalid/poster"
        draft.advancedValues["SourceConfig.sourceDescription"] = "PRIVATE_METADATA"
        draft.advancedValues["SourceConfig.drmConfig"] = "PRIVATE_KEY"
        let saved = try NativeConfigurationProfile.capture(name: "Study", draft: draft, sdkVersion: sdk)
        XCTAssertEqual(saved.values["source.preset"], .text(Sources.all[0].id))
        let bytes = try NativeProfileCodec.encode([saved])
        let text = String(decoding: bytes, as: UTF8.self)
        for privateValue in ["PRIVATE", "private.invalid", "sourceURL", "posterURL", "sourceDescription", "drmConfig"] {
            XCTAssertFalse(text.contains(privateValue))
        }
        XCTAssertEqual(try NativeProfileCodec.decode(bytes), [saved])
        draft.sourceURL += "?token=PRIVATE"
        XCTAssertEqual(try NativeConfigurationProfile.capture(name: "Study", draft: draft, sdkVersion: sdk).values["source.preset"], .null)
        draft.sourceURL = Sources.all[0].url.absoluteString
        draft.sourceType = .progressive
        XCTAssertEqual(try NativeConfigurationProfile.capture(name: "Study", draft: draft, sdkVersion: sdk).values["source.preset"], .null)
    }

    func testRestoreStagesSafeFieldsAndRetainsExcludedDraftAndAppliedState() throws {
        var savedDraft = ConfigurationDraft()
        savedDraft.autoplay = true
        savedDraft.startOffset = "25"
        savedDraft.advancedValues["SourceLiveConfig.targetLatency"] = "9"
        let saved = try NativeConfigurationProfile.capture(name: "Study", draft: savedDraft, sdkVersion: sdk)
        let session = NativeWorkspaceDraft(ConfigurationDraft())
        session.value.title = "Private title"
        session.value.posterURL = "https://private.invalid/poster"
        session.value.advancedValues["SourceConfig.sourceDescription"] = "Private metadata"
        session.value.advancedValues["StyleConfig.playerUiJs"] = "file:///private.js"
        session.value.advancedValues["SourceConfig.isPosterPersistent"] = "true"
        let applied = session.applied
        try session.restoreProfile(saved, sdkVersion: sdk)
        XCTAssertEqual(session.applied, applied)
        XCTAssertTrue(session.value.autoplay)
        XCTAssertEqual(session.value.startOffset, "25")
        XCTAssertEqual(session.value.title, "Private title")
        XCTAssertEqual(session.value.posterURL, "https://private.invalid/poster")
        XCTAssertEqual(session.value.advancedValues["SourceConfig.sourceDescription"], "Private metadata")
        XCTAssertEqual(session.value.advancedValues["StyleConfig.playerUiJs"], "file:///private.js")
        XCTAssertNil(session.value.advancedValues["SourceConfig.isPosterPersistent"])
        XCTAssertEqual(session.value.advancedValues["SourceLiveConfig.targetLatency"], "9.0")
    }

    func testCustomSourceIsRetainedAndDifferentSDKNeedsExplicitConfirmation() throws {
        var source = ConfigurationDraft()
        source.sourceURL = "https://private.invalid/signed"
        let saved = try NativeConfigurationProfile.capture(name: "Study", draft: source, sdkVersion: sdk)
        let session = NativeWorkspaceDraft(ConfigurationDraft())
        session.value.sourceURL = "https://current.invalid/media.mp4"
        session.value.sourceType = .progressive
        let original = session.value
        XCTAssertThrowsError(try session.restoreProfile(saved, sdkVersion: "3.129.0"))
        XCTAssertEqual(session.value, original)
        try session.restoreProfile(saved, sdkVersion: "3.129.0", confirmDifferentSDK: true)
        XCTAssertEqual(session.value.sourceURL, original.sourceURL)
        XCTAssertEqual(session.value.sourceType, original.sourceType)
        XCTAssertEqual(session.applied, ConfigurationDraft())
    }

    func testUnsupportedSchemaPlatformFieldsTypesAndEnumAreRejected() throws {
        let bytes = try NativeProfileCodec.encode([profile()])
        let original = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        let changes: [(inout [String: Any]) -> Void] = [
            { $0["schemaVersion"] = 2 },
            { $0["platform"] = "web" },
            { $0["unexpected"] = true },
            { root in
                var rows = root["profiles"] as! [[String: Any]]
                rows[0]["unexpected"] = "private"
                root["profiles"] = rows
            },
            { root in
                var rows = root["profiles"] as! [[String: Any]]
                var values = rows[0]["values"] as! [String: Any]
                values["player.autoplay"] = "true"
                rows[0]["values"] = values; root["profiles"] = rows
            },
            { root in
                var rows = root["profiles"] as! [[String: Any]]
                var values = rows[0]["values"] as! [String: Any]
                values["player.videoScaling"] = "unknown"
                rows[0]["values"] = values; root["profiles"] = rows
            }
        ]
        for change in changes {
            var edited = original; change(&edited)
            XCTAssertThrowsError(try NativeProfileCodec.decode(JSONSerialization.data(withJSONObject: edited)))
        }
    }

    func testNameNormalizationAndProfileCountAndByteBounds() throws {
        XCTAssertEqual(try profile("  Cafe\u{301}  ").name, "Café")
        XCTAssertThrowsError(try profile(" "))
        XCTAssertThrowsError(try profile(String(repeating: "a", count: 49)))
        XCTAssertNoThrow(try profile(String(repeating: "あ", count: 48)))
        XCTAssertThrowsError(try NativeProfileCodec.encode([profile("Study"), profile("study")]))
        XCTAssertThrowsError(try NativeProfileCodec.encode((0..<21).map { try profile("Study \($0)") }))
        XCTAssertThrowsError(try NativeProfileCodec.decode(Data(repeating: 32, count: 128 * 1024 + 1)))
    }
}
