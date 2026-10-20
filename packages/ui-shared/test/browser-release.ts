import { Container, DynamicSettingsPanelItem, Icon, PlaybackSpeedSelectBox, RecommendationItem, RecommendationOverlay, SeekBar, SettingsPanelItem, UIContainer, UIFactory, UIManager, UIVariantIdentifier, Watermark, i18n, type Component, type ComponentConfig } from "bitmovin-player-ui";
import { Player, type PlayerAPI } from "bitmovin-player";
import {
  BingeUIFactory, CinemaUIFactory, CompactUIFactory, CreatorUIFactory, DefaultUIFactory,
  LiveUIFactory, PremiereUIFactory, SportsUIFactory, StudioUIFactory,
} from "../src/liveUi";

// This module is loaded only by the browser regression. It exercises actual
// factories and UIManagers; no mocked DOM, emitter, or player is involved.
export async function inspectFactoryRelease(player: PlayerAPI) {
  const factories = {
    Default: DefaultUIFactory.buildDefaultUI,
    Live: LiveUIFactory.buildLiveUI,
    Cinema: CinemaUIFactory.buildCinemaUI,
    Compact: CompactUIFactory.buildCompactUI,
    Premiere: PremiereUIFactory.buildPremiereUI,
    Creator: CreatorUIFactory.buildCreatorUI,
    Studio: StudioUIFactory.buildStudioUI,
    Sports: SportsUIFactory.buildSportsUI,
    Binge: BingeUIFactory.buildBingeUI,
  };
  const results = [];
  const buildStock = UIFactory.defaultLayouts.main;
  let stockReleased = 0;
  let stockChildren: Component<ComponentConfig>[] = [];
  UIFactory.defaultLayouts.main = () => {
    const stock = buildStock();
    stockChildren = stock.getComponents();
    const release = stock.release.bind(stock);
    stock.release = () => { stockReleased += 1; release(); };
    return stock;
  };
  try {
    for (const [name, build] of Object.entries(factories)) {
      const manager = build(player);
      const root = manager.activeUi.getUI();
      const expectedStockChildren = stockChildren.filter((child) => !(child instanceof Watermark));
      const adoptedChildren = name !== "Default" ||
        (root.getComponents().length === expectedStockChildren.length &&
          root.getComponents().every((child, index) => child === expectedStockChildren[index]));
      const tracked: { releaseCalls: number; languageCalls: number }[] = [];
      let unlistedSettingLabels = 0;
      const observed = new Set<Component<ComponentConfig>>();
      const observeSubtree = (component: Component<ComponentConfig>): void => {
        if (observed.has(component)) return;
        observed.add(component);
        const counter = { releaseCalls: 0, languageCalls: 0 };
        tracked.push(counter);
        const release = component.release.bind(component);
        component.release = () => { counter.releaseCalls += 1; release(); };
        // The protected callback is replaced only for observing the actual
        // public i18n.setLanguage event, never for calling it directly.
        const localizable = component as unknown as { onLanguageChanged(): void };
        const languageChanged = localizable.onLanguageChanged.bind(component);
        localizable.onLanguageChanged = () => { counter.languageCalls += 1; languageChanged(); };
        if (component instanceof Container) component.getComponents().forEach(observeSubtree);
      };
      const visit = (component: Component<ComponentConfig>): void => {
        if (component instanceof SettingsPanelItem) {
          // The published implementation owns this label even when a subclass
          // replaces config.components after the base constructor created it.
          const label = (component as unknown as { label?: Component<ComponentConfig> }).label;
          if (label && !component.getComponents().includes(label)) {
            unlistedSettingLabels += 1;
            observeSubtree(label);
          }
        }
        if (component instanceof SeekBar) {
          const label = component.getLabel();
          if (label) observeSubtree(label);
        }
        if (component instanceof DynamicSettingsPanelItem) {
          const config = component.getConfig();
          observeSubtree(config.settingComponent);
          if (config.backNavigationRightComponent) observeSubtree(config.backNavigationRightComponent);
        }
        if (component instanceof Container) component.getComponents().forEach(visit);
      };
      visit(root);
      // An auxiliary can also be present in the normal tree. It must be released
      // once even when both its owner and manager traversal reach it.
      const sharedChild = observed.values().next().value;
      if (sharedChild) root.addComponent(sharedChild);
      const iconCounters = new Map<Icon, { releaseCalls: number; languageCalls: number }>();
      const prototype = Icon.prototype as unknown as { onLanguageChanged(): void; release(): void };
      const languageDescriptor = Object.getOwnPropertyDescriptor(prototype, "onLanguageChanged");
      const releaseDescriptor = Object.getOwnPropertyDescriptor(prototype, "release");
      const iconLanguageChanged = prototype.onLanguageChanged;
      const iconRelease = prototype.release;
      prototype.onLanguageChanged = function (this: Icon) {
        if (root.getDomElement().get(0).contains(this.getDomElement().get(0))) {
          const counter = iconCounters.get(this) ?? { releaseCalls: 0, languageCalls: 0 };
          counter.languageCalls += 1;
          iconCounters.set(this, counter);
        } else if (iconCounters.has(this)) {
          iconCounters.get(this)!.languageCalls += 1;
        }
        iconLanguageChanged.call(this);
      };
      prototype.release = function (this: Icon) {
        const counter = iconCounters.get(this);
        if (counter) counter.releaseCalls += 1;
        iconRelease.call(this);
      };
      try {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        i18n.setLanguage("de");
        const callsBeforeRelease = tracked.map((value) => value.languageCalls);
        manager.release();
        manager.release();
        i18n.setLanguage("en");
        const icons = [...iconCounters.values()];
        results.push({
          factory: name,
          auxiliaryComponents: tracked.length,
          unlistedSettingLabels,
          releasedExactlyOnce: tracked.every((value) => value.releaseCalls === 1),
          localizedWhileActive: callsBeforeRelease.every((count) => count === 1),
          localizedAfterRelease: tracked.some((value, index) => value.languageCalls !== callsBeforeRelease[index]),
          icons: icons.length,
          iconsReleasedExactlyOnce: icons.every((value) => value.releaseCalls === 1),
          iconsStoppedLocalizing: icons.every((value) => value.languageCalls === 1),
          adoptedChildren,
        });
      } finally {
        if (languageDescriptor) Object.defineProperty(prototype, "onLanguageChanged", languageDescriptor);
        else delete (prototype as Partial<typeof prototype>).onLanguageChanged;
        if (releaseDescriptor) Object.defineProperty(prototype, "release", releaseDescriptor);
        else delete (prototype as Partial<typeof prototype>).release;
      }
    }
  } finally {
    UIFactory.defaultLayouts.main = buildStock;
    i18n.setLanguage("en");
  }
  return { stockReleased, results };
}

