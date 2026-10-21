import Foundation
import BitmovinPlayer
import XCTest

final class NativeRemoteSourceTests: XCTestCase {
    func testPreparedSourceCopiesNativeObjectsAndChangesOnlyValidatedPublicFields() throws {
        let original = SourceConfig(url: URL(string: "https://example.com/original.m3u8")!, type: .hls)
        original.title = "Original"; original.options.startOffset = 3; original.liveConfig.targetLatency = 2
        original.metadata = ["example": 1]
        let fairplay = FairplayConfig(license: URL(string: "https://example.com/fairplay"), certificateURL: URL(string: "https://example.com/certificate")!)
        original.drmConfig = fairplay
        original.thumbnailTrack = ThumbnailTrack(url: URL(string: "https://example.com/thumbnails.vtt")!, label: "Thumbnails", identifier: "thumbnails", isDefaultTrack: false)
        original.add(subtitleTrack: SubtitleTrack(url: nil, format: .webVtt, label: "Manual", identifier: "manual", isDefaultTrack: false, language: "en"))
        let result = try XCTUnwrap(NativeRemoteSourceFactory.prepare(["url": "https://example.com/receiver.mpd", "type": "dash", "title": "Receiver", "options": ["startOffset": 12, "startOffsetTimelineReference": "start"], "liveConfig": ["targetLatency": 5]], original: original))
        XCTAssertEqual(result.url.pathExtension, "mpd"); XCTAssertEqual(result.type, .dash); XCTAssertEqual(result.title, "Receiver")
        XCTAssertTrue(result.drmConfig === fairplay); XCTAssertTrue(result.labelingConfig === original.labelingConfig); XCTAssertTrue(result.thumbnailTrack === original.thumbnailTrack)
        XCTAssertEqual(result.tracks.count, 1); XCTAssertEqual(result.metadata["example"] as? Int, 1)
        XCTAssertEqual(result.options.startOffset, 12); XCTAssertEqual(original.options.startOffset, 3)
        XCTAssertEqual(result.liveConfig.targetLatency, 5); XCTAssertEqual(original.liveConfig.targetLatency, 2)
        XCTAssertTrue(try NativeRemoteSourceFactory.prepare("original", original: original) === original)
        XCTAssertNil(try NativeRemoteSourceFactory.prepare(nil, original: original))
        XCTAssertThrowsError(try NativeRemoteSourceFactory.prepare(["title": "Changed", "options": ["startOffset": true]], original: original))
        XCTAssertEqual(original.title, "Original")
    }

    func testPublicRemoteAndReceiverDrmFactoriesPreserveTypedInputAndRedactExports() throws {
        let remote = try NativeRemoteSourceFactory.remote(["isAirPlayEnabled": false, "allowsAirPlay": true, "isCastEnabled": false, "sendDrmLicenseRequestsWithCredentials": true, "receiverStylesheetUrl": "https://example.com/receiver.css", "customReceiverConfig": ["theme": "example"]])
        XCTAssertTrue(remote.allowsAirPlay); XCTAssertFalse(remote.isCastEnabled); XCTAssertTrue(remote.sendDrmLicenseRequestsWithCredentials); XCTAssertEqual(remote.customReceiverConfig["theme"], "example")
        let object: [String: Any] = ["type": "widevine", "licenseUrl": "https://example.com/license", "licenseRequestHeaders": ["X-Example": "private-example-value"], "licenseRequestRetryDelay": "18446744073709551615", "maxLicenseRequestRetries": 7, "mediaKeySystemConfig": "{\"persistentState\":\"optional\"}"]
        let drm = try XCTUnwrap(NativeRemoteSourceFactory.receiverDrm(object) as? WidevineConfig)
        XCTAssertEqual(drm.licenseRequestRetryDelay, UInt.max); XCTAssertEqual(drm.maxLicenseRequestRetries, 7); XCTAssertEqual(drm.licenseRequestHeaders["X-Example"], "private-example-value")
        let result = drm.toCafDrmConfig(remoteControlConfig: remote)
        print("Public Widevine receiver configuration conversion returned an object: \(result != nil)")
        let json = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
        let code = try ApiOperation.cafWidevine.code(arguments: ["drm": json])
        XCTAssertFalse(code.contains("private-example-value")); XCTAssertTrue(code.contains("<LOCAL_HEADER_VALUE>")); XCTAssertTrue(NativeRemoteExample.factorySource.contains("final class NativeRemoteSourceFactory"))
        attach(code, name: "native-caf-widevine.swift")
        for (operation, json) in [(ApiOperation.cafPlayReady, "{\"type\":\"playReady\",\"licenseUrl\":\"https://example.com/license\"}"), (.cafClearKey, "{\"type\":\"clearKey\",\"decryptionKeys\":[{\"key\":\"00112233445566778899aabbccddeeff\",\"keyId\":\"00112233445566778899aabbccddeeff\"}]}")] {
            attach(try operation.code(arguments: ["drm": json]), name: operation == .cafPlayReady ? "native-caf-playready.swift" : "native-caf-clearkey.swift")
        }
        XCTAssertThrowsError(try NativeRemoteSourceFactory.remote(["isCastEnabled": 1]))
        XCTAssertThrowsError(try NativeRemoteSourceFactory.receiverDrm(["type": "widevine", "licenseRequestHeaders": ["Invalid Header": "value"]]))
    }

