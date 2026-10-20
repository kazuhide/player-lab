import type { Configuration } from "./configuration";

/** Export only validated GUI settings; the native media host retains lifecycle ownership. */
export function configurationCode(applied: Configuration): string {
  return [
    'import type { PlayerConfig, SourceConfig } from "bitmovin-player";',
    "",
    `const playerConfig = ${JSON.stringify({ playback: applied.player.playback, buffer: applied.player.buffer, adaptation: applied.player.adaptation, key: "YOUR_PLAYER_KEY", ui: false, tweaks: { app_id: "com.playerlab.vega" } }, null, 2)} as PlayerConfig;`,
    `const sourceConfig = ${JSON.stringify(applied.source, null, 2)} as SourceConfig;`,
    "",
    "// Pass playerConfig and sourceConfig to this sample's BitmovinPlayer component.",
    "// Keep its native media initialization, surface handling and release sequence.",
    "// Player and Analytics license values are not included.",
    "// Allow DVR controls the app's native controls separately from SDK configuration.",
  ].join("\n");
}
