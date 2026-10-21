import SwiftUI
import UIKit
import BitmovinPlayer

/// An optional public PlayerView host exposes view APIs while the original SwiftUI host remains available.
struct NativePlayerSurface: UIViewRepresentable {
    @ObservedObject var model: PlayerModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        let view = PlayerView(player: model.player, frame: .zero, playerViewConfig: model.makePlayerViewConfig())
        context.coordinator.container = container
        context.coordinator.playerView = view
        context.coordinator.embed(view, in: container)
        view.fullscreenHandler = context.coordinator
        model.attachApiView(view)
        return container
    }

    func updateUIView(_ view: UIView, context: Context) {}

    static func dismantleUIView(_ view: UIView, coordinator: Coordinator) {
        coordinator.onFullscreenExitRequested()
        if let playerView = coordinator.playerView {
            coordinator.model?.detachApiView(playerView)
            playerView.fullscreenHandler = nil
            playerView.player = nil
        }
    }

    @MainActor
    final class Coordinator: NSObject, FullscreenHandler {
        weak var model: PlayerModel?
        weak var container: UIView?
        weak var playerView: PlayerView?
        private var fullscreen: FullscreenSurfaceController?
        var isFullscreen: Bool { fullscreen != nil }

        init(model: PlayerModel) { self.model = model }

        func embed(_ view: UIView, in container: UIView) {
            view.removeFromSuperview()
            container.addSubview(view)
            view.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                view.topAnchor.constraint(equalTo: container.topAnchor),
                view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            ])
        }

        func onFullscreenRequested() {
            guard fullscreen == nil, let view = playerView, let container,
                  view.player === model?.player else { return }
            var responder: UIResponder? = container
            while responder != nil && !(responder is UIViewController) { responder = responder?.next }
            guard var presenter = responder as? UIViewController else { return }
            while let presented = presenter.presentedViewController { presenter = presented }
            let controller = FullscreenSurfaceController()
            controller.modalPresentationStyle = .fullScreen
            controller.isModalInPresentation = true
            controller.close = { [weak self] in self?.onFullscreenExitRequested() }
            fullscreen = controller
            controller.loadViewIfNeeded()
            embed(view, in: controller.videoContainer)
            presenter.present(controller, animated: false)
        }

        func onFullscreenExitRequested() {
            guard let controller = fullscreen else { return }
            fullscreen = nil
            if let view = playerView, let container { embed(view, in: container) }
            controller.dismiss(animated: false)
        }
    }
}

private final class FullscreenSurfaceController: UIViewController {
    let videoContainer = UIView()
    var close: (() -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        view.addSubview(videoContainer)
        videoContainer.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            videoContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            videoContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            videoContainer.topAnchor.constraint(equalTo: view.topAnchor),
            videoContainer.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.title = "Exit fullscreen"
        configuration.baseBackgroundColor = UIColor.black.withAlphaComponent(0.75)
        configuration.baseForegroundColor = .white
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12)
        button.configuration = configuration
        button.addAction(UIAction { [weak self] _ in self?.close?() }, for: .primaryActionTriggered)
        button.accessibilityIdentifier = "api.fullscreen.exit"
        view.addSubview(button)
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            button.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if presentingViewController == nil { close?() }
    }
}
