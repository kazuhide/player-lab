import type { Configuration } from "./configuration";
import { catalog } from "./api/catalog";
import { configurationOverrides } from "./api/configInputs";
import { typedCode } from "./api/typedCode";

/** Export only validated GUI settings; the native media host retains lifecycle ownership. */
export function configurationCode(applied: Configuration): string {
  const overrides = configurationOverrides(applied.draft.apiInputs ?? []);
  // Code generation retains editor markers; it never executes a callback or value factory.
  const player = overrides.apply("PlayerConfig", { ...applied.player, key: "YOUR_PLAYER_KEY", ui: false, tweaks: { app_id: "com.playerlab.vega", ...applied.player.tweaks } });
  const source = overrides.apply("SourceConfig", applied.source);
  player.key = "YOUR_PLAYER_KEY";
  return [
    'import type { PlayerAPI, PlayerConfig, SourceConfig } from "bitmovin-player";',
    'import * as SDK from "bitmovin-player/modules/bitmovinplayer-core";',
    "",
    "// Supply accessors owned by the current native media session.",
    "export function createConfiguration(lab: { getPlayer(): PlayerAPI; getSource(): SourceConfig | null }) {",
    `const playerConfig: PlayerConfig = ${typedCode(catalog.roots.PlayerConfig!, player, ["PlayerConfig"])};`,
    `const sourceConfig: SourceConfig = ${typedCode(catalog.roots.SourceConfig!, source, ["SourceConfig"])};`,
    "return { playerConfig, sourceConfig };",
    "}",
    "",
    "// Pass playerConfig and sourceConfig to this sample's BitmovinPlayer component.",
    "// Keep its native media initialization, surface handling and release sequence.",
    "// Player and Analytics license values are not included.",
    "// Edited JavaScript bodies are included as entered; review them before sharing.",
    "// Keep the Vega Fetch network transport required by this native integration.",
    "// Allow DVR controls the app's native controls separately from SDK configuration.",
  ].join("\n");
}
