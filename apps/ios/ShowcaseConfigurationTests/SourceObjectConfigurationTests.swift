import AVFoundation
import BitmovinPlayer
import XCTest

final class SourceObjectConfigurationTests: XCTestCase {
    func testExternalSubtitleThumbnailAndMetadataReachTypedSdkObjects() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = [
            "SourceConfig.metadata": "{\"category\":\"sample\",\"chapter\":2}",
            "Track.url": "https://example.com/subtitles.vtt",
            "Track.identifier": "external-en", "Track.label": "English",
            "Track.isDefaultTrack": "true", "SubtitleTrack.format": "webVtt",
            "SubtitleTrack.language": "en", "SubtitleTrack.associatedLanguage": "en-GB",
            "SubtitleTrack.characteristics": "[\"public.accessibility.transcribes-spoken-dialog\"]",
            "SubtitleTrack.isForced": "true",
            "SourceConfig.thumbnailTrack": "https://example.com/thumbnails.vtt",
            "ThumbnailTrack.identifier": "thumbnails", "ThumbnailTrack.label": "Preview", "ThumbnailTrack.isDefaultTrack": "true",
        ]
        let applied = try draft.validated()
        let config = applied.source.makeSourceConfig()
        let subtitle = try XCTUnwrap(config.tracks.first as? SubtitleTrack)
        XCTAssertEqual(subtitle.identifier, "external-en")
        XCTAssertEqual(subtitle.label, "English")
        XCTAssertEqual(subtitle.language, "en")
        XCTAssertEqual(subtitle.associatedLanguage, "en-GB")
        XCTAssertTrue(subtitle.isForced)
        XCTAssertTrue(subtitle.isDefaultTrack)
        XCTAssertEqual(subtitle.characteristics, ["public.accessibility.transcribes-spoken-dialog"])
        XCTAssertEqual(config.thumbnailTrack?.identifier, "thumbnails")
        XCTAssertEqual(config.thumbnailTrack?.label, "Preview")
        XCTAssertEqual(config.metadata["category"] as? String, "sample")
        XCTAssertEqual(config.metadata["chapter"] as? Int, 2)
        attachCode(configurationCode(source: applied.source, player: applied.player, uiMode: .default), name: "source-objects.swift")
    }

    func testFairplayFieldsAndCallbacksApplyWithoutExportingCredentials() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = [
            "SourceConfig.drmConfig": "fairplay",
            "DrmConfig.licenseUrl": "https://example.com/license",
            "FairplayConfig.certificateUrl": "https://example.com/certificate",
            "FairplayConfig.licenseRequestHeaders": "{\"X-Example\":\"local-only-value\"}",
            "FairplayConfig.prepareContentId": "removeSkdScheme",
            "FairplayConfig.prepareMessage": "formSpc",
            "FairplayConfig.prepareSyncMessage": "jsonSpc",
            "FairplayConfig.prepareCertificate": "base64",
            "FairplayConfig.prepareLicense": "jsonCkc",
        ]
        let applied = try draft.validated()
        let config = try XCTUnwrap(applied.source.makeSourceConfig().drmConfig as? FairplayConfig)
        XCTAssertEqual(config.licenseUrl?.absoluteString, "https://example.com/license")
        XCTAssertEqual(config.certificateUrl?.absoluteString, "https://example.com/certificate")
        XCTAssertEqual(config.licenseRequestHeaders?["X-Example"], "local-only-value")
        XCTAssertEqual(config.prepareContentId?("skd://asset"), "asset")
        let bytes = Data([0xfb, 0xff])
        let formData = try XCTUnwrap(config.prepareMessage?(bytes, "asset+id"))
        let form = try XCTUnwrap(String(data: formData, encoding: .utf8))
        XCTAssertTrue(form.contains("spc=%2B/8%3D"), form)
        XCTAssertTrue(form.contains("assetId=asset%2Bid"), form)
        let json = try XCTUnwrap(config.prepareSyncMessage?(bytes, "asset"))
        XCTAssertEqual((try JSONSerialization.jsonObject(with: json) as? [String: String])?["spc"], bytes.base64EncodedString())
        XCTAssertEqual(config.prepareCertificate?(Data(bytes.base64EncodedString().utf8)), bytes)
        XCTAssertEqual(config.prepareLicense?(try JSONSerialization.data(withJSONObject: ["ckc": bytes.base64EncodedString()])), bytes)
        let code = configurationCode(source: applied.source, player: applied.player, uiMode: .default)
        XCTAssertFalse(code.contains("local-only-value"))
        XCTAssertTrue(code.contains("<HEADER_VALUE>"))
        attachCode(code, name: "source-fairplay.swift")
    }

    func testClearKeyValuesStayLocalAndSwitchingToNoDrmClearsConfiguration() throws {
        var draft = ConfigurationDraft()
        let key = String(repeating: "a", count: 32)
        draft.advancedValues = ["SourceConfig.drmConfig": "clearKey", "DecryptionKey.key": key, "DecryptionKey.kid": String(repeating: "b", count: 32)]
        let applied = try draft.validated()
        XCTAssertEqual((applied.source.makeSourceConfig().drmConfig as? ClearKeyConfig)?.decryptionKeys.first?.key, key)
        let code = configurationCode(source: applied.source, player: applied.player, uiMode: .default)
        XCTAssertFalse(code.contains(key))
        XCTAssertTrue(code.contains("<CONTENT_KEY>"))
        draft.advancedValues = ["SourceConfig.drmConfig": "none"]
        XCTAssertNil(try draft.validated().source.makeSourceConfig().drmConfig)
    }

    func testObjectValidationRejectsMalformedInputBeforePlayerMutation() {
        for values in [
            ["SourceConfig.metadata": "[]"],
            ["FairplayConfig.licenseRequestHeaders": "{\"X-Example\":2}"],
            ["SourceConfig.drmConfig": "fairplay"],
            ["SourceConfig.drmConfig": "clearKey", "DecryptionKey.key": "not-hex"],
            ["Track.label": "English"],
            ["Track.url": "https://example.com/subtitles.vtt", "SubtitleTrack.characteristics": "{}"],
            ["DrmConfig.uuid": "not-a-uuid"],
            ["SubtitleUserInterfaceConfig.subtitleStyles": "{}"],
        ] {
            var draft = ConfigurationDraft()
            draft.advancedValues = values
            XCTAssertThrowsError(try draft.validated())
        }
    }

    private func attachCode(_ code: String, name: String) {
        let attachment = XCTAttachment(data: Data(code.utf8), uniformTypeIdentifier: "public.swift-source")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
