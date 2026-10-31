/** Local profiles contain validated basic form values, never whole SDK configs. */
export const PROFILE_STORAGE_KEY = "player-lab.web.configuration-profiles.v1";
const MAX_PROFILE_BYTES = 8 * 1024;
const MAX_STORE_BYTES = 128 * 1024;
const MAX_PROFILES = 20;
/** Null records removal of an optional override, including booleans and enums. */
type Value = string | number | boolean | null;
type Kind = "bool" | "number" | "text" | "enum";
type TextKind = "language" | "bitrate" | "dimension" | "ratio";
export interface EditableProfileField { key: string; kind: Kind; options?: string[]; min?: number }
export interface ProfileRule extends EditableProfileField { text?: TextKind }
export type ProfileRules = ReadonlyMap<string, ProfileRule>;
export interface ConfigurationProfile { id: string; name: string; sdkVersion: string; values: Record<string, Value> }
export interface ConfigurationProfiles { schemaVersion: 1; platform: "web"; profiles: ConfigurationProfile[] }
export interface ProfileStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export type ProfileErrorCode = "format" | "platform" | "setting" | "name" | "limit" | "storage" | "busy";
export class ProfileError extends Error {
  constructor(readonly code: ProfileErrorCode) { super(code); }
}

const playerFields = new Set([
  "playback.autoplay", "playback.muted", "playback.volume", "playback.playsInline", "playback.seeking", "playback.allowDecodingErrorRecovery",
  "adaptation.preload", "adaptation.disableDownloadCancelling", "adaptation.qualityThreshold", "adaptation.qualityUpperThreshold", "adaptation.logic", "adaptation.rttEstimationMethod",
  "buffer.video.forwardduration", "buffer.video.backwardduration", "buffer.audio.forwardduration", "buffer.audio.backwardduration",
  "network.requestApi", "network.defaultRequestTimeout", "logs.level", "logs.bitmovin", "tweaks.log_level", "style.nativeSubtitles",
  "cast.enable", "live.incrementalManifestUpdates", "live.lowLatency.targetLatency", "licensing.delay", "storage.disableStorageApi",
  ...["manifest/dash", "manifest/hls/master", "manifest/hls/variant", "media/video", "media/audio", "media/subtitles", "media/thumbnails"].map(type => `network.requestTimeout.${type}`),
]);
const tweakFields = new Set([
  "max_buffer_level", "startup_threshold", "restart_threshold", "native_hls_parsing", "native_hls_download_error_handling", "stop_download_on_pause",
  "hls_audio_only_threshold_bitrate", "file_protocol", "adaptation_set_switching_without_supplemental_property", "drm_stall_recovery_settle_timeout_ms",
  "drm_stall_recovery_license_activity_lookback_ms", "ignore_mp4_edts_box", "ignore_hls_audio_groups", "prevent_video_element_preloading",
  "fairplay_ignore_duplicate_init_data_key_errors", "no_quota_exceeded_adjustment", "segment_encryption_transition_handling", "enable_seek_for_live",
  "resume_live_content_at_previous_position_after_ad_break", "dword_base_media_decode_timestamps", "force_base_media_decode_time_rewrite",
  "tizen_max_safe_bmdt", "tizen_max_safe_pto", "webos_max_safe_bmdt", "webos_max_safe_pto", "akamai_datetime_parsing", "clear_buffers_on_seeking_backwards",
  "drop_invalid_segments", "min_size_for_gap_skipping", "proactive_gap_skip_distance_seconds", "force_software_decryption", "max_retries", "max_cdn_retries",
  "max_mpd_retries", "mpd_retry_delay", "mpd_update_period_tolerance", "parse_cea_708_caption", "hls_sync_segment_playback_time_via_media_sequence",
  "hls_parse_manifest_in_worker", "hls_clear_buffers_on_discontinuity_switches", "chunked_cmaf_streaming", "parse_emsg_boxes", "hls_backup_stream_penalty_duration",
  "check_all_drm_licenses_for_kid", "hls_parse_native_metadata", "prefer_managed_media_source", "infinite_retries_for_live", "minimal_backward_buffer_clearing_interval",
  "max_safe_mse_duration", "disable_parallel_segment_loading", "enable_muted_background_playback", "postpone_manifest_updates_until_playback_start",
  "max_startup_buffer", "dash_clear_buffers_on_period_switches", "disable_auto_recovery_on_dvr_window_exceeded", "enable_performance_logs",
  "enable_sgai_handling", "audio_track_switch_buffer_grace_period", "disable_audio_buffer_clearing_on_track_switch", "sgai_trigger_delay_compensation",
]);
const textFields: Record<string, TextKind> = {
  "playback.audioLanguage": "language", "playback.subtitleLanguage": "language",
  "adaptation.startupBitrate": "bitrate", "adaptation.maxStartupBitrate": "bitrate",
  "adaptation.bitrates.maxSelectableVideoBitrate": "bitrate", "adaptation.bitrates.minSelectableVideoBitrate": "bitrate",
  "adaptation.bitrates.maxSelectableAudioBitrate": "bitrate", "adaptation.bitrates.minSelectableAudioBitrate": "bitrate",
  "style.width": "dimension", "style.height": "dimension", "style.aspectratio": "ratio",
};
const sourceFields = new Set(["options.persistentPoster", "options.startOffset", "options.startOffsetTimelineReference"]);

