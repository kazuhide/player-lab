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

    func testBitrateConfigurationAndClearingDoNotRequireAReadySource() {
        var context = NativeApiContext()
        for sourceState in [PlaybackCommandState.SourceState.empty, .loading, .failed, .ready] {
            context.playback.source = sourceState
            XCTAssertNil(context.rejection(for: .bitrate), "The Player-property catalog must not require a ready Source")
            XCTAssertNil(context.rejection(for: .bitrate, arguments: ["value": "2500000"]))
            XCTAssertNil(context.rejection(for: .bitrate, arguments: ["value": "0"]))
        }
        context.playback.playerDestroyed = true
        XCTAssertNotNil(context.rejection(for: .bitrate))
        XCTAssertNotNil(context.rejection(for: .bitrate, arguments: ["value": "0"]))
    }

    func testTimeShiftCatalogRetainsZeroOffsetRecoveryWhenRewindControlsAreDisabled() {
        var context = ready()
        context.playback.live = true
        context.playback.maxTimeShift = -30
        context.playback.rewindEnabled = false
        XCTAssertNil(context.rejection(for: .timeShift))
        XCTAssertNil(context.rejection(for: .timeShift, arguments: ["value": "0"]))
        XCTAssertNotNil(context.rejection(for: .timeShift, arguments: ["value": "-5"]))
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
    func testFreshBitrateDispatchConfiguresAndClearsTheSamePlayerWithoutASource() {
        let model = PlayerModel(licenseKey: "configuration-tests-invalid-license")
        defer { model.player.destroy() }
        model.setApiEventRecording(false)
        let player = model.player
        XCTAssertNil(player.source)
        XCTAssertNoThrow(try model.executeApi(.bitrate, arguments: ["value": "2500000"]))
        model.unloadFromApi()
        model.apiSession.playerFailed = true
        XCTAssertNil(model.apiContext().rejection(for: .bitrate))
        XCTAssertNoThrow(try model.executeApi(.bitrate, arguments: ["value": "0"]))
        XCTAssertTrue(model.player === player)
        XCTAssertNil(player.source)
        XCTAssertTrue(model.apiEvents.isEmpty)
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
    func testLiveRewindReadinessRequiresTheCurrentLiveOwner() async {
        let owner = RewindTestOwner(), replacement = RewindTestOwner(), state = RewindTestState()
        state.currentOwner = owner
        let handler = CustomMessageHandler(), journal = NativeCallbackJournal()
        let bridge = NativeLiveRewindBridge(handler: handler, journal: journal)
        bridge.bind(to: rewindBinding(owner: owner, state: state))
        XCTAssertFalse(owner.isDestroyed)
        XCTAssertEqual(state.readyCalls, 0)

        bridge.receivedAsynchronousMessage(NativeLiveRewindBridge.readyMessage, withData: nil)
        await drainRewindMessages()
        XCTAssertEqual(state.readyCalls, 1)

        owner.isDestroyed = true
        bridge.receivedAsynchronousMessage(NativeLiveRewindBridge.readyMessage, withData: nil)
        await drainRewindMessages()
        XCTAssertEqual(state.readyCalls, 1, "A destroyed owner cannot become ready")

        owner.isDestroyed = false
        state.currentOwner = replacement
        bridge.receivedAsynchronousMessage(NativeLiveRewindBridge.readyMessage, withData: nil)
        await drainRewindMessages()
        XCTAssertEqual(state.readyCalls, 1, "A retired owner cannot mark its replacement ready")
    }

    @MainActor
    func testLiveRewindChecksOwnershipAtQueuedDeliveryAndDoesNotRetainTheOwner() async {
        var owner: RewindTestOwner? = RewindTestOwner()
        let state = RewindTestState(), handler = CustomMessageHandler(), journal = NativeCallbackJournal()
        state.currentOwner = owner
        let bridge = NativeLiveRewindBridge(handler: handler, journal: journal)
        bridge.bind(to: rewindBinding(owner: owner!, state: state))
        bridge.receivedAsynchronousMessage(NativeLiveRewindBridge.readyMessage, withData: nil)
        owner!.isDestroyed = true
        await drainRewindMessages()
        XCTAssertEqual(state.readyCalls, 0, "Readiness must use the state at delivery, not enqueue time")

        owner!.isDestroyed = false
        bridge.receivedAsynchronousMessage(NativeLiveRewindBridge.readyMessage, withData: nil)
        state.currentOwner = RewindTestOwner()
        await drainRewindMessages()
        XCTAssertEqual(state.readyCalls, 0, "Replacing the owner before delivery must reject the old message")

        weak var releasedOwner = owner
        owner = nil
        XCTAssertNil(releasedOwner, "The bridge binding must not keep its owner alive")
        bridge.receivedAsynchronousMessage(NativeLiveRewindBridge.readyMessage, withData: nil)
        await drainRewindMessages()
        XCTAssertEqual(state.readyCalls, 0)
    }

    @MainActor
    func testLiveRewindSendPreservesDeduplicationAndRejectsRetiredOwners() {
        let owner = RewindTestOwner(), state = RewindTestState()
        state.currentOwner = owner
        let handler = CustomMessageHandler(), journal = NativeCallbackJournal()
        var sent: [(String, String?)] = []
        let bridge = NativeLiveRewindBridge(handler: handler, journal: journal, sendMessage: { sent.append(($0, $1)) })
        bridge.bind(to: rewindBinding(owner: owner, state: state))
        bridge.send(false)
        bridge.send(false)
        XCTAssertEqual(sent.map(\.0), [NativeLiveRewindBridge.message])
        XCTAssertEqual(sent.map(\.1), ["false"])
        XCTAssertTrue(state.currentOwner === owner, "A preference change must keep the current owner")
        bridge.send(false, force: true)
        bridge.send(true)
        XCTAssertEqual(sent.map(\.1), ["false", "false", "true"])
        owner.isDestroyed = true
        bridge.send(false, force: true)
        owner.isDestroyed = false
        state.currentOwner = RewindTestOwner()
        bridge.send(false, force: true)
        XCTAssertEqual(sent.count, 3)
    }

    @MainActor
    func testLiveRewindConfigurationPreservesThePreferenceBeforeCreatingAPlayer() throws {
        let config = PlayerConfig(), ui = BitmovinUserInterfaceConfig(), journal = NativeCallbackJournal()
        let factoryFunction = try XCTUnwrap(UiMode.sports.factoryFunction)
        ui.uiManagerFactoryFunction = factoryFunction
        config.styleConfig.userInterfaceConfig = ui
        let bridge = try XCTUnwrap(PlayerModel.configureLiveRewindUI(config, callbackJournal: journal, enabled: false))
        XCTAssertTrue(config.styleConfig.userInterfaceConfig === ui)
        XCTAssertEqual(ui.uiManagerFactoryFunction, factoryFunction)
        XCTAssertEqual(ui.customOptions["playerLabLiveRewindEnabled"] as? Bool, false)
        XCTAssertTrue(ui.customMessageHandler?.delegate === bridge)
        config.styleConfig.userInterfaceType = .system
        XCTAssertNil(PlayerModel.configureLiveRewindUI(config, callbackJournal: journal, enabled: true))
    }

    private final class RewindTestOwner: NSObject {
        var isDestroyed = false
    }

    private final class RewindTestState {
        var currentOwner: AnyObject?
        var readyCalls = 0
    }

    private func rewindBinding(owner: RewindTestOwner, state: RewindTestState) -> NativeLiveRewindOwnerBinding {
        NativeLiveRewindOwnerBinding(owner: owner, isDestroyed: { ($0 as? RewindTestOwner)?.isDestroyed ?? true },
                                     currentOwner: { state.currentOwner }, didBecomeReady: { _ in state.readyCalls += 1 })
    }

    @MainActor
    private func drainRewindMessages() async {
        let drained = XCTestExpectation(description: "Queued rewind messages delivered")
        DispatchQueue.main.async { drained.fulfill() }
        let result = await XCTWaiter.fulfillment(of: [drained], timeout: 1)
        XCTAssertEqual(result, .completed)
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
