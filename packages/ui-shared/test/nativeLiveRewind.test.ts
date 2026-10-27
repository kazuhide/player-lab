import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerAPI } from "bitmovin-player";
import type { UIConfig, UIInstanceManager, UIManager } from "bitmovin-player-ui";
import { applyNativeLiveRewindPolicy } from "../src/nativeLiveRewind";

const disabledConfig = { playerLabLiveRewindEnabled: false } as UIConfig;
const disabledClass = "playerlab-live-rewind-disabled";

function event() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); },
    unsubscribe: (listener: () => void) => listeners.delete(listener),
    emit: () => { [...listeners].forEach((listener) => listener()); },
    queued: () => [...listeners],
    count: () => listeners.size,
  };
}

function variant() {
  const classes = new Set<string>();
  const onRelease = event();
  const getUI = vi.fn(() => ({ getDomElement: () => ({ get: () => ({ classList: {
    toggle: (name: string, value: boolean) => { if (value) classes.add(name); else classes.delete(name); },
    remove: (name: string) => classes.delete(name),
  } }) }) }));
  return { classes, onRelease, getUI };
}

function fixture(initialLive = true, initiallyActive = true) {
  let live = initialLive;
  const handlers = new Map<string, Set<() => void>>();
  const events = Object.fromEntries(["SourceLoaded", "SourceUnloaded", "DurationChanged", "TimeChanged"].map((name) => [name, name]));
  const player = {
    exports: { PlayerEvent: events }, isLive: () => live,
    on(name: string, listener: () => void) {
      const listeners = handlers.get(name) ?? new Set();
      listeners.add(listener); handlers.set(name, listeners);
    },
    off(name: string, listener: () => void) { handlers.get(name)?.delete(listener); },
  } as unknown as PlayerAPI;
  const first = variant();
  const onActiveUiChanged = event();
  const raw = { activeUi: initiallyActive ? first : null, onActiveUiChanged };
  const manager = raw as unknown as UIManager;
  return {
    player, manager, first, onActiveUiChanged,
    setLive(value: boolean) { live = value; },
    activate(next: ReturnType<typeof variant>) { raw.activeUi = next; onActiveUiChanged.emit(); },
    emit(name: string) { [...(handlers.get(name) ?? [])].forEach((listener) => listener()); },
    queued(name: string) { return [...(handlers.get(name) ?? [])]; },
    listenerCount() { return [...handlers.values()].reduce((sum, listeners) => sum + listeners.size, 0); },
  };
}

