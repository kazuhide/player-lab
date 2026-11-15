import type { PlayerAPI } from "bitmovin-player";
import {
  Button, Container, PlaybackToggleOverlay, SeekBar, ToggleButton, VolumeSlider, UIFactory, UIManager, UIVariantIdentifier,
  type Component, type ComponentConfig, type UIContainer,
} from "bitmovin-player-ui";
import { EngagementTimeline } from "./EngagementTimeline.ts";
import { UI_JA } from "./ui-ja.ts";
import type { EngagementSnapshot, MetricMode } from "./types.ts";

/** Keeps official layouts and seek behavior; only the aggregate graph is application-owned. */
export function createPlayerUi(player: PlayerAPI, locale: "en" | "ja" = "en"): {
  manager: UIManager;
  timelines: EngagementTimeline[];
  setGraphData(snapshot: EngagementSnapshot | null, mode: MetricMode, locale: "en" | "ja", enabled: boolean): void;
  setLocale(locale: "en" | "ja"): void;
} {
  const localization = {
    language: locale,
    vocabularies: { ja: UI_JA },
    adaptLocalizationToSubtitleLanguage: false,
  };
  // Configure localization before any layout creates eagerly rendered labels.
  UIManager.setLocalizationConfig(localization);
  const timelines: EngagementTimeline[] = [];
  let graphState: {
    snapshot: EngagementSnapshot | null;
    mode: MetricMode;
    locale: "en" | "ja";
    enabled: boolean;
  } = { snapshot: null, mode: "replay", locale, enabled: true };
  const decorate = (container: UIContainer): UIContainer => {
    const visit = (parent: Container<ComponentConfig>): void => {
      for (const child of parent.getComponents().slice()) {
        if (child instanceof SeekBar && !(child instanceof VolumeSlider)) {
          const timeline = new EngagementTimeline({ seekBar: child });
          parent.prependComponent(timeline);
          const element = parent.getDomElement().get(0) as HTMLElement;
          element.classList.add("pl-engagement-track");
          timelines.push(timeline);
          timeline.setData(graphState.snapshot, graphState.mode, graphState.locale);
          timeline.setEnabled(graphState.enabled);
        } else if (child instanceof Container) {
          visit(child);
        }
      }
    };
    visit(container);
    return container;
  };

  const releaseUnconfiguredTree = (component: Component<ComponentConfig>): void => {
    const owned = new Set<Component<ComponentConfig>>();
    const collect = (child: Component<ComponentConfig>): void => {
      if (owned.has(child)) return;
      owned.add(child);
      const element = child.getDomElement().get(0);
      // DOM's public component association also covers icons owned by buttons.
      for (const node of [element, ...element.querySelectorAll<typeof element>("*")]) {
        if (node.component) owned.add(node.component);
      }
      if (child instanceof Container) for (const descendant of child.getComponents()) collect(descendant);
    };
    collect(component);
    for (const child of [...owned].reverse()) child.release();
  };
  const createCompactLayout = (): UIContainer => {
    const container = UIFactory.defaultLayouts.smallScreen();
    // On narrow desktop windows, the full-frame Play overlay can sit beneath the
    // control bar. Keep its visible Play button instead. Real mobile layouts use
    // TouchControlOverlay, which remains unchanged for tap and double-tap input.
    for (const component of container.getComponents().slice()) {
      if (component instanceof PlaybackToggleOverlay) {
        // Constructors subscribe to localization even before configuration. The
        // manager will never own an excluded component, so release its full tree.
        releaseUnconfiguredTree(component);
        container.removeComponent(component);
      }
    }
    return decorate(container);
  };

  // Variant ordering and conditions follow the official UIFactory.buildUI in UI 4.23.1.
  const smallScreenWidth = 800;
  const manager = new UIManager(player, [
    {
      ui: UIFactory.defaultLayouts.emptyState,
      condition: context => !context.isSourceLoaded,
      identifier: UIVariantIdentifier.empty,
    },
    {
      ui: UIFactory.defaultLayouts.smallScreenAds,
      condition: context => context.documentWidth < smallScreenWidth && context.isAd && context.adRequiresUi,
      identifier: UIVariantIdentifier.smallScreenAds,
    },
    {
      ui: createCompactLayout,
      condition: context => !context.isAd && !context.adRequiresUi && context.documentWidth < smallScreenWidth,
      identifier: UIVariantIdentifier.smallScreen,
    },
    {
      ui: UIFactory.defaultLayouts.tvAds,
      condition: context => context.isTv && context.isAd && context.adRequiresUi,
      identifier: UIVariantIdentifier.tvAds,
    },
    {
      ui: () => {
        const tv = UIFactory.defaultLayouts.tv();
        return { ...tv, ui: decorate(tv.ui) };
      },
      condition: context => context.isTv && !context.isAd && !context.adRequiresUi,
      identifier: UIVariantIdentifier.tv,
    },
    {
      ui: UIFactory.defaultLayouts.ads,
      condition: context => context.isAd && context.adRequiresUi,
      identifier: UIVariantIdentifier.ads,
    },
    {
      ui: () => decorate(UIFactory.defaultLayouts.main()),
      condition: context => !context.isAd && !context.adRequiresUi,
      identifier: UIVariantIdentifier.main,
    },
  ], { localization });
  const refreshAccessibleLabels = (component: Component<ComponentConfig>): void => {
    let label = component.getConfig().ariaLabel;
    if (component instanceof ToggleButton) {
      const config = component.getConfig();
      label = (component.isOn() ? config.onAriaLabel : config.offAriaLabel) ?? label ?? config.text;
    } else if (component instanceof Button) {
      label ??= component.getConfig().text;
    }
    if (label !== undefined) component.setAriaLabel(label);
    if (component instanceof Container) {
      for (const child of component.getComponents()) refreshAccessibleLabels(child);
    }
  };
  const refreshActiveLabels = (): void => {
    if (manager.activeUi) refreshAccessibleLabels(manager.activeUi.getUI());
  };
  manager.onActiveUiChanged.subscribe(refreshActiveLabels);
  return {
    manager,
    timelines,
    setGraphData(snapshot, mode, graphLocale, enabled) {
      graphState = { snapshot, mode, locale: graphLocale, enabled };
      for (const timeline of timelines) {
        timeline.setData(snapshot, mode, graphLocale);
        timeline.setEnabled(enabled);
      }
    },
    setLocale(next) {
      localization.language = next;
      graphState.locale = next;
      UIManager.setLocalizationConfig(localization);
      // UI 4.23.1 updates localized text live but leaves some button ARIA labels
      // at their initial language. Refresh through public APIs without toggling state.
      refreshActiveLabels();
      for (const timeline of timelines) timeline.setData(graphState.snapshot, graphState.mode, next);
    },
  };
}
