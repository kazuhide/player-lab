import type { PlayerAPI } from "bitmovin-player";
import {
  Button, Container, i18n, PlaybackToggleOverlay, SeekBar, ToggleButton, VolumeSlider, UIFactory, UIManager, UIVariantIdentifier,
  type Component, type ComponentConfig, type UIContainer,
} from "bitmovin-player-ui";
import { EngagementTimeline } from "./EngagementTimeline.ts";
import { UI_JA } from "./ui-ja.ts";
import type { MetricMode, TimelineSnapshot } from "./types.ts";
import { createViewerMarkers, type ViewerMarkerDefinition } from "./viewer-markers.ts";

/** Keep official layouts and seeking, with reference-owned graph data and markers. */
export function createPlayerUi(player: PlayerAPI, locale: "en" | "ja" = "en"): {
  manager: UIManager;
  timelines: EngagementTimeline[];
  setGraphData(snapshot: TimelineSnapshot | null, mode: MetricMode, locale: "en" | "ja", enabled: boolean): void;
  setLocale(locale: "en" | "ja"): void;
  setViewerMarkers(markers: readonly ViewerMarkerDefinition[]): void;
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
    snapshot: TimelineSnapshot | null;
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
    if (component instanceof Container) {
      for (const child of component.getComponents()) releaseUnconfiguredTree(child);
    }
    component.release();
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
  const viewerMarkers = createViewerMarkers(manager.timelineMarkers);
  return {
    manager,
    timelines,
    setViewerMarkers(markers) { viewerMarkers.set(markers); },
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
      // Unlike setLocalizationConfig, setLanguage notifies existing UI components.
      i18n.setLanguage(next);
      // UI 4.23.1 updates localized text live but leaves some button ARIA labels
      // at their initial language. Refresh through public APIs without toggling state.
      refreshActiveLabels();
      for (const timeline of timelines) timeline.setData(graphState.snapshot, graphState.mode, next);
    },
  };
}
