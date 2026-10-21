import BitmovinPlayer
import XCTest

final class ApiOperationTests: XCTestCase {
    func testArgumentValidationPreservesSupportedWholeNumberDomains() throws {
        XCTAssertEqual(try ApiOperation.bitrate.validated(["value": String(UInt.max)])["value"], String(UInt.max))
        XCTAssertNoThrow(try ApiOperation.volume.validated(["value": "37"]))
        XCTAssertNoThrow(try ApiOperation.timeShift.validated(["value": "-18.75"]))
        XCTAssertNoThrow(try ApiOperation.speed.validated(["value": "1.25"]))
        XCTAssertNoThrow(try ApiOperation.currentTime.validated(["value": "absoluteTime"]))
        for (operation, value) in [(ApiOperation.volume, "100.5"), (.volume, "-1"),
            (.bitrate, "18446744073709551616"), (.bitrate, "2.5"), (.timeShift, "NaN"),
            (.timeShift, "1"), (.speed, "0"), (.speed, "1e39"), (.currentTime, "invented")] {
            XCTAssertThrowsError(try operation.validated(["value": value]), "Accepted invalid argument for \(operation)")
        }
    }

    @MainActor
    func testRealSdkQueriesHaveVisibleResultsAndDoNotExposeThePlayerKey() throws {
        let key = "configuration-tests-invalid-license"
        let model = PlayerModel(licenseKey: key)
        defer { model.player.destroy() }
        try model.executeApi(.currentTime, arguments: ["value": "relativeTime"])
        XCTAssertTrue(model.apiResult.contains("currentTime:"))
        XCTAssertTrue(model.apiState.contains { $0.id == "Player.isDestroyed" && $0.value == "false" })
        XCTAssertTrue(model.apiState.contains { $0.id == "PlayerFactory.sdkVersion" && $0.value == "3.128.0" })
        XCTAssertFalse(model.apiState.contains { $0.value.contains(key) })
        let original = model.player
        XCTAssertThrowsError(try model.executeApi(.volume, arguments: ["value": "100.5"]))
        XCTAssertTrue(model.player === original)
    }
}
