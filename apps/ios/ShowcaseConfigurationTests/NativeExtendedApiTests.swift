import UIKit
import BitmovinPlayer
import XCTest

final class NativeExtendedApiTests: XCTestCase {
    func testOperationCodeBuildsTypedSubtitlesStylesAndAdItems() throws {
        let subtitle = try ApiOperation.subtitleAdd.code(arguments: ["json": "{\"identifier\":\"manual\",\"url\":null,\"language\":\"en\"}"])
        XCTAssertTrue(subtitle.contains("SubtitleTrack(url: nil"))
        XCTAssertTrue(subtitle.contains("player.addSubtitle(track: track)"))
        XCTAssertEqual(try ApiOperation.subtitleStyles.code(arguments: ["json": "null"]), "player.setSubtitleStyles(nil)")
        XCTAssertTrue(try ApiOperation.viewSubtitleStyles.code(arguments: ["json": "[]"]).contains("playerView.setSubtitleStyles(rules)"))
        let ad = try ApiOperation.advertisingSchedule.code(arguments: ["json": "{\"sources\":[{\"tag\":\"https://example.com/ad.mp4\",\"type\":\"progressive\"}],\"trigger\":{\"seconds\":12}}"])
        XCTAssertTrue(ad.contains("ofType: .progressive"))
        XCTAssertTrue(ad.contains("trigger: .seconds(12.0)"))
        XCTAssertTrue(ad.contains("player.ads.schedule(adItem: adItem)"))
    }

    func testOperationInputsRejectInvalidGeometryObjectsAndSourceIndexes() {
        XCTAssertThrowsError(try ApiOperation.playerAdContainer.code(arguments: ["x": "nan", "y": "0", "width": "320", "height": "180"]))
        XCTAssertThrowsError(try ApiOperation.playerAdContainer.code(arguments: ["x": "0", "y": "0", "width": "0", "height": "180"]))
        XCTAssertThrowsError(try ApiOperation.sourceMetadata.code(arguments: ["json": "[]"]))
        XCTAssertThrowsError(try ApiOperation.renderSourceThumbnail.code(arguments: ["index": "-1"]))
        XCTAssertThrowsError(try ApiOperation.posterImage.code(arguments: ["url": ""]))
        XCTAssertThrowsError(try ApiOperation.playerAdSchedule.code(arguments: ["json": "{\"sources\":[]}"]))
    }

    func testNativeCueCacheIsBoundedAndPreservesCurrentOwnerUntilRetirement() throws {
        let objects = NativeApiObjects()
        let config = SourceConfig(url: URL(string: "https://example.com/content.m3u8")!, type: .hls)
        let source = SourceFactory.createSource(from: config)
        let other = SourceFactory.createSource(from: config)
        let cue = try NativeCueDraft(json: "{\"startTime\":0,\"endTime\":1,\"text\":\"Example\"}", parsedCues: []).cue
        let track = try NativeSubtitleDraft.parse("{\"identifier\":\"manual\",\"url\":null}").make()
        objects.prepareSource(source)
        objects.enteredCues["manual"] = .init(source: source, controller: track.controller, cue: cue)
        for _ in 0..<20 { objects.appendParsedCue(cue, source: source) }
        XCTAssertEqual(objects.parsedCues.count, 16)
        XCTAssertEqual(objects.enteredCues.count, 1)
        objects.appendParsedCue(cue, source: other)
        XCTAssertEqual(objects.parsedCues.count, 1)
        XCTAssertTrue(objects.enteredCues.isEmpty)
        objects.retireSource()
        XCTAssertTrue(objects.parsedCues.isEmpty)
    }
}