describe("optional native live rewind UI policy", () => {
  afterEach(() => vi.unstubAllGlobals());

  function nativeMessages() {
    const callbacks = new Map<string, (data?: string) => void>();
    const on = vi.fn((name: string, callback: (data?: string) => void) => callbacks.set(name, callback));
    const sendAsynchronous = vi.fn();
    vi.stubGlobal("window", { bitmovin: { customMessageHandler: { on, sendAsynchronous } } });
    return { on, sendAsynchronous,
      send: (data?: string) => callbacks.get("playerlab-live-rewind-enabled")?.(data) };
  }

  it("changes the live controls through public native messages without a clock tick or UI replacement", async () => {
    const messages = nativeMessages();
    const f = fixture();
    applyNativeLiveRewindPolicy(f.player, f.manager);
    await Promise.resolve();
    expect(messages.sendAsynchronous).toHaveBeenCalledWith("playerlab-live-rewind-ready", "");
    messages.send("false");
    expect(f.first.classes.has(disabledClass)).toBe(true);
    messages.send("true");
    expect(f.first.classes.has(disabledClass)).toBe(false);
    expect(f.manager.activeUi).toBe(f.first);
    messages.send("false");
    f.setLive(false); f.emit("DurationChanged");
    expect(f.first.classes.has(disabledClass)).toBe(false);
    f.setLive(true); f.emit("TimeChanged");
    expect(f.first.classes.has(disabledClass)).toBe(true);
  });

  it("uses one native dispatcher and retires only the released UI's subscription", async () => {
    const messages = nativeMessages();
    const f = fixture();
    const second = variant();
    const secondManager = { activeUi: second, onActiveUiChanged: event() } as unknown as UIManager;
    applyNativeLiveRewindPolicy(f.player, f.manager);
    applyNativeLiveRewindPolicy(f.player, secondManager);
    expect(messages.on).toHaveBeenCalledTimes(1);
    messages.send("false");
    expect(f.first.classes.has(disabledClass)).toBe(true);
    expect(second.classes.has(disabledClass)).toBe(true);
    f.first.onRelease.emit();
    expect(f.first.classes.size).toBe(0);
    expect(f.listenerCount()).toBe(4);
    messages.send("true"); messages.send("false");
    expect(f.first.classes.size).toBe(0);
    expect(second.classes.has(disabledClass)).toBe(true);
    second.onRelease.emit();
    expect(f.listenerCount()).toBe(0);
    messages.send("false");
    expect(second.classes.size).toBe(0);
    await Promise.resolve();
    expect(messages.sendAsynchronous).not.toHaveBeenCalled();
  });

  it("accepts only explicit boolean text and preserves the initial host policy", () => {
    const messages = nativeMessages();
    const f = fixture();
    applyNativeLiveRewindPolicy(f.player, f.manager, disabledConfig);
    for (const data of [undefined, "TRUE", "", "0", "{\"enabled\":true}"]) messages.send(data);
    expect(f.first.classes.has(disabledClass)).toBe(true);
    messages.send("true");
    expect(f.first.classes.has(disabledClass)).toBe(false);
  });

  it("keeps a bridge free of UI references until a lazy variant actually activates", async () => {
    const messages = nativeMessages();
    const f = fixture(true, false);
    applyNativeLiveRewindPolicy(f.player, f.manager);
    await Promise.resolve();
    expect(messages.on).not.toHaveBeenCalled();
    expect(messages.sendAsynchronous).not.toHaveBeenCalled();
    f.activate(f.first);
    await Promise.resolve();
    expect(messages.on).toHaveBeenCalledTimes(1);
    expect(messages.sendAsynchronous).toHaveBeenCalledTimes(1);
    messages.send("false");
    expect(f.first.classes.has(disabledClass)).toBe(true);
    f.first.onRelease.emit();
    messages.send("false");
    expect(f.first.classes.size).toBe(0);
    expect(f.listenerCount()).toBe(0);
  });

  it("keeps existing consumers unchanged when the policy is absent or enabled", () => {
    for (const config of [undefined, { playerLabLiveRewindEnabled: true } as UIConfig]) {
      const f = fixture();
      expect(applyNativeLiveRewindPolicy(f.player, f.manager, config)).toBe(f.manager);
      expect(f.first.getUI).not.toHaveBeenCalled();
      expect(f.first.classes.size).toBe(0);
      expect(f.listenerCount()).toBe(0);
      expect(f.onActiveUiChanged.count()).toBe(0);
    }
  });

  it("tracks actual live status across source loading, HLS readiness and live-to-VOD changes", () => {
    const f = fixture(false);
    applyNativeLiveRewindPolicy(f.player, f.manager, disabledConfig);
    expect(f.first.classes.has(disabledClass)).toBe(false);
    f.emit("SourceLoaded");
    expect(f.first.classes.has(disabledClass)).toBe(false);
    f.setLive(true); f.emit("TimeChanged");
    expect(f.first.classes.has(disabledClass)).toBe(true);
    f.setLive(false); f.emit("DurationChanged");
    expect(f.first.classes.has(disabledClass)).toBe(false);
    f.setLive(true); f.emit("SourceLoaded");
    expect(f.first.classes.has(disabledClass)).toBe(true);
    f.setLive(false); f.emit("SourceUnloaded");
    expect(f.first.classes.has(disabledClass)).toBe(false);
  });

  it("observes lazy variants only when activated and cleans all ownership on UI release", () => {
    const f = fixture();
    const lazy = variant();
    applyNativeLiveRewindPolicy(f.player, f.manager, disabledConfig);
    expect(f.first.classes.has(disabledClass)).toBe(true);
    expect(lazy.getUI).not.toHaveBeenCalled();
    f.activate(lazy); f.activate(lazy);
    expect(lazy.getUI).toHaveBeenCalledTimes(1);
    expect(lazy.classes.has(disabledClass)).toBe(true);
    expect(f.listenerCount()).toBe(4);
    const queuedUpdate = f.queued("TimeChanged");
    const queuedActivation = f.onActiveUiChanged.queued();
    f.first.onRelease.emit();
    expect(f.listenerCount()).toBe(0);
    expect(f.onActiveUiChanged.count()).toBe(0);
    expect(f.first.onRelease.count()).toBe(0);
    expect(lazy.onRelease.count()).toBe(0);
    expect(f.first.classes.size).toBe(0);
    expect(lazy.classes.size).toBe(0);
    queuedUpdate.forEach((callback) => callback());
    queuedActivation.forEach((callback) => callback());
    expect(lazy.classes.size).toBe(0);
    expect(f.listenerCount()).toBe(0);
  });

  it("does not attach player listeners until a lazy UI has an active owner", () => {
    const f = fixture(true, false);
    applyNativeLiveRewindPolicy(f.player, f.manager, disabledConfig);
    expect(f.listenerCount()).toBe(0);
    expect(f.first.getUI).not.toHaveBeenCalled();
    f.activate(f.first);
    expect(f.listenerCount()).toBe(4);
    expect(f.first.classes.has(disabledClass)).toBe(true);
    f.first.onRelease.emit();
    expect(f.listenerCount()).toBe(0);
  });

  it("releases only its own UI and listeners when another UI shares the player", () => {
    const f = fixture();
    const second = variant();
    const secondChanged = event();
    const secondManager = { activeUi: second as unknown as UIInstanceManager, onActiveUiChanged: secondChanged } as unknown as UIManager;
    applyNativeLiveRewindPolicy(f.player, f.manager, disabledConfig);
    applyNativeLiveRewindPolicy(f.player, secondManager, disabledConfig);
    expect(f.listenerCount()).toBe(8);
    f.first.onRelease.emit();
    expect(f.first.classes.size).toBe(0);
    expect(second.classes.has(disabledClass)).toBe(true);
    expect(f.listenerCount()).toBe(4);
    f.setLive(false); f.emit("TimeChanged");
    expect(second.classes.has(disabledClass)).toBe(false);
    second.onRelease.emit();
    expect(f.listenerCount()).toBe(0);
  });
});
