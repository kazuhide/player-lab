import Foundation
import BitmovinPlayer

struct ApiArgument: Identifiable {
    let id: String
    let label: String
    let input: ConfigurationInput
    let initial: String
    init(_ id: String, _ label: String, _ input: ConfigurationInput, initial: String? = nil) {
        self.id = id; self.label = label; self.input = input; self.initial = initial ?? input.initial
    }
}

enum ApiOperation: String, CaseIterable, Identifiable {
    case play = "Player.play()", pause = "Player.pause()"
    case mute = "Player.mute()", unmute = "Player.unmute()"
    case unload = "Player.unload()", reload = "Player.load(source:)"
    case destroyAndRecreate = "Player.destroy() and recreate"
    case seek = "Player.seek(time:)", timeShift = "Player.timeShift"
    case volume = "Player.volume", speed = "Player.playbackSpeed"
    case bitrate = "Player.maxSelectableBitrate"
    case audio = "Player.setAudio(trackIdentifier:)", subtitle = "Player.setSubtitle(trackIdentifier:)"
    case removeSubtitle = "Player.removeSubtitle(trackIdentifier:)"
    case canPlay = "Player.canPlay(atPlaybackSpeed:)"
    case currentTime = "Player.currentTime(_:)"
    case bufferLevel = "BufferApi.getLevel(_:)", bufferTarget = "BufferApi.setTargetLevel(_:)"
    case nowPlaying = "NowPlayingApi.isEnabled"
    case sourceLatency = "SourceLatencyApi.automaticallyPreservesLatency"
    case allowsAirPlay = "Player.allowsAirPlay", airPlayPicker = "Player.showAirPlayTargetPicker()"
    case cast = "RemoteControlApi.castVideo()", stopCast = "RemoteControlApi.castStop()"
    case thumbnail = "ThumbnailsApi.thumbnail(forTime:)"
    case cancelThumbnails = "ThumbnailsApi.cancelPendingRenderRequests()"
    case thumbnailMode = "ThumbnailsApi.renderingMode"
    case enterFullscreen = "UserInterfaceApi.enterFullscreen()", exitFullscreen = "UserInterfaceApi.exitFullscreen()"
    case enterPiP = "UserInterfaceApi.enterPictureInPicture()", exitPiP = "UserInterfaceApi.exitPictureInPicture()"
    case viewScaling = "UserInterfaceApi.scalingMode", enablePiP = "PictureInPictureApi.isEnabled"

    var id: String { rawValue }

    var arguments: [ApiArgument] {
        switch self {
        case .seek: return [.init("value", "Position (seconds)", .number(minimum: 0))]
        case .timeShift: return [.init("value", "Offset from live edge (seconds; zero or negative)", .text, initial: "0")]
        case .volume: return [.init("value", "Volume (whole number, 0–100)", .number(minimum: 0), initial: "0")]
        case .speed, .canPlay: return [.init("value", "Playback speed", .number(minimum: 0), initial: "1")]
        case .bitrate: return [.init("value", "Maximum bitrate (whole bit/s; 0 is unlimited)", .text, initial: "0")]
        case .audio, .removeSubtitle: return [.init("value", "Track identifier", .text)]
        case .subtitle: return [.init("value", "Track identifier (empty turns subtitles off)", .text)]
        case .currentTime: return [.init("value", "Time mode", .choice(["relativeTime", "absoluteTime"]))]
        case .bufferLevel: return [.init("value", "Buffer type", .choice(["forwardDuration", "backwardDuration"]))]
        case .bufferTarget: return [.init("value", "Forward buffer target (seconds)", .number(minimum: 0))]
        case .nowPlaying, .sourceLatency, .allowsAirPlay, .enablePiP:
            return [.init("value", "Enabled", .boolean)]
        case .thumbnail: return [.init("value", "Position (seconds)", .number(minimum: 0))]
        case .thumbnailMode: return [.init("value", "Rendering mode", .choice(["automatic", "trickPlay"]))]
        case .viewScaling: return [.init("value", "Scaling mode", .choice(["fit", "zoom", "stretch"]))]
        default: return []
        }
    }

