import BitmovinPlayer
import XCTest

final class NativeAdvertisingTests: XCTestCase {
    private let schedule = #"[{"sources":[{"tag":"https://example.com/first.xml","type":"ima","vastLoadTimeout":3,"videoLoadTimeout":9},{"tag":"https://example.com/fallback.mp4","type":"progressive"}],"trigger":{"seconds":5.5},"linearUi":{"requestsUi":false,"message":"Advertisement","untilSkippableMessage":"Wait","skippableMessage":"Skip"}},{"sources":[{"tag":"https://example.com/post.xml","type":"bitmovin"}],"position":"post"}]"#

    func testScheduleCreatesActualAdItemsWithFallbackSourcesAndTypedTriggers() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = ["AdvertisingConfig.schedule": schedule, "ImaSettings.maxRedirects": String(UInt.max),
            "ImaSettings.language": "en", "ImaSettings.ppid": "local-only-publisher", "ImaSettings.sessionId": "local-only-session",
            "ImaSettings.enableBackgroundPlayback": "true", "ImaSettings.disableNowPlayingInfo": "false", "ImaSettings.playerVersion": "example-version"]
        #if !os(tvOS)
        draft.advancedValues["ImaAdvertisingConfig.preferredUiType"] = "disabled"
        draft.advancedValues["ImaAdvertisingConfig.adAttributionUiMode"] = "attributionWithCountdown"
        draft.advancedValues["ImaAdvertisingConfig.shouldPauseOnTap"] = "false"
        draft.advancedValues["ImaSettings.sameAppKeyEnabled"] = "true"
        #endif
        let applied = try draft.validated()
        let player = PlayerConfig()
        applied.player.apply(to: player)
        let items = player.advertisingConfig.schedule
        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(items[0].trigger, .seconds(5.5))
        XCTAssertEqual(items[0].sources.count, 2)
        XCTAssertEqual(items[0].sources[0].vastLoadTimeout, 3)
        XCTAssertEqual(items[0].sources[0].videoLoadTimeout, 9)
        XCTAssertEqual(items[0].sources[1].type, .progressive)
        XCTAssertFalse(items[0].linearAdUiConfig.requestsUi)
        XCTAssertEqual(items[0].linearAdUiConfig.message, "Advertisement")
        XCTAssertEqual(items[0].linearAdUiConfig.untilSkippableMessage, "Wait")
        XCTAssertEqual(items[0].linearAdUiConfig.skippableMessage, "Skip")
        XCTAssertEqual(items[1].position, "post")
        XCTAssertEqual(items[1].trigger, .post)
        XCTAssertNotNil(player.advertisingConfig.beforeInitialization)
        let code = configurationCode(source: applied.source, player: applied.player, uiMode: .default)
        XCTAssertFalse(code.contains("local-only-publisher"))
        XCTAssertFalse(code.contains("local-only-session"))
        XCTAssertTrue(code.contains(String(UInt.max)))
        attachCode(code, name: "native-advertising.swift")
    }

    func testAdDecisionAndMacroCallbacksReturnRealSdkItemsAndProviderValues() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = ["AdvertisingConfig.schedule": schedule,
            "AdvertisingConfig.shouldLoadAdItem": "return input.item.sources.length > 1;",
            "AdvertisingConfig.shouldPlayAdItem": "return input.item.trigger !== 'post';",
            "AdvertisingConfig.shouldPlaySeekedOverAdItems": "return [input.items.length - 1, 0];",
            "AdvertisingConfig.beforeInitialization": "input.settings.language = 'ja'; return input.settings;",
            "AdvertisingConfig.onAdsManagerAvailable": "return {};",
            "BitmovinAdvertisingConfig.onSelectAdQuality": "return input.suggestedIndex;",
            "VastMacroConfig.valueProvider": "return input.macro.values.map(value => input.scope + ':' + value);",
        ]
        let applied = try draft.validated()
        let config = PlayerConfig()
        let journal = NativeCallbackJournal()
        applied.player.apply(to: config, callbackJournal: journal)
        let ads = config.advertisingConfig
        XCTAssertTrue(ads.shouldLoadAdItem(ads.schedule[0]))
        XCTAssertFalse(ads.shouldLoadAdItem(ads.schedule[1]))
        XCTAssertTrue(ads.shouldPlayAdItem(ads.schedule[0]))
        XCTAssertFalse(ads.shouldPlayAdItem(ads.schedule[1]))
        let selected = ads.shouldPlaySeekedOverAdItems(ads.schedule)
        XCTAssertTrue(selected[0] === ads.schedule[1])
        XCTAssertTrue(selected[1] === ads.schedule[0])
        XCTAssertEqual(ads.bitmovin.macro.valueProvider?(VastMacro(name: "EXAMPLE", values: ["a", "b"]), VastMacroContext(scope: .tracking)), ["tracking:a", "tracking:b"])
        XCTAssertNotNil(ads.beforeInitialization)
        XCTAssertNotNil(ads.onAdsManagerAvailable)
        XCTAssertNotNil(ads.bitmovin.onSelectAdQuality)
        XCTAssertEqual(journal.snapshot.filter { $0.value.contains("Calls: 0") }.count, 3, "Registration is distinct from observed invocation")
        attachCode(configurationCode(source: applied.source, player: applied.player, uiMode: .default), name: "native-advertising-callbacks.swift")
    }

    func testMalformedScheduleAndCallbackResultsDoNotPartiallyApply() throws {
        for json in ["{}", #"[{"sources":[]}]"#, #"[{"sources":[{"tag":"relative"}]}]"#,
            #"[{"sources":[{"tag":"https://example.com/ad.xml","type":3}]}]"#,
            #"[{"sources":[{"tag":"https://example.com/ad.xml"}],"trigger":{"percentage":101}}]"#,
            #"[{"sources":[{"tag":"https://example.com/ad.xml"}],"linearUi":{"requestsUi":1}}]"#] {
            var draft = ConfigurationDraft(); draft.advancedValues = ["AdvertisingConfig.schedule": json]
            XCTAssertThrowsError(try draft.validated())
        }
        XCTAssertNil(AdvancedConfiguration.validImaPatch(["maxRedirects": -1]))
        XCTAssertNil(AdvancedConfiguration.validImaPatch(["language": NSNull()]))
        XCTAssertNil(AdvancedConfiguration.validImaPatch(["enableBackgroundPlayback": 1]))
        var draft = ConfigurationDraft()
        draft.advancedValues = ["AdvertisingConfig.schedule": schedule, "AdvertisingConfig.shouldPlaySeekedOverAdItems": "return [0, 0];"]
        let config = PlayerConfig()
        let journal = NativeCallbackJournal()
        try draft.validated().player.apply(to: config, callbackJournal: journal)
        let result = config.advertisingConfig.shouldPlaySeekedOverAdItems(config.advertisingConfig.schedule)
        XCTAssertEqual(result.count, 2)
        XCTAssertTrue(result[0] === config.advertisingConfig.schedule[0])
        XCTAssertTrue(journal.snapshot[0].value.contains("failures: 1"))
    }

    private func attachCode(_ code: String, name: String) {
        let attachment = XCTAttachment(data: Data(code.utf8), uniformTypeIdentifier: "public.swift-source")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
