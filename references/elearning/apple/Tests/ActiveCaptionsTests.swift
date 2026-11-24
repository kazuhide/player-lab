import XCTest
@testable import ReferenceDomain

final class ActiveCaptionsTests: XCTestCase {
    func testOverlappingCuesExitIndependently() {
        var captions = ActiveCaptions()
        captions.enter(start: 30, end: 36, text: "First")
        captions.enter(start: 31, end: 35, text: "Second")
        XCTAssertEqual(captions.text, "First\nSecond")
        captions.exit(start: 31, end: 35, text: "Second")
        XCTAssertEqual(captions.text, "First")
        captions.exit(start: 30, end: 36, text: "First")
        XCTAssertNil(captions.text)
    }
}
