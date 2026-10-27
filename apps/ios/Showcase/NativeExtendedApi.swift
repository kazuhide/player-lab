import Foundation
import UIKit
import AVFoundation
import Combine
import BitmovinPlayer

final class NativeApiObjects: ObservableObject {
    struct EnteredCue {
        weak var source: Source?
        let controller: SubtitleTrackController
        let cue: Cue
    }
    let thumbnailContainer = UIView(frame: CGRect(x: 0, y: 0, width: 320, height: 180))
    let adContainer = UIView()
    let presentationRegistration = NativePresentationRegistration()
    let consoleLogger = ConsoleLogger()
    @Published var showsThumbnailContainer = false
    private(set) var parsedCues: [Cue] = []
    private weak var parsedSource: Source?
    struct AcquiredLicense { weak var source: Source?; let request: FairplayContentKeyRequest }
    private(set) var acquiredLicenses: [AcquiredLicense] = []
    var enteredCues: [String: EnteredCue] = [:]
    struct OwnedSuspension {
        weak var player: Player?
        let suspension: any SharePlaySuspension
    }
    var sharePlaySuspensions: [OwnedSuspension] = []

    func retirePlayer(_ player: Player) {
        if !player.isDestroyed {
            for item in sharePlaySuspensions where item.player === player { player.sharePlay.endSuspension(item.suspension) }
        }
        sharePlaySuspensions.removeAll { $0.player == nil || $0.player === player }
    }

    func prepareSource(_ source: Source) {
        if parsedSource !== source { retireSource(); parsedSource = source }
    }
    func appendParsedCue(_ cue: Cue, source: Source) {
        prepareSource(source)
        parsedCues.insert(cue, at: 0)
        if parsedCues.count > 16 { parsedCues.removeLast(parsedCues.count - 16) }
    }
    func appendAcquiredLicense(_ request: FairplayContentKeyRequest, source: Source) {
        prepareSource(source)
        acquiredLicenses.insert(.init(source: source, request: request), at: 0)
        if acquiredLicenses.count > 16 { acquiredLicenses.removeLast(acquiredLicenses.count - 16) }
    }
    func retireSource() {
        acquiredLicenses.removeAll()
        enteredCues.removeAll()
        parsedCues.removeAll()
        parsedSource = nil
    }
}

