#if !os(tvOS)
import BitmovinPlayer
import XCTest

final class OfflineConfigurationTests: XCTestCase {
    @MainActor
    func testMigrationCallbackAcceptsEditedLogicAndFallsBackWithoutPartialStorage() throws {
        let workbench = OfflineWorkbench()
        workbench.migrationScript = "storage.count = (storage.count ?? 0) + 1; return input.url.endsWith('.m3u8') ? input.identifier.toUpperCase() + ':' + storage.count : input.identifier;"
        let callback = try workbench.makeMigrationCallback(remoteAssetUrl: "https://example.com/master.m3u8")
        XCTAssertEqual(callback("one"), "ONE:1"); XCTAssertEqual(callback("two"), "TWO:2")
        workbench.migrationScript = "while (true) {}"
        let bounded = try workbench.makeMigrationCallback(remoteAssetUrl: "https://example.com/master.m3u8")
        XCTAssertEqual(bounded("original"), "original")
        XCTAssertTrue(workbench.migrationJournal.snapshot.first?.value.contains("failures: 1") == true)
    }

    @MainActor
    func testDownloadConfigPreservesUnsignedIntegerAndOptionalSdkInputs() throws {
        let workbench = OfflineWorkbench()
        XCTAssertNil(try workbench.makeDownloadConfig().minimumBitrate)
        workbench.minimumBitrate = String(UInt64.max)
        workbench.supportClearKey = true
        workbench.insertPlaylistType = true
        let config = try workbench.makeDownloadConfig()
        XCTAssertEqual(config.minimumBitrate?.uint64Value, UInt64.max)
        XCTAssertTrue(config.supportClearKeyContent)
        XCTAssertTrue(config.tweaksConfig.shouldInsertPlaylistTypeTagIfMissing)
        workbench.minimumBitrate = "0"
        XCTAssertEqual(try workbench.makeDownloadConfig().minimumBitrate?.uint64Value, 0)
    }

    @MainActor
    func testMalformedDownloadBitratesFailBeforeAnyDownloadRequest() {
        let workbench = OfflineWorkbench()
        for input in ["-1", "1.5", "NaN", "18446744073709551616"] {
            workbench.minimumBitrate = input
            XCTAssertThrowsError(try workbench.makeDownloadConfig())
            XCTAssertNil(workbench.manager)
        }
    }

    @MainActor
    func testWhitespaceAcceptedByGuiProducesTheSameCanonicalBitrateInCode() throws {
        let workbench = OfflineWorkbench()
        workbench.minimumBitrate = " 100 \n"
        XCTAssertEqual(try workbench.makeDownloadConfig().minimumBitrate?.uint64Value, 100)
        XCTAssertFalse(workbench.downloadCode.contains("\" 100 "))
        XCTAssertTrue(workbench.downloadCode.contains("100 as UInt64"))
        attach(workbench.downloadCode, name: "offline-canonical-bitrate.swift")
        workbench.minimumBitrate = " \n"
        XCTAssertNil(try workbench.makeDownloadConfig().minimumBitrate)
        XCTAssertTrue(workbench.downloadCode.contains("minimumBitrate = nil"))
        workbench.minimumBitrate = " \(UInt64.max) "
        XCTAssertEqual(try workbench.makeDownloadConfig().minimumBitrate?.uint64Value, UInt64.max)
        attach(workbench.downloadCode, name: "offline-maximum-bitrate.swift")
    }

    private func attach(_ code: String, name: String) { let item = XCTAttachment(data: Data(("import Foundation\nimport BitmovinPlayer\n" + code).utf8), uniformTypeIdentifier: "public.swift-source"); item.name = name; item.lifetime = .keepAlways; add(item) }
}
#endif
