import * as SDK from "bitmovin-player-react-native";
import type { Configuration, NativePlatform } from "./configuration";
import { NATIVE_SCRIPT_FIELDS, type NativeScriptDraft } from "./nativeScripts";

class ScriptBody { constructor(readonly expression: string) {} }
function scripted(value: object, prefix: string, draft: NativeScriptDraft | undefined): object {
  const root: Record<string, unknown> = { ...value };
  if (!draft?.allowed) return root;
  for (const field of NATIVE_SCRIPT_FIELDS) {
    const body = draft.bodies[field.id];
    if (body === undefined || !field.id.startsWith(prefix + ".")) continue;
    const path = field.id.slice(prefix.length + 1).split(".");
    let target = root;
    for (const key of path.slice(0, -1)) {
      const existing = target[key];
      const next: Record<string, unknown> = existing && typeof existing === "object" ? { ...existing } : {};
      if (key === "advertisingConfig" && !("schedule" in next)) next.schedule = [];
      target[key] = next; target = next;
    }
    const factory = /Handler$/.test(field.id);
    const asynchronous = field.signature.includes("=> Promise");
    target[path[path.length - 1]!] = new ScriptBody(factory ? `(() => {\n${body}\n})()` : `${asynchronous ? "async " : ""}(${field.parameters.join(", ")}) => {\n${body}\n}`);
  }
  return root;
}

const ENUMS: Record<string, Readonly<Record<string, string>>> = {
  SourceType: SDK.SourceType, TimelineReferencePoint: SDK.TimelineReferencePoint, SubtitleFormat: SDK.SubtitleFormat,
  AnalyticsRetryPolicy: SDK.AnalyticsRetryPolicy, ScalingMode: SDK.ScalingMode, UserInterfaceType: SDK.UserInterfaceType,
  SurfaceType: SDK.SurfaceType, ForceReuseVideoCodecReason: SDK.ForceReuseVideoCodecReason, PictureInPictureAction: SDK.PictureInPictureAction,
  AdSourceType: SDK.AdSourceType,
};
const ENUM_PATHS: Record<string, string> = {
  "SourceConfig.type": "SourceType", "SourceConfig.options.startOffsetTimelineReference": "TimelineReferencePoint",
  "SourceConfig.subtitleTracks[].format": "SubtitleFormat", "PlayerConfig.analyticsConfig.retryPolicy": "AnalyticsRetryPolicy",
  "PlayerConfig.styleConfig.scalingMode": "ScalingMode", "PlayerConfig.styleConfig.userInterfaceType": "UserInterfaceType",
  "PlayerConfig.tweaksConfig.forceReuseVideoCodecReasons[]": "ForceReuseVideoCodecReason",
  "PlayerViewConfig.surfaceType": "SurfaceType", "PlayerViewProps.scalingMode": "ScalingMode",
  "PlayerViewProps.pictureInPictureActions[]": "PictureInPictureAction",
  "PlayerConfig.advertisingConfig.schedule[].sources[].type": "AdSourceType",
};

/** Emit actual enum expressions rather than asserting that arbitrary JSON has SDK types. */
export function sdkCodeValue(value: unknown, path: string, depth = 0): string {
  if (value instanceof ScriptBody) return value.expression;
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
  const scripts = applied.draft.scripts;
  const lines = [
    'import React, { useEffect, useRef, useState } from "react";',
    'import { Modal, View, Button } from "react-native";',
    'import * as SDK from "bitmovin-player-react-native";', "",
    "export function ConfiguredPlayer() {",
    "  const current = useRef<SDK.Player | null>(null);",
    `  const [fullscreen, setFullscreen] = useState(${Boolean(applied.props.isFullscreenRequested)});`,
    "  const lab = {",
    "    getPlayer() { if (!current.current) throw new Error(\"Player is not active\"); return current.current; },",
    "    getSource() { return current.current?.source; },",
    "    setFullscreen, Source: SDK.Source, CustomUi: SDK.CustomUi, CustomMessageHandler: SDK.CustomMessageHandler,",
    "  };",
    `const playerConfig: SDK.PlayerConfig = ${sdkCodeValue(scripted(playerConfig, "PlayerConfig", scripts), "PlayerConfig")};`,
    `const sourceConfig: SDK.SourceConfig = ${sdkCodeValue(scripted(applied.source, "SourceConfig", scripts), "SourceConfig")};`,
    `const viewConfig: SDK.PlayerViewConfig = ${sdkCodeValue(viewConfig, "PlayerViewConfig")};`,
    `const viewProps: Pick<SDK.PlayerViewProps, "isFullscreenRequested" | "isPictureInPictureEnabled" | "isPictureInPictureRequested" | "pictureInPictureActions" | "scalingMode" | "fullscreenHandler" | "customMessageHandler"> = ${sdkCodeValue(scripted(applied.props, "PlayerViewProps", scripts), "PlayerViewProps")};`,
    "  if (viewProps.isFullscreenRequested !== undefined && !viewProps.fullscreenHandler) viewProps.fullscreenHandler = {",
    "    isFullscreenActive: false,",
    "    enterFullscreen() { this.isFullscreenActive = true; setFullscreen(true); },",
    "    exitFullscreen() { this.isFullscreenActive = false; setFullscreen(false); },",
    "  };",
  ];
  if (applied.draft.arraySettings?.offlineSubtitles || Object.keys(applied.draft.apiSettings ?? {}).some((id) => /^(Offline|BitmovinCastManagerOptions)/.test(id))) lines.push(
    "// Validated inputs for the offline and Cast API experiments.",
    `const offlineConfig: SDK.OfflineContentConfig = ${sdkCodeValue(scripted(applied.offline, "OfflineContentConfig", scripts), "OfflineContentConfig")};`,
    `const downloadRequest: SDK.OfflineDownloadRequest = ${sdkCodeValue(applied.download, "OfflineDownloadRequest")};`,
    `const offlineOptions: SDK.OfflineSourceOptions = ${sdkCodeValue(applied.offlineOptions, "OfflineSourceOptions")};`,
    `const castOptions: SDK.BitmovinCastManagerOptions = ${sdkCodeValue(applied.cast, "BitmovinCastManagerOptions")};`,
  );
  lines.push("", "  const player = SDK.usePlayer(playerConfig);", "  current.current = player;",
    "  useEffect(() => () => { current.current = null; player.destroy(); }, [player]);",
    "  const playerView = <SDK.PlayerView player={player} config={viewConfig} {...viewProps}",
    "    {...(viewProps.isFullscreenRequested !== undefined ? { isFullscreenRequested: fullscreen } : {})}",
    "    style={fullscreen ? { flex: 1, width: \"100%\" } : { width: \"100%\", aspectRatio: 16 / 9 }}",
    "    onPlayerViewReady={() => player.load(sourceConfig)} />;",
    "  return fullscreen ? <Modal visible presentationStyle=\"fullScreen\">{playerView}<Button title=\"Exit fullscreen\" onPress={() => { viewProps.fullscreenHandler?.exitFullscreen(); setFullscreen(false); }} /></Modal> : <View>{playerView}</View>;", "}", "",
    "// Player and Analytics license values and request headers are placeholders.",
    "// The app's Allow DVR control is separate from SDK configuration.",
    "// An external track's isDefault flag is metadata; choose subtitles in the player menu to enable them.",
    "// Edited callback bodies are included as entered. Review them before sharing this example.",
  );
  return lines.join("\n");
}
