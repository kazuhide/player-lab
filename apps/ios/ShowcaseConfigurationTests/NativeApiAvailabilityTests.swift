import BitmovinPlayer
import PlaybackCore
import XCTest

final class NativeApiAvailabilityTests: XCTestCase {
    func testLoadingAndFailureLeaveBootstrapAndRecoveryAvailable() {
        var context = NativeApiContext()
        XCTAssertNotNil(context.rejection(for: .play))
        XCTAssertNil(context.rejection(for: .destroyAndRecreate))
        XCTAssertNil(context.rejection(for: .volume))
        XCTAssertNil(context.rejection(for: .subtitle, arguments: ["value": ""]))
        context.hasConfiguredSource = true
        XCTAssertNil(context.rejection(for: .reload))
        XCTAssertNil(context.rejection(for: .loadConfig))
        context.hasSource = true
        context.playback.source = .failed
        XCTAssertNotNil(context.rejection(for: .seek))
        XCTAssertNil(context.rejection(for: .unload))
        XCTAssertNil(context.rejection(for: .reload))
        context.playback.playerDestroyed = true
        XCTAssertNotNil(context.rejection(for: .volume))
        XCTAssertNil(context.rejection(for: .destroyAndRecreate))
    }

    func testTrackCatalogAndFreshArgumentsUseOnlyTheCurrentSource() {
        var context = ready()
        XCTAssertNotNil(context.rejection(for: .audio))
        context.audioIDs = ["current-audio"]
        context.subtitleIDs = ["current-subtitle"]
        XCTAssertNil(context.rejection(for: .audio))
        XCTAssertNil(context.rejection(for: .audio, arguments: ["value": "current-audio"]))
        XCTAssertNotNil(context.rejection(for: .audio, arguments: ["value": "retired-audio"]))
        XCTAssertNotNil(context.rejection(for: .subtitle, arguments: ["value": "retired-subtitle"]))
        XCTAssertNil(context.rejection(for: .subtitle, arguments: ["value": ""]))
        context.subtitleIDs = []
        XCTAssertNil(context.rejection(for: .subtitle, arguments: ["value": ""]))
        XCTAssertNotNil(context.rejection(for: .removeSubtitle))
    }

    func testImaCommandsRequireActualActiveImaContext() {
        var context = ready()
        context.hasImaManager = true
        XCTAssertNotNil(context.rejection(for: .imaClicked))
        context.playback.linearAdActive = true
        XCTAssertNotNil(context.rejection(for: .imaDiscard))
        context.activeAdIsIma = true
        XCTAssertNil(context.rejection(for: .imaClicked))
        XCTAssertNil(context.rejection(for: .imaDiscard))
        context.hasImaManager = false
        XCTAssertNotNil(context.rejection(for: .imaDiscard))
    }

    @MainActor
    func testFreshDispatchRejectsSeekWithoutSourceBeforeCallingTheSdk() throws {
        let model = PlayerModel(licenseKey: "configuration-tests-invalid-license")
        defer { model.player.destroy() }
        model.setApiEventRecording(false)
        let player = model.player
        XCTAssertThrowsError(try model.executeApi(.seek, arguments: ["value": "2"]))
        XCTAssertThrowsError(try model.executeApi(.advertisingSkip, arguments: [:]))
        XCTAssertTrue(model.player === player)
        XCTAssertNil(model.player.source)
        XCTAssertTrue(model.apiEvents.isEmpty)
        XCTAssertNoThrow(try model.executeApi(.subtitle, arguments: ["value": ""]))
    }

    @MainActor
    func testSessionResetAndUnavailableTvPreferenceDoNotDependOnRecording() {
        let model = PlayerModel(licenseKey: "configuration-tests-invalid-license")
        defer { model.player.destroy() }
        model.setApiEventRecording(false)
        model.apiSession.playerFailed = true
        model.apiSession.adClientType = .ima
        model.unloadFromApi()
        XCTAssertFalse(model.apiSession.playerFailed)
        XCTAssertNil(model.apiSession.adClientType)
        XCTAssertTrue(model.apiEvents.isEmpty)
        #if os(tvOS)
        model.timeShiftEnabled = false
        XCTAssertTrue(model.timeShiftEnabled)
        XCTAssertNotNil(model.liveRewindControlsUnavailableReason)
        #endif
    }

    #if !os(tvOS)
    @MainActor
    func testLiveRewindBridgePreservesDemoDelegateAndRejectsRetiredReadiness() async throws {
        let model = PlayerModel(licenseKey: "configuration-tests-invalid-license")
        defer { model.player.destroy() }
        // Keep this ownership test source-free so invalid-license loading and
        // asynchronous cancellation do not affect the delegate assertions.
        let originalPlayer = model.player
        let ui = try XCTUnwrap(originalPlayer.config.styleConfig.userInterfaceConfig as? BitmovinUserInterfaceConfig)
        let handler = try XCTUnwrap(ui.customMessageHandler)
        let delegate = try XCTUnwrap(handler.delegate)
        XCTAssertTrue(delegate is NativeLiveRewindBridge, "Configured handler delegate: \(type(of: delegate))")
        XCTAssertFalse(originalPlayer.isDestroyed)
        model.timeShiftEnabled = false
        XCTAssertTrue(model.player === originalPlayer)
        XCTAssertNil(model.player.source)
        delegate.receivedAsynchronousMessage(NativeLiveRewindBridge.readyMessage, withData: nil)
        for _ in 0..<100 {
            if model.liveRewindUiReady { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertTrue(model.liveRewindUiReady)
        model.setUiMode(.sports)
        XCTAssertTrue(originalPlayer.isDestroyed)
        XCTAssertFalse(model.liveRewindUiReady)
        delegate.receivedAsynchronousMessage(NativeLiveRewindBridge.readyMessage, withData: nil)
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertFalse(model.liveRewindUiReady, "An old Web UI cannot mark the replacement view ready")
        XCTAssertEqual((model.player.config.styleConfig.userInterfaceConfig as? BitmovinUserInterfaceConfig)?.customOptions["playerLabLiveRewindEnabled"] as? Bool, false)
    }

    func testLiveRewindBridgePreservesTheConfiguredDemonstrationDelegate() {
        let handler = CustomMessageHandler(), journal = NativeCallbackJournal()
        let delegate = EchoWebMessageDelegate()
        handler.delegate = delegate
        let bridge = NativeLiveRewindBridge(handler: handler, journal: journal)
        XCTAssertTrue(handler.delegate === bridge)
        XCTAssertEqual(bridge.receivedSynchronousMessage("example", withData: "value"), "example:value")
        bridge.receivedAsynchronousMessage("example", withData: "value")
        XCTAssertEqual(delegate.lastMessage, "example:value")
    }
    #endif

    private func ready() -> NativeApiContext {
        var context = NativeApiContext()
        context.hasSource = true
        context.playback.source = .ready
        context.playback.duration = 60
        return context
    }
}

#if !os(tvOS)
private final class EchoWebMessageDelegate: NSObject, CustomMessageHandlerDelegate {
    var lastMessage: String?
    func receivedSynchronousMessage(_ message: String, withData data: String?) -> String? { message + ":" + (data ?? "") }
    func receivedAsynchronousMessage(_ message: String, withData data: String?) { lastMessage = message + ":" + (data ?? "") }
}
#endif