// Observe the real public on/off boundary so a raw subscription cannot escape
// the manager's tracked player wrapper and survive release.
export function inspectManagerSourceSubscriptions(player: PlayerAPI) {
  const on = player.on.bind(player);
  const off = player.off.bind(player);
  const originalOn = player.on;
  const originalOff = player.off;
  const pending = new Map<string, Set<unknown>>();
  player.on = (event, callback) => {
    const listeners = pending.get(event) ?? new Set<unknown>();
    listeners.add(callback); pending.set(event, listeners);
    return on(event, callback);
  };
  player.off = (event, callback) => {
    pending.get(event)?.delete(callback);
    return off(event, callback);
  };
  let manager: UIManager | undefined;
  try {
    manager = LiveUIFactory.buildLiveUI(player);
    const events = [player.exports.PlayerEvent.SourceLoaded, player.exports.PlayerEvent.SourceUnloaded];
    const registered = events.map((event) => pending.get(event)?.size ?? 0);
    manager.release(); manager.release();
    return { registered, remaining: events.map((event) => pending.get(event)?.size ?? 0) };
  } finally {
    manager?.release();
    player.on = originalOn; player.off = originalOff;
  }
}

// Dynamic recommendation items and their title/duration labels leave the normal
// tree when metadata is replaced. Observe language events after that removal.
export function inspectRecommendationControlRelease(player: PlayerAPI) {
  const overlay = new RecommendationOverlay();
  const recommendation = (title: string) => ({ title, duration: 12, resource: { hls: "http://localhost/ownership.m3u8" } });
  const manager = new UIManager(player, [{ ui: new UIContainer({ components: [overlay] }), identifier: UIVariantIdentifier.main }], {
    metadata: { recommendations: [recommendation("First")] },
  });
  const tracked: { releaseCalls: number; languageCalls: number; removed: boolean }[] = [];
  const observed = new Set<Component<ComponentConfig>>();
  const observe = (removed: boolean) => {
    for (const item of overlay.recommendationContainer.getComponents()) {
      const elements = item.getDomElement().get(0).querySelectorAll(".bmpui-title, .bmpui-duration");
      for (const element of elements) {
        const label = (element as HTMLElement & { component: Component<ComponentConfig> }).component;
        if (!label || observed.has(label)) continue;
        observed.add(label);
        const counter = { releaseCalls: 0, languageCalls: 0, removed };
        tracked.push(counter);
        const release = label.release.bind(label);
        label.release = () => { counter.releaseCalls += 1; release(); };
        const localizable = label as unknown as { onLanguageChanged(): void };
        const changed = localizable.onLanguageChanged.bind(label);
        localizable.onLanguageChanged = () => { counter.languageCalls += 1; changed(); };
      }
    }
  };
  try {
    observe(true);
    i18n.setLanguage("de");
    manager.recommendations.add(recommendation("Second"));
    observe(false);
    const before = tracked.map((value) => value.languageCalls);
    manager.release(); manager.release();
    i18n.setLanguage("en");
    return {
      labels: tracked.length, removedLabels: tracked.filter((value) => value.removed).length,
      removedReleased: tracked.filter((value) => value.removed).every((value) => value.releaseCalls === 1),
      allReleasedOnce: tracked.every((value) => value.releaseCalls === 1),
      stoppedLocalizing: tracked.every((value, index) => value.languageCalls === before[index]),
    };
  } finally { manager.release(); i18n.setLanguage("en"); }
}

