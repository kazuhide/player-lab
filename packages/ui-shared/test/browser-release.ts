import { Container, DynamicSettingsPanelItem, Icon, SeekBar, UIFactory, i18n, type Component, type ComponentConfig } from "bitmovin-player-ui";
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
      const root = manager.getUiVariants()[0]!.ui;
      const adoptedChildren = name !== "Default" || root.getComponents().every((child, index) => child === stockChildren[index]);
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
