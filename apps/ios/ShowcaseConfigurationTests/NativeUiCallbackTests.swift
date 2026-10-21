import BitmovinPlayer
import XCTest

final class NativeUiCallbackTests: XCTestCase {
    func testPiPRestoreCompletesExactlyOnceWithEditedBooleanAndSafeFallback() throws {
        for (body, expected, failures) in [("return 2 + 2 === 4;", true, 0), ("return 'yes';", false, 1), ("throw new Error('private');", false, 1)] {
            let advanced = try AdvancedConfiguration(validating: ["PictureInPictureConfig.restoreUserInterfaceHandler-swift.property": body])
            let journal = NativeCallbackJournal(), config = PlayerViewConfig()
            advanced.apply(to: config, callbackJournal: journal)
            var calls = 0
            let callback = try XCTUnwrap(config.pictureInPictureConfig.restoreUserInterfaceHandler)
            callback { restored in calls += 1; XCTAssertEqual(restored, expected) }
            XCTAssertEqual(calls, 1)
            XCTAssertTrue(journal.snapshot[0].value.contains("failures: \(failures)"))
        }
        var draft = ConfigurationDraft()
        draft.advancedValues = ["PictureInPictureConfig.restoreUserInterfaceHandler-swift.property": "return false;"]
        attach(try draft.validated(), name: "native-pip-restore.swift")
    }

