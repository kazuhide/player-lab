import XCTest

final class NativeWorkspaceDraftTests: XCTestCase {
    func testTabIndependentDraftRebasesUntouchedFieldsFromAppliedModel() {
        let initial = ConfigurationDraft()
        let session = NativeWorkspaceDraft(initial)
        session.value.autoplay = true
        var next = initial
        next.title = "Updated applied source"
        next.startMuted = false
        session.synchronize(next)

        XCTAssertTrue(session.value.autoplay, "Keep the user's unapplied Player edit")
        XCTAssertEqual(session.value.title, "Updated applied source", "Do not restore an unrelated retired source value")
        XCTAssertFalse(session.value.startMuted)
        XCTAssertEqual(session.applied, next)
        XCTAssertNotEqual(session.value, session.applied)
    }

    func testExplicitPresetReplacesSourceDraftButRetainsPlayerDraft() {
        var initial = ConfigurationDraft()
        initial.advancedValues["SourceConfig.isPosterPersistent"] = "true"
        let session = NativeWorkspaceDraft(initial)
        session.value.sourceURL = "https://example.com/old-draft.m3u8"
        session.value.title = "Unapplied old title"
        session.value.startOffset = "25"
        session.value.audioLanguage = "de"
        session.value.autoplay = true
        session.value.maximumBitrate = "2500000"
        session.value.advancedValues["PlaybackConfig.isBackgroundPlaybackEnabled"] = "true"
        var preset = ConfigurationDraft(source: SourceSettings(Sources.all[1]))
        preset.startMuted = false
        session.replaceSourcePreset(preset)

        XCTAssertEqual(session.value.sourceURL, preset.sourceURL)
        XCTAssertEqual(session.value.title, "VOD HLS")
        XCTAssertEqual(session.value.startOffset, preset.startOffset)
        XCTAssertEqual(session.value.audioLanguage, preset.audioLanguage)
        XCTAssertNil(session.value.advancedValues["SourceConfig.isPosterPersistent"])
        XCTAssertTrue(session.value.autoplay)
        XCTAssertEqual(session.value.maximumBitrate, "2500000")
        XCTAssertEqual(session.value.advancedValues["PlaybackConfig.isBackgroundPlaybackEnabled"], "true")
        XCTAssertFalse(session.value.startMuted)
    }

    func testChoosingSamePresetStillDiscardsSourceDraft() {
        let initial = ConfigurationDraft()
        let session = NativeWorkspaceDraft(initial)
        session.value.sourceURL = "https://example.com/stale.m3u8"
        session.value.startMuted = false
        session.replaceSourcePreset(initial)
        XCTAssertEqual(session.value.sourceURL, initial.sourceURL)
        XCTAssertFalse(session.value.startMuted)
    }

    func testRebasePreservesIntentionalOverrideRemovalAndRebasesUntouchedOverrides() {
        var initial = ConfigurationDraft()
        initial.advancedValues["SourceConfig.isPosterPersistent"] = "true"
        initial.advancedValues["PlaybackConfig.isBackgroundPlaybackEnabled"] = "false"
        let session = NativeWorkspaceDraft(initial)
        session.value.advancedValues.removeValue(forKey: "SourceConfig.isPosterPersistent")
        var next = initial
        next.advancedValues["PlaybackConfig.isBackgroundPlaybackEnabled"] = "true"
        next.advancedValues["SourceConfig.sourceDescription"] = "New description"
        session.synchronize(next)
        XCTAssertNil(session.value.advancedValues["SourceConfig.isPosterPersistent"], "A staged removal must remain a removal")
        XCTAssertEqual(session.value.advancedValues["PlaybackConfig.isBackgroundPlaybackEnabled"], "true")
        XCTAssertEqual(session.value.advancedValues["SourceConfig.sourceDescription"], "New description")
    }
}
