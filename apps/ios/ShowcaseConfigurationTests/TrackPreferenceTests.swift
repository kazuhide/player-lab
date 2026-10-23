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

    func testInitialSelectionWaitsForBothReadinessOrdersAndIgnoresDuplicates() {
        for readyFirst in [true, false] {
            let source = NSObject()
            var gate = InitialTrackSelectionGate()
            gate.bind(source)
            if readyFirst {
                XCTAssertFalse(gate.recordReady(eventSource: source, currentSource: source))
                XCTAssertFalse(gate.recordReady(eventSource: source, currentSource: source))
                XCTAssertTrue(gate.recordLoaded(eventSource: source, currentSource: source))
            } else {
                XCTAssertFalse(gate.recordLoaded(eventSource: source, currentSource: source))
                XCTAssertFalse(gate.recordLoaded(eventSource: source, currentSource: source))
                XCTAssertTrue(gate.recordReady(eventSource: source, currentSource: source))
            }
            XCTAssertTrue(gate.claim(eventSource: source, currentSource: source))
            XCTAssertFalse(gate.recordReady(eventSource: source, currentSource: source))
            XCTAssertFalse(gate.recordLoaded(eventSource: source, currentSource: source))
            XCTAssertFalse(gate.claim(eventSource: source, currentSource: source), "Later manual track choices must not be overwritten")
        }
    }

    func testReadinessFactsNeverCrossSourceReplacementOrRetirement() {
        let retired = NSObject(), current = NSObject()
        var gate = InitialTrackSelectionGate()
        gate.bind(retired)
        XCTAssertFalse(gate.recordReady(eventSource: retired, currentSource: retired))
        gate.bind(current)
        XCTAssertFalse(gate.recordLoaded(eventSource: current, currentSource: current))
        XCTAssertFalse(gate.recordReady(eventSource: retired, currentSource: current))
        XCTAssertFalse(gate.recordReady(eventSource: current, currentSource: retired))
        XCTAssertTrue(gate.recordReady(eventSource: current, currentSource: current))
        gate.retire()
        XCTAssertFalse(gate.recordLoaded(eventSource: current, currentSource: current))
        XCTAssertFalse(gate.recordReady(eventSource: current, currentSource: current))
        XCTAssertFalse(gate.claim(eventSource: current, currentSource: current))
        gate.bind(current)
        XCTAssertFalse(gate.recordLoaded(eventSource: current, currentSource: current))
        XCTAssertTrue(gate.recordReady(eventSource: current, currentSource: current))
        XCTAssertTrue(gate.claim(eventSource: current, currentSource: current))
    }

    func testDefaultPreferencesLeaveSdkAndOsSelectionUntouched() {
        XCTAssertFalse(InitialTrackPreferences().usesSelectionApi)
        XCTAssertTrue(InitialTrackPreferences(audioLanguage: "de").usesSelectionApi)
        XCTAssertTrue(InitialTrackPreferences(subtitleMode: .off).usesSelectionApi)
    }
}
