import AVFoundation
import BitmovinPlayer
import Combine
import SwiftUI
import UIKit
import XCTest
#if os(tvOS)
@testable import Showcase_tvOS
#else
@testable import Showcase_iOS
#endif

/// Opt-in, licensed public-SDK checks. No mock player or private observer is used.
@MainActor
final class TrackRuntimeTests: XCTestCase {
    private var subscriptions = Set<AnyCancellable>()
    private var errors: [Int] = []
    private var sourceLoads = 0
    private var observations: [Observation] = []
    private weak var observedModel: PlayerModel?

    private struct Observation: Codable {
        let stage: String
        let sourceLoads: Int
        let duration: Double?
        let position: Double?
        let live: Bool
        let playing: Bool
        let audioLanguages: [String]
        let subtitleLanguages: [String]
        let selectedAudio: String?
        let selectedSubtitle: String?
        let selectedSubtitleLabel: String?
        let errorCodes: [Int]
        let timestamp: TimeInterval
        let playerOwner: String
        let sourceOwner: String?
        let emittedSourceOwner: String?
        let audioIdentifiers: [String]
        let selectedAudioIdentifier: String?
        let audioPreference: String?
        let subtitlePreference: String?
        let recentLog: [String]
    }

    #if !os(tvOS)
    func testSportsSourceOnlySubtitleOffRetainsPreferredAudio() async throws {
        XCTAssertFalse(bitmovinLicenseKey().isEmpty, "Configure the normal app Player license first")
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        let players = model.$player.sink { [weak self, weak model] player in
            guard let self, let model else { return }
            self.subscriptions.removeAll()
            self.observe(player, model: model)
        }
        let controller = NativePreviewController(model: model)
        controller.setInteractive(false)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        window.rootViewController = controller
        window.windowLevel = .alert + 1
        window.makeKeyAndVisible()
        defer {
            record("final Sports source-only Off", player: model.player)
            attachObservations(name: "sports-source-only-off-events.json")
            attach(window, name: "Sports source-only Off final")
            model.player.destroy()
            subscriptions.removeAll()
            players.cancel()
            window.isHidden = true
        }
        XCTAssertEqual(model.presentation, .sdkSwiftUI)
        var draft = model.configurationDraft
        draft.sourceURL = ProcessInfo.processInfo.environment["PLAYER_LAB_TEST_MEDIA_URL"]
            ?? "http://127.0.0.1:5284/vod-multiaudio/master.m3u8"
        draft.title = "Sports source-only subtitle Off"
        draft.autoplay = true
        draft.startOffset = "5"
        draft.audioLanguage = "de-AT"
        draft.subtitleMode = .language
        draft.subtitleLanguage = "de"
        draft.videoScaling = .fill
        _ = try model.apply(draft)
        try await eventually("initial preferred audio and subtitles") {
            model.player.audio?.language == "de" && model.player.subtitle.language == "de"
        }
        try await progress(model.player, stage: "default UI preferred tracks") {
            model.player.audio?.language == "de" && model.player.subtitle.language == "de"
        }
        controller.setInteractive(true)
        try await progress(model.player, stage: "expanded default UI preferred tracks") {
            model.player.audio?.language == "de" && model.player.subtitle.language == "de"
        }
        controller.setInteractive(false)
        model.player.pause()
        try await eventually("default UI pauses before recreation") { model.player.isPaused }
        let oldPlayer = model.player
        let oldGeneration = model.playerGeneration
        model.setUiMode(.sports)
        XCTAssertTrue(oldPlayer.isDestroyed)
        XCTAssertFalse(model.player === oldPlayer)
        XCTAssertNotEqual(model.playerGeneration, oldGeneration)
        let interface = try XCTUnwrap(model.player.config.styleConfig.userInterfaceConfig as? BitmovinUserInterfaceConfig)
        XCTAssertEqual(interface.uiManagerFactoryFunction,
                       "bitmovin.playerui.UIFactory.buildSportsUI")
        controller.setInteractive(true)
        try await eventually("Sports UI preferred audio and subtitles") {
            model.player.audio?.language == "de" && model.player.subtitle.language == "de"
        }
        try await progress(model.player, stage: "Sports preferred tracks") {
            model.player.audio?.language == "de" && model.player.subtitle.language == "de"
        }
        model.player.pause()
        try await eventually("Sports UI pauses before source-only reload") { model.player.isPaused }
        let samePlayer = model.player
        let sameGeneration = model.playerGeneration
        let previousSource = try XCTUnwrap(model.player.source)
        let beforeLoads = sourceLoads
        draft = model.configurationDraft
        XCTAssertEqual(draft.audioLanguage.lowercased(), "de-at")
        draft.subtitleMode = .off
        record("before subtitle Off Apply", player: model.player)
        XCTAssertEqual(try model.apply(draft), .reloadSource)
        XCTAssertTrue(model.player === samePlayer)
        XCTAssertEqual(model.playerGeneration, sameGeneration)
        XCTAssertFalse(model.player.source === previousSource)
        XCTAssertTrue(window.rootViewController === controller)
        XCTAssertEqual(model.configurationDraft.audioLanguage.lowercased(), "de-at")
        record("after subtitle Off Apply", player: model.player)
        try await eventually("Sports source-only Off keeps preferred German audio") {
            self.sourceLoads > beforeLoads && model.player.isPlaying
                && model.player.audio?.language == "de"
        }
        let item = try XCTUnwrap(videoLayer(controller.view.layer)?.player?.currentItem)
        let loadedLegible = try await item.asset.loadMediaSelectionGroup(for: .legible)
        let legible = try XCTUnwrap(loadedLegible)
        XCTAssertGreaterThanOrEqual(legible.options.count, 2)
        try await progress(model.player, stage: "Sports source-only Off") {
            model.player.audio?.language == "de"
                && item.currentMediaSelection.selectedMediaOption(in: legible) == nil
        }
        XCTAssertTrue(errors.isEmpty, "Player/Source error codes: \(errors)")
    }
    #endif

