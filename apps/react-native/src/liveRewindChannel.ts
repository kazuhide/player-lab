import { CustomMessageHandler } from "bitmovin-player-react-native";

const READY = "playerlab-live-rewind-ready";
const ENABLED = "playerlab-live-rewind-enabled";

/** The public SDK message channel updates the existing UI, including while paused. */
export class LiveRewindChannel {
  readonly handler: CustomMessageHandler;
  private active = true;
  private enabled = true;
  constructor(private readonly delegate?: CustomMessageHandler) {
    this.handler = new CustomMessageHandler({
      onReceivedSynchronousMessage: (message, data) => this.active ? delegate?.receivedSynchronousMessage(message, data) : undefined,
      onReceivedAsynchronousMessage: (message, data) => {
        if (!this.active) return;
        if (message === READY) this.send();
        else delegate?.receivedAsynchronousMessage(message, data);
      },
    });
  }
  setEnabled(enabled: boolean): void { this.enabled = enabled; this.send(); }
  private send(): void { if (this.active) this.handler.sendMessage(ENABLED, String(this.enabled)); }
  /** Preserve outgoing messages from an applied demonstration handler as well. */
  attach(): () => void {
    this.active = true;
    const delegate = this.delegate;
    const previous = delegate?.sendMessage;
    const forward = (message: string, data: string | undefined) => { if (this.active) this.handler.sendMessage(message, data); };
    if (delegate) delegate.sendMessage = forward;
    return () => {
      this.active = false;
      if (delegate?.sendMessage === forward && previous) delegate.sendMessage = previous;
    };
  }
}