// Observe controls removed by the SDK's layout override processor before they are
// configured. Their localization subscription starts in the Component constructor.
export function inspectExcludedSettingsRelease(player: PlayerAPI) {
  const factories = {
    Default: DefaultUIFactory.buildDefaultUI,
    Premiere: PremiereUIFactory.buildPremiereUI,
    Creator: CreatorUIFactory.buildCreatorUI,
    Studio: StudioUIFactory.buildStudioUI,
  };
  const counters = new Map<PlaybackSpeedSelectBox, { releaseCalls: number; languageCalls: number }>();
  const prototype = PlaybackSpeedSelectBox.prototype as unknown as { onLanguageChanged(): void; release(): void };
  const languageDescriptor = Object.getOwnPropertyDescriptor(prototype, "onLanguageChanged");
  const releaseDescriptor = Object.getOwnPropertyDescriptor(prototype, "release");
  const languageChanged = prototype.onLanguageChanged;
  const release = prototype.release;
  prototype.onLanguageChanged = function (this: PlaybackSpeedSelectBox) {
    const counter = counters.get(this);
    if (counter) counter.languageCalls += 1;
    languageChanged.call(this);
  };
  prototype.release = function (this: PlaybackSpeedSelectBox) {
    const counter = counters.get(this) ?? { releaseCalls: 0, languageCalls: 0 };
    counter.releaseCalls += 1;
    counters.set(this, counter);
    release.call(this);
  };
  const results = [];
  try {
    for (const [name, build] of Object.entries(factories)) {
      const previous = new Set(counters.keys());
      const manager = build(player, { playbackSpeedSelectionEnabled: false });
      try {
        const root = manager.activeUi.getUI();
        const remaining = new Set<Component<ComponentConfig>>();
        const visit = (component: Component<ComponentConfig>): void => {
          if (remaining.has(component)) return;
          remaining.add(component);
          if (component instanceof SettingsPanelItem) visit(component.getConfig().settingComponent);
          if (component instanceof Container) component.getComponents().forEach(visit);
        };
        visit(root);
        const excluded = [...counters].filter(([component]) => !previous.has(component));
        i18n.setLanguage("de");
        manager.release();
        manager.release();
        i18n.setLanguage("en");
        results.push({
          factory: name,
          remainingSpeedControls: [...remaining].filter((component) => component instanceof PlaybackSpeedSelectBox).length,
          excludedSpeedControls: excluded.length,
          releasedExactlyOnce: excluded.every(([, value]) => value.releaseCalls === 1),
          stoppedLocalizing: excluded.every(([, value]) => value.languageCalls === 0),
        });
      } finally {
        manager.release();
      }
    }
  } finally {
    if (languageDescriptor) Object.defineProperty(prototype, "onLanguageChanged", languageDescriptor);
    else delete (prototype as Partial<typeof prototype>).onLanguageChanged;
    if (releaseDescriptor) Object.defineProperty(prototype, "release", releaseDescriptor);
    else delete (prototype as Partial<typeof prototype>).release;
    i18n.setLanguage("en");
  }
  return results;
}

