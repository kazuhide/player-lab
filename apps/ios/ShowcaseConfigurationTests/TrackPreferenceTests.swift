import Foundation
import XCTest

final class TrackPreferenceTests: XCTestCase {
    func testLanguageNormalizationAndInvalidDrafts() throws {
        XCTAssertEqual(try InitialTrackPreferences.language(" DE-at ", field: "Audio"), "de-at")
        XCTAssertNil(try InitialTrackPreferences.language(" \n", field: "Audio"))
        XCTAssertThrowsError(try InitialTrackPreferences.language("", field: "Subtitles", required: true))
        for invalid in ["German", "de_at", "de\nDE", "de--AT", "x", "en-", "en-123456789"] {
            XCTAssertThrowsError(try InitialTrackPreferences.language(invalid, field: "Audio"), invalid)
        }
    }

    func testExactTagWinsBeforePrimaryLanguageFallback() {
        let tracks: [(identifier: String, language: String?)] = [
            ("unknown", nil), ("german", "de"), ("austria", "DE-AT"), ("english", "en")
        ]
        XCTAssertEqual(InitialTrackPreferences.matchingIdentifier("de-at", tracks: tracks), "austria")
        XCTAssertEqual(InitialTrackPreferences.matchingIdentifier("de-ch", tracks: tracks), "german")
        XCTAssertNil(InitialTrackPreferences.matchingIdentifier("ja", tracks: tracks))
    }

    func testSelectionIsOncePerSourceAndRejectsQueuedRetiredEvents() {
        let old = NSObject(), current = NSObject()
        var gate = InitialTrackSelectionGate()
        gate.bind(old)
        gate.bind(current)
        XCTAssertFalse(gate.claim(eventSource: old, currentSource: old))
        XCTAssertFalse(gate.claim(eventSource: old, currentSource: current))
        XCTAssertTrue(gate.claim(eventSource: current, currentSource: current))
        gate.bind(current)
        XCTAssertFalse(gate.claim(eventSource: current, currentSource: current))
        gate.retire()
        XCTAssertFalse(gate.claim(eventSource: current, currentSource: current))
    }

    func testDefaultPreferencesLeaveSdkAndOsSelectionUntouched() {
        XCTAssertFalse(InitialTrackPreferences().usesSelectionApi)
        XCTAssertTrue(InitialTrackPreferences(audioLanguage: "de").usesSelectionApi)
        XCTAssertTrue(InitialTrackPreferences(subtitleMode: .off).usesSelectionApi)
    }
}
