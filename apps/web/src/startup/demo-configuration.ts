import type { DemoEngineId } from "./contract";

export interface AppliedConfiguration {
  readonly engine: DemoEngineId;
  readonly version: string;
  readonly code: string;
}

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
type Check = (value: unknown) => Value;
type Fields = Record<string, Value>;
const invalid = (): never => { throw new Error("Unsupported applied configuration."); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  return value as Record<string, unknown>;
}
function own(value: unknown, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object(value), key);
  if (descriptor && !("value" in descriptor)) return invalid();
  return descriptor?.value;
}
const boolean: Check = (value) => typeof value === "boolean" ? value : invalid();
const number: Check = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400 ? value : invalid();
function choice<T extends string | number | boolean | null>(...values: readonly T[]) {
  return (value: unknown): T => {
    for (const allowed of values) if (allowed === value) return allowed;
    return invalid();
  };
}
function fields(value: unknown, checks: Record<string, Check>, required = Object.keys(checks)): Fields {
  object(value); const result: Fields = {};
  for (const [key, check] of Object.entries(checks)) {
    const candidate = own(value, key);
    if (candidate !== undefined) result[key] = check(candidate);
    else if (required.includes(key)) invalid();
  }
  return result;
}
const nested = (checks: Record<string, Check>, required?: string[]): Check => (value) => fields(value, checks, required);
const list = (check: Check, max = 8): Check => (value) => Array.isArray(value) && value.length > 0 && value.length <= max
  ? value.map(check) : invalid();
/** Serialize only newly projected allowlisted values; never SDK metadata itself. */
function literal(value: Fields, variables: Record<string, string> = {}): string {
  const entries = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item, null, 2)}`);
  entries.push(...Object.entries(variables).map(([key, identifier]) => `${JSON.stringify(key)}: ${identifier}`));
  return `{\n  ${entries.join(",\n").replace(/\n/g, "\n  ")}\n}`;
}
const buffer = nested({ forwardduration: number, backwardduration: number });

function hls(raw: unknown): string {
  const configuration = fields(raw, {
    debug: boolean, autoStartLoad: boolean, startPosition: number,
    audioPreference: nested({ lang: choice("en") }), preferManagedMediaSource: boolean, enableWorker: boolean,
    lowLatencyMode: boolean, enableInterstitialPlayback: boolean,
    maxBufferLength: number, maxMaxBufferLength: number, backBufferLength: number, frontBufferFlushThreshold: number,
  }, ["debug", "autoStartLoad", "startPosition", "audioPreference", "preferManagedMediaSource", "enableWorker", "lowLatencyMode", "enableInterstitialPlayback"]);
  return `import Hls from "hls.js";
import emittedWorkerUrl from "hls.js/dist/hls.worker.js?url";

const hls = new Hls(${literal(configuration, { workerPath: "emittedWorkerUrl" })});
hls.attachMedia(video);
hls.loadSource(mediaUrl);
await video.play();`;
}

function shaka(raw: unknown): string {
  const format = choice("hls", "dash")(own(raw, "sourceType"));
  const bundle = choice("shaka-player.hls-es2021", "shaka-player.dash-es2021")(own(raw, "bundle"));
  if (bundle !== `shaka-player.${format}-es2021`) return invalid();
  const start = number(own(raw, "startTimeSeconds"));
  const configuration = fields(raw, {
    preferredAudio: list(nested({ language: choice("en"), role: choice(""), label: choice(""), channelCount: number,
      codec: choice(""), spatialAudio: boolean })),
    streaming: nested({ preferNativeHls: boolean, fallbackToNativeHlsOnMseError: boolean,
      useNativeHlsForFairPlay: boolean, lowLatencyMode: boolean, bufferingGoal: number,
      bufferBehind: number, rebufferingGoal: number, segmentPrefetchLimit: choice(0, 1, 2) },
    ["preferNativeHls", "fallbackToNativeHlsOnMseError", "useNativeHlsForFairPlay", "lowLatencyMode"]),
    cmcd: nested({ enabled: boolean }), cmsd: nested({ enabled: boolean }),
    ads: nested({ disableHLSInterstitial: boolean, disableDASHInterstitial: boolean, disableSVTA: boolean }),
  });
  const mime = format === "hls" ? "application/x-mpegurl" : "application/dash+xml";
  return `import shaka from "shaka-player/dist/${bundle}.js";