/** Intersect an explicit policy with the fields and types the current panel edits. */
export function createProfileRules(fields: readonly EditableProfileField[]): ProfileRules {
  const rules = new Map<string, ProfileRule>();
  for (const field of fields) {
    const player = field.key.startsWith("PlayerConfig.");
    const path = field.key.slice(13);
    const text = player && Object.prototype.hasOwnProperty.call(textFields, path) ? textFields[path] : undefined;
    const known = player ? playerFields.has(path) || path.startsWith("tweaks.") && tweakFields.has(path.slice(7))
      : field.key.startsWith("SourceConfig.") && sourceFields.has(path);
    if (text && field.kind === "text") rules.set(field.key, { ...field, text });
    else if (known && field.kind !== "text") rules.set(field.key, { ...field, ...(field.options ? { options: [...field.options] } : {}) });
  }
  return rules;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new ProfileError("format");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new ProfileError("format");
}
const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
function nameValue(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || [...input.trim()].length > 48 || /[\p{Cc}\p{Cf}]/u.test(input)) throw new ProfileError("name");
  return input.trim();
}
function validValue(input: unknown, rule: ProfileRule): input is Value {
  if (input === null) return true;
  if (rule.kind === "bool") return typeof input === "boolean";
  if (rule.kind === "number") return typeof input === "number" && Number.isFinite(input) && Math.abs(input) <= Number.MAX_SAFE_INTEGER && (rule.min === undefined || input >= rule.min);
  if (rule.kind === "enum") return typeof input === "string" && input !== "" && !!rule.options?.includes(input);
  if (typeof input !== "string" || !input || input.length > 64) return false;
  if (rule.text === "language") return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(input);
  if (rule.text === "bitrate") return /^(?:auto|Infinity|\d+(?:\.\d+)?)$/.test(input) && (input === "auto" || input === "Infinity" || Number(input) <= Number.MAX_SAFE_INTEGER);
  if (rule.text === "dimension") return /^(?:auto|\d+(?:\.\d+)?(?:px|%|em|rem|vh|vw))$/.test(input);
  return rule.text === "ratio" && /^[1-9]\d{0,3}:[1-9]\d{0,3}$/.test(input);
}
export function validateProfileValues(input: unknown, rules: ProfileRules): Record<string, Value> {
  const record = object(input); const values: Record<string, Value> = {};
  if (!Object.keys(record).length || Object.keys(record).length > 200) throw new ProfileError("setting");
  for (const [key, value] of Object.entries(record)) {
    const rule = rules.get(key);
    if (!rule || !validValue(value, rule)) throw new ProfileError("setting");
    values[key] = value;
  }
  return values;
}

