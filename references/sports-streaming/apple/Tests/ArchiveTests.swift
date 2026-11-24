import XCTest
@testable import ReferenceDomain

final class ArchiveTests: XCTestCase {
    func testCatalogAndArchiveReadinessAreIndependent() throws {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../fixtures/catalog.json")
        let catalog = try JSONDecoder().decode(EventCatalog.self, from: Data(contentsOf: file))
        let event = try XCTUnwrap(catalog.events.first)
        XCTAssertNotNil(catalog.assets.first { $0.id == event.liveAssetId })
        XCTAssertEqual(event.archiveStatus, "not_ready")
    }

    func testArchiveChoiceStaysInsideItsEvent() throws {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../fixtures/catalog.json")
        let catalog = try JSONDecoder().decode(EventCatalog.self, from: Data(contentsOf: file))
        let event = try XCTUnwrap(catalog.events.first { $0.id == "SP-EVENT-S" })
        XCTAssertEqual(catalog.archive(for: event, selectedID: nil)?.id, event.archiveAssetId)
        XCTAssertEqual(catalog.archive(for: event, selectedID: "SP-ARCH-E")?.id, "SP-ARCH-E")
        XCTAssertNil(catalog.archive(for: event, selectedID: "SP-CLIP-A"))
        XCTAssertNil(catalog.archive(for: event, selectedID: "SP-ARCH-EVENT"))
        let next = try XCTUnwrap(catalog.events.first { $0.id == "SP-EVENT-30" })
        XCTAssertEqual(catalog.archive(for: next, selectedID: nil)?.id, next.archiveAssetId)
    }

    func testEndedEventWithNoDVRWindowUsesFullArchiveEvidence() throws {
        let json = """
        {"id":"event","status":"ended","archiveStatus":"ready","liveAssetId":"live","archiveAssetId":"archive",
         "utcStartMs":1700000000000,"seekableUtcStartMs":null,"seekableUtcEndMs":null,
         "archiveMapping":{"assetId":"archive","utcStartMs":1700000000000,"durationMs":180000,"utcMappings":[]}}
        """
        let status = try JSONDecoder().decode(EventUpdate.self, from: Data(json.utf8))
        XCTAssertEqual(status.presentationEndMs, 1700000180000)
        XCTAssertEqual(status.archiveMapping?.position(for: 1700000012000), 12)
    }

    func testEditedArchiveSkipsGapsAndExactEnd() {
        let map = ArchiveMap(assetId: "archive", durationMs: 6000, utcStartMs: 10000, utcMappings: [
            .init(utcStartMs: 10000, utcEndMs: 12000, archiveStartMs: 0),
            .init(utcStartMs: 15000, utcEndMs: 19000, archiveStartMs: 2000)])
        XCTAssertEqual(map.position(for: 16000), 3)
        XCTAssertNil(map.position(for: 12000))
        XCTAssertNil(map.position(for: 19000))
        XCTAssertNil(map.position(for: nil))
    }

    func testFinalizedSourceUsesCurrentRelativeTimeAfterContinuousTransition() {
        var clock = PresentationClock()
        let start = 1_700_000_000_000.0
        let end = start + 180_000
        XCTAssertEqual(clock.read(absolute: start / 1000 + 10, relative: 9, live: true, origin: start, end: end, uptime: 100, speed: 1), start + 10_000)
        XCTAssertEqual(clock.read(absolute: 9.5, relative: 9.5, live: false, origin: start, end: end, uptime: 100.5, speed: 1), start + 10_500)
        XCTAssertEqual(clock.read(absolute: 40, relative: 40, live: false, origin: start, end: end, uptime: 110, speed: 1), start + 41_000)
        var discontinuous = PresentationClock()
        _ = discontinuous.read(absolute: start / 1000 + 10, relative: 9, live: true, origin: start, end: end, uptime: 100, speed: 1)
        XCTAssertNil(discontinuous.read(absolute: 20, relative: 20, live: false, origin: start, end: end, uptime: 101, speed: 1))
    }

    func testUnknownOriginAndInvalidMappingAreUnavailable() {
        XCTAssertNil(ArchiveMap(assetId: "a", durationMs: 5000, utcStartMs: nil, utcMappings: []).position(for: 100))
        let invalid = ArchiveMap(assetId: "a", durationMs: 5000, utcStartMs: 0, utcMappings: [
            .init(utcStartMs: 1000, utcEndMs: 900, archiveStartMs: 0)])
        XCTAssertNil(invalid.position(for: 1000))
    }
}
