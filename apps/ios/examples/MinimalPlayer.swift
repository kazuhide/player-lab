import SwiftUI
import UIKit
import BitmovinPlayer

@main
struct MinimalPlayerApp: App {
    var body: some Scene {
        WindowGroup {
            if let url = URL(string: "https://example.com/video/master.m3u8") {
                MinimalPlayerView(licenseKey: "YOUR_PLAYER_KEY", sourceURL: url)
            } else {
                Text("Invalid source URL")
            }
        }
    }
}

struct MinimalPlayerView: UIViewRepresentable {
    let licenseKey: String
    let sourceURL: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> PlayerView {
        let config = PlayerConfig()
        config.key = licenseKey
        config.playbackConfig.isAutoplayEnabled = true
        config.playbackConfig.isMuted = true
        #if os(tvOS)
        config.styleConfig.userInterfaceType = .system
        #endif
        let player = PlayerFactory.createPlayer(playerConfig: config)
        context.coordinator.player = player
        player.add(listener: context.coordinator)
        let view = PlayerView(player: player, frame: .zero)
        let source = SourceFactory.createSource(from: SourceConfig(url: sourceURL, type: .hls))
        player.load(source: source)
        return view
    }

    func updateUIView(_ view: PlayerView, context: Context) {}

    static func dismantleUIView(_ view: PlayerView, coordinator: Coordinator) {
        guard let player = coordinator.player else { return }
        coordinator.player = nil
        player.remove(listener: coordinator)
        view.player = nil
        player.destroy()
    }

    final class Coordinator: NSObject, PlayerListener {
        var player: Player?

        func onPlayerError(_ event: PlayerErrorEvent, player: Player) {
            guard player === self.player else { return }
            print("Player error \(event.code)")
        }

        func onSourceError(_ event: SourceErrorEvent, player: Player) {
            guard player === self.player else { return }
            print("Source error \(event.code)")
        }
    }
}
