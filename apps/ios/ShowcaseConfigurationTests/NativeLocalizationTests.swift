import XCTest

final class NativeLocalizationTests: XCTestCase {
    private func strings(_ language: String) throws -> Bundle {
        let path = try XCTUnwrap(Bundle(for: Self.self).path(forResource: language, ofType: "lproj"))
        return try XCTUnwrap(Bundle(path: path))
    }

    func testJapaneseNavigationAndHelpUseShippedResources() throws {
        let bundle = try strings("ja")
        XCTAssertEqual(NativeLocalization.text("Settings", bundle: bundle), "設定")
        XCTAssertEqual(NativeLocalization.text("Default", bundle: bundle), "標準")
        XCTAssertEqual(NativeLocalization.text("Initial audio language", bundle: bundle), "初期の音声言語")
        XCTAssertEqual(NativeLocalization.text("Run API", bundle: bundle), "APIを実行")
        let help = NativeLocalization.text("Optional title shown by the player. Empty clears the title.", bundle: bundle)
        XCTAssertTrue(help.contains("タイトル"))
        XCTAssertFalse(help.contains("Optional"))
    }

    func testEnglishLabelsAndUnknownSdkTokensRemainUnchanged() throws {
        let bundle = try strings("en")
        XCTAssertEqual(NativeLocalization.text("Reset to applied", bundle: bundle), "Reset to applied")
        XCTAssertEqual(NativeLocalization.text("Player.volume", bundle: bundle), "Player.volume")
        XCTAssertEqual(NativeLocalization.text("SourceConfig.tracks", bundle: try strings("ja")), "SourceConfig.tracks")
    }

    func testNamedProfilesShipJapaneseDraftOnlyControls() throws {
        let bundle = try strings("ja")
        XCTAssertEqual(NativeLocalization.text("Profiles", bundle: bundle), "プロファイル")
        XCTAssertEqual(NativeLocalization.text("Restore draft", bundle: bundle), "下書きに復元")
        XCTAssertEqual(NativeLocalization.text("Saved fields", bundle: bundle), "保存する項目")
        XCTAssertTrue(NativeLocalization.text("Profiles save a limited settings subset on this device. Restore only edits the draft; use Apply separately.", bundle: bundle).contains("下書きだけ"))
    }

    func testLocalizedPresentationDoesNotChangeStoredOrSdkValues() throws {
        XCTAssertEqual(VideoScaling.fill.rawValue, "Fill (crop)")
        XCTAssertEqual(VideoScaling.fill.sdkCode, "zoom")
        XCTAssertEqual(OffsetReference.end.rawValue, "End")
        XCTAssertEqual(InitialSubtitleMode.language.rawValue, "Preferred language")
        let bundle = try strings("ja")
        XCTAssertEqual(NativeLocalization.text(VideoScaling.fill.rawValue, bundle: bundle), "画面に合わせてトリミング")
        XCTAssertEqual(VideoScaling.fill.sdkCode, "zoom")
    }

    func testFormattedLocalizedLabelsPreserveTheirArguments() throws {
        let format = NativeLocalization.text("Applied: %@", bundle: try strings("ja"))
        XCTAssertEqual(String(format: format, "SourceConfig.tracks"), "適用済み：SourceConfig.tracks")
        let position = NativeLocalization.text("Position: %.1fs", bundle: try strings("ja"))
        XCTAssertEqual(String(format: position, locale: Locale(identifier: "en_US_POSIX"), 12.5), "再生位置：12.5秒")
    }

    func testEverySdkSettingHelpHasAJapaneseTranslation() throws {
        let bundle = try strings("ja")
        for field in AdvancedConfiguration.fields where !field.note.isEmpty {
            XCTAssertNotEqual(NativeLocalization.text(field.note, bundle: bundle), field.note,
                              "Missing Japanese setting help: \(field.note)")
        }
        for operation in ApiOperation.allCases {
            for argument in operation.arguments where !argument.note.isEmpty {
                XCTAssertNotEqual(NativeLocalization.text(argument.note, bundle: bundle), argument.note,
                                  "Missing Japanese API help: \(argument.note)")
            }
        }
    }

    func testInvocationReceiptTranslatesProseAndRetainsTheSdkOperation() throws {
        let bundle = try strings("ja")
        let receipt = NativeLocalization.operationResult("Player.volume invoked. Inspect the state and event log for SDK completion.", bundle: bundle)
        XCTAssertTrue(receipt.hasPrefix("Player.volume"))
        XCTAssertTrue(receipt.contains("状態"))
        XCTAssertFalse(receipt.contains("invoked"))
        XCTAssertEqual(NativeLocalization.operationResult("42", bundle: bundle), "42")
    }
}
