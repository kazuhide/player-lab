import Foundation
import BitmovinPlayer

#if !os(tvOS)
/// Checks the current owner when a message is delivered, without extending its lifetime.
final class NativeLiveRewindOwnerBinding {
    private weak var owner: AnyObject?
    private let isDestroyed: (AnyObject) -> Bool
    private let currentOwner: () -> AnyObject?
    private let didBecomeReady: @MainActor (NativeLiveRewindBridge) -> Void

    init(owner: AnyObject, isDestroyed: @escaping (AnyObject) -> Bool,
         currentOwner: @escaping () -> AnyObject?,
         didBecomeReady: @escaping @MainActor (NativeLiveRewindBridge) -> Void) {
        self.owner = owner
        self.isDestroyed = isDestroyed
        self.currentOwner = currentOwner
        self.didBecomeReady = didBecomeReady
    }

    var isCurrentAndAlive: Bool {
        guard let owner, !isDestroyed(owner), currentOwner() === owner else { return false }
        return true
    }

    @MainActor
    func receiveReady(from bridge: NativeLiveRewindBridge) {
        guard isCurrentAndAlive else { return }
        didBecomeReady(bridge)
    }
}

/// The preference bridge shares the public handler with editable demonstration callbacks.
/// The SDK holds its delegate weakly, so the player callback journal retains this adapter.
final class NativeLiveRewindBridge: NSObject, CustomMessageHandlerDelegate {
    static let message = "playerlab-live-rewind-enabled"
    static let readyMessage = "playerlab-live-rewind-ready"
    let handler: CustomMessageHandler
    private let demonstrationDelegate: CustomMessageHandlerDelegate?
    private weak var journal: NativeCallbackJournal?
    private var binding: NativeLiveRewindOwnerBinding?
    private let sendMessage: (String, String?) -> Void
    private var lastSent: Bool?

    init(handler: CustomMessageHandler, journal: NativeCallbackJournal,
         sendMessage: ((String, String?) -> Void)? = nil) {
        self.handler = handler
        self.journal = journal
        self.sendMessage = sendMessage ?? { [weak handler] message, data in
            handler?.sendMessage(message, withData: data)
        }
        demonstrationDelegate = handler.delegate
        super.init()
        handler.delegate = self
        journal.retain(self)
    }

    func bind(to player: Player) {
        let journal = self.journal
        bind(to: NativeLiveRewindOwnerBinding(owner: player,
            isDestroyed: { ($0 as? Player)?.isDestroyed ?? true },
            currentOwner: { [weak journal] in journal?.model?.player },
            didBecomeReady: { [weak journal] bridge in journal?.model?.liveRewindUiDidBecomeReady(bridge: bridge) }))
    }

    func bind(to binding: NativeLiveRewindOwnerBinding) { self.binding = binding }

    func send(_ enabled: Bool, force: Bool = false) {
        guard binding?.isCurrentAndAlive == true, force || lastSent != enabled else { return }
        lastSent = enabled
        sendMessage(Self.message, String(enabled))
    }

    func receivedSynchronousMessage(_ message: String, withData data: String?) -> String? {
        demonstrationDelegate?.receivedSynchronousMessage(message, withData: data)
    }

    func receivedAsynchronousMessage(_ message: String, withData data: String?) {
        if message == Self.readyMessage {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.binding?.receiveReady(from: self)
            }
            return
        }
        demonstrationDelegate?.receivedAsynchronousMessage(message, withData: data)
    }
}
#endif
