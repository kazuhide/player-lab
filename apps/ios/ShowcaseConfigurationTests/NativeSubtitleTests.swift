import AVFoundation
import BitmovinPlayer
import XCTest

final class NativeSubtitleTests: XCTestCase {
    func testSourceSubtitleArrayBuildsIndependentTypedTracksIncludingManualCues() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = ["SourceConfig.tracks": """
        [{"identifier":"manual-en","label":"Manual English","url":null,"format":"webVtt","language":"en","forced":true},
         {"identifier":"external-de","label":"German","url":"https://example.com/de.vtt","language":"de","associatedLanguage":"de-AT","characteristics":["public.accessibility.transcribes-spoken-dialog"]}]
        """]
        let applied = try draft.validated()
        let tracks = applied.source.makeSourceConfig().tracks.compactMap { $0 as? SubtitleTrack }
        XCTAssertEqual(tracks.count, 2)
        XCTAssertNil(tracks[0].url)
        XCTAssertTrue(tracks[0].isForced)
        XCTAssertEqual(tracks[1].language, "de")
        XCTAssertEqual(tracks[1].associatedLanguage, "de-AT")
        XCTAssertEqual(tracks[1].characteristics, ["public.accessibility.transcribes-spoken-dialog"])
        attach(configurationCode(source: applied.source, player: applied.player, uiMode: .default), name: "subtitle-array.swift")
    }

    func testSingleTrackCanExplicitlySelectManualCueMode() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = ["Track.url": "", "Track.identifier": "manual", "SubtitleTrack.format": "webVtt"]
        let track = try XCTUnwrap(draft.validated().source.makeSourceConfig().tracks.first as? SubtitleTrack)
        XCTAssertNil(track.url)
        XCTAssertEqual(track.identifier, "manual")
    }

    func testDuplicateOrMalformedSubtitleInputsAreRejectedBeforeApplying() {
        for array in ["{}", "[{\"identifier\":\"same\"},{\"identifier\":\"same\"}]", "[{\"url\":\"relative.vtt\"}]", "[{\"format\":\"unknown\"}]", "[{\"forced\":1}]", "[{\"extra\":true}]"] {
            var draft = ConfigurationDraft()
            draft.advancedValues = ["SourceConfig.tracks": array]
            XCTAssertThrowsError(try draft.validated(), array)
        }
        var draft = ConfigurationDraft()
        draft.advancedValues = ["SourceConfig.tracks": "[{\"identifier\":\"same\"}]", "Track.url": "", "Track.identifier": "same"]
        XCTAssertThrowsError(try draft.validated())
    }

    func testCueFactoryPreservesTypedPayloadAndRejectsInvalidNativeValues() throws {
        let draft = try NativeCueDraft(json: """
        {"startTime":1,"endTime":3,"html":"<b>Example</b>","text":"Example","rawText":"raw","attributedText":{"string":"Styled","fontSize":24,"foregroundColor":"#cc3344"},"position":{"column":2,"row":3},"region":"region","regionStyle":"style"}
        """, parsedCues: [])
        XCTAssertEqual(draft.cue.startTime, 1)
        XCTAssertEqual(draft.cue.endTime, 3)
        XCTAssertEqual(draft.cue.text, "Example")
        XCTAssertEqual(draft.cue.attributedText?.string, "Styled")
        XCTAssertEqual(draft.cue.position?.column, 2)
        for value in ["{\"startTime\":2,\"endTime\":1}", "{\"startTime\":false,\"endTime\":2}", "{\"startTime\":0,\"endTime\":2,\"imageBase64\":\"invalid\"}", "{\"startTime\":0,\"endTime\":2,\"vttFromParsedCue\":0}"] {
            XCTAssertThrowsError(try NativeCueDraft(json: value, parsedCues: []))
        }
        attach("import Foundation\nimport UIKit\nimport AVFoundation\nimport BitmovinPlayer\nlet cue = " + draft.code, name: "manual-cue.swift")
        XCTAssertNil(try NativeCueDraft.styles("null"))
        XCTAssertEqual(try NativeCueDraft.styles("[]")?.count, 0)
    }

    private func attach(_ value: String, name: String) {
        let attachment = XCTAttachment(data: Data(value.utf8), uniformTypeIdentifier: "public.swift-source")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