extension ApiOperation {
    var extendedArguments: [ApiArgument] {
        let position = ApiArgument("time", "Position (seconds)", .number(minimum: 0))
        let cueNote = "Fields: startTime, endTime, html, text, rawText, attributedText (text or {string,fontSize,foregroundColor}), imageBase64, position:{column,row}, region, regionStyle and vttFromParsedCue (a current parsed-cue index). Image bytes are excluded from code. VTT properties come from real CueParsedEvent objects."
        switch self {
        case .renewFairplay: return [.init("index", "Acquired FairPlay request index on current source", .text, initial: "0", note: "Use an actual FairplayLicenseAcquiredEvent request shown in SDK state. Load licensed FairPlay content and enable event observation first. The app never constructs an AVContentKeyRequest.")]
        case .rotateView: return [.init("degrees", "Native PlayerView preview rotation (degrees)", .text, initial: "0", note: "Rotates the actual native PlayerView inside its host, calling willRotate before the transform and didRotate after layout. This changes the view preview, not the device orientation.")]
        case .sourceMetadata: return [.init("json", "Source metadata JSON (null clears)", .json(initial: "{}"), note: "Supports ordinary JSON and {$avMetadataItem: {...}} native metadata values using the same typed factory as SourceConfig.metadata.")]
        case .subtitleAdd: return [.init("json", "Subtitle object", .json(initial: "{\"identifier\":\"manual-example\",\"label\":\"Manual example\",\"url\":null,\"format\":\"webVtt\"}"), note: "Fields: url (null for manual cues), format, label, identifier, isDefaultTrack, language, associatedLanguage, characteristics and forced. The identifier must not already exist on the current source.")]
        case .cueEnter: return [.init("track", "Existing subtitle track identifier", .text), .init("json", "Cue object", .json(initial: "{\"startTime\":0,\"endTime\":5,\"text\":\"Example subtitle\"}"), note: cueNote)]
        case .cueExit: return [.init("track", "Identifier used by the last cueEnter for this source", .text)]
        case .sourceThumbnail, .legacyThumbnail: return [position]
        case .subtitleStyles, .viewSubtitleStyles:
            return [.init("json", "Subtitle style rules", .json(initial: "null"), note: "Enter null to restore defaults, [] for no rules, or an array of AVTextStyleRule text-markup attribute dictionaries.")]
        case .posterImage: return [.init("url", "Poster image URL", .url), .init("persistent", "Keep poster persistent", .boolean)]
        case .thumbnailContainer: return [.init("enabled", "Attach the visible thumbnail preview container", .boolean)]
        case .renderThumbnail, .renderSourceThumbnail:
            return (self == .renderSourceThumbnail ? [.init("index", "SDK playlist source index", .text, initial: "0")] : []) + [position,
                .init("before", "Tolerance before (seconds)", .number(minimum: 0)), .init("after", "Tolerance after (seconds)", .number(minimum: 0))]
        case .playerAdSchedule, .advertisingSchedule:
            return [.init("json", "Ad item", .json(initial: "{\"sources\":[{\"tag\":\"https://example.com/vast.xml\",\"type\":\"ima\"}],\"trigger\":{\"seconds\":10}}"), note: "Enter a real test ad URL before running. Fields match AdvertisingConfig.schedule: sources, trigger or position, and linearUi. Scheduling is distinct from an ad successfully loading or playing.")]
        case .playerAdContainer, .advertisingContainer:
            return [.init("x", "Container x (points)", .text, initial: "0"), .init("y", "Container y (points)", .text, initial: "0"),
                .init("width", "Container width (points)", .number(minimum: 1), initial: "320"), .init("height", "Container height (points)", .number(minimum: 1), initial: "180")]
        #if !os(tvOS)
        case .pipSkipControls, .hidePiPControls: return [.init("value", "Enabled", .boolean)]
        #endif
        default: return callbackArguments
        }
    }

