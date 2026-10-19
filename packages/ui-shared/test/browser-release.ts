import { Container, DynamicSettingsPanelItem, Icon, PlaybackSpeedSelectBox, RecommendationItem, SeekBar, SettingsPanelItem, UIContainer, UIFactory, UIManager, UIVariantIdentifier, Watermark, i18n, type Component, type ComponentConfig } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";
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
export async function inspectRecommendationPromises(player: PlayerAPI, scenario: "released" | "superseded" | "active-failure" | "active-abort" | "released-failure" | "released-intent" | "pause" | "released-pause" | "external-source" | "unload" | "destroy" | "play-failure") {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const loads: (ReturnType<typeof deferred> & { source: Parameters<PlayerAPI["load"]>[0] })[] = [];
  const plays: ReturnType<typeof deferred>[] = [];
  const load = player.load;
  const play = player.play;
  const pause = player.pause;
  const getSource = player.getSource;
  const on = player.on;
  const off = player.off;
  const boundOn = on.bind(player);
  const boundOff = off.bind(player);
  let currentSource = player.getSource();
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
    listeners.get(event)?.delete(callback);
    boundOff(event, callback);
  };
  const emit = (event: string) => [...(listeners.get(event)?.values() ?? [])].forEach((callback) => callback());
  player.getSource = () => currentSource;
  player.load = (source) => {
    const pending = { ...deferred(), source };
    loads.push(pending);
    const unloading = currentSource != null;
    currentSource = null;
    if (unloading) emit(player.exports.PlayerEvent.SourceUnloaded);
    return pending.promise;
  };
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
    if (scenario === "superseded") {
      second.getDomElement().get(0).click();
      await finishLoad(0);
      if (plays.length !== 0) throw new Error("An obsolete load must not play a later source");
      await finishLoad(1);
      plays[0]!.resolve();
    } else if (scenario === "active-failure" || scenario === "released-failure") {
      loads[0]!.reject(new Error("Recommendation fixture load failed"));
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
    return { loads: loads.length, plays: plays.length, listeners: [...listeners.values()].reduce((count, values) => count + values.size, 0), pauseRestored: player.pause === pause };
  } finally {
    player.load = load;
    player.play = play;
    player.pause = pause;
    player.getSource = getSource;
    player.on = on;
    player.off = off;
    manager.release();
    element.remove();
  }
}
