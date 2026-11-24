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

    func testClockUsesCurrentFrameAcrossSixSecondPublisherProcessingInterval() {
        var clock = PresentationClock()
        let origin = 1_700_000_000_000.0
        let end = origin + 180_000
        XCTAssertEqual(clock.read(absolute: origin / 1000 + 100, relative: 10, live: true, origin: origin,
                                  end: origin + 160_000, uptime: 0, speed: 1), origin + 100_000)
        XCTAssertNil(clock.read(absolute: origin / 1000 + 200, relative: 10, live: false, origin: origin,
                                end: origin + 160_000, uptime: 0.25, speed: 1))
        // The provider withdraws both bounds before the native player sees ENDLIST.
        XCTAssertNil(clock.read(absolute: origin / 1000 + 102, relative: 12, live: true, origin: origin,
                                end: nil, uptime: 2, speed: 1))
        XCTAssertNil(clock.read(absolute: 14, relative: 14, live: false, origin: origin,
                                end: nil, uptime: 4, speed: 1))
        XCTAssertNil(clock.read(absolute: 15, relative: 15, live: false, origin: origin,
                                end: nil, uptime: 5, speed: 1))
        // A DVR seek after ENDLIST moved the viewer; recover the new frame.
        XCTAssertEqual(clock.read(absolute: 25, relative: 25, live: false, origin: origin,
                                  end: end, uptime: 6, speed: 1), origin + 115_000)
        XCTAssertNil(clock.read(absolute: 95, relative: 95, live: false, origin: origin,
                                end: end, uptime: 7, speed: 1))
        XCTAssertNil(clock.read(absolute: 27, relative: 27, live: false, origin: origin + 1000,
                                end: end, uptime: 8, speed: 1))
    }

    func testUnknownClockOrDiscontinuousEndlistNeverAcquiresAnOffsetFromProcessing() {
        let origin = 1_700_000_000_000.0
        for (relative, uptime) in [(3.0, 6.0), (40.0, 1.0)] {
            var clock = PresentationClock()
            XCTAssertNil(clock.read(absolute: origin / 1000 + 3, relative: 3, live: true, origin: origin,
                                    end: nil, uptime: -1, speed: 1))
            _ = clock.read(absolute: origin / 1000 + 33, relative: 3, live: true, origin: origin,
                           end: origin + 90_000, uptime: 0, speed: 1)
            XCTAssertNil(clock.read(absolute: relative, relative: relative, live: false, origin: origin,
                                    end: nil, uptime: uptime, speed: 1))
            XCTAssertNil(clock.read(absolute: relative, relative: relative, live: false, origin: origin,
                                    end: origin + 180_000, uptime: uptime + 7, speed: 1))
        }
    }

    func testUnknownOriginAndInvalidMappingAreUnavailable() {
        XCTAssertNil(ArchiveMap(assetId: "a", durationMs: 5000, utcStartMs: nil, utcMappings: []).position(for: 100))
        let invalid = ArchiveMap(assetId: "a", durationMs: 5000, utcStartMs: 0, utcMappings: [
            .init(utcStartMs: 1000, utcEndMs: 900, archiveStartMs: 0)])
        XCTAssertNil(invalid.position(for: 1000))
    }
}
