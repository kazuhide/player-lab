import BitmovinPlayer
import XCTest

final class NativeLoggingTests: XCTestCase {
    func testCustomLoggerReceivesTypedEntriesFiltersLevelsAndRetainsNoPayloadText() throws {
        let old = DebugConfig.logging.logger
        defer { NativeLoggingOwner.apply(.empty, journal: nil); DebugConfig.logging.logger = old }
        var draft = ConfigurationDraft()
        draft.advancedValues = ["LoggingConfig.logger": "javascript", "Logger.level": "info", "Logger.customLog": "storage.lastLevel = input.level; storage.lastSender = input.sender;"]
        let applied = try draft.validated(), journal = NativeCallbackJournal()
        NativeLoggingOwner.apply(applied.player.advanced, journal: journal)
        let logger = try XCTUnwrap(DebugConfig.logging.logger as? NativeGuiLogger)
        logger.log(LogEntry(message: "private payload is intentionally not retained", level: .verbose, sender: "example"))
        XCTAssertTrue(logger.summary.hasPrefix("0 entries"))
        logger.log(LogEntry(message: "private payload is intentionally not retained", level: .error, code: 123, sender: "example"))
        XCTAssertTrue(logger.summary.hasPrefix("1 entries")); XCTAssertFalse(logger.summary.contains("private payload")); XCTAssertFalse(logger.summary.contains("example"))
        XCTAssertEqual(journal.snapshot.first?.id, "Logger.customLog")
        XCTAssertTrue(journal.snapshot.first?.value.contains("Calls: 1; failures: 0") == true)
        let runtime = journal.runtime(sources: [:], owner: "player")
        XCTAssertTrue(runtime === logger.runtime)
        attach(configurationCode(source: applied.source, player: applied.player, uiMode: .default), name: "native-logger.swift")
    }

    func testNativeLogEntryBuildsPublicNSErrorDataAndValidatesFullIntegerRange() throws {
        let draft = try NativeLogEntryDraft("{\"message\":\"Example\",\"sender\":\"Example app\",\"level\":\"error\",\"code\":\"9223372036854775807\",\"date\":\"2026-10-21T00:00:00Z\",\"data\":{\"domain\":\"example\",\"code\":4,\"message\":\"Example detail\",\"userInfo\":{\"category\":\"sample\"}}}")
        XCTAssertEqual(draft.entry.code, Int.max)
        XCTAssertEqual(draft.entry.data?.underlyingError.domain, "example")
        XCTAssertEqual(draft.entry.data?.underlyingError.userInfo["category"] as? String, "sample")
        XCTAssertThrowsError(try NativeLogEntryDraft("{\"message\":\"Example\",\"sender\":\"Example\",\"level\":\"error\",\"code\":true}"))
        attach("import Foundation\nimport BitmovinPlayer\nlet entry = " + draft.code, name: "native-log-entry.swift")
    }

    func testConsoleSelectionAndDependentFieldsApplyToActualGlobalSdkLogger() throws {
        let old = DebugConfig.logging.logger
        defer { NativeLoggingOwner.apply(.empty, journal: nil); DebugConfig.logging.logger = old }
        let config = try AdvancedConfiguration(validating: ["LoggingConfig.logger": "console", "Logger.level": "verbose", "ConsoleLogger.level": "error"])
        NativeLoggingOwner.apply(config, journal: nil)
        XCTAssertTrue(DebugConfig.logging.logger is ConsoleLogger)
        XCTAssertEqual(DebugConfig.logging.logger?.level, .error)
        NativeLoggingOwner.apply(try AdvancedConfiguration(validating: ["LoggingConfig.logger": "disabled"]), journal: nil)
        XCTAssertNil(DebugConfig.logging.logger)
        XCTAssertThrowsError(try AdvancedConfiguration(validating: ["LoggingConfig.logger": "javascript"]))
        XCTAssertThrowsError(try AdvancedConfiguration(validating: ["Logger.customLog": "return;"]))
    }

    #if !os(tvOS)
    func testPlayerCallbacksAndWebUiDelegateShareTheSameOwnerRuntime() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = ["NetworkConfig.preprocessHttpRequest": "storage.requests = (storage.requests ?? 0) + 1; return input.request;", "BitmovinUserInterfaceConfig.customMessageHandler": "true", "CustomMessageHandler.receivedSynchronousMessage": "return String(storage.requests ?? 0);"]
        let applied = try draft.validated(), journal = NativeCallbackJournal(), config = PlayerConfig()
        applied.player.apply(to: config, callbackJournal: journal); applied.player.advanced.applyUI(to: config, callbackJournal: journal)
        let request = HttpRequest(url: URL(string: "https://example.com/master.m3u8")!, method: "GET")
        config.networkConfig.preprocessHttpRequest?(.manifestHlsMaster, request) { _ in }
        XCTAssertEqual(journal.messageHandler?.delegate?.receivedSynchronousMessage("count", withData: nil), "1")
    }
    #endif

    private func attach(_ code: String, name: String) { let attachment = XCTAttachment(data: Data(code.utf8), uniformTypeIdentifier: "public.swift-source"); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment) }
}
