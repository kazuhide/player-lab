import SwiftUI
import BitmovinPlayer

enum NativeHostSetting: String, CaseIterable, Identifiable {
    case factory = "Player factory", presentation = "Presentation", nativeHost = "Native PlayerView host"
    case pictureInPicture = "Picture-in-Picture", scaling = "Scaling mode", controls = "AVKit controls", code = "Presentation code"
    var id: String { rawValue }
}

/// Host and factory choices are integration settings, separate from SDK operations.
struct NativeApiHostSettings: View {
    @ObservedObject var model: PlayerModel
    @Binding var setting: NativeHostSetting

    private var settings: [NativeHostSetting] {
        NativeHostSetting.allCases.filter {
            switch $0 {
            case .pictureInPicture: return model.presentation == .sdkBindings
            case .scaling: return [.sdkBindings, .playerLayer, .playerController].contains(model.presentation)
            case .controls: return model.presentation == .playerController
            default: return true
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            WorkspaceChoice(title: "Host setting", selection: $setting, options: settings, label: { $0.rawValue })
            .accessibilityIdentifier("api.host.setting")
            if setting == .code {
                WorkspaceCode(code: model.presentation.code + "\n\n" + model.nativePlayerFactory.code, identifier: "api.host.code")
            } else {
                ScrollView {
                    WorkspaceCard {
                        switch setting {
                        case .factory:
                            Picker("Player factory", selection: Binding(get: { model.nativePlayerFactory }, set: { model.setNativePlayerFactory($0) })) {
                                ForEach(NativePlayerFactory.allCases) { Text(LocalizedStringKey($0.rawValue)).tag($0) }
                            }
                            .accessibilityIdentifier("api.factory")
                            Text(LocalizedStringKey(model.nativePlayerFactory.rawValue)).font(.subheadline)
                            Text("Recreates the player and reloads the source immediately.")
                                .font(.caption).foregroundStyle(Color.workspaceSecondary)
                        case .presentation:
                            Picker("Presentation", selection: Binding(get: { model.presentation }, set: { model.setPresentation($0) })) {
                                ForEach(NativePresentation.allCases) { Text(LocalizedStringKey($0.rawValue)).tag($0) }
                            }
                            .accessibilityIdentifier("api.presentation")
                            Text(LocalizedStringKey(model.presentation.rawValue)).font(.subheadline)
                            Text("Recreates the player and reloads the source immediately.")
                                .font(.caption).foregroundStyle(Color.workspaceSecondary)
                        case .nativeHost:
                            Toggle("Use native PlayerView host", isOn: Binding(get: { model.usesNativeApiHost }, set: { model.setNativeApiHost($0) }))
                                .accessibilityIdentifier("api.nativeHost")
                            Text("Reloads the source immediately.")
                                .font(.caption).foregroundStyle(Color.workspaceSecondary)
                        case .pictureInPicture:
                            Toggle("Picture-in-Picture enabled", isOn: $model.boundPiPEnabled)
                            Toggle("Picture-in-Picture active", isOn: $model.boundPiPActive)
                            Text("SDK Picture-in-Picture availability: \(model.boundPiPAvailable)")
                                .font(.caption)
                            #if !os(tvOS)
                            Toggle("Show Picture-in-Picture skip controls", isOn: $model.boundPiPSkipControls)
                            #endif
                        case .scaling:
                            Picker("Scaling mode", selection: $model.boundScalingMode) {
                                Text("Fit").tag(ScalingMode.fit)
                                Text("Zoom").tag(ScalingMode.zoom)
                                Text("Stretch").tag(ScalingMode.stretch)
                            }
                        case .controls: Toggle("Show AVKit playback controls", isOn: $model.nativeControlsShown)
                        case .code: EmptyView()
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onChange(of: model.presentation) { _ in
            if !settings.contains(setting) { setting = .presentation }
        }
    }
}

enum NativeApiGroup: String, CaseIterable, Identifiable {
    case all = "All features", playback = "Playback", source = "Source and tracks"
    case view = "View and UI", buffer = "Quality and buffer", ads = "Advertising"
    case remote = "Cast and SharePlay", diagnostics = "Diagnostics"
    var id: String { rawValue }

    func contains(_ operation: ApiOperation) -> Bool {
        self == .all || operation.workspaceGroup == self
    }
}

extension ApiOperation {
    var workspaceGroup: NativeApiGroup {
        let name = rawValue.lowercased()
        if ["advertis", "aditem", "adcontainer", "skipad", "ima", "interstitial", "macro", "trackingregistry"].contains(where: name.contains) { return .ads }
        if ["cast", "remotecontrol", "caf", "shareplay", "airplay"].contains(where: name.contains) { return .remote }
        if ["buffer", "bitrate"].contains(where: name.contains) { return .buffer }
        if ["userinterface", "playerview", "pictureinpicture", "thumbnail", "systemui", "custommessage"].contains(where: name.contains) { return .view }
        if ["source", "subtitle", "audio", "cue", "fairplay", "load("].contains(where: name.contains) { return .source }
        if name.contains("logger") { return .diagnostics }
        return .playback
    }

    var relatedStateIDs: [String] {
        switch self {
        case .play, .pause: return ["Player.isPlaying", "Player.isPaused", "Player.currentTime"]
        case .mute, .unmute: return ["Player.isMuted", "Player.volume"]
        case .volume: return ["Player.volume", "Player.isMuted"]
        case .seek, .currentTime: return ["Player.currentTime", "Player.duration"]
        case .timeShift: return ["Player.timeShift", "Player.maxTimeShift", "Player.isLive"]
        case .speed, .canPlay: return ["Player.playbackSpeed", "Player.isPlaying"]
        case .audio: return ["Player.audio", "Player.availableAudio"]
        case .subtitle, .removeSubtitle, .subtitleAdd: return ["Player.subtitle", "Player.availableSubtitles"]
        case .bitrate: return ["Player.maxSelectableBitrate", "Player.videoPlaybackQuality"]
        case .bufferLevel, .bufferTarget: return ["Player.buffer"]
        default:
            switch workspaceGroup {
            case .ads: return ["AdvertisingApi.activeAd", "AdvertisingApi.activeAdBreak", "AdvertisingApi.schedule"]
            case .remote: return ["RemoteControlApi.isCasting", "SharePlayApi.isInGroupSession"]
            case .source: return ["Player.isLive", "Player.duration", "Player.currentTime"]
            case .view: return ["Presentation.host", "Player.isPlaying"]
            default: return ["Player.isPlaying", "Player.isPaused", "Player.currentTime"]
            }
        }
    }
}

extension ApiOperation {
    var displayName: String {
        switch self {
        case .play: return "Play"
        case .pause: return "Pause"
        case .mute: return "Mute"
        case .unmute: return "Unmute"
        case .unload: return "Unload source"
        case .reload: return "Reload source"
        case .destroyAndRecreate: return "Recreate player"
        case .seek: return "Seek"
        case .timeShift: return "Live offset"
        case .volume: return "Volume"
        case .speed: return "Playback speed"
        case .bitrate: return "Maximum bitrate"
        case .audio: return "Select audio"
        case .subtitle: return "Select subtitles"
        case .removeSubtitle: return "Remove subtitle"
        case .canPlay: return "Check playback speed"
        case .currentTime: return "Read playback position"
        case .bufferLevel: return "Read buffer level"
        case .bufferTarget: return "Set buffer target"
        case .nowPlaying: return "Now Playing"
        case .sourceLatency: return "Preserve live latency"
        case .allowsAirPlay: return "Allow AirPlay"
        case .airPlayPicker: return "Choose AirPlay device"
        case .cast: return "Start casting"
        case .stopCast: return "Stop casting"
        case .thumbnail: return "Find thumbnail"
        case .cancelThumbnails: return "Cancel thumbnails"
        case .thumbnailMode: return "Thumbnail mode"
        case .enterFullscreen: return "Enter fullscreen"
        case .exitFullscreen: return "Exit fullscreen"
        case .enterPiP: return "Enter Picture-in-Picture"
        case .exitPiP: return "Exit Picture-in-Picture"
        case .viewScaling: return "View scaling"
        case .enablePiP: return "Enable Picture-in-Picture"
        case .loadConfig: return "Load source configuration"
        case .renewFairplay: return "Renew FairPlay license"
        case .rotateView: return "Notify view rotation"
        case .layoutView: return "Layout player view"
        case .sourceMetadata: return "Source metadata"
        case .subtitleAdd: return "Add subtitle"
        case .cueEnter: return "Enter subtitle cue"
        case .cueExit: return "Exit subtitle cue"
        case .sourceThumbnail: return "Find source thumbnail"
        case .legacyThumbnail: return "Find legacy thumbnail"
        case .subtitleStyles: return "Player subtitle styles"
        case .viewSubtitleStyles: return "View subtitle styles"
        case .posterImage: return "Set poster image"
        case .thumbnailContainer: return "Thumbnail container"
        case .renderThumbnail: return "Render thumbnail"
        case .renderSourceThumbnail: return "Render source thumbnail"
        case .playerAdSchedule: return "Schedule player ad"
        case .advertisingSchedule: return "Schedule advertising ad"
        case .playerAdSkip: return "Skip player ad"
        case .advertisingSkip: return "Skip advertising ad"
        case .playerAdContainer: return "Player ad container"
        case .advertisingContainer: return "Advertising container"
        case .imaClicked: return "Notify IMA ad click"
        case .imaDiscard: return "Discard IMA ad break"
        case .macroPreview: return "Preview VAST macros"
        case .interstitialMacroPreview: return "Preview interstitial macros"
        case .trackingRegister: return "Register tracking event"
        case .trackingRegisterMultiple: return "Register tracking events"
        case .trackingQuery: return "Read tracking events"
        case .sharePlayBegin: return "Suspend SharePlay"
        case .sharePlayEnd: return "Resume SharePlay"
        case .sharePlayEndAt: return "Resume at proposed time"
        case .loggerLog: return "Send logger message"
        case .consoleLoggerLog: return "Send console message"
        case .remoteConfigPreview: return "Prepare remote source"
        case .cafWidevine: return "Widevine CAF settings"
        case .cafPlayReady: return "PlayReady CAF settings"
        case .cafClearKey: return "ClearKey CAF settings"
        #if os(tvOS)
        case .tvMenu: return "TV transport menu"
        case .tvContextActions: return "TV contextual actions"
        case .tvInfoActions: return "TV info actions"
        case .tvInfoControllers: return "TV info controllers"
        case .tvMarkers: return "Source markers"
        #else
        case .messageSend: return "Send UI message"
        case .messageSendWithData: return "Send UI message and data"
        case .pipSkipControls: return "Picture-in-Picture skips"
        case .hidePiPControls: return "Hide PiP controls"
        #endif
        }
    }
}