    func testInterstitialMappingsValidateBeforeMutatingRealProtocolConsumers() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = [
            "InterstitialsConfig.customAttributesMapping": "return {clickThroughUrl: input.customAttributes.destination, tracking:[{trigger:'start', registration:'single', events:[{uris:['https://example.com/start'], offset:2}]}, {trigger:'complete', events:[{uris:['https://example.com/complete']}]}]};",
            "InterstitialsConfig.macroValueProvider": "return input.values.map(value => input.name + ':' + value);",
        ]
        let applied = try draft.validated(), journal = NativeCallbackJournal(), config = PlayerConfig()
        applied.player.apply(to: config, callbackJournal: journal)
        let data = MappingData(), registry = MappingRegistry()
        try XCTUnwrap(config.interstitialsConfig.customAttributesMapping)(data, registry)
        XCTAssertEqual(registry.clickThroughUrl?.absoluteString, "https://example.com/destination")
        XCTAssertEqual(registry.events.trackingEvents(for: .start).first?.offset, 2)
        XCTAssertEqual(registry.events.trackingEvents(for: .complete).first?.uris, ["https://example.com/complete"])
        XCTAssertEqual(registry.events.singles, 1); XCTAssertEqual(registry.events.multiple, 1)
        XCTAssertTrue(journal.interstitialRegistry === registry)
        XCTAssertEqual(config.interstitialsConfig.macroValueProvider?(InterstitialMacro(name: "EXAMPLE", values: ["a", "b"])), ["EXAMPLE:a", "EXAMPLE:b"])
        let previous = registry.clickThroughUrl
        XCTAssertThrowsError(try NativeInterstitialPatch(["clickThroughUrl": "https://example.com/changed", "tracking": [["trigger": "invalid", "events": []]]]))
        XCTAssertEqual(registry.clickThroughUrl, previous)
        try NativeInterstitialPatch(["clickThroughUrl": NSNull()]).apply(to: registry)
        XCTAssertNil(registry.clickThroughUrl)
        attach(applied, name: "native-interstitials.swift")
    }

    func testMacroAndTrackingOperationArgumentsUseTypedSdkObjects() throws {
        XCTAssertThrowsError(try ApiOperation.macroPreview.code(arguments: ["values": "[1]"]))
        XCTAssertThrowsError(try ApiOperation.sharePlayEnd.code(arguments: ["index": "-1"]))
        XCTAssertTrue(try ApiOperation.sharePlayBegin.code(arguments: ["reason": "inspection"]).contains("AVCoordinatedPlaybackSuspension.Reason"))
        XCTAssertTrue(try ApiOperation.macroPreview.code(arguments: ["name": "EXAMPLE", "values": "[\"one\"]", "scope": "tracking"]).contains("VastMacroContext(scope: .tracking)"))
        let values = ["trigger": "start", "json": "[{\"uris\":[\"https://example.com\"],\"offset\":1}]"]
        XCTAssertTrue(try ApiOperation.trackingRegister.code(arguments: values).contains("register(trackingEvent:"))
        XCTAssertTrue(try ApiOperation.trackingRegisterMultiple.code(arguments: values).contains("register(trackingEvents:"))
    }

    #if os(tvOS)
    func testTvSeekHandlerUsesBothSdkArgumentsAndRejectsNonfiniteResults() throws {
        for (body, expected) in [("return Math.max(input.oldTime, input.targetTime - 3);", 17.0), ("return Infinity;", 20.0)] {
            let advanced = try AdvancedConfiguration(validating: ["SystemUserInterfaceConfig.timeToSeekAfterUserSeeked": body])
            let config = PlayerConfig(); advanced.applyUI(to: config)
            let ui = try XCTUnwrap(config.styleConfig.userInterfaceConfig as? SystemUserInterfaceConfig)
            XCTAssertEqual(ui.timeToSeekAfterUserSeeked?(10, 20), expected)
        }
        var draft = ConfigurationDraft()
        draft.advancedValues = ["SystemUserInterfaceConfig.timeToSeekAfterUserSeeked": "return input.targetTime;"]
        attach(try draft.validated(), name: "native-tv-seek.swift")
    }
    #else
    func testWebMessageDelegateSurvivesWeakDelegateStorageAndRunsEditedBodies() throws {
        XCTAssertThrowsError(try AdvancedConfiguration(validating: ["CustomMessageHandler.receivedSynchronousMessage": "return null;"]))
        var draft = ConfigurationDraft()
        draft.advancedValues = ["BitmovinUserInterfaceConfig.customMessageHandler": "true", "CustomMessageHandler.receivedSynchronousMessage": "return input.message + ':' + input.data;", "CustomMessageHandler.receivedAsynchronousMessage": "storage.last = input.message;"]
        let applied = try draft.validated(), journal = NativeCallbackJournal(), config = PlayerConfig()
        applied.player.advanced.applyUI(to: config, callbackJournal: journal)
        let handler = try XCTUnwrap((config.styleConfig.userInterfaceConfig as? BitmovinUserInterfaceConfig)?.customMessageHandler)
        XCTAssertTrue(handler === journal.messageHandler)
        let delegate = try XCTUnwrap(handler.delegate)
        XCTAssertEqual(delegate.receivedSynchronousMessage("example", withData: "value"), "example:value")
        delegate.receivedAsynchronousMessage("another", withData: nil)
        XCTAssertTrue(journal.snapshot.allSatisfy { $0.value.contains("failures: 0") })
        attach(applied, name: "native-web-messaging.swift")
    }
    #endif

    private func attach(_ applied: ValidatedConfiguration, name: String) {
        let item = XCTAttachment(data: Data(configurationCode(source: applied.source, player: applied.player, uiMode: .default).utf8), uniformTypeIdentifier: "public.swift-source")
        item.name = name; item.lifetime = .keepAlways; add(item)
    }
}

private final class MappingData: NSObject, InterstitialMappingData {
    let customAttributes: [String: Any] = ["destination": "https://example.com/destination"]
}
private final class TrackingRegistry: NSObject, InterstitialTrackingRegistry {
    var singles = 0, multiple = 0
    var values: [Int: [InterstitialTrackingEvent]] = [:]
    func register(trackingEvent: InterstitialTrackingEvent, for trigger: InterstitialTrackingEventTrigger) { singles += 1; values[trigger.rawValue, default: []].append(trackingEvent) }
    func register(trackingEvents: [InterstitialTrackingEvent], for trigger: InterstitialTrackingEventTrigger) { multiple += 1; values[trigger.rawValue, default: []] += trackingEvents }
    func trackingEvents(for trigger: InterstitialTrackingEventTrigger) -> [InterstitialTrackingEvent] { values[trigger.rawValue] ?? [] }
}
private final class MappingRegistry: NSObject, InterstitialCustomAttributesMappingRegistry {
    let events = TrackingRegistry()
    var tracking: any InterstitialTrackingRegistry { events }
    var clickThroughUrl: URL?
}