    func testInitialTrackSelectionReloadRecreationAndNativeScaling() async throws {
        XCTAssertFalse(bitmovinLicenseKey().isEmpty, "Configure the normal app Player license first")
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        let players = model.$player.sink { [weak self, weak model] player in
            guard let self, let model else { return }
            self.subscriptions.removeAll()
            self.observe(player, model: model)
        }
        let controller = UIViewController()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        window.rootViewController = controller
        window.windowLevel = .alert + 1
        window.makeKeyAndVisible()
        var view: PlayerView?
        defer {
            record("final", player: model.player)
            if model.log.contains(where: { $0.contains("Initial audio language unavailable") }) {
                record("initial audio unavailable", player: model.player)
            }
            if let data = try? JSONEncoder().encode(observations) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "native-track-observations.json"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
            view?.player = nil
            model.player.destroy()
            subscriptions.removeAll()
            players.cancel()
            window.isHidden = true
        }
        model.timeShiftEnabled = false
        var draft = model.configurationDraft
        draft.sourceURL = ProcessInfo.processInfo.environment["PLAYER_LAB_TEST_MEDIA_URL"]
            ?? "http://127.0.0.1:5284/vod-multiaudio/master.m3u8"
        draft.title = "Native initial track selection"
        draft.autoplay = true
        draft.startOffset = "5"
        draft.audioLanguage = "de-AT"
        draft.subtitleMode = .language
        draft.subtitleLanguage = "de"

        for scaling in VideoScaling.allCases {
            draft.videoScaling = scaling
            let previous = model.player
            let previousSource = model.player.source
            let beforeLoads = sourceLoads
            let effect = try model.apply(draft)
            if effect == .recreatePlayer {
                XCTAssertTrue(previous.isDestroyed)
                XCTAssertFalse(model.player === previous)
            }
            view?.player = nil
            view?.removeFromSuperview()
            // A square viewport makes aspect-ratio behavior visible with the 16:9 fixture.
            let nextView = PlayerView(player: model.player, frame: CGRect(x: 20, y: 20, width: 320, height: 320))
            controller.view.addSubview(nextView)
            nextView.layoutIfNeeded()
            view = nextView
            try await eventually("fresh finite HLS source and native selected languages") {
                self.sourceLoads > beforeLoads && model.player.duration.isFinite && model.player.duration > 59
                    && model.player.availableAudio.count >= 2 && model.player.availableSubtitles.count >= 2
                    && model.player.audio?.language == "de" && model.player.subtitle.language == "de"
            }
            if let previousSource { XCTAssertFalse(previousSource.isAttachedToPlayer) }
            XCTAssertEqual(nextView.scalingMode, scaling.sdkValue)
            XCTAssertEqual(model.player.config.styleConfig.scalingMode, scaling.sdkValue)
            XCTAssertFalse(model.timeShiftEnabled)
            try await progress(model.player, stage: scaling.rawValue) {
                model.player.audio?.language == "de" && model.player.subtitle.language == "de"
            }
            let layer = try XCTUnwrap(videoLayer(nextView.layer))
            XCTAssertTrue(layer.isReadyForDisplay)
            XCTAssertFalse(layer.videoRect.isEmpty)
            switch scaling {
            case .fit:
                XCTAssertEqual(layer.videoGravity, .resizeAspect)
                XCTAssertLessThan(layer.videoRect.height, layer.bounds.height - 20)
            case .fill:
                XCTAssertEqual(layer.videoGravity, .resizeAspectFill)
                XCTAssertEqual(layer.videoRect.width, layer.bounds.width, accuracy: 2)
                XCTAssertEqual(layer.videoRect.height, layer.bounds.height, accuracy: 2)
            case .stretch:
                XCTAssertEqual(layer.videoGravity, .resize)
                XCTAssertEqual(layer.videoRect.width, layer.bounds.width, accuracy: 2)
                XCTAssertEqual(layer.videoRect.height, layer.bounds.height, accuracy: 2)
            }
            attach(window, name: "Native scaling \(scaling.rawValue)")
        }

        // A later user/API selection is not overwritten on subsequent TimeChanged events.
        let englishAudio = try XCTUnwrap(model.player.availableAudio.first { $0.language == "en" })
        let englishSubtitle = try XCTUnwrap(model.player.availableSubtitles.first { $0.language == "en" })
        model.player.setAudio(trackIdentifier: englishAudio.identifier)
        model.player.setSubtitle(trackIdentifier: englishSubtitle.identifier)
        try await eventually("later selection remains available") {
            model.player.audio?.language == "en" && model.player.subtitle.language == "en"
        }
        try await progress(model.player, stage: "later manual choice") {
            model.player.audio?.language == "en" && model.player.subtitle.language == "en"
        }
        XCTAssertEqual(model.player.audio?.language, "en")
        XCTAssertEqual(model.player.subtitle.language, "en")

        // A title-only Apply reloads a new source on the same player and reapplies its preferences.
        let samePlayer = model.player
        let previousSource = model.player.source
        let beforeLoads = sourceLoads
        draft.title += " reloaded"
        XCTAssertEqual(try model.apply(draft), .reloadSource)
        XCTAssertTrue(model.player === samePlayer)
        try await eventually("same-player reload selects the preferred tracks") {
            self.sourceLoads > beforeLoads && model.player.audio?.language == "de"
                && model.player.subtitle.language == "de"
        }
        XCTAssertFalse(model.player.source === previousSource)
        XCTAssertFalse(try XCTUnwrap(previousSource).isAttachedToPlayer)
        try await progress(model.player, stage: "source-only reload") {
            model.player.audio?.language == "de" && model.player.subtitle.language == "de"
        }

        draft.subtitleMode = .off
        let beforeOff = sourceLoads
        XCTAssertEqual(try model.apply(draft), .reloadSource)
        try await eventually("subtitle Off source reaches actual playback") {
            self.sourceLoads > beforeOff && model.player.isPlaying && model.player.audio?.language == "de"
        }
        let item = try XCTUnwrap(videoLayer(try XCTUnwrap(view).layer)?.player?.currentItem)
        let loadedLegible = try await item.asset.loadMediaSelectionGroup(for: .legible)
        let legible = try XCTUnwrap(loadedLegible)
        XCTAssertGreaterThanOrEqual(legible.options.count, 2)
        try await eventually("subtitle Off clears the native legible-media selection") {
            item.currentMediaSelection.selectedMediaOption(in: legible) == nil
        }
        XCTAssertTrue(model.player === samePlayer)
        try await progress(model.player, stage: "subtitle Off") {
            model.player.audio?.language == "de" && item.currentMediaSelection.selectedMediaOption(in: legible) == nil
        }
        XCTAssertTrue(errors.isEmpty, "Player/Source error codes: \(errors)")
        print("Native initial-track qualification: source reload, player recreation, manual selection and subtitle Off passed")
    }

