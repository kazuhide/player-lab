import Foundation
import BitmovinPlayer

#if !os(tvOS)
/// The preference bridge shares the public handler with editable demonstration callbacks.
/// The SDK holds its delegate weakly, so the player callback journal retains this adapter.
final class NativeLiveRewindBridge: NSObject, CustomMessageHandlerDelegate {
    static let message = "playerlab-live-rewind-enabled"
    static let readyMessage = "playerlab-live-rewind-ready"
    let handler: CustomMessageHandler
    private let demonstrationDelegate: CustomMessageHandlerDelegate?
    private weak var journal: NativeCallbackJournal?
    private weak var owner: Player?
    private var lastSent: Bool?

    init(handler: CustomMessageHandler, journal: NativeCallbackJournal) {
        self.handler = handler
        self.journal = journal
        demonstrationDelegate = handler.delegate
        super.init()
        handler.delegate = self
        journal.retain(self)
    }

    func bind(to player: Player) { owner = player }

    func send(_ enabled: Bool, force: Bool = false) {
        guard let owner, !owner.isDestroyed, journal?.model?.player === owner,
              force || lastSent != enabled else { return }
        lastSent = enabled
        handler.sendMessage(Self.message, withData: String(enabled))
    }

    func receivedSynchronousMessage(_ message: String, withData data: String?) -> String? {
        demonstrationDelegate?.receivedSynchronousMessage(message, withData: data)
    }

    func receivedAsynchronousMessage(_ message: String, withData data: String?) {
        if message == Self.readyMessage {
            DispatchQueue.main.async { [weak self] in
                guard let self, let owner = self.owner, !owner.isDestroyed,
                      let model = self.journal?.model, model.player === owner else { return }
                model.liveRewindUiDidBecomeReady(bridge: self)
            }
            return
        }
        demonstrationDelegate?.receivedAsynchronousMessage(message, withData: data)
    }
}
#endif
