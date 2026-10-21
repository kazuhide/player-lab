import { BufferType, type CustomDataConfig, type Player, type SourceConfig } from "bitmovin-player-react-native";
import { finiteNumber, stringEntries } from "./apiValues";
import { EMPTY_METADATA, metadataValue } from "./metadataInput";

export interface ApiArgument { name: string; label: string; initial: string; choices?: readonly string[]; editor?: "metadata"; }
export interface ApiOperation {
  id: string;
  arguments: ApiArgument[];
  run: (values: Record<string, string>) => unknown;
  code: (values: Record<string, string>) => string;
}

const value: ApiArgument = { name: "value", label: "Value", initial: "" };
const time: ApiArgument = { name: "value", label: "Time (seconds)", initial: "0" };
const bufferType: ApiArgument = { name: "type", label: "Buffer type", initial: "forwardDuration", choices: ["forwardDuration", "backwardDuration"] };
function selectedBuffer(value: string | undefined): BufferType {
  if (value === "forwardDuration") return BufferType.FORWARD_DURATION;
  if (value === "backwardDuration") return BufferType.BACKWARD_DURATION;
  throw new Error("Select a buffer type.");
}
const customKeys = [
  "customData1", "customData2", "customData3", "customData4", "customData5", "customData6", "customData7", "customData8", "customData9", "customData10",
  "customData11", "customData12", "customData13", "customData14", "customData15", "customData16", "customData17", "customData18", "customData19", "customData20",
  "customData21", "customData22", "customData23", "customData24", "customData25", "customData26", "customData27", "customData28", "customData29", "customData30", "experimentName",
] as const;
export function customData(raw: string): CustomDataConfig {
  const output: CustomDataConfig = {};
  for (const [name, value] of Object.entries(stringEntries(raw))) {
    const key = customKeys.find((key) => key === name);
    if (!key) throw new Error("Use customData1 through customData30, or experimentName.");
    output[key] = value;
  }
  return output;
}

