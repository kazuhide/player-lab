import type { Configuration, NativePlatform } from "./configuration";

/** Read the validated applied object, never the editable draft or environment. */
export function configurationCode(applied: Configuration, platform: NativePlatform, factory: string | null): string {
  const lines = [
    'import React, { useEffect } from "react";',
    'import { PlayerView, usePlayer, CustomUi, UserInterfaceType, type PlayerConfig, type SourceConfig, type PlayerViewConfig } from "bitmovin-player-react-native";',
    "",
    `const playerConfig = ${JSON.stringify({ playbackConfig: applied.player.playbackConfig, bufferConfig: applied.player.bufferConfig, adaptationConfig: applied.player.adaptationConfig, licenseKey: "YOUR_PLAYER_KEY" }, null, 2)} as PlayerConfig;`,
    `const sourceConfig = ${JSON.stringify(applied.source, null, 2)} as SourceConfig;`,
  ];
  if (factory) {
    lines.push(
      "// Package these shared UI resources with the app as described in the guide.",
      `playerConfig.styleConfig = { userInterfaceType: UserInterfaceType.Bitmovin, playerUiJs: ${JSON.stringify(platform === "android" ? "file:///android_asset/webui/bitmovinplayer-ui.js" : "bitmovinplayer-ui.js")}, playerUiCss: ${JSON.stringify(platform === "android" ? "file:///android_asset/webui/bitmovinplayer-ui.css" : "bitmovinplayer-ui.css")} };`,
      `const viewConfig: PlayerViewConfig = { uiConfig: { variant: new CustomUi(${JSON.stringify(factory)}) } };`,
    );
  } else lines.push("const viewConfig: PlayerViewConfig = {};");
  lines.push(
    "",
    "export function ConfiguredPlayer() {",
    "  const player = usePlayer(playerConfig);",
    "  useEffect(() => () => { player.destroy(); }, [player]);",
    "  return <PlayerView player={player} config={viewConfig}",
    "    style={{ width: \"100%\", aspectRatio: 16 / 9 }}",
    "    onPlayerViewReady={() => player.load(sourceConfig)} />;",
    "}",
    "",
    "// Player and Analytics license values are not included.",
    "// The app's Allow DVR control is separate from SDK configuration.",
    "// An external track's isDefault flag is metadata; choose subtitles in the player menu to enable them.",
  );
  return lines.join("\n");
}