shaka.polyfill.installAll();
const player = new shaka.Player();
if (!player.configure(${literal(configuration)})) throw new Error("Configuration rejected");
await player.attach(video);
const loading = player.load(mediaUrl, ${start}, "${mime}");
const playing = video.play();
await Promise.all([loading, playing]);`;
}

const V8_MODULES = {
  EngineBitmovin: "engine-bitmovin", RendererMSE: "mserenderer", ABR: "abr", ContainerMP4: "container-mp4",
  HLS: "hls", ContainerTS: "container-ts", XML: "xml", DASH: "dash",
} as const;
function bitmovin8(raw: unknown): string {
  const format = choice("hls", "dash")(own(raw, "format"));
  if (own(raw, "modular") !== true) return invalid();
  const modules = own(raw, "modules");
  const expected = ["Core", "EngineBitmovin", "RendererMSE", "ABR", "ContainerMP4", ...(format === "hls" ? ["HLS", "ContainerTS"] : ["XML", "DASH"])];
  if (!Array.isArray(modules) || modules.length !== expected.length || new Set(modules).size !== modules.length
    || expected.some((name) => !modules.includes(name))) return invalid();
  const imports: string[] = []; const registration: string[] = [];
  for (const name of modules) {
    if (name === "Core") continue;
    const file = V8_MODULES[name as keyof typeof V8_MODULES];
    imports.push(`import ${name} from "bitmovin-player/modules/bitmovinplayer-${file}";`);
    registration.push(`Player.addModule(bitmovin8Module(${name}));`);
  }
  const configuration = fields(raw, {
    playback: nested({ muted: boolean, autoplay: boolean, audioLanguage: choice("en"),
      preferredTech: list(nested({ player: choice("html5"), streaming: choice(format) }), 1) }),
    ui: choice(false), analytics: choice(false), storage: nested({ disableStorageApi: boolean }),
    buffer: nested({ audio: buffer, video: buffer }), logs: nested({ level: choice("off", "warn", "error", "log", "debug"), bitmovin: boolean }),
  }, ["playback", "ui", "analytics", "storage"]);
  const options = fields(own(raw, "sourceOptions"), { startOffset: number });
  const rate = number(own(raw, "playbackRate"));
  return `import { Player } from "bitmovin-player/modules/bitmovinplayer-core";
${imports.join("\n")}

function bitmovin8Module(value) {
  const valid = candidate => candidate && typeof candidate === "object"
    && typeof candidate.name === "string" && candidate.name.length > 0
    && (typeof candidate.module === "function" || (typeof candidate.module === "object" && candidate.module !== null));
  if (valid(value)) return value;
  if (value && typeof value === "object" && valid(value.default)) return value.default;
  throw new Error("Invalid Bitmovin module definition.");
}
${registration.join("\n")}
const player = new Player(container, ${literal(configuration, { key: "playerKey" })});
video.playbackRate = ${rate};
player.setVideoElement(video);
await player.load({ ${format}: mediaUrl, options: ${literal(options)} }, "html5.${format}");
await player.play();`;
}

const WEBX_CLEAR_PACKAGES = [
  ["AdaptationPackage", "playerx-adaptation.package"],
  ["CapabilitiesPackage", "playerx-capabilities.package"],
  ["ContainerMp4Package", "playerx-container-mp4.package"],
  ["DataPackage", "playerx-data.package"],
  ["HlsManifestPackage", "playerx-hls-manifest.package"],
  ["MediaStatePackage", "playerx-media-state.package"],
  ["MsePlaybackPackage", "playerx-mse-playback.package"],
  ["NativePlaybackPackage", "playerx-native-playback.package"],
  ["NetworkPackage", "playerx-network.package"],
  ["PlatformDetectionPackage", "playerx-platform-detection.package"],
  ["PlaybackApiPackage", "playerx-playback-api.package"],
  ["PlaybackPackage", "playerx-playback.package"],
  ["PlaybackTechnologyPackage", "playerx-playback-technology.package"],
  ["SegmentProcessingPackage", "playerx-segment-processing.package"],
  ["SourcePackage", "playerx-source.package"],
  ["SourcesApiPackage", "playerx-sources-api.package"],
  ["StreamDataStructurePackage", "playerx-stream-data-structure.package"],
  ["StreamingPackage", "playerx-streaming.package"],
  ["VideoElementControllerPackage", "playerx-video-element-controller.package"],
  ["viewMode", "playerx-view-mode.package"],
] as const;

function clearFmp4Factory(raw: unknown): string {
  const packages = own(raw, "packages");
  if (!Array.isArray(packages) || packages.length !== WEBX_CLEAR_PACKAGES.length) return invalid();
  for (const [index, [, id]] of WEBX_CLEAR_PACKAGES.entries()) {
    const entry = Object.getOwnPropertyDescriptor(packages, String(index));
    if (!entry || !("value" in entry) || entry.value !== id) return invalid();
  }
  const imports = WEBX_CLEAR_PACKAGES.map(([name, id]) => name === "viewMode"
    ? `import * as ViewModeEntry from "@bitmovin/player-web-x/packages/${id}";`
    : `import { ${name} } from "@bitmovin/player-web-x/packages/${id}";`);
  const additions = WEBX_CLEAR_PACKAGES.map(([name]) => `    player.packages.add(${name});`).join("\n");
  return `import { Player as CorePlayer } from "@bitmovin/player-web-x/bundles/playerx-core";
