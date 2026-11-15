import type { PlayerAPI } from "bitmovin-player";
import {
  Container, PlaybackToggleOverlay, SeekBar, VolumeSlider, UIFactory, UIManager, UIVariantIdentifier,
  type ComponentConfig, type UIContainer,
} from "bitmovin-player-ui";
import { EngagementTimeline } from "./EngagementTimeline.ts";
import { UI_JA } from "./ui-ja.ts";

/** Keeps official layouts and seek behavior; only the aggregate graph is application-owned. */
export function createPlayerUi(player: PlayerAPI, locale: "en" | "ja" = "en"): {
  manager: UIManager;
  timelines: EngagementTimeline[];
} {
  const localization = {
    language: locale,
    vocabularies: { ja: UI_JA },
    adaptLocalizationToSubtitleLanguage: false,
  };
  // Configure localization before any layout creates eagerly rendered labels.
  UIManager.setLocalizationConfig(localization);
  const timelines: EngagementTimeline[] = [];
  const decorate = (container: UIContainer): UIContainer => {
    const visit = (parent: Container<ComponentConfig>): void => {
      for (const child of parent.getComponents().slice()) {
        if (child instanceof SeekBar && !(child instanceof VolumeSlider)) {
          const timeline = new EngagementTimeline({ seekBar: child });
          parent.prependComponent(timeline);
          const element = parent.getDomElement().get(0) as HTMLElement;
          element.classList.add("pl-engagement-track");
          timelines.push(timeline);
        } else if (child instanceof Container) {
          visit(child);
        }
      }
    };
    visit(container);
    return container;
  };

  const main = decorate(UIFactory.defaultLayouts.main());
  const compactLayout = UIFactory.defaultLayouts.smallScreen();
  // On narrow desktop windows, the full-frame Play overlay can sit beneath the
  // control bar. Keep its visible Play button instead. Real mobile layouts use
  // TouchControlOverlay, which remains unchanged for tap and double-tap input.
  for (const component of compactLayout.getComponents().slice()) {
    if (component instanceof PlaybackToggleOverlay) compactLayout.removeComponent(component);
  }
  const smallScreen = decorate(compactLayout);
  const tv = UIFactory.defaultLayouts.tv();
  decorate(tv.ui);

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
      ui: smallScreen,
      condition: context => !context.isAd && !context.adRequiresUi && context.documentWidth < smallScreenWidth,
      identifier: UIVariantIdentifier.smallScreen,
    },
    {
      ui: UIFactory.defaultLayouts.tvAds,
      condition: context => context.isTv && context.isAd && context.adRequiresUi,
      identifier: UIVariantIdentifier.tvAds,
    },
    {
      ...tv,
      condition: context => context.isTv && !context.isAd && !context.adRequiresUi,
      identifier: UIVariantIdentifier.tv,
    },
    {
      ui: UIFactory.defaultLayouts.ads,
      condition: context => context.isAd && context.adRequiresUi,
      identifier: UIVariantIdentifier.ads,
    },
    {
      ui: main,
      condition: context => !context.isAd && !context.adRequiresUi,
      identifier: UIVariantIdentifier.main,
    },
  ], { localization });
  return { manager, timelines };
}