/** Every operation calls the typed wrapper directly; input validation precedes native dispatch. */
export function nativeOperations(player: Player, source: SourceConfig): ApiOperation[] {
  const operations: ApiOperation[] = [];
  function noArgs(id: string, run: () => unknown): void {
    operations.push({ id, arguments: [], run, code: () => id.replace(/^Player\./, "player.").replace(/^Source\./, "player.source.") + "()" });
  }
  function one<T>(id: string, argument: ApiArgument, parse: (value: string) => T, run: (value: T) => unknown): void {
    operations.push({ id, arguments: [argument], run: (values) => run(parse(values[argument.name] ?? "")),
      code: (values) => id.replace(/^Player\./, "player.").replace(/^Source\./, "player.source.") + "(" + JSON.stringify(parse(values[argument.name] ?? "")) + ")" });
  }
  function property(id: string, read: () => unknown): void {
    operations.push({ id, arguments: [], run: read,
      code: () => id.replace(/^Player\./, "player.").replace(/^Source\./, "player.source.") });
  }
  noArgs("Player.initialize", () => player.initialize());
  noArgs("Player.destroy", () => player.destroy());
  noArgs("Player.play", () => player.play());
  noArgs("Player.pause", () => player.pause());
  noArgs("Player.mute", () => player.mute());
  noArgs("Player.unmute", () => player.unmute());
  noArgs("Player.unload", () => player.unload());
  noArgs("Player.skipAd", () => player.skipAd());
  noArgs("Player.castVideo", () => player.castVideo());
  noArgs("Player.castStop", () => player.castStop());
  noArgs("Player.showAirPlayTargetPicker", () => player.showAirPlayTargetPicker());
  noArgs("Player.load", () => player.load(source));
  operations[operations.length - 1]!.code = () => "player.load(sourceConfig);";
  one("Player.seek", time, (raw) => finiteNumber(raw, "Time", 0), (v) => player.seek(v));
  one("Player.timeShift", time, (raw) => finiteNumber(raw, "Offset"), (v) => player.timeShift(v));
  one("Player.setVolume", { ...value, initial: "100", label: "Volume (0–100)" }, (raw) => finiteNumber(raw, "Volume", 0, 100), (v) => player.setVolume(v));
  one("Player.setPlaybackSpeed", { ...value, initial: "1", label: "Playback speed" }, (raw) => finiteNumber(raw, "Speed"), (v) => player.setPlaybackSpeed(v));
  one("Player.setVideoQuality", { ...value, initial: "auto", label: "Quality ID (getAvailableVideoQualities, or auto)" }, (raw) => raw, (v) => player.setVideoQuality(v));
  one("Player.setAudioTrack", { ...value, label: "Audio track identifier (getAvailableAudioTracks)" }, (raw) => raw, (v) => player.setAudioTrack(v));
  one("Player.setSubtitleTrack", { ...value, label: "Subtitle identifier (blank disables subtitles)" }, (raw) => raw || undefined, (v) => player.setSubtitleTrack(v));
  one("Player.setMaxSelectableBitrate", { ...value, label: "Bitrate (blank removes the cap)" }, (raw) => raw.trim() ? finiteNumber(raw, "Bitrate", 1) : null, (v) => player.setMaxSelectableBitrate(v));
  one("Player.getThumbnail", time, (raw) => finiteNumber(raw, "Time", 0), (v) => player.getThumbnail(v));
  one("Player.canPlayAtPlaybackSpeed", { ...value, initial: "1", label: "Playback speed" }, (raw) => finiteNumber(raw, "Speed"), (v) => player.canPlayAtPlaybackSpeed(v));
  one("Player.getCurrentTime", { ...value, label: "Time mode", initial: "relative", choices: ["relative", "absolute"] }, (raw) => {
    if (raw !== "relative" && raw !== "absolute") throw new Error("Select a time mode.");
    return raw;
  }, (v) => player.getCurrentTime(v));
  one("Player.buffer.getLevel", bufferType, selectedBuffer, (v) => player.buffer.getLevel(v));
  operations.push({ id: "Player.buffer.setTargetLevel", arguments: [bufferType, { ...value, label: "Target duration (seconds)", initial: "40" }],
    run: (values) => player.buffer.setTargetLevel(selectedBuffer(values.type), finiteNumber(values.value ?? "", "Duration", 0)),
    code: (values) => `player.buffer.setTargetLevel(${JSON.stringify(selectedBuffer(values.type))}, ${finiteNumber(values.value ?? "", "Duration", 0)});` });
  one("Player.mediaControls.setEnabled", { ...value, label: "Enabled", initial: "true", choices: ["true", "false"] }, (raw) => {
    if (!["true", "false"].includes(raw)) throw new Error("Select true or false.");
    return raw === "true";
  }, (v) => player.mediaControls.setEnabled(v));
  noArgs("Player.mediaControls.isEnabled", () => player.mediaControls.isEnabled());
  noArgs("Player.analytics.getUserId", () => {
    if (!player.analytics) throw new Error("Configure Analytics before creating this player.");
    return player.analytics.getUserId();
  });
  one("Player.analytics.sendCustomDataEvent", { ...value, label: "Custom data (one name=value per line)" }, customData, (v) => {
    if (!player.analytics) throw new Error("Configure Analytics before creating this player.");
    return player.analytics.sendCustomDataEvent(v);
  });
  noArgs("Player.getVolume", () => player.getVolume());
  noArgs("Player.getDuration", () => player.getDuration());
  noArgs("Player.isMuted", () => player.isMuted());
  noArgs("Player.isPlaying", () => player.isPlaying());
  noArgs("Player.isPaused", () => player.isPaused());
  noArgs("Player.isLive", () => player.isLive());
  noArgs("Player.isAirPlayActive", () => player.isAirPlayActive());
  noArgs("Player.isAirPlayAvailable", () => player.isAirPlayAvailable());
  noArgs("Player.getAudioTrack", () => player.getAudioTrack());
  noArgs("Player.getAvailableAudioTracks", () => player.getAvailableAudioTracks());
  noArgs("Player.getSubtitleTrack", () => player.getSubtitleTrack());
  noArgs("Player.getAvailableSubtitles", () => player.getAvailableSubtitles());
  noArgs("Player.isAd", () => player.isAd());
  noArgs("Player.getTimeShift", () => player.getTimeShift());
  noArgs("Player.getMaxTimeShift", () => player.getMaxTimeShift());
  noArgs("Player.isCastAvailable", () => player.isCastAvailable());
  noArgs("Player.isCasting", () => player.isCasting());
  noArgs("Player.getVideoQuality", () => player.getVideoQuality());
  noArgs("Player.getAvailableVideoQualities", () => player.getAvailableVideoQualities());
  noArgs("Player.getPlaybackSpeed", () => player.getPlaybackSpeed());
  property("Player.config", () => player.config);
  property("Player.nativeId", () => player.nativeId);
  property("Player.isInitialized", () => player.isInitialized);
  property("Player.isDestroyed", () => player.isDestroyed);
  property("Player.source", () => player.source ? { nativeId: player.source.nativeId, config: player.source.config,
    isInitialized: player.source.isInitialized, isDestroyed: player.source.isDestroyed } : undefined);
  property("Player.buffer.nativeId", () => player.buffer.nativeId);
  property("Player.mediaControls.nativeId", () => player.mediaControls.nativeId);
  property("Player.analytics.playerId", () => player.analytics?.playerId);
  const activeSource = () => { if (!player.source) throw new Error("Load a source first."); return player.source; };
  noArgs("Source.duration", () => activeSource().duration());
  noArgs("Source.isActive", () => activeSource().isActive());
  noArgs("Source.isAttachedToPlayer", () => activeSource().isAttachedToPlayer());
  noArgs("Source.metadata", () => activeSource().metadata());
  noArgs("Source.loadingState", () => activeSource().loadingState());
  noArgs("Source.initialize", () => activeSource().initialize());
  noArgs("Source.destroy", () => { const source = activeSource(); player.unload(); source.destroy(); });
  operations[operations.length - 1]!.code = () => "const source = player.source;\nplayer.unload();\nsource.destroy();";
  property("Source.config", () => activeSource().config);
  property("Source.nativeId", () => activeSource().nativeId);
  property("Source.isInitialized", () => activeSource().isInitialized);
  property("Source.isDestroyed", () => activeSource().isDestroyed);
  property("Source.remoteControl", () => activeSource().remoteControl);
  const drm = () => { const drm = activeSource().drm; if (!drm) throw new Error("Load a DRM-configured source first."); return drm; };
  noArgs("Source.drm.initialize", () => drm().initialize());
  noArgs("Source.drm.destroy", () => drm().destroy());
  property("Source.drm.config", () => drm().config);
  property("Source.drm.nativeId", () => drm().nativeId);
  property("Source.drm.isInitialized", () => drm().isInitialized);
  property("Source.drm.isDestroyed", () => drm().isDestroyed);
  one("Source.getThumbnail", time, (raw) => finiteNumber(raw, "Time", 0), (v) => activeSource().getThumbnail(v));
  one("Source.setMetadata", { ...value, label: "Source metadata", initial: EMPTY_METADATA, editor: "metadata" }, metadataValue, (v) => activeSource().setMetadata(v));
  one("Source.drm.fairplay.renewExpiringLicense", { ...value, label: "SKD URI from onFairplayLicenseAcquired" }, (raw) => {
    if (!raw.startsWith("skd://")) throw new Error("Enter the skd:// URI from the acquired content-key request.");
    return { skdUri: raw };
  }, (request) => {
    const fairplay = activeSource().drm?.fairplay;
    if (!fairplay) throw new Error("Load a FairPlay-configured source first.");
    return fairplay.renewExpiringLicense(request);
  });
  return operations.sort((left, right) => left.id.localeCompare(right.id));
}