${imports.join("\n")}

// Clear fMP4 HLS only; TS, AES, UI, Analytics, advertising and subtitle packages are omitted.
function isPublicViewModePackage(value) {
  if (!value || typeof value !== "object") return false;
  const dependencies = Reflect.get(value, "dependencies");
  const onAdd = Reflect.get(value, "onAdd");
  return typeof onAdd === "function" && Array.isArray(dependencies)
    && dependencies.length === 3
    && ["core-effects", "source-state-atom", "source-api-manager"].every(name => dependencies.includes(name));
}

function resolvePublicViewModePackage(value) {
  if (isPublicViewModePackage(value)) return value;
  const nested = value && typeof value === "object" ? Reflect.get(value, "default") : undefined;
  if (isPublicViewModePackage(nested)) return nested;
  throw new Error("Public ViewMode package export is incompatible");
}

async function createPlayer(config) {
  const viewMode = resolvePublicViewModePackage(Reflect.get(ViewModeEntry, "default"));
  const player = CorePlayer(config);
  try {
${additions}
    return player;
  } catch (error) {
    await player.dispose();
    throw error;
  }
}`;
}

function webx(raw: unknown): string {
  const format = choice("hls", "dash")(own(raw, "sourceType"));
  const bundle = choice("playerx-hls", "playerx-dash", "playerx-core-clear-fmp4")(own(raw, "bundle"));
  const compact = bundle === "playerx-core-clear-fmp4";
  if (compact ? format !== "hls" : bundle !== `playerx-${format}`) return invalid();
  const factory = compact ? clearFmp4Factory(raw) : `import { Player } from "@bitmovin/player-web-x/bundles/${bundle}";`;
  const configuration = fields(raw, { muted: boolean, autoplay: boolean, preventSeeking: boolean });
  const video = fields(raw, { playsInline: boolean, controls: boolean });
  const start = number(own(raw, "startTimeSeconds")); const rate = number(own(raw, "playbackRate"));
  const defaultLogLevel = choice(0, 1, 2, 3, 4, null)(own(raw, "defaultLogLevel"));
  const player: Fields = { playback: configuration };
  if (defaultLogLevel !== null) player.defaultLogLevel = defaultLogLevel;
  const options = { attach: boolean(own(raw, "stagingAttach")), loadControl: choice(0, 1, 2)(own(raw, "stagingLoadControl")) };
  const load = choice(0, 1, 2)(own(raw, "startLoadControl"));
  const sequence = choice("attach-before-load", "load-before-attach")(own(raw, "startSequence"));
  const content = choice("content")(own(raw, "contentType"));
  const attach = "player.sources.attachVideo(source, { video, container });\nvideo.controls = false;";
  const loading = `source.loadControl = ${load};`;
  return `${factory}

video.muted = ${configuration.muted};
video.defaultMuted = ${configuration.muted};
video.playsInline = ${video.playsInline};
video.controls = ${video.controls};
video.playbackRate = ${rate};
const player = ${compact ? "await createPlayer" : "Player"}(${literal(player, { key: "playerKey", defaultContainer: "container", defaultVideoElement: "video" })});
const source = player.sources.add({ resources: [{ url: mediaUrl, type: "${format}" }], contentType: "${content}" }, ${literal(options)});
source.currentTime = ${start};
source.playbackRate = ${rate};
${sequence === "load-before-attach" ? `${loading}\n${attach}` : `${attach}\n${loading}`}
await source.play();`;
}

/** A fail-closed projection from an observed snapshot, with no provider imports. */
export function appliedConfiguration(metadata: unknown, engine: DemoEngineId): AppliedConfiguration | null {
  try {
    if (own(metadata, "engine") !== engine) return null;
    const version = own(metadata, "version");
    if (typeof version !== "string" || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) return null;
    const configuration = own(metadata, "configuration");
    const render = { "web-x": webx, "bitmovin-8": bitmovin8, hls, shaka }[engine];
    return { engine, version, code: render(configuration) };
  } catch { return null; }
}
