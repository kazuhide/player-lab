import packageInfo from "../package.json";
import type { ConfigurationDraft } from "./configuration";
import { SOURCES } from "./sources";
import { NATIVE_SETTING_FIELDS } from "./nativeSettings";
import { finiteNumber } from "./apiValues";

export const CURRENT_SDK_VERSION = packageInfo.dependencies["bitmovin-player-react-native"];
export const PROFILE_LIMITS = { count: 20, nameCharacters: 48, profileBytes: 8 * 1024, totalBytes: 128 * 1024 } as const;
export type ProfilePlatform = "react-native-ios" | "react-native-android";
export interface ProfileSettings {
  type: ConfigurationDraft["type"];
  startOffset: number | null;
  timeline: ConfigurationDraft["timeline"];
  autoplay: boolean;
  muted: boolean;
  forwardDuration: number | null;
  maxBitrate: number | null;
}
export interface ConfigurationProfile {
  name: string;
  sdkVersion: string;
  sourcePreset: string | null;
  settings: ProfileSettings;
  overrides: Record<string, string>;
}

const messages = {
  invalid: "This saved configuration contains unsupported or invalid fields.",
  format: "The saved configuration format or platform is not supported.",
  name: "Enter a name from 1 to 48 characters without control characters.",
  capacity: "Saved configurations exceed the local storage limits.",
  duplicate: "A configuration with this name already exists. Confirm replacement.",
  missing: "The selected saved configuration no longer exists.",
  sdk: "This configuration was saved with another SDK version. Confirm loading the validated draft.",
  storage: "Saved configurations could not be read or written.",
  recovery: "A saved configuration backup is available. Confirm recovery before loading it.",
} as const;
export class ConfigurationProfileError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = "ConfigurationProfileError"; }
}
const reject = (): never => { throw new ConfigurationProfileError("invalid"); };

export function profileErrorMessage(cause: unknown): string {
  return cause instanceof ConfigurationProfileError ? cause.message : messages.storage;
}
/** Count UTF-8 bytes without relying on browser-only encoders in native hosts. */
export function profileBytes(value: string): number {
  let size = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return size;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return reject();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) reject();
}
export function profileName(value: string): string {
  if (typeof value !== "string") throw new ConfigurationProfileError("name");
  const name = value.trim().normalize("NFC");
  if (!name || Array.from(name).length > PROFILE_LIMITS.nameCharacters || /[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(name)) throw new ConfigurationProfileError("name");
  return name;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) return reject();
  return value as T;
}
function number(value: unknown, minimum = -Infinity, maximum = Infinity, whole = false): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (whole && !Number.isSafeInteger(value))) return reject();
  return value;
}
function draftNumber(value: string): number | null {
  if (typeof value !== "string" || value.length > 384) return reject();
  if (!value.trim()) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return reject();
  return number(Number(value));
}
/** The basic form accepts decimal notation, so avoid scientific notation on restoration. */
function rawNumber(value: number | null): string {
  if (value === null) return "";
  const text = String(value);
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i);
  if (!match) return text;
  const digits = match[2]! + (match[3] ?? "");
  const point = match[2]!.length + Number(match[4]);
  return match[1] + (point <= 0 ? "0." + "0".repeat(-point) + digits : point >= digits.length ? digits + "0".repeat(point - digits.length) : digits.slice(0, point) + "." + digits.slice(point));
}

