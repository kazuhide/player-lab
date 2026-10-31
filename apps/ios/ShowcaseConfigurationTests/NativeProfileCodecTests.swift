import XCTest
#if canImport(ProfileCore)
@testable import ProfileCore
#endif

final class NativeProfileCodecTests: XCTestCase {
    private func assertProfiles(_ actual: [NativeConfigurationProfile], _ expected: [NativeConfigurationProfile], file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(actual, expected, file: file, line: line)
    }
    private func profile(_ name: String = "Study") -> NativeConfigurationProfile {
        NativeConfigurationProfile(id: UUID(), name: name, sdkVersion: "3.128.0", values: [
            "source.preset": .null, "source.startOffset": .null, "source.timelineReference": .text("automatic"),
            "source.audioLanguage": .text(""), "source.subtitleMode": .text("automatic"), "source.subtitleLanguage": .text(""),
            "player.autoplay": .boolean(false), "player.startMuted": .boolean(true), "player.sdkTimeShiftEnabled": .boolean(true),
            "player.maximumBitrate": .number(0), "player.forwardBuffer": .number(0), "player.videoScaling": .text("fit")
        ])
    }

    func testStrictScalarTypesAndAllUnsupportedFieldsAreRejected() throws {
        let original = profile()
        let invalid: [(String, NativeProfileValue)] = [
            ("player.autoplay", .number(1)), ("player.maximumBitrate", .boolean(true)),
            ("player.maximumBitrate", .number(1.5)), ("player.forwardBuffer", .number(-1)),
            ("source.preset", .text("https://private.invalid")), ("source.audioLanguage", .text("Bearer private")),
            ("sdk.SourceConfig.sourceDescription", .text("private")), ("sdk.Unknown.isEnabled", .boolean(true)),
            ("sdk.SourceLiveConfig.targetLatency", .text("2")), ("sdk.TweaksConfig.sourceFailureAction", .text("unknown"))
        ]
        for (id, value) in invalid {
            var values = original.values; values[id] = value
            let bad = NativeConfigurationProfile(id: original.id, name: original.name, sdkVersion: original.sdkVersion, values: values)
            XCTAssertThrowsError(try NativeProfileCodec.encode([bad]), id)
        }
        XCTAssertEqual(try NativeProfileCodec.decode(NativeProfileCodec.encode([original])), [original])
    }

    func testNamesSchemaPlatformCountAndCollectionBytesFailClosed() throws {
        XCTAssertEqual(try NativeProfileSchema.normalizedName(" Cafe\u{301} "), "Café")
        XCTAssertNoThrow(try NativeProfileSchema.normalizedName(String(repeating: "あ", count: 48)))
        for name in ["", " ", String(repeating: "あ", count: 49), "Bearer 12345678", "https://private.invalid"] {
            XCTAssertThrowsError(try NativeProfileSchema.normalizedName(name))
        }
        XCTAssertThrowsError(try NativeProfileCodec.encode([profile("Study"), profile("study")]))
        XCTAssertThrowsError(try NativeProfileCodec.encode((0..<21).map { profile("Study \($0)") }))
        XCTAssertThrowsError(try NativeProfileCodec.decode(Data(repeating: 32, count: NativeProfileCodec.collectionLimit + 1)))
        let bytes = try NativeProfileCodec.encode([profile()])
        let original = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        let mutations: [(String, Any)] = [("schemaVersion", 2), ("platform", "web"), ("private", "unknown")]
        for (key, value) in mutations {
            var root = original; root[key] = value
            XCTAssertThrowsError(try NativeProfileCodec.decode(JSONSerialization.data(withJSONObject: root)))
        }
        var root = original
        var rows = root["profiles"] as! [[String: Any]]
        var values = rows[0]["values"] as! [String: Any]
        values["player.autoplay"] = 1
        rows[0]["values"] = values; root["profiles"] = rows
        XCTAssertThrowsError(try NativeProfileCodec.decode(JSONSerialization.data(withJSONObject: root)))
    }

    func testStoreSurvivesRestartAndExplicitReplacementAndDeletion() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("profiles.json")
        let first = NativeProfileStore(fileURL: file)
        assertProfiles(try await first.load(), [])
        let saved = profile()
        assertProfiles(try await first.save(saved), [saved])
        let restarted = NativeProfileStore(fileURL: file)
        assertProfiles(try await restarted.load(), [saved])
        let duplicate = profile("study")
        do { _ = try await restarted.save(duplicate); XCTFail("A duplicate needs explicit replacement") }
        catch { XCTAssertEqual(error as? NativeProfileError, .duplicate) }
        assertProfiles(try await restarted.save(duplicate, replacing: saved.id), [duplicate])
        assertProfiles(try await restarted.delete(duplicate.id), [])
        assertProfiles(try await NativeProfileStore(fileURL: file).load(), [])
        XCTAssertEqual(try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }

    func testCorruptStoreIsPreservedUntilExplicitClearAndDeniedWriteRetainsState() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("profiles.json")
        let corrupt = Data("unsupported-private-data".utf8)
        try corrupt.write(to: file)
        let broken = NativeProfileStore(fileURL: file)
        do { _ = try await broken.load(); XCTFail("Corrupt data must be reported") } catch {}
        do { _ = try await broken.save(profile()); XCTFail("Save must not overwrite unreadable data") } catch {}
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
        assertProfiles(try await broken.clear(), [])
        let denied = NativeProfileStore(fileURL: file, write: { _, _ in throw CocoaError(.fileWriteNoPermission) })
        assertProfiles(try await denied.load(), [])
        do { _ = try await denied.save(profile()); XCTFail("Denied persistence must be reported") }
        catch { XCTAssertEqual(error as? NativeProfileError, .write) }
        assertProfiles(try await denied.load(), [])
    }

    func testStoreRejectsOversizeAndSymlinkDataWithoutReadingTheTarget() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("profiles.json")
        try Data(repeating: 32, count: NativeProfileCodec.collectionLimit + 1).write(to: file)
        do { _ = try await NativeProfileStore(fileURL: file).load(); XCTFail("Oversized data must fail") } catch {}
        try FileManager.default.removeItem(at: file)
        let target = directory.appendingPathComponent("private.txt")
        let valid = try NativeProfileCodec.encode([profile()])
        try valid.write(to: target)
        try FileManager.default.createSymbolicLink(at: file, withDestinationURL: target)
        do { _ = try await NativeProfileStore(fileURL: file).load(); XCTFail("Symlinks must fail") } catch {}
        XCTAssertEqual(try Data(contentsOf: target), valid)
    }

    func testDeniedReadCannotBecomeAnEmptyWritableStore() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let denied = NativeProfileStore(fileURL: file,
            read: { _ in throw CocoaError(.fileReadNoPermission) },
            write: { _, _ in XCTFail("An unreadable store must not be overwritten") })
        do { _ = try await denied.load(); XCTFail("Permission failure must be visible") }
        catch { XCTAssertEqual(error as? NativeProfileError, .read) }
        do { _ = try await denied.save(profile()); XCTFail("An unreadable store must reject saving") }
        catch { XCTAssertEqual(error as? NativeProfileError, .read) }
    }
}
