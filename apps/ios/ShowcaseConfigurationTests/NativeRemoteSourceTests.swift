import Foundation
import CryptoKit
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
        XCTAssertThrowsError(try NativeRemoteSourceFactory.prepare(["type": "none"], original: original))
        XCTAssertThrowsError(try NativeRemoteSourceFactory.prepare(["type": SourceType.none.rawValue], original: original))
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

    func testActualGeneratedRemoteClosureSeparatesExceptionsFromIntentionalCancellation() throws {
        XCTAssertEqual(NativeGeneratedRemoteCallbacks.sourceSHA256, try exportedFixtureSource().hash, "Regenerate the executable fixture after changing the export producer")
        let original = SourceConfig(url: URL(string: "https://example.com/master.m3u8")!, type: .hls)
        XCTAssertTrue(NativeGeneratedRemoteCallbacks.throwing(sourceConfig: original) === original, "A failed exported callback must preserve the same original source as the app adapter")
        XCTAssertNil(NativeGeneratedRemoteCallbacks.cancel(sourceConfig: original), "An explicit successful null return still cancels remote source preparation")
        let edited = try XCTUnwrap(NativeGeneratedRemoteCallbacks.edited(sourceConfig: original))
        XCTAssertEqual(edited.title, "Edited receiver title")
        XCTAssertFalse(edited === original)
    }

    func testActualGeneratedCallbacksPreserveStrictBooleanAndWholeDrmFallbacks() throws {
        let track = SubtitleTrack(url: nil, format: .webVtt, label: "Optional", identifier: "optional", isDefaultTrack: false, language: "en", forced: false)
        for (values, exported) in [
            (["SourceConfig.drmConfig": "fairplay", "FairplayConfig.certificateUrl": "https://example.com/certificate", "PlaybackConfig.isForcedSubtitleCallback": "return 1;", "FairplayConfig.prepareOfflineDrmLicenseInformation": "return {licenseDuration: true, playbackDuration: 45};"], NativeGeneratedRemoteCallbacks.numericBool(track: track, data: Data())),
            (["SourceConfig.drmConfig": "fairplay", "FairplayConfig.certificateUrl": "https://example.com/certificate", "PlaybackConfig.isForcedSubtitleCallback": "return false;", "FairplayConfig.prepareOfflineDrmLicenseInformation": "return {licenseDuration: 60};"], NativeGeneratedRemoteCallbacks.partialDurations(track: track, data: Data())),
        ] {
            let advanced = try AdvancedConfiguration(validating: values), player = PlayerConfig()
            advanced.apply(to: player, callbackJournal: NativeCallbackJournal())
            let source = SourceConfig(url: URL(string: "https://example.com/master.m3u8")!, type: .hls)
            source.drmConfig = FairplayConfig(license: nil, certificateURL: URL(string: "https://example.com/certificate")!)
            advanced.apply(to: source, callbackJournal: NativeCallbackJournal())
            let nativeDrm = try XCTUnwrap((source.drmConfig as? FairplayConfig)?.prepareOfflineDrmLicenseInformation?(Data()))
            XCTAssertEqual(exported.0, player.playbackConfig.isForcedSubtitleCallback?(track))
            XCTAssertEqual(exported.1?.licenseDuration, nativeDrm.licenseDuration)
            XCTAssertEqual(exported.1?.playbackDuration, nativeDrm.playbackDuration)
        }
    }

    func testGenerateActualExportedRemoteCallbackFixtures() throws {
        attach(try exportedFixtureSource().source, name: "NativeGeneratedRemoteCallbackFixtures.swift")
    }

    private func exportedFixtureSource() throws -> (source: String, hash: String) {
        var lines = [
            "// Generated by NativeRemoteSourceTests from the actual export producer.",
            "// Only resource lookup is redirected to the XCTest bundle; callback logic is unchanged.",
            "import Foundation", "import JavaScriptCore", "import BitmovinPlayer",
            "enum NativeGeneratedRemoteCallbacks {", "    static let sourceSHA256 = \"<SOURCE_HASH>\"",
        ]
        for (name, body) in [("throwing", "throw new Error('example');"), ("cancel", "return null;"), ("edited", "input.source.title = 'Edited receiver title'; return input.source;")] {
            var code = try ApiOperation.remoteConfigPreview.code(arguments: ["prepareSource": body])
            let factory = NativeRemoteExample.factorySource
            guard code.hasPrefix(factory) else { throw ConfigurationValidationError(message: "Remote export no longer begins with its shared factory source.") }
            code.removeFirst(factory.count)
            code = code.replacingOccurrences(of: "Bundle.main.url(forResource:", with: "Bundle(for: NativeGeneratedRemoteCallbacksMarker.self).url(forResource:")
            lines.append("    static func \(name)(sourceConfig: SourceConfig) -> SourceConfig? {")
            lines += code.components(separatedBy: "\n").filter { !$0.hasPrefix("import ") }.map { "        " + $0 }
            lines += ["        return prepared", "    }"]
        }
        for (name, values) in [
            ("numericBool", ["SourceConfig.drmConfig": "fairplay", "FairplayConfig.certificateUrl": "https://example.com/certificate", "PlaybackConfig.isForcedSubtitleCallback": "return 1;", "FairplayConfig.prepareOfflineDrmLicenseInformation": "return {licenseDuration: true, playbackDuration: 45};"]),
            ("partialDurations", ["SourceConfig.drmConfig": "fairplay", "FairplayConfig.certificateUrl": "https://example.com/certificate", "PlaybackConfig.isForcedSubtitleCallback": "return false;", "FairplayConfig.prepareOfflineDrmLicenseInformation": "return {licenseDuration: 60};"]),
        ] {
            let advanced = try AdvancedConfiguration(validating: values)
            lines += ["    static func \(name)(track: SubtitleTrack, data: Data) -> (Bool?, DrmLicenseInformation?) {", "        let playerConfig = PlayerConfig()", "        let sourceConfig = SourceConfig(url: URL(string: \"https://example.com/master.m3u8\")!, type: .hls)", "        sourceConfig.drmConfig = FairplayConfig(license: nil, certificateURL: URL(string: \"https://example.com/certificate\")!)"]
            let code = advanced.nativeCallbackCode.joined(separator: "\n").replacingOccurrences(of: "Bundle.main.url(forResource:", with: "Bundle(for: NativeGeneratedRemoteCallbacksMarker.self).url(forResource:")
            lines += code.components(separatedBy: "\n").filter { !$0.hasPrefix("import ") }.map { "        " + $0 }
            lines += ["        return (playerConfig.playbackConfig.isForcedSubtitleCallback?(track), (sourceConfig.drmConfig as? FairplayConfig)?.prepareOfflineDrmLicenseInformation?(data))", "    }"]
        }
        lines += ["}", "private final class NativeGeneratedRemoteCallbacksMarker: NSObject {}"]
        let template = lines.joined(separator: "\n") + "\n"
        let hash = SHA256.hash(data: Data(template.utf8)).map { String(format: "%02x", $0) }.joined()
        return (template.replacingOccurrences(of: "<SOURCE_HASH>", with: hash), hash)
    }

    private func attach(_ code: String, name: String) { let attachment = XCTAttachment(data: Data(code.utf8), uniformTypeIdentifier: "public.swift-source"); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment) }
}