export function decodeProfiles(text: string, rules: ProfileRules): ConfigurationProfiles {
  if (bytes(text) > MAX_STORE_BYTES) throw new ProfileError("limit");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ProfileError("format"); }
  return validateCollection(parsed, rules);
}
function validateCollection(parsed: unknown, rules: ProfileRules): ConfigurationProfiles {
  const root = object(parsed); exact(root, ["schemaVersion", "platform", "profiles"]);
  if (root.schemaVersion !== 1) throw new ProfileError("format");
  if (root.platform !== "web") throw new ProfileError("platform");
  if (!Array.isArray(root.profiles) || root.profiles.length > MAX_PROFILES) throw new ProfileError("limit");
  const ids = new Set<string>(); const names = new Set<string>();
  const profiles = root.profiles.map(value => {
    const entry = object(value); exact(entry, ["id", "name", "sdkVersion", "values"]);
    if (typeof entry.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.id) || ids.has(entry.id)) throw new ProfileError("format");
    const name = nameValue(entry.name);
    if (names.has(name.toLowerCase())) throw new ProfileError("name");
    if (typeof entry.sdkVersion !== "string" || entry.sdkVersion.length > 48 || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(entry.sdkVersion)) throw new ProfileError("format");
    const profile = { id: entry.id, name, sdkVersion: entry.sdkVersion, values: validateProfileValues(entry.values, rules) };
    if (bytes(JSON.stringify(profile)) > MAX_PROFILE_BYTES) throw new ProfileError("limit");
    ids.add(entry.id); names.add(name.toLowerCase()); return profile;
  });
  const result = { schemaVersion: 1 as const, platform: "web" as const, profiles };
  if (bytes(JSON.stringify(result)) > MAX_STORE_BYTES) throw new ProfileError("limit");
  return result;
}
export function encodeProfiles(profiles: ConfigurationProfiles, rules: ProfileRules): string {
  return JSON.stringify(validateCollection(profiles, rules));
}
export function saveProfile(collection: ConfigurationProfiles, name: string, values: unknown, sdkVersion: string, rules: ProfileRules, id: string): ConfigurationProfiles {
  const normalized = nameValue(name);
  const existing = collection.profiles.find(profile => profile.name.toLowerCase() === normalized.toLowerCase());
  const profile = { id: existing?.id ?? id, name: normalized, sdkVersion, values: validateProfileValues(values, rules) };
  const profiles = existing ? collection.profiles.map(entry => entry.id === existing.id ? profile : entry) : [...collection.profiles, profile];
  return validateCollection({ ...collection, profiles }, rules);
}
export function deleteProfile(collection: ConfigurationProfiles, id: string): ConfigurationProfiles {
  return { ...collection, profiles: collection.profiles.filter(profile => profile.id !== id) };
}
export function readProfiles(storage: () => ProfileStore, rules: ProfileRules): ConfigurationProfiles {
  let text: string | null;
  try { text = storage().getItem(PROFILE_STORAGE_KEY); } catch { throw new ProfileError("storage"); }
  return text === null ? { schemaVersion: 1, platform: "web", profiles: [] } : decodeProfiles(text, rules);
}
export function writeProfiles(storage: () => ProfileStore, collection: ConfigurationProfiles, rules: ProfileRules): void {
  const text = encodeProfiles(collection, rules);
  try { storage().setItem(PROFILE_STORAGE_KEY, text); } catch { throw new ProfileError("storage"); }
}
export function clearProfiles(storage: () => ProfileStore): void {
  try { storage().removeItem(PROFILE_STORAGE_KEY); } catch { throw new ProfileError("storage"); }
}