    func extendedCode(_ values: [String: String], parsedCues: [Cue]) throws -> String {
        let json = values["json"] ?? "{}"
        let time = values["time"] ?? "0"
        let before = values["before"] ?? "0", after = values["after"] ?? "0"
        switch self {
        case .loadConfig: return "player.load(sourceConfig: sourceConfig)"
        case .renewFairplay:
            guard let index = Int(values["index"] ?? ""), index >= 0 else { throw invalidExtended("Enter a nonnegative acquired-request index.") }
            return "// Retain requests from the current source's actual FairplayLicenseAcquiredEvent.\n// Retire those requests when the source changes; never fabricate an AVContentKeyRequest.\nsource.drm.fairplay.renewExpiringLicense(for: acquiredRequests[\(index)])"
        case .rotateView:
            let angle = try Self.rotationAngle(values)
            return "playerView.willRotate()\nplayerView.transform = CGAffineTransform(rotationAngle: \(angle))\nplayerView.setNeedsLayout()\nplayerView.layoutIfNeeded()\nplayerView.didRotate()"
        case .layoutView: return "playerView.setNeedsLayout()\nplayerView.layoutIfNeeded() // UIKit invokes layoutSubviews on the actual view."

        case .sourceMetadata:
            let object = try JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
            guard object is NSNull || object is [String: Any] else { throw invalidExtended("Source metadata needs an object or null.") }
            return object is NSNull ? "player.source?.metadata = nil" : (try NativeMetadataDraft(json: json).code + ["player.source?.metadata = sourceMetadata.mapValues { $0 as AnyObject }"]).joined(separator: "\n")
        case .subtitleAdd: return "let track = \(try NativeSubtitleDraft.parse(json).code)\nplayer.addSubtitle(track: track)"
        case .cueEnter:
            let draft = try NativeCueDraft(json: json, parsedCues: parsedCues)
            return "let track = player.availableSubtitles.first { $0.identifier == \(swiftString(values["track"] ?? "")) }!\nlet enteredCue = \(draft.code)\ntrack.controller.cueEnter(enteredCue)\n// Retain this exact cue and controller for cueExit, and retire them when the source changes."
        case .cueExit: return "// Use the exact cue and controller retained by cueEnter on the current source.\ntrack.controller.cueExit(enteredCue)"
        case .sourceThumbnail: return "let thumbnail = player.source?.thumbnail(forTime: \(time))"
        case .legacyThumbnail: return "let thumbnail = player.thumbnail(forTime: \(time))"
        case .subtitleStyles, .viewSubtitleStyles:
            _ = try NativeCueDraft.styles(json)
            let receiver = self == .subtitleStyles ? "player" : "playerView"
            if json == "null" { return receiver + ".setSubtitleStyles(nil)" }
            return "let attributes = try! JSONSerialization.jsonObject(with: Data(\(swiftString(json)).utf8)) as! [[String: Any]]\nlet rules = attributes.compactMap { AVTextStyleRule(textMarkupAttributes: $0) }\n\(receiver).setSubtitleStyles(rules)"
        case .posterImage:
            guard !(values["url"] ?? "").isEmpty else { throw invalidExtended("Enter a poster image URL.") }
            return "playerView.setPosterImage(url: URL(string: \(swiftString(values["url"]!)))!, keepPersistent: \(values["persistent"] ?? "false"))"
        case .thumbnailContainer: return "player.thumbnails.container = \(values["enabled"] == "true" ? "thumbnailPreviewView" : "nil")"
        case .renderThumbnail: return "player.thumbnails.renderThumbnail(forTime: \(time), toleranceBefore: \(before), toleranceAfter: \(after))"
        case .renderSourceThumbnail:
            guard let index = Int(values["index"] ?? ""), index >= 0 else { throw invalidExtended("Enter a nonnegative source index.") }
            return "let source = player.playlist.sources[\(index)]\nplayer.thumbnails.renderThumbnail(for: source, time: \(time), toleranceBefore: \(before), toleranceAfter: \(after))"
        case .playerAdSchedule, .advertisingSchedule:
            guard let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { throw invalidExtended("An ad item needs a JSON object.") }
            return (try NativeAdItemDraft(object).code(name: "adItem") + [self == .playerAdSchedule ? "player.scheduleAd(adItem: adItem)" : "player.ads.schedule(adItem: adItem)"]).joined(separator: "\n")
        case .playerAdSkip: return "player.skipAd()"
        case .advertisingSkip: return "player.ads.skip()"
        case .playerAdContainer, .advertisingContainer:
            let frame = try Self.adContainerFrame(values)
            return "let adContainer = UIView(frame: CGRect(x: \(frame.origin.x), y: \(frame.origin.y), width: \(frame.width), height: \(frame.height)))\nplayerView.contentOverlay.view.addSubview(adContainer)\n" + (self == .playerAdContainer ? "player.registerAdContainer(adContainer)" : "player.ads.register(adContainer: adContainer)")
        case .imaClicked: return "// Use the actual manager received by onAdsManagerAvailable.\nadsManager.clicked()"
        case .imaDiscard: return "// Use the actual manager received by onAdsManagerAvailable.\nadsManager.discardAdBreak()"
        #if !os(tvOS)
        case .pipSkipControls: return "playerView.pictureInPicture.showSkipControls = \(values["value"] ?? "false")"
        case .hidePiPControls: return "playerView.tweaks.hidePlaybackControlsInPictureInPicture = \(values["value"] ?? "false")"
        #endif
        default: return try callbackCode(values)
        }
    }

