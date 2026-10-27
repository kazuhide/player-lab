import type { PlayerAPI } from "bitmovin-player";
import type { UIConfig, UIInstanceManager, UIManager } from "bitmovin-player-ui";

interface NativeLiveRewindOptions extends UIConfig {
  playerLabLiveRewindEnabled?: boolean;
}

const DISABLED_CLASS = "playerlab-live-rewind-disabled";

/** Apply the native host's optional control-visibility policy without changing SDK playback configuration. */
export function applyNativeLiveRewindPolicy(player: PlayerAPI, manager: UIManager, config?: UIConfig): UIManager {
  if ((config as NativeLiveRewindOptions | undefined)?.playerLabLiveRewindEnabled !== false) return manager;

  let released = false;
  let listening = false;
  const roots = new Map<UIInstanceManager, HTMLElement>();
  const events = [
    player.exports.PlayerEvent.SourceLoaded,
    player.exports.PlayerEvent.SourceUnloaded,
    player.exports.PlayerEvent.DurationChanged,
    player.exports.PlayerEvent.TimeChanged,
  ];
  const update = () => {
    if (released) return;
    const hideRewind = player.isLive();
    for (const root of roots.values()) root.classList.toggle(DISABLED_CLASS, hideRewind);
  };
  const release = () => {
    if (released) return;
    released = true;
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
      }
    }
    update();
  };
  manager.onActiveUiChanged.subscribe(activate);
  activate();
  return manager;
}
