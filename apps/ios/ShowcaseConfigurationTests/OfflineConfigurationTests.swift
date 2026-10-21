#if !os(tvOS)
import BitmovinPlayer
import XCTest

final class OfflineConfigurationTests: XCTestCase {
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
}
#endif