type Preset = { id: string; type: ConfigurationDraft["type"]; url: string };
const allowedIds = [
  "SourceConfig.options.startOffset", "SourceConfig.options.startOffsetTimelineReference", "SourceConfig.isPosterPersistent",
  "PlayerConfig.playbackConfig.isAutoplayEnabled", "PlayerConfig.playbackConfig.isMuted", "PlayerConfig.playbackConfig.handleAudioFocus",
  "PlayerConfig.playbackConfig.isBackgroundPlaybackEnabled", "PlayerConfig.playbackConfig.isPictureInPictureEnabled",
  "PlayerConfig.playbackConfig.isTimeShiftEnabled", "PlayerConfig.playbackConfig.isTunneledPlaybackEnabled",
  "PlayerConfig.bufferConfig.audioAndVideo.forwardDuration", "PlayerConfig.bufferConfig.restartThreshold", "PlayerConfig.bufferConfig.startupThreshold",
  "PlayerConfig.adaptationConfig.maxSelectableBitrate", "PlayerConfig.liveConfig.minTimeshiftBufferDepth", "PlayerConfig.mediaControlConfig.isEnabled",
  "PlayerConfig.remoteControlConfig.isCastEnabled", "PlayerConfig.styleConfig.isUiEnabled", "PlayerConfig.styleConfig.scalingMode", "PlayerConfig.styleConfig.userInterfaceType",
  "PlayerConfig.tweaksConfig.bandwidthEstimateWeightLimit", "PlayerConfig.tweaksConfig.isCustomHlsLoadingEnabled", "PlayerConfig.tweaksConfig.isNativeHlsParsingEnabled",
  "PlayerConfig.tweaksConfig.languagePropertyNormalization", "PlayerConfig.tweaksConfig.localDynamicDashWindowUpdateInterval", "PlayerConfig.tweaksConfig.playbackStartBehaviour",
  "PlayerConfig.tweaksConfig.seekToEndThreshold", "PlayerConfig.tweaksConfig.timeChangedInterval", "PlayerConfig.tweaksConfig.unstallingBehaviour",
  "PlayerConfig.tweaksConfig.useFiletypeExtractorFallbackForHls", "WebUiConfig.enableWebViewInspecting", "WebUiConfig.focusUiOnInitialization", "WebUiConfig.playbackSpeedSelectionEnabled",
] as const;
export const PROFILE_OVERRIDE_IDS: readonly string[] = allowedIds;
const allowed = new Set<string>(allowedIds);
const fields = new Map(NATIVE_SETTING_FIELDS.map(field => [field.id, field]));
function validateOverride(id: string, value: unknown): string {
  const field = fields.get(id);
  if (!allowed.has(id) || !field || typeof value !== "string" || value.length > 64 || !value || value !== value.trim()) return reject();
  if (field.kind === "number") { try { finiteNumber(value, "Saved numeric setting"); } catch { return reject(); } }
  else if ((field.kind !== "boolean" && field.kind !== "enum") || !field.choices?.includes(value)) return reject();
  return value;
}
function validateSettings(value: unknown, platform: ProfilePlatform): ProfileSettings {
  const data = record(value);
  keys(data, ["type", "startOffset", "timeline", "autoplay", "muted", "forwardDuration", "maxBitrate"]);
  if (typeof data.autoplay !== "boolean" || typeof data.muted !== "boolean") return reject();
  const type = choice(data.type, platform === "react-native-ios" ? ["hls", "progressive"] as const : ["hls", "dash", "progressive"] as const);
  const forwardDuration = number(data.forwardDuration, 0);
  if (platform === "react-native-android" && forwardDuration === 0) return reject();
  const maxBitrate = number(data.maxBitrate, 1, platform === "react-native-android" ? 2147483647 : Number.MAX_SAFE_INTEGER, true);
  return { type, startOffset: number(data.startOffset), timeline: choice(data.timeline, ["default", "start", "end"]), autoplay: data.autoplay, muted: data.muted, forwardDuration, maxBitrate };
}
function settingsFromDraft(draft: ConfigurationDraft, platform: ProfilePlatform): ProfileSettings {
  if (draft.maxBitrate.trim() && !/^\+?\d+(?:\.0*)?$/.test(draft.maxBitrate.trim())) return reject();
  return validateSettings({ type: draft.type, startOffset: draftNumber(draft.startOffset), timeline: draft.timeline, autoplay: draft.autoplay, muted: draft.muted,
    forwardDuration: draftNumber(draft.forwardDuration), maxBitrate: draftNumber(draft.maxBitrate) }, platform);
}
function presets(platform: ProfilePlatform): Preset[] {
  return SOURCES.filter(source => platform !== "react-native-ios" || source.kind.endsWith("hls"))
    .map(source => ({ id: source.id, type: source.kind.endsWith("hls") ? "hls" : "dash", url: source.url }));
}
function presetForId(id: unknown, platform: ProfilePlatform): Preset {
  const preset = presets(platform).find(candidate => candidate.id === id);
  return preset ?? reject();
}
function presetForDraft(draft: ConfigurationDraft, platform: ProfilePlatform): Preset | undefined {
  return presets(platform).find(preset => preset.url === draft.url && preset.type === draft.type);
}
function overridesFromDraft(draft: ConfigurationDraft): ConfigurationProfile["overrides"] {
  const overrides: ConfigurationProfile["overrides"] = {};
  for (const [id, value] of Object.entries(draft.apiSettings ?? {})) {
    if (!allowed.has(id)) continue;
    if (value === "") continue;
    overrides[id] = validateOverride(id, value);
  }
  return overrides;
}
function draftFromProfile(profile: ConfigurationProfile, current: ConfigurationDraft, preset: Preset | null): ConfigurationDraft {
  const apiSettings = Object.fromEntries(Object.entries(current.apiSettings ?? {}).filter(([id]) => !allowed.has(id)));
  Object.assign(apiSettings, profile.overrides);
  const data = profile.settings;
  return { ...current, ...(preset ? { url: preset.url } : {}), type: data.type, startOffset: rawNumber(data.startOffset), timeline: data.timeline,
    autoplay: data.autoplay, muted: data.muted, forwardDuration: rawNumber(data.forwardDuration), maxBitrate: rawNumber(data.maxBitrate), apiSettings };
}