    static func rotationAngle(_ values: [String: String]) throws -> Double {
        guard let degrees = Double(values["degrees"] ?? ""), degrees.isFinite else { throw ConfigurationValidationError(message: "Rotation must be finite degrees.") }
        return degrees.truncatingRemainder(dividingBy: 360) * .pi / 180
    }

    static func adContainerFrame(_ values: [String: String]) throws -> CGRect {
        guard let x = Double(values["x"] ?? ""), x.isFinite, let y = Double(values["y"] ?? ""), y.isFinite,
              let width = Double(values["width"] ?? ""), width.isFinite, width > 0,
              let height = Double(values["height"] ?? ""), height.isFinite, height > 0 else { throw ConfigurationValidationError(message: "The ad container needs finite coordinates and positive dimensions.") }
        return CGRect(x: x, y: y, width: width, height: height)
    }
    private func invalidExtended(_ message: String) -> ConfigurationValidationError { .init(message: message) }
}

extension PlayerModel {
    @MainActor
    func executeExtendedApi(_ operation: ApiOperation, arguments: [String: String]) throws -> String {
        let json = arguments["json"] ?? "{}"
        let time = Double(arguments["time"] ?? "0")!
        switch operation {
        case .loadConfig:
            try loadConfiguredSourceConfigFromApi()
        case .renewFairplay:
            guard let index = Int(arguments["index"] ?? ""), apiObjects.acquiredLicenses.indices.contains(index),
                  let source = player.source, apiObjects.acquiredLicenses[index].source === source else {
                throw apiInputError("Choose a retained FairplayLicenseAcquiredEvent request from the current source. Load licensed FairPlay content and enable event observation first.")
            }
            source.drm.fairplay.renewExpiringLicense(for: apiObjects.acquiredLicenses[index].request)
            return "Requested license renewal using the selected actual SDK request. Check FairPlay events for the result."
        case .rotateView:
            let view = try requireApiView()
            let angle = try ApiOperation.rotationAngle(arguments)
            view.willRotate()
            view.transform = CGAffineTransform(rotationAngle: angle)
            view.setNeedsLayout(); view.layoutIfNeeded()
            view.didRotate()
            return "Rotated the current native PlayerView preview; SDK willRotate/didRotate bracketed actual view layout. Device orientation was not changed."
        case .layoutView:
            let view = try requireApiView(); view.setNeedsLayout(); view.layoutIfNeeded()
            return "Requested and performed layout on the current native PlayerView. UIKit owns layoutSubviews dispatch."
        case .sourceMetadata:
            guard let source = player.source else { throw apiInputError("Load a source first.") }
            let object = try JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
            if object is NSNull { source.metadata = nil }
            else if object is [String: Any] { source.metadata = try NativeMetadataDraft(json: json).values.mapValues { $0 as AnyObject } }
            else { throw apiInputError("Source metadata needs an object or null.") }
        case .subtitleAdd:
            guard player.source != nil else { throw apiInputError("Load a source first.") }
            let draft = try NativeSubtitleDraft.parse(json)
            guard !player.availableSubtitles.contains(where: { $0.identifier == draft.identifier }) else { throw apiInputError("A subtitle track with this identifier already exists.") }
            player.addSubtitle(track: draft.make())
        case .cueEnter:
            guard let source = player.source,
                  let track = player.availableSubtitles.first(where: { $0.identifier == arguments["track"] }) else { throw apiInputError("Choose an existing subtitle track on the current source.") }
            let draft = try NativeCueDraft(json: json, parsedCues: apiObjects.parsedCues)
            apiObjects.prepareSource(source)
            if let previous = apiObjects.enteredCues[track.identifier], previous.source === source { previous.controller.cueExit(previous.cue) }
            track.controller.cueEnter(draft.cue)
            apiObjects.enteredCues[track.identifier] = .init(source: source, controller: track.controller, cue: draft.cue)
        case .cueExit:
            guard let id = arguments["track"], let entered = apiObjects.enteredCues[id], entered.source === player.source else { throw apiInputError("Enter a cue on the current source before exiting it.") }
            entered.controller.cueExit(entered.cue)
            apiObjects.enteredCues.removeValue(forKey: id)
        case .sourceThumbnail:
            guard let source = player.source else { throw apiInputError("Load a source first.") }
            return source.thumbnail(forTime: time) == nil ? "The SDK returned no source thumbnail at this position." : "The SDK returned a source thumbnail."
        case .legacyThumbnail: return player.thumbnail(forTime: time) == nil ? "The SDK returned no player thumbnail at this position." : "The SDK returned a player thumbnail."
        case .subtitleStyles: player.setSubtitleStyles(try NativeCueDraft.styles(json))
        case .viewSubtitleStyles: try requireApiView().setSubtitleStyles(NativeCueDraft.styles(json))
        case .posterImage:
            guard let url = arguments["url"].flatMap(URL.init(string:)), !(arguments["url"] ?? "").isEmpty else { throw apiInputError("Enter a poster image URL.") }
            try requireApiView().setPosterImage(url: url, keepPersistent: arguments["persistent"] == "true")
        case .thumbnailContainer:
            let enabled = arguments["enabled"] == "true"
            player.thumbnails.container = enabled ? apiObjects.thumbnailContainer : nil
            apiObjects.showsThumbnailContainer = enabled
        case .renderThumbnail:
            player.thumbnails.renderThumbnail(forTime: time, toleranceBefore: Double(arguments["before"]!)!, toleranceAfter: Double(arguments["after"]!)!)
        case .renderSourceThumbnail:
            guard let index = Int(arguments["index"] ?? ""), player.playlist.sources.indices.contains(index) else { throw apiInputError("Choose an existing SDK playlist source index.") }
            player.thumbnails.renderThumbnail(for: player.playlist.sources[index], time: time, toleranceBefore: Double(arguments["before"]!)!, toleranceAfter: Double(arguments["after"]!)!)
        case .playerAdSchedule, .advertisingSchedule:
            guard let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { throw apiInputError("An ad item needs a JSON object.") }
            let item = try NativeAdItemDraft(object).make()
            if operation == .playerAdSchedule { player.scheduleAd(adItem: item) } else { player.ads.schedule(adItem: item) }
        case .playerAdSkip: player.skipAd()
        case .advertisingSkip: player.ads.skip()
        case .playerAdContainer, .advertisingContainer:
            let frame = try ApiOperation.adContainerFrame(arguments)
            let view = try requireApiView()
            let container = apiObjects.adContainer
            container.frame = frame
            if container.superview !== view.contentOverlay.view { container.removeFromSuperview(); view.contentOverlay.view.addSubview(container) }
            if operation == .playerAdContainer { player.registerAdContainer(container) } else { player.ads.register(adContainer: container) }
        case .imaClicked, .imaDiscard:
            guard let manager = playerCallbackJournal.adsManager else { throw apiInputError("Load an IMA ad first and wait for onAdsManagerAvailable. No manager is fabricated by the inspector.") }
            if operation == .imaClicked { manager.clicked() } else { manager.discardAdBreak() }
        #if !os(tvOS)
        case .pipSkipControls: try requireApiView().pictureInPicture.showSkipControls = arguments["value"] == "true"
        case .hidePiPControls: try requireApiView().tweaks.hidePlaybackControlsInPictureInPicture = arguments["value"] == "true"
        #endif
        default: return try executeCallbackApi(operation, arguments: arguments)
        }
        return operation.rawValue + " invoked. Inspect actual SDK state and events for completion."
    }
    private func apiInputError(_ message: String) -> ConfigurationValidationError { .init(message: message) }
}
