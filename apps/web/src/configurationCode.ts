import { copiedConfigurationString } from "../../../shared/configurationDifferences";

/** Format data as JavaScript without losing infinite SDK limits or executing strings. */
export function javascriptValue(value: unknown, depth = 0): string {
  return javascriptData(value, depth, []);
}

function javascriptData(value: unknown, depth: number, path: string[], expression?: (value: unknown, path: string[]) => string | undefined): string {
  if (depth > 32) throw new Error("Configuration nesting is too deep.");
  const replacement = expression?.(value, path);
  if (replacement !== undefined) return replacement;
  if (value === null) return "null";
  if (typeof value === "number") {
    if (Number.isNaN(value)) throw new Error("NaN is not a configuration value.");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(copiedConfigurationString(value, path));
  if (typeof value === "boolean") return JSON.stringify(value);
  const indent = "  ".repeat(depth);
  const child = `${indent}  `;
  if (Array.isArray(value)) {
    return value.length ? `[\n${value.map((item, index) => child + javascriptData(item, depth + 1, [...path, String(index)], expression)).join(",\n")}\n${indent}]` : "[]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined && typeof item !== "function");
    return entries.length ? `{\n${entries.map(([key, item]) => `${child}${JSON.stringify(key)}: ${javascriptData(item, depth + 1, [...path, key], expression)}`).join(",\n")}\n${indent}}` : "{}";
  }
  throw new Error("Only configuration data can be exported.");
}

const ENUMS: Record<string, Record<string, string>> = {
  TimelineReferencePoint: { Start: "start", End: "end" },
  LogLevel: { DEBUG: "debug", LOG: "log", WARN: "warn", ERROR: "error", OFF: "off" },
  NetworkRequestApi: { XHR: "xhr", Fetch: "fetch" },
  AdaptationLogicType: { BUFFER: "v1", BUFFER_FILL_RATE: "v2", DOWNLOAD_PREDICTION: "v3", LOW_LATENCY: "low-latency-v1", WISH: "wish" },
  RttEstimationMethod: { WeightedAverage: "weightedaverage", Median: "median" },
};
const ENUM_PATHS: Record<string, string> = {
  "SourceConfig.options.startOffsetTimelineReference": "TimelineReferencePoint",
  "PlayerConfig.logs.level": "LogLevel", "PlayerConfig.tweaks.log_level": "LogLevel",
  "PlayerConfig.network.requestApi": "NetworkRequestApi",
  ...Object.fromEntries(["desktop", "mobile"].flatMap(target => [
    [`PlayerConfig.adaptation.${target}.logic`, "AdaptationLogicType"],
    [`PlayerConfig.adaptation.${target}.rttEstimationMethod`, "RttEstimationMethod"],
  ])),
};

export interface ConfigurationCode {
  /** GUI-owned paths only. The SDK's entire config, including credentials, must never be passed. */
  player: Record<string, unknown>;
  source: Record<string, unknown>;
  ui: Record<string, unknown>;
  runtime: string[];
}

export function configurationCode(snapshot: ConfigurationCode): string {
  const player = Object.fromEntries(Object.entries(snapshot.player).filter(([name]) => name !== "key" && name !== "analytics"));
  const sourceNames = new Set(["hls", "dash", "progressive", "title", "description", "poster", "options", "thumbnailTrack", "subtitleTracks", "audioTracks"]);
  const source = Object.fromEntries(Object.entries(snapshot.source).filter(([name]) => sourceNames.has(name)));
  if (source.options && typeof source.options === "object") {
    const names = new Set(["persistentPoster", "startOffset", "startOffsetTimelineReference"]);
    source.options = Object.fromEntries(Object.entries(source.options).filter(([name]) => names.has(name)));
  }
  const usedEnums = new Set<string>();
  const configCode = (root: string, value: unknown): string => javascriptData(value, 0, [root], (item, path) => {
    const name = ENUM_PATHS[path.join(".")];
    const member = name && Object.entries(ENUMS[name] ?? {}).find(([, value]) => value === item)?.[0];
    if (!name || !member) return undefined;
    usedEnums.add(name);
    return `${name}.${member}`;
  });
  const playerCode = configCode("PlayerConfig", { ...player, key: "YOUR_PLAYER_KEY", ui: false });
  const sourceCode = configCode("SourceConfig", source);
  return [
    'import { Player, type PlayerConfig, type SourceConfig } from "bitmovin-player";',
    'import type { UIConfig } from "bitmovin-player-ui";',
    ...[...usedEnums].map(name => `enum ${name} { ${Object.entries(ENUMS[name] ?? {}).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(", ")} }`),
    "",
    "// Creation and load settings submitted to the current player. Draft edits are excluded.",
    `const playerConfig: PlayerConfig = ${playerCode};`,
    `const sourceConfig: SourceConfig = ${sourceCode};`,
    `const uiConfig: UIConfig = ${javascriptValue(snapshot.ui)};`,
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