function requirePlatform(platform: ProfilePlatform): void {
  if (!["react-native-ios", "react-native-android"].includes(platform)) throw new ConfigurationProfileError("format");
}
function validateProfile(value: unknown, platform: ProfilePlatform): ConfigurationProfile {
  requirePlatform(platform);
  const profile = record(value);
  keys(profile, ["name", "sdkVersion", "sourcePreset", "settings", "overrides"]);
  if (typeof profile.name !== "string" || profileName(profile.name) !== profile.name) return reject();
  if (typeof profile.sdkVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(profile.sdkVersion) || profile.sdkVersion.length > 80) return reject();
  const settings = validateSettings(profile.settings, platform);
  const preset = profile.sourcePreset === null ? null : presetForId(profile.sourcePreset, platform);
  if (preset && preset.type !== settings.type) return reject();
  const overrides: ConfigurationProfile["overrides"] = {};
  for (const [id, value] of Object.entries(record(profile.overrides))) overrides[id] = validateOverride(id, value);
  const result: ConfigurationProfile = { name: profile.name, sdkVersion: profile.sdkVersion, sourcePreset: preset?.id ?? null, settings, overrides };
  if (profileBytes(JSON.stringify(result)) > PROFILE_LIMITS.profileBytes) throw new ConfigurationProfileError("capacity");
  return result;
}
export function captureProfile(name: string, draft: ConfigurationDraft, platform: ProfilePlatform): ConfigurationProfile {
  const profile: ConfigurationProfile = { name: profileName(name), sdkVersion: CURRENT_SDK_VERSION,
    sourcePreset: presetForDraft(draft, platform)?.id ?? null,
    settings: settingsFromDraft(draft, platform), overrides: overridesFromDraft(draft) };
  return validateProfile(profile, platform);
}
/** Restoration only returns editor data. The existing Apply action owns all SDK effects. */
export function restoreProfile(profile: ConfigurationProfile, current: ConfigurationDraft, platform: ProfilePlatform, confirmSdk = false): ConfigurationDraft {
  const validated = validateProfile(profile, platform);
  if (validated.sdkVersion !== CURRENT_SDK_VERSION && !confirmSdk) throw new ConfigurationProfileError("sdk");
  const preset = validated.sourcePreset === null ? null : presetForId(validated.sourcePreset, platform);
  return draftFromProfile(validated, current, preset);
}

export function decodeProfiles(raw: string | null, platform: ProfilePlatform): ConfigurationProfile[] {
  requirePlatform(platform);
  if (raw === null) return [];
  if (typeof raw !== "string" || profileBytes(raw) > PROFILE_LIMITS.totalBytes) throw new ConfigurationProfileError("capacity");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return reject(); }
  const envelope = record(value);
  keys(envelope, ["schemaVersion", "platform", "profiles"]);
  if (envelope.schemaVersion !== 1 || envelope.platform !== platform) throw new ConfigurationProfileError("format");
  if (!Array.isArray(envelope.profiles)) return reject();
  if (envelope.profiles.length > PROFILE_LIMITS.count) throw new ConfigurationProfileError("capacity");
  const profiles = envelope.profiles.map(profile => validateProfile(profile, platform));
  if (new Set(profiles.map(profile => profile.name)).size !== profiles.length) return reject();
  return profiles;
}
export function encodeProfiles(profiles: readonly ConfigurationProfile[], platform: ProfilePlatform): string {
  requirePlatform(platform);
  if (!Array.isArray(profiles) || profiles.length > PROFILE_LIMITS.count) throw new ConfigurationProfileError("capacity");
  const validated = profiles.map(profile => validateProfile(profile, platform));
  const raw = JSON.stringify({ schemaVersion: 1, platform, profiles: validated });
  decodeProfiles(raw, platform);
  return raw;
}
export interface ProfileIO {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  recover?: () => Promise<void>;
}

/** Serialize local edits and acknowledge them only after durable storage confirms the write. */
export class ProfileRepository {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly io: ProfileIO, private readonly platform: ProfilePlatform) {}
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.then(() => {}, () => {});
    return next.catch(cause => { throw cause instanceof ConfigurationProfileError ? cause : new ConfigurationProfileError("storage"); });
  }
  private async read(): Promise<ConfigurationProfile[]> { return decodeProfiles(await this.io.read(), this.platform); }
  private async write(profiles: ConfigurationProfile[]): Promise<ConfigurationProfile[]> {
    const raw = encodeProfiles(profiles, this.platform);
    await this.io.write(raw);
    if (await this.io.read() !== raw) throw new ConfigurationProfileError("storage");
    return profiles;
  }
  list(): Promise<ConfigurationProfile[]> { return this.run(() => this.read()); }
  save(profile: ConfigurationProfile, replace = false): Promise<ConfigurationProfile[]> {
    return this.run(async () => {
      const validated = validateProfile(profile, this.platform);
      const profiles = await this.read();
      const index = profiles.findIndex(item => item.name === validated.name);
      if (index !== -1 && !replace) throw new ConfigurationProfileError("duplicate");
      if (index === -1) profiles.push(validated); else profiles[index] = validated;
      return this.write(profiles);
    });
  }
  remove(name: string): Promise<ConfigurationProfile[]> {
    return this.run(async () => {
      const profiles = await this.read();
      if (!profiles.some(item => item.name === name)) throw new ConfigurationProfileError("missing");
      return this.write(profiles.filter(item => item.name !== name));
    });
  }
  recover(): Promise<ConfigurationProfile[]> {
    return this.run(async () => {
      if (!this.io.recover) throw new ConfigurationProfileError("storage");
      await this.io.recover();
      return this.read();
    });
  }
}
