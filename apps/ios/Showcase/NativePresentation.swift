import SwiftUI
import AVKit
import BitmovinPlayer

enum NativePresentation: String, CaseIterable, Identifiable {
    case sdkSwiftUI = "SDK SwiftUI"
    case sdkBindings = "SDK SwiftUI with bindings"
    case playerView = "Native PlayerView"
    case playerLayer = "AVPlayerLayer"
    case playerController = "AVPlayerViewController"
    var id: String { rawValue }
}

struct NativePresentationSurface: View {
    @ObservedObject var model: PlayerModel
    var body: some View {
        Group {
            switch model.presentation {
            case .sdkSwiftUI: VideoPlayerView(player: model.player, playerViewConfig: model.makePlayerViewConfig())
            case .sdkBindings: NativeBindingSurface(model: model)
            case .playerView: NativePlayerSurface(model: model)
            case .playerLayer: NativeLayerSurface(model: model)
            case .playerController: NativeControllerSurface(model: model)
            }
        }
        .id(model.playerGeneration)
    }
}

/// The owner identity prevents an old SwiftUI dismantle from unregistering a new player's surface.
final class NativePresentationRegistration {
    private(set) weak var player: Player?
    private(set) weak var layer: AVPlayerLayer?
    private(set) weak var controller: AVPlayerViewController?

    func attach(_ layer: AVPlayerLayer, to player: Player) {
        retire()
        self.player = player; self.layer = layer
        player.register(layer)
    }
    func attach(_ controller: AVPlayerViewController, to player: Player) {
        retire()
        self.player = player; self.controller = controller
        player.register(controller)
    }
    func detach(_ layer: AVPlayerLayer, from player: Player) {
        guard self.layer === layer, self.player === player else { return }
        retire()
    }
    func detach(_ controller: AVPlayerViewController, from player: Player) {
        guard self.controller === controller, self.player === player else { return }
        retire()
    }
    func retire() {
        if let player, !player.isDestroyed {
            if let layer { player.unregisterPlayerLayer(layer) }
            if let controller { player.unregisterPlayerViewController(controller) }
        }
        layer = nil; controller = nil; player = nil
    }
}

struct NativeLayerSurface: UIViewRepresentable {
    @ObservedObject var model: PlayerModel
    func makeCoordinator() -> Coordinator { Coordinator(player: model.player, registration: model.apiObjects.presentationRegistration) }
    func makeUIView(context: Context) -> NativeVideoLayerView {
        let view = NativeVideoLayerView()
        context.coordinator.registration.attach(view.videoLayer, to: context.coordinator.player)
        return view
    }
    func updateUIView(_ view: NativeVideoLayerView, context: Context) {
        view.videoLayer.videoGravity = model.boundScalingMode == .zoom ? .resizeAspectFill : model.boundScalingMode == .stretch ? .resize : .resizeAspect
    }
    static func dismantleUIView(_ view: NativeVideoLayerView, coordinator: Coordinator) { coordinator.registration.detach(view.videoLayer, from: coordinator.player) }
    final class Coordinator {
        let player: Player
        let registration: NativePresentationRegistration
        init(player: Player, registration: NativePresentationRegistration) { self.player = player; self.registration = registration }
    }
}

final class NativeVideoLayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var videoLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

struct NativeControllerSurface: UIViewControllerRepresentable {
    @ObservedObject var model: PlayerModel
    func makeCoordinator() -> NativeLayerSurface.Coordinator { .init(player: model.player, registration: model.apiObjects.presentationRegistration) }
    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        context.coordinator.registration.attach(controller, to: context.coordinator.player)
        return controller
    }
    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        controller.showsPlaybackControls = model.nativeControlsShown
        controller.videoGravity = model.boundScalingMode == .zoom ? .resizeAspectFill : model.boundScalingMode == .stretch ? .resize : .resizeAspect
    }
    static func dismantleUIViewController(_ controller: AVPlayerViewController, coordinator: NativeLayerSurface.Coordinator) { coordinator.registration.detach(controller, from: coordinator.player) }
}

struct NativeBindingSurface: View {
    @ObservedObject var model: PlayerModel
    private var configuredView: VideoPlayerView {
        let view = VideoPlayerView(player: model.player, playerViewConfig: model.makePlayerViewConfig())
            .isPictureInPictureEnabled($model.boundPiPEnabled)
            .isPictureInPictureAvailable($model.boundPiPAvailable)
            .isPictureInPictureActive($model.boundPiPActive)
            .scalingMode($model.boundScalingMode)
        #if os(tvOS)
        return view
        #else
        return view.showSkipControlsInPictureInPicture($model.boundPiPSkipControls)
        #endif
    }
    var body: some View { configuredView.body }
}

extension NativePresentation {
    var code: String {
        switch self {
        case .sdkSwiftUI: return "VideoPlayerView(player: player, playerViewConfig: playerViewConfig)"
        case .sdkBindings:
            var text = "VideoPlayerView(player: player, playerViewConfig: playerViewConfig)\n    .isPictureInPictureEnabled($isPiPEnabled)\n    .isPictureInPictureAvailable($isPiPAvailable)\n    .isPictureInPictureActive($isPiPActive)\n    .scalingMode($scalingMode)"
            #if !os(tvOS)
            text += "\n    .showSkipControlsInPictureInPicture($showSkipControls)"
            #endif
            return text
        case .playerView: return "let view = PlayerView(player: player, frame: .zero, playerViewConfig: playerViewConfig)\n// Retain your FullscreenHandler while it is assigned to the view."
        case .playerLayer: return "let layer = AVPlayerLayer()\nplayer.register(layer)\n// Add the layer to your visible view and update its frame during layout.\n// Before retiring this same player/layer pair:\nplayer.unregisterPlayerLayer(layer)"
        case .playerController: return "let controller = AVPlayerViewController()\nplayer.register(controller)\n// Embed the controller using UIViewController containment.\n// Before retiring this same player/controller pair:\nplayer.unregisterPlayerViewController(controller)"
        }
    }
}