    func validated(_ values: [String: String]) throws -> [String: String] {
        var parsed: [String: String] = [:]
        for argument in arguments {
            parsed[argument.id] = try argument.input.validate(values[argument.id] ?? argument.initial, field: argument.label)
        }
        let value = parsed["value"] ?? ""
        switch self {
        case .timeShift:
            guard let offset = Double(value), offset.isFinite, offset <= 0 else { throw invalid("Time shift must be finite and zero or negative seconds.") }
            parsed["value"] = String(offset)
        case .volume:
            guard let volume = Double(value), volume.rounded() == volume, (0...100).contains(volume) else { throw invalid("Volume must be a whole number from 0 through 100.") }
        case .bitrate:
            guard UInt(value) != nil else { throw invalid("Maximum bitrate must be a nonnegative UInt in bit/s.") }
        case .speed, .canPlay:
            guard let speed = Float(value), speed.isFinite, speed > 0 else { throw invalid("Playback speed must be a finite positive Float.") }
        case .audio, .removeSubtitle:
            guard !value.isEmpty else { throw invalid("A track identifier is required.") }
        default: break
        }
        return parsed
    }

    private func invalid(_ message: String) -> ConfigurationValidationError { .init(message: message) }

    func code(arguments: [String: String]) throws -> String {
        let arguments = try validated(arguments)
        let value = arguments["value"] ?? ""
        let literal = swiftString(value)
        switch self {
        case .play: return "player.play()"
        case .pause: return "player.pause()"
        case .mute: return "player.mute()"
        case .unmute: return "player.unmute()"
        case .unload: return "player.unload()"
        case .reload: return "let source = SourceFactory.createSource(from: sourceConfig)\nplayer.load(source: source)"
        case .destroyAndRecreate: return "player.destroy()\n// Create a replacement player and attach its view before reloading the source.\nlet player = PlayerFactory.createPlayer(playerConfig: playerConfig)"
        case .seek: return "player.seek(time: \(value))"
        case .timeShift: return "player.timeShift = \(value)"
        case .volume: return "player.volume = \(Int(Double(value)!))"
        case .speed: return "let speed: Float = \(value)\nif player.canPlay(atPlaybackSpeed: speed) { player.playbackSpeed = speed }"
        case .bitrate: return "player.maxSelectableBitrate = \(value)"
        case .audio: return "player.setAudio(trackIdentifier: \(literal))"
        case .subtitle: return "player.setSubtitle(trackIdentifier: \(value.isEmpty ? "nil" : literal))"
        case .removeSubtitle: return "player.removeSubtitle(trackIdentifier: \(literal))"
        case .canPlay: return "let canPlay = player.canPlay(atPlaybackSpeed: \(value))"
        case .currentTime: return "let time = player.currentTime(.\(value))"
        case .bufferLevel: return "let level = player.buffer.getLevel(.\(value))"
        case .bufferTarget: return "player.buffer.setTargetLevel(\(value))"
        case .nowPlaying: return "player.nowPlaying.isEnabled = \(value)"
        case .sourceLatency: return "player.source?.latency.automaticallyPreservesLatency = \(value)"
        case .allowsAirPlay: return "player.allowsAirPlay = \(value)"
        case .airPlayPicker: return "player.showAirPlayTargetPicker()"
        case .cast: return "player.castVideo()"
        case .stopCast: return "player.castStop()"
        case .thumbnail: return "let thumbnail = player.thumbnails.thumbnail(forTime: \(value))"
        case .cancelThumbnails: return "player.thumbnails.cancelPendingRenderRequests()"
        case .thumbnailMode: return "player.thumbnails.renderingMode = .\(value)"
        case .enterFullscreen: return "playerView.enterFullscreen()"
        case .exitFullscreen: return "playerView.exitFullscreen()"
        case .enterPiP: return "playerView.enterPictureInPicture()"
        case .exitPiP: return "playerView.exitPictureInPicture()"
        case .viewScaling: return "playerView.scalingMode = .\(value)"
        case .enablePiP: return "playerView.pictureInPicture.isEnabled = \(value)"
        }
    }
}

