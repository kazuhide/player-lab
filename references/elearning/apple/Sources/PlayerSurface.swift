import SwiftUI
import AVKit
import BitmovinPlayer

/// Retire the old view first. Switching controls never loads another source.
struct PlayerSurface: UIViewControllerRepresentable {
    let player: Player
    let standardControls: Bool
    let isFullscreen: Bool
    let toggleFullscreen: () -> Void

    func makeUIViewController(context: Context) -> SurfaceController {
        SurfaceController(player: player, toggleFullscreen: toggleFullscreen)
    }

    func updateUIViewController(_ controller: SurfaceController, context: Context) {
        controller.isFullscreen = isFullscreen
        controller.presentControls(standardControls)
    }

    static func dismantleUIViewController(_ controller: SurfaceController, coordinator: ()) {
        controller.retire()
    }
}

final class SurfaceController: UIViewController, FullscreenHandler {
    private let toggleFullscreen: () -> Void
    var isFullscreen = false
    func onFullscreenRequested() { if !isFullscreen { toggleFullscreen() } }
    func onFullscreenExitRequested() { if isFullscreen { toggleFullscreen() } }
    private let player: Player
    private var standard: Bool?
    private var native: AVPlayerViewController?
    #if os(iOS)
    private var webUI: PlayerView?
    #endif

    init(player: Player, toggleFullscreen: @escaping () -> Void) {
        self.toggleFullscreen = toggleFullscreen
        self.player = player
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("Storyboard unavailable") }

    func presentControls(_ standard: Bool) {
        guard self.standard != standard else { return }
        retire()
        self.standard = standard
        #if os(iOS)
        if standard {
            let surface = PlayerView(player: player, frame: view.bounds)
            surface.fullscreenHandler = self
            webUI = surface
            embed(surface)
            return
        }
        #endif
        let controller = AVPlayerViewController()
        controller.showsPlaybackControls = standard
        native = controller
        player.register(controller)
        addChild(controller)
        embed(controller.view)
        controller.didMove(toParent: self)
    }

    private func embed(_ content: UIView) {
        content.frame = view.bounds
        content.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(content)
    }

    func retire() {
        #if os(iOS)
        webUI?.fullscreenHandler = nil
        webUI?.player = nil
        webUI?.removeFromSuperview()
        webUI = nil
        #endif
        if let native {
            native.willMove(toParent: nil)
            if !player.isDestroyed { player.unregisterPlayerViewController(native) }
            native.view.removeFromSuperview()
            native.removeFromParent()
            self.native = nil
        }
        standard = nil
    }
}

#if os(iOS)
struct AirPlayPicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let picker = AVRoutePickerView()
        picker.prioritizesVideoDevices = true
        picker.accessibilityLabel = "AirPlay"
        return picker
    }
    func updateUIView(_ view: AVRoutePickerView, context: Context) {}
}
#endif