    func testEditingACompleteRemoteSnapshotPreservesUnsetLiveLatency() throws {
        let original = SourceConfig(url: URL(string: "https://example.com/master.m3u8")!, type: .hls)
        original.liveConfig.targetLatency = .nan
        print("Public SourceLiveConfig default minTimeshiftBufferDepth: \(original.liveConfig.minTimeshiftBufferDepth)")
        var input = NativeRemoteSourceFactory.input(original)
        input["title"] = "Receiver preview"
        let prepared = try XCTUnwrap(NativeRemoteSourceFactory.prepare(input, original: original))
        XCTAssertEqual(prepared.title, "Receiver preview")
        XCTAssertTrue(prepared.liveConfig.targetLatency.isNaN)
        XCTAssertTrue(original.liveConfig.targetLatency.isNaN)
        XCTAssertEqual(prepared.liveConfig.minTimeshiftBufferDepth, original.liveConfig.minTimeshiftBufferDepth)
        XCTAssertEqual(try NativeRemoteSourceFactory.prepare(["liveConfig": ["minTimeshiftBufferDepth": -123]], original: original)?.liveConfig.minTimeshiftBufferDepth, -123)
        XCTAssertThrowsError(try NativeRemoteSourceFactory.prepare(["liveConfig": ["minTimeshiftBufferDepth": 123]], original: original))
    }

    func testStandalonePreparedSourceEditorUsesTheSameExportedNativeFactory() throws {
        let code = try ApiOperation.remoteConfigPreview.code(arguments: ["prepareSource": "input.source.title = 'Receiver preview'; return input.source;"])
        attach("import Foundation\nimport BitmovinPlayer\nlet sourceConfig = SourceConfig(url: URL(string: \"https://example.com/master.m3u8\")!, type: .hls)\n" + code, name: "native-remote-preview.swift")
    }

    #if !os(tvOS)
    func testEditedPrepareSourceCallbackReturnsTypedReceiverDrmAndVisibleFallback() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = ["RemoteControlConfig.prepareSource": "return {url: input.source.url.replace('master.m3u8', 'receiver.mpd'), type:'dash', drmConfig:{type:'widevine', licenseUrl:'https://example.com/license'}};"]
        let applied = try draft.validated(), journal = NativeCallbackJournal(), config = PlayerConfig()
        applied.player.apply(to: config, callbackJournal: journal)
        let original = SourceConfig(url: URL(string: "https://example.com/master.m3u8")!, type: .hls)
        let result = try XCTUnwrap(config.remoteControlConfig.prepareSource?(.cast, original))
        XCTAssertEqual(result.url.lastPathComponent, "receiver.mpd"); XCTAssertEqual(result.type, .dash); XCTAssertTrue(result.drmConfig is WidevineConfig)
        XCTAssertTrue(journal.snapshot.first?.value.contains("failures: 0") == true)
        attach(configurationCode(source: applied.source, player: applied.player, uiMode: .default), name: "native-remote-callback.swift")
        let invalid = try AdvancedConfiguration(validating: ["RemoteControlConfig.prepareSource": "return {type:'invalid'};"])
        let other = PlayerConfig(); invalid.apply(to: other, callbackJournal: NativeCallbackJournal())
        XCTAssertTrue(other.remoteControlConfig.prepareSource?(.cast, original) === original)
    }
    #endif

    private func attach(_ code: String, name: String) { let attachment = XCTAttachment(data: Data(code.utf8), uniformTypeIdentifier: "public.swift-source"); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment) }
}