// Exercise the actual SDK component, UI manager and DOM click with controlled
// public load/play promises. The browser test observes genuine unhandled errors
// through Playwright; this helper installs no rejection listener or suppressor.
export async function inspectRecommendationPromises(player: PlayerAPI, scenario: "released" | "superseded" | "active-failure" | "active-abort" | "released-failure" | "released-intent" | "pause" | "released-pause" | "external-source" | "unload" | "destroy" | "play-failure" | "superseded-unload-pending" | "superseded-external-source" | "superseded-unload" | "destroy-before-notify" | "destroy-notify-invalid" | "external-source-play" | "active-load-abort" | "destroyed-failure" | "pause-next-before-unload" | "pause-next-after-unload" | "pause-next-external-source" | "pause-next-external-unload" | "pause-next-after-external-unload" | "pause-cancelled-load" | "pause-receipt-destroy" | "active-sdk-cancel" | "active-destroy-cancel-message" | "destroyed-sdk-cancel" | "native-pause" | "api-load-forwarding" | "api-same-object" | "api-unload-forwarding" | "api-load-sync-throw" | "api-unload-sync-throw" | "api-successor" | "api-genuine-failure") {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const loads: (ReturnType<typeof deferred> & { source: Parameters<PlayerAPI["load"]>[0] })[] = [];
  const plays: ReturnType<typeof deferred>[] = [];
  const unloads: ReturnType<typeof deferred>[] = [];
  const apiInvocations: { method: string; receiver: unknown; args: unknown[] }[] = [];
  const externalError = new Error("External API rejected synchronously");
  const load = player.load;
  const unload = player.unload;
  const play = player.play;
  const pause = player.pause;
  const getSource = player.getSource;
  const on = player.on;
  const off = player.off;
  const boundOn = on.bind(player);
  const boundOff = off.bind(player);
  let currentSource = player.getSource();
  let invalidated = false;
  let deferredUnloads = 0;
  const resource = { dash: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd" };
  const first = new RecommendationItem({ recommendationConfig: { title: "First recommendation", resource } });
  const second = new RecommendationItem({ recommendationConfig: { title: "Second recommendation", resource: { ...resource } } });
  const element = document.createElement("div");
  document.body.append(element);
  const manager = new UIManager(player, [{
    identifier: UIVariantIdentifier.main,
    ui: new UIContainer({ components: [first, second] }),
  }], { container: element });
  // Observe only the pending action's temporary public listeners, created on click.
  const listeners = new Map<string, Map<unknown, () => void>>();
  player.on = (event, callback) => {
    const values = listeners.get(event) ?? new Map<unknown, () => void>();
    values.set(callback, () => callback({ type: event, timestamp: performance.now(), issuer: "api" } as Parameters<typeof callback>[0]));
    listeners.set(event, values);
    boundOn(event, callback);
  };
  player.off = (event, callback) => {
    if (invalidated) throw new player.exports.PlayerAPINotAvailableError("off");
    listeners.get(event)?.delete(callback);
    boundOff(event, callback);
  };
  const emit = (event: string) => [...(listeners.get(event)?.values() ?? [])].forEach((callback) => callback());
  player.getSource = () => {
    if (invalidated) throw new player.exports.PlayerAPINotAvailableError("getSource");
    return currentSource;
  };
  player.load = function (this: unknown, source, ...extra: unknown[]) {
    apiInvocations.push({ method: "load", receiver: this, args: [source, ...extra] });
    if (scenario === "api-load-sync-throw" && loads.length === 1) throw externalError;
    const pending = { ...deferred(), source };
    loads.push(pending);
    const unloading = currentSource != null;
    currentSource = null;
    // Web 8.280 clears the receipt before asynchronous SourceUnloaded delivery.
    if (unloading) {
      if (scenario.startsWith("superseded-") || scenario.startsWith("pause-") || scenario.startsWith("api-") || (scenario === "external-source-play" && loads.length === 2)) deferredUnloads++;
      else emit(player.exports.PlayerEvent.SourceUnloaded);
    }
    // An accepted external API can synchronously cause a newer recommendation.
    if (scenario === "api-successor" && loads.length === 2) second.getDomElement().get(0).click();
    return pending.promise;
  };
  const fixtureLoad = player.load;
  player.unload = function (this: unknown, ...args: unknown[]) {
    apiInvocations.push({ method: "unload", receiver: this, args });
    if (scenario === "api-unload-sync-throw") throw externalError;
    const pending = deferred();
    unloads.push(pending);
    const unloading = currentSource != null;
    currentSource = null;
    if (unloading) emit(player.exports.PlayerEvent.SourceUnloaded);
    return pending.promise;
  };
  const fixtureUnload = player.unload;
  player.play = () => { const pending = deferred(); plays.push(pending); return pending.promise; };
  const finishLoad = async (index: number) => {
    currentSource = loads[index]!.source;
    loads[index]!.resolve();
    await Promise.resolve();
  };
  try {
    // A second pause is a public no-op with no Paused event, but must cancel intent.
    if (scenario === "pause" || scenario === "released-pause") {
      await new Promise<void>((resolve) => {
        const paused = () => { boundOff(player.exports.PlayerEvent.Paused, paused); resolve(); };
        boundOn(player.exports.PlayerEvent.Paused, paused);
        player.pause("recommendation-fixture-initial");
      });
      if (!player.isPaused()) throw new Error("The real SDK must already be paused before testing cancellation");
    }
    first.getDomElement().get(0).click();
    if (loads.length !== 1 || plays.length !== 0) throw new Error("Recommendation must wait for its load before playing");
    if (["released", "released-failure", "released-intent", "released-pause"].includes(scenario)) manager.release();
    if (scenario.startsWith("api-")) {
      const receiver = {};
      const extra = {};
      const replacement = { hls: "https://example.invalid/replacement.m3u8" };
      const cancelledLoad = new Error("Load call was cancelled by another load or unload call");
      const notifyInitialUnload = () => {
        if (deferredUnloads !== 1) throw new Error("Only the initial source has an unload notification");
        emit(player.exports.PlayerEvent.SourceUnloaded);
        deferredUnloads--;
      };
      if (scenario === "api-load-sync-throw" || scenario === "api-unload-sync-throw") {
        let caught: unknown;
        try {
          Reflect.apply(scenario === "api-load-sync-throw" ? player.load : player.unload,
            receiver, [replacement, "forwarded", extra]);
        } catch (error) { caught = error; }
        if (caught !== externalError) throw new Error("External synchronous errors must preserve identity");
        if (player.load === fixtureLoad || player.unload === fixtureUnload || player.pause === pause) {
          throw new Error("A rejected external request must leave recommendation ownership active");
        }
        notifyInitialUnload();
        await finishLoad(0);
        plays[0]!.resolve();
      } else if (scenario === "api-unload-forwarding") {
        const result = Reflect.apply(player.unload, receiver, ["forwarded", extra]);
        const call = apiInvocations[apiInvocations.length - 1]!;
        if (result !== unloads[0]!.promise || call.receiver !== receiver || call.args.length !== 2 ||
            call.args[0] !== "forwarded" || call.args[1] !== extra) throw new Error("Unload forwarding changed its contract");
        loads[0]!.reject(cancelledLoad);
        unloads[0]!.resolve();
        await result;
        notifyInitialUnload();
      } else {
        const requested = scenario === "api-same-object" ? resource : replacement;
        const result = Reflect.apply(player.load, receiver, [requested, "forwarded", extra]);
        const call = apiInvocations[1]!;
        if (result !== loads[1]!.promise || call.receiver !== receiver || call.args.length !== 3 ||
            call.args[0] !== requested || call.args[1] !== "forwarded" || call.args[2] !== extra) {
          throw new Error("Load forwarding changed its contract");
        }
        if (scenario === "api-successor") {
          const hooks = { load: player.load, unload: player.unload, pause: player.pause };
          if (!loads[2] || hooks.load === fixtureLoad || hooks.unload === fixtureUnload) {
            throw new Error("The reentrant recommendation must own its API hooks");
          }
          loads[0]!.reject(cancelledLoad);
          loads[1]!.resolve();
          await result;
          await Promise.resolve();
          await Promise.resolve();
          if (player.load !== hooks.load || player.unload !== hooks.unload || player.pause !== hooks.pause) {
            throw new Error("Old action settlement must not restore over successor hooks");
          }
          notifyInitialUnload();
          await finishLoad(2);
          plays[0]!.resolve();
        } else {
          currentSource = requested;
          loads[1]!.resolve();
          await result;
          if (scenario === "api-same-object") loads[0]!.resolve();
          else loads[0]!.reject(scenario === "api-genuine-failure"
            ? new Error("Recommendation fixture load failed") : cancelledLoad);
          notifyInitialUnload();
        }
      }
    } else if (scenario.startsWith("pause-")) {
      if (player.getConfig(false).playback?.autoplay !== false || !player.getVideoElement().paused) {
        throw new Error("The autoplay=false SDK media element must be paused during teardown");
      }
      player.pause("recommendation-fixture-between-clicks");
      if (player.pause !== pause) throw new Error("Cancelling the action must restore its pause hook immediately");
      if (deferredUnloads !== 1) throw new Error("The first load must still own one delayed teardown notification");
      const notifyUnload = () => { emit(player.exports.PlayerEvent.SourceUnloaded); deferredUnloads--; };
      if (scenario === "pause-cancelled-load") {
        notifyUnload();
        await finishLoad(0);
      } else if (scenario === "pause-receipt-destroy") {
        manager.release();
        invalidated = true;
        emit(player.exports.PlayerEvent.Destroy);
        loads[0]!.reject(new DOMException("Destroyed cancelled recommendation", "AbortError"));
        for (const [event, values] of listeners) {
          for (const callback of values.keys()) boundOff(event as Parameters<PlayerAPI["off"]>[0], callback as Parameters<PlayerAPI["off"]>[1]);
        }
        listeners.clear();
      } else {
        const notifyBeforeNext = scenario === "pause-next-after-unload" || scenario === "pause-next-after-external-unload";
        if (notifyBeforeNext) notifyUnload();
        second.getDomElement().get(0).click();
        if (scenario === "pause-next-external-source") {
          const replacement = { hls: "https://example.invalid/replacement.m3u8" };
          const loading = player.load(replacement);
          currentSource = replacement;
          loads[2]!.resolve();
          await loading;
        }
        if (!notifyBeforeNext) notifyUnload();
        if (scenario === "pause-next-external-unload" || scenario === "pause-next-after-external-unload") emit(player.exports.PlayerEvent.SourceUnloaded);
        loads[0]!.reject(new DOMException("Paused first recommendation", "AbortError"));
        if (scenario === "pause-next-before-unload" || scenario === "pause-next-after-unload") {
          await finishLoad(1);
          const latestPlay = plays[0];
          if (!latestPlay) throw new Error("The second recommendation must play after pause and delayed teardown");
          latestPlay.resolve();
        } else {
          loads[1]!.resolve();
          await Promise.resolve();
        }
      }
    } else if (scenario.startsWith("superseded-")) {
      second.getDomElement().get(0).click();
      if (deferredUnloads !== 1) throw new Error("The preceding unload must remain pending across both clicks");
      if (scenario === "superseded-external-source") {
        const replacement = { hls: "https://example.invalid/replacement.m3u8" };
        const loading = player.load(replacement);
        currentSource = replacement;
        loads[2]!.resolve();
        await loading;
      }
      emit(player.exports.PlayerEvent.SourceUnloaded);
      deferredUnloads--;
      if (scenario === "superseded-unload") emit(player.exports.PlayerEvent.SourceUnloaded);
      loads[0]!.reject(new Error("Load call was cancelled by another load or unload call"));
      if (scenario === "superseded-unload-pending") {
        await finishLoad(1);
        const latestPlay = plays[0];
        if (!latestPlay) throw new Error("The latest recommendation must play after the preceding delayed unload");
        latestPlay.resolve();
      } else {
        loads[1]!.resolve();
        await Promise.resolve();
      }
    } else if (scenario === "external-source-play") {
      await finishLoad(0);
      const replacement = { hls: "https://example.invalid/replacement.m3u8" };
      const loading = player.load(replacement);
      plays[0]!.reject(new DOMException("Replaced recommendation playback", "AbortError"));
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      emit(player.exports.PlayerEvent.SourceUnloaded);
      deferredUnloads--;
      currentSource = replacement;
      loads[1]!.resolve();
      await loading;
    } else if (scenario === "destroy-before-notify" || scenario === "destroy-notify-invalid" || scenario === "destroyed-failure" || scenario === "destroyed-sdk-cancel") {
      manager.release();
      // destroy() invalidates public APIs before its asynchronous Destroy event.
      invalidated = true;
      if (scenario !== "destroy-before-notify") emit(player.exports.PlayerEvent.Destroy);
      if (scenario === "destroyed-failure") loads[0]!.reject(new Error("Recommendation fixture load failed"));
      else if (scenario === "destroyed-sdk-cancel") loads[0]!.reject(new Error("Load was cancelled as the player is being destroyed"));
      else loads[0]!.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      if (player.pause !== pause) throw new Error("Disposed action must restore its pause hook before notification");
      if (scenario === "destroy-before-notify") emit(player.exports.PlayerEvent.Destroy);
      // The SDK owns removal of all listeners once destroy() completes.
      for (const [event, values] of listeners) {
        for (const callback of values.keys()) boundOff(event as Parameters<PlayerAPI["off"]>[0], callback as Parameters<PlayerAPI["off"]>[1]);
      }
      listeners.clear();
    } else if (scenario === "superseded") {
      second.getDomElement().get(0).click();
      await finishLoad(0);
      if (plays.length !== 0) throw new Error("An obsolete load must not play a later source");
      await finishLoad(1);
      plays[0]!.resolve();
    } else if (scenario === "active-failure" || scenario === "released-failure") {
      loads[0]!.reject(new Error("Recommendation fixture load failed"));
    } else if (scenario === "active-sdk-cancel" || scenario === "active-destroy-cancel-message") {
      loads[0]!.reject(new Error(scenario === "active-sdk-cancel"
        ? "Load call was cancelled by another load or unload call"
        : "Load was cancelled as the player is being destroyed"));
    } else if (scenario === "native-pause") {
      await finishLoad(0);
      await new Promise<void>((resolve) => {
        const paused = () => { boundOff(player.exports.PlayerEvent.Paused, paused); resolve(); };
        boundOn(player.exports.PlayerEvent.Paused, paused);
        player.getVideoElement().pause();
      });
      if (!player.isPaused()) throw new Error("A current native pause must be reflected in the SDK state");
      plays[0]!.reject(new DOMException("Current media paused", "AbortError"));
    } else if (scenario === "active-load-abort") {
      loads[0]!.reject(new DOMException("Active recommendation load abort", "AbortError"));
    } else if (scenario === "active-abort" || scenario === "play-failure") {
      await finishLoad(0);
      plays[0]!.reject(scenario === "active-abort"
        ? new DOMException("Active recommendation abort", "AbortError")
        : new Error("Recommendation fixture play failed"));
    } else if (scenario === "released-intent") {
      await finishLoad(0);
      plays[0]!.resolve();
    } else {
      if (scenario === "external-source") {
        const replacement = { hls: "https://example.invalid/replacement.m3u8" };
        const loading = player.load(replacement);
        currentSource = replacement;
        loads[1]!.resolve();
        await loading;
      }
      if (scenario === "pause" || scenario === "released-pause") player.pause("recommendation-fixture-cancel");
      if (scenario === "unload") emit(player.exports.PlayerEvent.SourceUnloaded);
      if (scenario === "destroy" || scenario === "released") emit(player.exports.PlayerEvent.Destroy);
      if (scenario === "released") loads[0]!.reject(new DOMException("Released recommendation load", "AbortError"));
      else {
        loads[0]!.resolve();
        await Promise.resolve();
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    return { loads: loads.length, plays: plays.length, listeners: [...listeners.values()].reduce((count, values) => count + values.size, 0), pauseRestored: player.pause === pause, loadRestored: player.load === fixtureLoad, unloadRestored: player.unload === fixtureUnload };
  } finally {
    player.load = load;
    player.unload = unload;
    player.play = play;
    player.pause = pause;
    player.getSource = getSource;
    player.on = on;
    player.off = off;
    manager.release();
    element.remove();
  }
}

// Validate invalidation timing against the installed SDK, independently of the
// controlled teardown fixture. No source or license is needed on localhost.
export async function inspectRealRecommendationDestroy() {
  const host = document.createElement("div");
  document.body.append(host);
  const checked = <T>(phase: string, operation: () => T): T => {
    try { return operation(); } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
      throw new Error(`${phase}: ${message}`);
    }
  };
  const player = checked("construct", () => new Player(host, { key: "", ui: false, playback: { autoplay: false } }));
  const PlayerAPINotAvailableError = player.exports.PlayerAPINotAvailableError;
  let finishLoad!: () => void;
  player.load = () => new Promise<void>((resolve) => { finishLoad = resolve; });
  let plays = 0;
  player.play = () => { plays++; return Promise.resolve(); };
  const item = new RecommendationItem({ recommendationConfig: {
    title: "Destroy recommendation", resource: { hls: "https://example.invalid/not-loaded.m3u8" },
  } });
  const manager = checked("UI manager", () => new UIManager(player, [{ identifier: UIVariantIdentifier.main,
    ui: new UIContainer({ components: [item] }),
  }]));
  let destroyNotified = false;
  let released = false;
  player.on(player.exports.PlayerEvent.Destroy, () => { destroyNotified = true; });
  try {
    checked("click", () => item.getDomElement().get(0).click());
    checked("release", () => manager.release());
    released = true;
    const destroying = checked("destroy", () => player.destroy());
    const notifiedSynchronously = destroyNotified;
    let invalidatedSynchronously = false;
    try { player.getSource(); } catch (error) {
      if (!(error instanceof PlayerAPINotAvailableError)) throw new Error(`Unexpected post-destroy exception: ${String(error)}`);
      invalidatedSynchronously = true;
    }
    finishLoad();
    await destroying.catch((error) => { throw new Error(`destroy settlement: ${String(error)}`); });
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    return { plays, invalidatedSynchronously, notifiedSynchronously, destroyNotified };
  } finally {
    if (!released) checked("final release", () => manager.release());
    host.remove();
  }
}

// Real load/play promises preserve the SDK's own cancellation and event ordering.
const realRecommendationRaces = new WeakMap<PlayerAPI, { manager: UIManager; host: HTMLElement }>();
export async function startRealRecommendationRace(player: PlayerAPI, scenario: "superseded" | "paused-previous" | "paused-current" | "destroyed" | "external-load" | "external-same-object" | "external-unload") {
  const previous = player.getSource();
  if (!previous?.hls) throw new Error("The real race fixture needs the app's public HLS source");
  const sourceA = { hls: previous.hls, title: "Race recommendation A" };
  const sourceB = { dash: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd", title: "Race recommendation B" };
  const a = new RecommendationItem({ recommendationConfig: { title: sourceA.title, resource: sourceA } });
  const b = new RecommendationItem({ recommendationConfig: { title: sourceB.title, resource: sourceB } });
  const host = document.createElement("div");
  document.body.append(host);
  const manager = new UIManager(player, [{ identifier: UIVariantIdentifier.main,
    ui: new UIContainer({ components: [a, b] }),
  }], { container: host });
  realRecommendationRaces.set(player, { manager, host });
  const initial = { autoplay: player.getConfig(false).playback?.autoplay, playing: player.isPlaying() };
  // Keep every action in one task so earlier SDK notifications remain queued.
  a.getDomElement().get(0).click();
  if (scenario === "paused-previous") player.pause("fixture-pause-previous");
  if (scenario === "destroyed") {
    releaseRealRecommendationRace(player);
    await player.destroy();
  } else if (scenario === "external-load" || scenario === "external-same-object") {
    await player.load(scenario === "external-same-object" ? sourceA : sourceB);
  } else if (scenario === "external-unload") {
    await player.unload();
  } else {
    b.getDomElement().get(0).click();
    if (scenario === "paused-current") player.pause("fixture-pause-current");
  }
  return initial;
}
export function releaseRealRecommendationRace(player: PlayerAPI) {
  const owned = realRecommendationRaces.get(player);
  if (!owned) return;
  realRecommendationRaces.delete(player);
  owned.manager.release();
  owned.host.remove();
}
