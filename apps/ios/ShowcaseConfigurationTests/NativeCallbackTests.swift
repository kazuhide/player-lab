import BitmovinPlayer
import XCTest

final class NativeCallbackTests: XCTestCase {
    func testEditedFunctionBodiesReceiveSdkArgumentsAndReturnTypedValues() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = [
            "SourceConfig.drmConfig": "fairplay", "FairplayConfig.certificateUrl": "https://example.com/certificate",
            "FairplayConfig.prepareContentId": "return 'asset:' + input.contentId.toUpperCase();",
            "FairplayConfig.prepareMessage": "return input.bytes.map((byte, index) => (byte + index + input.assetId.length) % 256);",
            "FairplayConfig.prepareLicenseServerUrl": "return input.url.replace('/old', '/new');",
            "FairplayConfig.prepareOfflineDrmLicenseInformation": "return {licenseDuration: input.bytes.length * 60, playbackDuration: 45};",
            "LabelingConfig.audioLabel": "return input.language + ': ' + input.label;",
            "LabelingConfig.subtitleLabel": "return input.isForced ? input.label + ' (forced)' : input.label;",
            "PlaybackConfig.isForcedSubtitleCallback": "return input.id === 'required';",
        ]
        let applied = try draft.validated()
        let journal = NativeCallbackJournal()
        let config = applied.source.makeSourceConfig(callbackJournal: journal)
        let fairplay = try XCTUnwrap(config.drmConfig as? FairplayConfig)
        XCTAssertEqual(fairplay.prepareContentId?("abc"), "asset:ABC")
        let firstCallMetrics = journal.runtime(
            sources: applied.source.advanced.callbackSources(owner: .source), owner: "source"
        ).metricsSnapshot()["FairplayConfig.prepareContentId"] ?? [:]
        print("Callback interpreter first-call trusted metrics: \(firstCallMetrics)")
        XCTAssertEqual(fairplay.prepareMessage?(Data([1, 254]), "id"), Data([3, 1]), "\(journal.snapshot)")
        XCTAssertEqual(fairplay.prepareLicenseServerUrl?("https://example.com/old"), "https://example.com/new")
        let information = try XCTUnwrap(fairplay.prepareOfflineDrmLicenseInformation?(Data([1, 2, 3])))
        XCTAssertEqual(information.licenseDuration, 180)
        XCTAssertEqual(information.playbackDuration, 45)
        let audio = AudioTrack(label: "English", identifier: "en", isDefaultTrack: false, language: "en")
        XCTAssertEqual(config.labelingConfig.audioLabel?(audio), "en: English")
        let subtitle = SubtitleTrack(url: nil, format: .webVtt, label: "English", identifier: "required", isDefaultTrack: false, language: "en", forced: true)
        XCTAssertEqual(config.labelingConfig.subtitleLabel?(subtitle), "English (forced)")
        let player = PlayerConfig()
        applied.player.apply(to: player, callbackJournal: journal)
        XCTAssertEqual(player.playbackConfig.isForcedSubtitleCallback?(subtitle), true)
        XCTAssertEqual(journal.snapshot.count, 7)
        let sourceRuntime = journal.runtime(sources: applied.source.advanced.callbackSources(owner: .source), owner: "source")
        let metrics = sourceRuntime.metricsSnapshot()
        XCTAssertFalse(metrics.isEmpty)
        XCTAssertTrue(metrics.values.allSatisfy { $0["cpuMs"] != nil && $0["wallMs"] != nil })
        let measurement = XCTAttachment(data: try JSONSerialization.data(withJSONObject: metrics, options: [.sortedKeys, .prettyPrinted]), uniformTypeIdentifier: "public.json")
        measurement.name = "native-callback-metrics.json"; measurement.lifetime = .keepAlways; add(measurement)
        if journal.snapshot.contains(where: { !$0.value.contains("failures: 0") }) { print("Callback interpreter trusted metrics: \(metrics)") }
        XCTAssertTrue(journal.snapshot.allSatisfy { $0.value.contains("failures: 0") }, "\(journal.snapshot)")
        attachCode(configurationCode(source: applied.source, player: applied.player, uiMode: .default), name: "native-callbacks.swift")
    }

    func testSyntaxFailsValidationAndRuntimeTypeFailuresUseVisibleFallbacks() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = ["PlaybackConfig.isForcedSubtitleCallback": "return (;"]
        XCTAssertThrowsError(try draft.validated())
        draft.advancedValues = [
            "SourceConfig.drmConfig": "fairplay", "FairplayConfig.certificateUrl": "https://example.com/certificate",
            "FairplayConfig.prepareContentId": "return 123;",
            "FairplayConfig.prepareLicense": "throw new Error('private response must not be logged');",
        ]
        let journal = NativeCallbackJournal()
        let config = try XCTUnwrap(draft.validated().source.makeSourceConfig(callbackJournal: journal).drmConfig as? FairplayConfig)
        XCTAssertEqual(config.prepareContentId?("original"), "original")
        XCTAssertEqual(config.prepareLicense?(Data([1, 2, 3])), Data([1, 2, 3]))
        XCTAssertTrue(journal.snapshot.allSatisfy { $0.value.contains("failures: 1") })
        XCTAssertFalse(journal.snapshot.contains { $0.value.contains("private response") })
        XCTAssertNil(NativeScriptRuntime.data([1, -1]))
        XCTAssertNil(NativeScriptRuntime.data([true]))
        XCTAssertNil(NativeScriptRuntime.data([1.5]))
    }

    func testNetworkCallbacksConstructSdkRequestsResponsesAndCompleteExactlyOnce() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = [
            "NetworkConfig.preprocessHttpRequest": "input.request.headers['X-Example'] = input.type; input.request.method = 'POST'; input.request.body = {utf8: 'hello'}; return input.request;",
            "NetworkConfig.preprocessHttpResponse": "input.response.status = 201; input.response.headers['X-Example'] = 'response'; return input.response;",
            "NetworkConfig.retryHttpRequest": "return input.retry < 2 ? {action: 'retry', delay: 0.25, request: input.response.request} : {action: 'abort'};",
            "NetworkConfig.preprocessHttpRequestDelegate": "input.request.url += '?example=1'; return input.request;",
        ]
        let applied = try draft.validated()
        let journal = NativeCallbackJournal()
        let config = PlayerConfig()
        applied.player.apply(to: config, callbackJournal: journal)
        let request = HttpRequest(url: URL(string: "https://example.com/master.m3u8")!, method: "GET")
        var requestCalls = 0
        config.networkConfig.preprocessHttpRequest?(.manifestHlsMaster, request) { result in
            requestCalls += 1
            XCTAssertEqual(result.method, "POST")
            XCTAssertEqual(result.headers["X-Example"], HttpRequestType.manifestHlsMaster.rawValue)
            XCTAssertEqual(result.body, Data("hello".utf8))
        }
        XCTAssertEqual(requestCalls, 1)
        XCTAssertEqual(request.method, "GET", "The adapter must not partially mutate the original before validation")
        let response = HttpResponse(request: request, url: request.url, status: 503)
        var responseCalls = 0
        config.networkConfig.preprocessHttpResponse?(.manifestHlsMaster, response) { result in
            responseCalls += 1
            XCTAssertEqual(result.status, 201)
            XCTAssertEqual(result.headers["X-Example"], "response")
        }
        XCTAssertEqual(responseCalls, 1)
        var retries = 0
        var aborts = 0
        let retry = try XCTUnwrap(config.networkConfig.retryHttpRequest)
        retry(.manifestHlsMaster, 1, response, { delay, retried in retries += 1; XCTAssertEqual(delay, 0.25); XCTAssertEqual(retried.url, request.url) }, { aborts += 1 })
        retry(.manifestHlsMaster, 2, response, { _, _ in retries += 1 }, { aborts += 1 })
        XCTAssertEqual(retries, 1)
        XCTAssertEqual(aborts, 1)
        var delegated = 0
        try XCTUnwrap(config.networkConfig.preprocessHttpRequestDelegate).preprocessHttpRequest("example", httpRequest: request) { result in
            delegated += 1
            XCTAssertEqual(result.url.query, "example=1")
        }
        XCTAssertEqual(delegated, 1)
        XCTAssertTrue(journal.snapshot.allSatisfy { $0.value.contains("failures: 0") }, "\(journal.snapshot)")
        attachCode(configurationCode(source: applied.source, player: applied.player, uiMode: .default), name: "native-network.swift")
    }

    func testInvalidNetworkOutputLeavesOriginalUntouchedAndStillCompletes() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = [
            "NetworkConfig.preprocessHttpRequest": "input.request.method = 123; return input.request;",
            "NetworkConfig.preprocessHttpResponse": "input.response.headers = {'Invalid Header': 'value'}; return input.response;",
            "NetworkConfig.retryHttpRequest": "return {action: 'retry', delay: -1};",
        ]
        let journal = NativeCallbackJournal()
        let config = PlayerConfig()
        try draft.validated().player.apply(to: config, callbackJournal: journal)
        let request = HttpRequest(url: URL(string: "https://example.com/master.m3u8")!, method: "GET")
        var completions = 0
        config.networkConfig.preprocessHttpRequest?(.manifestHlsMaster, request) { result in completions += 1; XCTAssertTrue(result === request) }
        let response = HttpResponse(request: request, url: request.url, status: 503)
        config.networkConfig.preprocessHttpResponse?(.manifestHlsMaster, response) { result in completions += 1; XCTAssertTrue(result === response) }
        config.networkConfig.retryHttpRequest?(.manifestHlsMaster, 1, response, { _, _ in XCTFail("An invalid retry must not run") }, { completions += 1 })
        XCTAssertEqual(completions, 3)
        XCTAssertTrue(journal.snapshot.allSatisfy { $0.value.contains("failures: 1") })
    }

    #if !os(tvOS)
    func testLicenseCallbacksShareOnlyTheirSourcesInMemoryStorage() throws {
        var draft = ConfigurationDraft()
        draft.advancedValues = [
            "SourceConfig.drmConfig": "fairplay", "FairplayConfig.certificateUrl": "https://example.com/certificate",
            "FairplayConfig.persistLicenseData": "storage[input.assetId] = input.base64;",
            "FairplayConfig.provideLicenseData": "return storage[input.assetId] ?? null;",
        ]
        let applied = try draft.validated()
        let config = try XCTUnwrap(applied.source.makeSourceConfig().drmConfig as? FairplayConfig)
        XCTAssertNil(config.provideLicenseData?("asset"))
        config.persistLicenseData?("asset", Data([0, 128, 255]))
        XCTAssertEqual(config.provideLicenseData?("asset"), Data([0, 128, 255]))
        let other = try XCTUnwrap(applied.source.makeSourceConfig().drmConfig as? FairplayConfig)
        XCTAssertNil(other.provideLicenseData?("asset"))
    }
    #endif

    func testOwnerSourceLimitsFailBeforeAnySdkCallbackIsConstructed() throws {
        XCTAssertThrowsError(try NativeScriptRuntime.validateSources(Dictionary(uniqueKeysWithValues: (0..<129).map { ("callback\($0)", "return true;") })))
        let body = "/*" + String(repeating: " ", count: 65_500) + "*/ return true;"
        XCTAssertThrowsError(try NativeScriptRuntime.validateSources(Dictionary(uniqueKeysWithValues: (0..<17).map { ("callback\($0)", body) })))
    }

    func testEditedByteAndStringMapsReturnNativeBridgeValues() throws {
        let runtime = NativeScriptRuntime(sources: [
            "bytes": "return input.bytes.map((byte, index) => (byte + index + input.assetId.length) % 256);",
            "strings": "return input.values.map(value => 'tracking:' + value);",
        ])
        let bytes = try runtime.evaluate("bytes", input: ["bytes": [1, 254], "assetId": "id"])
        XCTAssertEqual(NativeScriptRuntime.data(bytes), Data([3, 1]))
        let sdkBytes = try runtime.evaluate("bytes", input: AdvancedConfiguration.dataInput(Data([1, 254]), assetId: "id"))
        XCTAssertEqual(NativeScriptRuntime.data(sdkBytes), Data([3, 1]))
        let strings = try runtime.evaluate("strings", input: ["values": ["a", "b"]])
        XCTAssertEqual(NativeScriptRuntime.strings(strings), ["tracking:a", "tracking:b"])
        XCTAssertNotNil(runtime.metricsSnapshot()["strings"]?["cpuMs"], "The actual native thread CPU clock must be connected to the trusted interpreter")
    }

    func testBoundedInterpreterRejectsHostAccessAndTerminatesLoopsWithStorageRollback() throws {
        XCTAssertThrowsError(try NativeScriptRuntime.validate("return /example/.test(input.text);", id: "regex"))
        let journal = NativeCallbackJournal()
        let runtime = NativeScriptRuntime(sources: [
            "save": "storage.counter = 3; return storage.counter;",
            "loop": "storage.counter = 99; try { while (true) {} } catch (e) { return 123; } finally { storage.counter = 100; }",
            "read": "return storage.counter;",
            "host": "return globalThis;",
        ], journal: journal)
        XCTAssertEqual(runtime.call("save", input: [:], fallback: -1, convert: NativeScriptRuntime.number), 3)
        let started = Date()
        XCTAssertEqual(runtime.call("loop", input: [:], fallback: -1, convert: NativeScriptRuntime.number), -1)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
        XCTAssertEqual(runtime.call("read", input: [:], fallback: -1, convert: NativeScriptRuntime.number), 3)
        XCTAssertEqual(runtime.call("host", input: [:], fallback: -1, convert: NativeScriptRuntime.number), -1)
        XCTAssertTrue(journal.snapshot.first(where: { $0.id == "loop" })?.value.contains("failures: 1") == true)
        let generated = NativeScriptRuntime.codePreamble(["loop": "while (true) {}"], name: "bounded").joined(separator: "\n")
        XCTAssertTrue(generated.contains("PlayerLabScriptEngine"))
        XCTAssertTrue(generated.contains("Bundle.main.url(forResource:"))
        XCTAssertTrue(generated.contains("ACORN-LICENSE.txt"))
        XCTAssertLessThan(generated.utf8.count, 8_192, "Code examples must show configuration rather than embedding the parser implementation")
        XCTAssertFalse(generated.contains("objectForKeyedSubscript(\"Function\")"))
    }

    private func attachCode(_ code: String, name: String) {
        let attachment = XCTAttachment(data: Data(code.utf8), uniformTypeIdentifier: "public.swift-source")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
