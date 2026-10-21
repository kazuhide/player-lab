import Foundation
import BitmovinPlayer

enum NativePlayerFactory: String, CaseIterable, Identifiable {
    case standard = "PlayerFactory (with configured Analytics)"
    case core = "PlayerCoreFactory"
    case legacy = "PlayerFactory.create (deprecated)"
    var id: String { rawValue }
    var code: String {
        switch self {
        case .standard: return "let player = PlayerFactory.createPlayer(playerConfig: playerConfig)\n// Pass the Analytics argument when attaching a configured collector."
        case .core: return "let player = PlayerCoreFactory.createPlayer(playerConfig: playerConfig)"
        case .legacy: return "let player = PlayerFactory.create(playerConfig: playerConfig)"
        }
    }
}
