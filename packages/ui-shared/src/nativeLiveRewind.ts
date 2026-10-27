import type { PlayerAPI } from "bitmovin-player";
import type { UIConfig, UIInstanceManager, UIManager } from "bitmovin-player-ui";

interface NativeLiveRewindOptions extends UIConfig {
  playerLabLiveRewindEnabled?: boolean;
}

const DISABLED_CLASS = "playerlab-live-rewind-disabled";
const PREFERENCE_MESSAGE = "playerlab-live-rewind-enabled";
const READY_MESSAGE = "playerlab-live-rewind-ready";

interface NativeMessages {
  on(name: string, listener: (data?: string) => void): void;
  sendAsynchronousMessage(name: string, data: string): void;
}

// The public native bridge has no documented off method. Keep one dispatcher
// per WebView bridge and retire individual subscribers without retaining a UI.
const messageSubscribers = new WeakMap<NativeMessages, Set<(data?: string) => void>>();

function nativeMessages(): NativeMessages | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = (window as Window & { bitmovin?: { customMessageHandler?: NativeMessages } }).bitmovin?.customMessageHandler;
  return bridge && typeof bridge.on === "function" && typeof bridge.sendAsynchronousMessage === "function" ? bridge : undefined;
}

function subscribe(bridge: NativeMessages, listener: (data?: string) => void): () => void {
  let listeners = messageSubscribers.get(bridge);
  if (!listeners) {
    listeners = new Set();
    messageSubscribers.set(bridge, listeners);
    const subscribers = listeners;
    bridge.on(PREFERENCE_MESSAGE, (data) => { for (const subscriber of subscribers) subscriber(data); });
  }
  listeners.add(listener);
  const subscribers = listeners;
  return () => { subscribers.delete(listener); };
}

/** Apply the native host's optional control-visibility policy without changing SDK playback configuration. */
export function applyNativeLiveRewindPolicy(player: PlayerAPI, manager: UIManager, config?: UIConfig): UIManager {
  let enabled = (config as NativeLiveRewindOptions | undefined)?.playerLabLiveRewindEnabled !== false;
  const bridge = nativeMessages();
  if (enabled && !bridge) return manager;

  let released = false;
  let listening = false;
  let unsubscribeMessages: (() => void) | undefined;
  const roots = new Map<UIInstanceManager, HTMLElement>();
  const events = [
    player.exports.PlayerEvent.SourceLoaded,
    player.exports.PlayerEvent.SourceUnloaded,
    player.exports.PlayerEvent.DurationChanged,
    player.exports.PlayerEvent.TimeChanged,
  ];
  const update = () => {
    if (released) return;
    const hideRewind = !enabled && player.isLive();
    for (const root of roots.values()) root.classList.toggle(DISABLED_CLASS, hideRewind);
  };
  const release = () => {
    if (released) return;
    released = true;
    unsubscribeMessages?.();
    manager.onActiveUiChanged.unsubscribe(activate);
    if (listening) for (const event of events) player.off(event, update);
    for (const [instance, root] of roots) {
      instance.onRelease.unsubscribe(release);
      root.classList.remove(DISABLED_CLASS);
    }
    roots.clear();
  };
  const activate = () => {
    if (released) return;
    const instance = manager.activeUi;
    if (!instance) return;
    if (!roots.has(instance)) {
      // Only the active variant is resolved. Other UI factories can remain lazy.
      roots.set(instance, instance.getUI().getDomElement().get(0));
      instance.onRelease.subscribe(release);
      if (!listening) {
        listening = true;
        for (const event of events) player.on(event, update);
        if (bridge) {
          unsubscribeMessages = subscribe(bridge, (data) => {
            if (released || data !== "true" && data !== "false") return;
            enabled = data === "true";
            update();
          });
          queueMicrotask(() => {
            if (released) return;
            // Older hosts need not implement this optional control channel.
            try { bridge.sendAsynchronousMessage(READY_MESSAGE, ""); } catch { /* Keep the initial policy. */ }
          });
        }
      }
    }
    update();
  };
  manager.onActiveUiChanged.subscribe(activate);
  activate();
  return manager;
}
