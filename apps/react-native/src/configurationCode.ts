import * as SDK from "bitmovin-player-react-native";
import type { Configuration, NativePlatform } from "./configuration";

const ENUMS: Record<string, Readonly<Record<string, string>>> = {
  SourceType: SDK.SourceType, TimelineReferencePoint: SDK.TimelineReferencePoint, SubtitleFormat: SDK.SubtitleFormat,
  AnalyticsRetryPolicy: SDK.AnalyticsRetryPolicy, ScalingMode: SDK.ScalingMode, UserInterfaceType: SDK.UserInterfaceType,
  SurfaceType: SDK.SurfaceType, ForceReuseVideoCodecReason: SDK.ForceReuseVideoCodecReason, PictureInPictureAction: SDK.PictureInPictureAction,
};
const ENUM_PATHS: Record<string, string> = {
  "SourceConfig.type": "SourceType", "SourceConfig.options.startOffsetTimelineReference": "TimelineReferencePoint",
  "SourceConfig.subtitleTracks[].format": "SubtitleFormat", "PlayerConfig.analyticsConfig.retryPolicy": "AnalyticsRetryPolicy",
  "PlayerConfig.styleConfig.scalingMode": "ScalingMode", "PlayerConfig.styleConfig.userInterfaceType": "UserInterfaceType",
  "PlayerConfig.tweaksConfig.forceReuseVideoCodecReasons[]": "ForceReuseVideoCodecReason",
  "PlayerViewConfig.surfaceType": "SurfaceType", "PlayerViewProps.scalingMode": "ScalingMode",
  "PlayerViewProps.pictureInPictureActions[]": "PictureInPictureAction",
};

/** Emit actual enum expressions rather than asserting that arbitrary JSON has SDK types. */
export function sdkCodeValue(value: unknown, path: string, depth = 0): string {
  path = path.replace(/^OfflineContentConfig\.sourceConfig/, "SourceConfig");
  if (/licenseKey$/i.test(path)) return JSON.stringify(path.includes("analytics") ? "YOUR_ANALYTICS_KEY" : "YOUR_PLAYER_KEY");
  if (/headers\./i.test(path)) return JSON.stringify("YOUR_HEADER_VALUE");
  const enumName = ENUM_PATHS[path];
  if (enumName) {
    const key = Object.entries(ENUMS[enumName] ?? {}).find(([, item]) => item === value)?.[0];
    if (key) return `SDK.${enumName}.${key}`;
  }
  if (Array.isArray(value)) return "[" + value.map((item) => sdkCodeValue(item, path + "[]", depth + 1)).join(", ") + "]";
  if (value && typeof value === "object") {
    if (path.endsWith(".variant") && "uiManagerFactoryFunction" in value && typeof value.uiManagerFactoryFunction === "string") {
      return `new SDK.CustomUi(${JSON.stringify(value.uiManagerFactoryFunction)})`;
    }
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (!entries.length) return "{}";
    const indent = "  ".repeat(depth + 1);
    return "{\n" + entries.map(([key, item]) => indent + JSON.stringify(key) + ": " + sdkCodeValue(item, path + "." + key, depth + 1)).join(",\n") + "\n" + "  ".repeat(depth) + "}";
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Read the validated applied object, never unapplied form text or environment keys. */
export function configurationCode(applied: Configuration, platform: NativePlatform, factory: string | null): string {
  const playerConfig: SDK.PlayerConfig = { ...applied.player, licenseKey: "YOUR_PLAYER_KEY" };
  if (factory) playerConfig.styleConfig = {
    userInterfaceType: SDK.UserInterfaceType.Bitmovin,
    playerUiJs: platform === "android" ? "file:///android_asset/webui/bitmovinplayer-ui.js" : "bitmovinplayer-ui.js",
    playerUiCss: platform === "android" ? "file:///android_asset/webui/bitmovinplayer-ui.css" : "bitmovinplayer-ui.css",
    ...applied.player.styleConfig,
  };
  const webUi: SDK.WebUiConfig = { ...(factory ? { variant: new SDK.CustomUi(factory) } : {}), ...applied.webUi };
  const viewConfig: SDK.PlayerViewConfig = { ...applied.view, ...(Object.keys(webUi).length ? { uiConfig: webUi } : {}) };
  const lines = [
    'import React, { useEffect } from "react";',
    'import * as SDK from "bitmovin-player-react-native";', "",
    `const playerConfig: SDK.PlayerConfig = ${sdkCodeValue(playerConfig, "PlayerConfig")};`,
    `const sourceConfig: SDK.SourceConfig = ${sdkCodeValue(applied.source, "SourceConfig")};`,
    `const viewConfig: SDK.PlayerViewConfig = ${sdkCodeValue(viewConfig, "PlayerViewConfig")};`,
    `const viewProps = ${sdkCodeValue(applied.props, "PlayerViewProps")};`,
  ];
  if (Object.keys(applied.draft.apiSettings ?? {}).some((id) => /^(Offline|BitmovinCastManagerOptions)/.test(id))) lines.push(
    "// Validated inputs for the offline and Cast API experiments.",
    `const offlineConfig: SDK.OfflineContentConfig = ${sdkCodeValue(applied.offline, "OfflineContentConfig")};`,
    `const downloadRequest: SDK.OfflineDownloadRequest = ${sdkCodeValue(applied.download, "OfflineDownloadRequest")};`,
    `const offlineOptions: SDK.OfflineSourceOptions = ${sdkCodeValue(applied.offlineOptions, "OfflineSourceOptions")};`,
    `const castOptions: SDK.BitmovinCastManagerOptions = ${sdkCodeValue(applied.cast, "BitmovinCastManagerOptions")};`,
  );
  lines.push("", "export function ConfiguredPlayer() {", "  const player = SDK.usePlayer(playerConfig);",
    "  useEffect(() => () => { player.destroy(); }, [player]);",
    "  return <SDK.PlayerView player={player} config={viewConfig} {...viewProps}",
    "    style={{ width: \"100%\", aspectRatio: 16 / 9 }}",
    "    onPlayerViewReady={() => player.load(sourceConfig)} />;", "}", "",
    "// Player and Analytics license values and request headers are placeholders.",
    "// The app's Allow DVR control is separate from SDK configuration.",
    "// An external track's isDefault flag is metadata; choose subtitles in the player menu to enable them.",
  );
  return lines.join("\n");
}