    private func observe(_ player: Player, model: PlayerModel) {
        observedModel = model
        errors.removeAll()
        player.events.on(SourceLoadedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self, weak model, weak player] event in
                guard let self, let model, let player, model.player === player,
                      player.source === event.source else { return }
                self.sourceLoads += 1
                self.record("SourceLoaded", player: player, emittedSource: event.source)
            }.store(in: &subscriptions)
        player.events.on(ReadyEvent.self)
            .compactMap { [weak player] _ in player?.source }.receive(on: DispatchQueue.main)
            .sink { [weak self, weak model, weak player] source in
                guard let model, let player, model.player === player, player.source === source else { return }
                self?.record("Ready", player: player, emittedSource: source)
            }.store(in: &subscriptions)
        player.events.on(AudioAddedEvent.self)
            .compactMap { [weak player] _ in player?.source }.receive(on: DispatchQueue.main)
            .sink { [weak self, weak model, weak player] source in
                guard let model, let player, model.player === player, player.source === source else { return }
                self?.record("AudioAdded", player: player, emittedSource: source)
            }.store(in: &subscriptions)
        player.events.on(AudioChangedEvent.self)
            .compactMap { [weak player] _ in player?.source }.receive(on: DispatchQueue.main)
            .sink { [weak self, weak model, weak player] source in
                guard let model, let player, model.player === player, player.source === source else { return }
                self?.record("AudioChanged", player: player, emittedSource: source)
            }.store(in: &subscriptions)
        player.events.on(SubtitleChangedEvent.self)
            .compactMap { [weak player] _ in player?.source }.receive(on: DispatchQueue.main)
            .sink { [weak self, weak model, weak player] source in
                guard let model, let player, model.player === player, player.source === source else { return }
                self?.record("SubtitleChanged", player: player, emittedSource: source)
            }.store(in: &subscriptions)
        player.events.on(PlayerErrorEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.errors.append($0.code.rawValue) }.store(in: &subscriptions)
        player.events.on(SourceErrorEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.errors.append($0.code.rawValue) }.store(in: &subscriptions)
    }

    private func progress(_ player: Player, stage: String, selected: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(40)
        var baseline: TimeInterval?
        while Date() < deadline {
            // Couple both current selections with real progress after the initial
            // seek. A transient language match or the zero-to-five seek is insufficient.
            if player.isPlaying && player.currentTime >= 5 && selected() {
                if let baseline, player.currentTime > baseline + 1 {
                    XCTAssertTrue(selected(), "Current audio/subtitle selection at playback completion")
                    record(stage + " after progress", player: player)
                    return
                } else if baseline == nil {
                    baseline = player.currentTime
                    record(stage + " before progress", player: player)
                }
            } else { baseline = nil }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Real playback with the expected current audio/subtitle selection must advance")
        throw QualificationFailure.deadline
    }

    private func record(_ stage: String, player: Player, emittedSource: Source? = nil) {
        observations.append(Observation(stage: stage, sourceLoads: sourceLoads,
            duration: player.duration.isFinite ? player.duration : nil,
            position: player.currentTime.isFinite ? player.currentTime : nil,
            live: player.isLive, playing: player.isPlaying,
            audioLanguages: player.availableAudio.compactMap(\.language),
            subtitleLanguages: player.availableSubtitles.compactMap(\.language),
            selectedAudio: player.audio?.language,
            selectedSubtitle: player.availableSubtitles.isEmpty ? nil : player.subtitle.language,
            selectedSubtitleLabel: player.availableSubtitles.isEmpty ? nil : player.subtitle.label,
            errorCodes: errors, timestamp: Date().timeIntervalSince1970,
            playerOwner: String(describing: ObjectIdentifier(player)),
            sourceOwner: player.source.map { String(describing: ObjectIdentifier($0)) },
            emittedSourceOwner: emittedSource.map { String(describing: ObjectIdentifier($0)) },
            audioIdentifiers: player.availableAudio.map(\.identifier),
            selectedAudioIdentifier: player.audio?.identifier,
            audioPreference: observedModel?.configurationDraft.audioLanguage,
            subtitlePreference: observedModel?.configurationDraft.subtitleMode.rawValue,
            recentLog: observedModel.map { Array($0.log.prefix(12)) } ?? []))
    }

    private func attachObservations(name: String) {
        if let data = try? JSONEncoder().encode(observations) {
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    private func videoLayer(_ layer: CALayer) -> AVPlayerLayer? {
        if let video = layer as? AVPlayerLayer, video.player?.currentItem != nil { return video }
        return layer.sublayers?.compactMap { videoLayer($0) }.first
    }

    private func attach(_ window: UIWindow, name: String) {
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func eventually(_ message: String, timeout: TimeInterval = 40,
                            _ condition: () throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try condition() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail(message)
        throw QualificationFailure.deadline
    }
    private enum QualificationFailure: Error { case deadline }
}
