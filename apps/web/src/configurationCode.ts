/** Format data as JavaScript without losing infinite SDK limits or executing strings. */
export function javascriptValue(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error("Configuration nesting is too deep.");
  if (value === null) return "null";
  if (typeof value === "number") {
    if (Number.isNaN(value)) throw new Error("NaN is not a configuration value.");
    return String(value);
  }
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  const indent = "  ".repeat(depth);
  const child = `${indent}  `;
  if (Array.isArray(value)) {
    return value.length ? `[\n${value.map((item) => child + javascriptValue(item, depth + 1)).join(",\n")}\n${indent}]` : "[]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined && typeof item !== "function");
    return entries.length ? `{\n${entries.map(([key, item]) => `${child}${JSON.stringify(key)}: ${javascriptValue(item, depth + 1)}`).join(",\n")}\n${indent}}` : "{}";
  }
  throw new Error("Only configuration data can be exported.");
}

export interface ConfigurationCode {
  /** GUI-owned paths only. The SDK's entire config, including credentials, must never be passed. */
  player: Record<string, unknown>;
  source: Record<string, unknown>;
  ui: Record<string, unknown>;
  runtime: string[];
}

export function configurationCode(snapshot: ConfigurationCode): string {
  const player = Object.fromEntries(Object.entries(snapshot.player).filter(([name]) => name !== "key" && name !== "analytics"));
  const sourceNames = new Set(["hls", "dash", "progressive", "title", "description", "poster", "options", "thumbnailTrack", "subtitles", "audioTracks"]);
  const source = Object.fromEntries(Object.entries(snapshot.source).filter(([name]) => sourceNames.has(name)));
  if (source.options && typeof source.options === "object") {
    const names = new Set(["persistentPoster", "startOffset", "startOffsetTimelineReference"]);
    source.options = Object.fromEntries(Object.entries(source.options).filter(([name]) => names.has(name)));
  }
  return [
    'import { Player, type PlayerConfig, type SourceConfig } from "bitmovin-player";',
    'import type { UIConfig } from "bitmovin-player-ui";',
    "",
    "// Creation and load settings submitted to the current player. Draft edits are excluded.",
    `const playerConfig = ${javascriptValue({ ...player, key: "YOUR_PLAYER_KEY", ui: false })} as PlayerConfig;`,
    `const sourceConfig = ${javascriptValue(source)} as SourceConfig;`,
    `const uiConfig = ${javascriptValue(snapshot.ui)} as UIConfig;`,
    "",
    'const player = new Player(document.getElementById("player")!, playerConfig);',
    "// Attach the selected UI with the construction code shown beside the player.",
    "await player.load(sourceConfig);",
    "",
    "// Runtime values observed when this snapshot was refreshed.",
    ...snapshot.runtime,
    "",
    "// Player and Analytics license values are not included.",
  ].join("\n");
}