extension PlayerModel {
    @MainActor
    func executeApi(_ operation: ApiOperation, arguments: [String: String]) throws {
        let arguments = try operation.validated(arguments)
        let value = arguments["value"] ?? ""
        let player = self.player
        guard !player.isDestroyed else { throw ConfigurationValidationError(message: "Create a player before invoking this API.") }
        var result = operation.rawValue + " invoked. Inspect the state and event log for SDK completion."
        switch operation {
        case .play: player.play()
        case .pause: player.pause()
        case .mute: player.mute()
        case .unmute: player.unmute()
        case .unload: unloadFromApi()
        case .reload: reloadFromApi()
        case .destroyAndRecreate: recreateFromApi()
        case .seek: player.seek(time: Double(value)!)
        case .timeShift: player.timeShift = Double(value)!
        case .volume: player.volume = Int(Double(value)!)
        case .speed:
            let speed = Float(value)!
            guard player.canPlay(atPlaybackSpeed: speed) else { throw ConfigurationValidationError(message: "The SDK reports that this playback speed is unavailable for the current content.") }
            player.playbackSpeed = speed
        case .bitrate: player.maxSelectableBitrate = UInt(value)!
        case .audio: player.setAudio(trackIdentifier: value)
        case .subtitle: player.setSubtitle(trackIdentifier: value.isEmpty ? nil : value)
        case .removeSubtitle: player.removeSubtitle(trackIdentifier: value)
        case .canPlay: result = "canPlay: \(player.canPlay(atPlaybackSpeed: Float(value)!))"
        case .currentTime: result = "currentTime: \(player.currentTime(value == "relativeTime" ? .relativeTime : .absoluteTime)) seconds"
        case .bufferLevel:
            let level = player.buffer.getLevel(value == "forwardDuration" ? .forwardDuration : .backwardDuration)
            result = "Buffer level: \(level.level)s; target: \(level.targetLevel)s"
        case .bufferTarget: player.buffer.setTargetLevel(Double(value)!)
        case .nowPlaying: player.nowPlaying.isEnabled = value == "true"
        case .sourceLatency:
            guard let source = player.source else { throw ConfigurationValidationError(message: "Load a source first.") }
            source.latency.automaticallyPreservesLatency = value == "true"
        case .allowsAirPlay: player.allowsAirPlay = value == "true"
        case .airPlayPicker: player.showAirPlayTargetPicker()
        case .cast: player.castVideo()
        case .stopCast: player.castStop()
        case .thumbnail: result = player.thumbnails.thumbnail(forTime: Double(value)!) == nil ? "No thumbnail at this position. Configure a thumbnail track or rendering workflow." : "Thumbnail available at the requested position."
        case .cancelThumbnails: player.thumbnails.cancelPendingRenderRequests()
        case .thumbnailMode: player.thumbnails.renderingMode = value == "automatic" ? .automatic : .trickPlay
        case .enterFullscreen: try requireApiView().enterFullscreen()
        case .exitFullscreen: try requireApiView().exitFullscreen()
        case .enterPiP: try requireApiView().enterPictureInPicture()
        case .exitPiP: try requireApiView().exitPictureInPicture()
        case .viewScaling:
            try requireApiView().scalingMode = value == "fit" ? .fit : value == "zoom" ? .zoom : .stretch
        case .enablePiP: try requireApiView().pictureInPicture.isEnabled = value == "true"
        }
        setApiResult(result)
        refreshApiState()
    }

    @MainActor
    private func requireApiView() throws -> PlayerView {
        guard let view = apiPlayerView, view.player === player else {
            throw ConfigurationValidationError(message: "Enable the native PlayerView host before invoking a view API.")
        }
        return view
    }
}
