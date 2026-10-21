import { AdSourceType, SubtitleFormat, type AdItem, type AdSource, type SideLoadedSubtitleTrack } from "bitmovin-player-react-native";
import { finiteNumber } from "./apiValues";
import type { NativeSettings } from "./nativeSettings";

export interface AdItemDraft { position: string; preloadOffset: string; sources: AdSource[]; }
export interface NativeArrayDraft {
  subtitles?: SideLoadedSubtitleTrack[];
  offlineSubtitles?: SideLoadedSubtitleTrack[];
  ads?: AdItemDraft[];
}

export function parseSubtitleTracks(tracks: SideLoadedSubtitleTrack[]): SideLoadedSubtitleTrack[] {
  const identifiers = new Set<string>();
  return tracks.map((track) => {
    if (!track.url.trim() || !track.label.trim() || !track.language.trim()) throw new Error("Subtitle URL, label and language are required.");
    const language = Intl.getCanonicalLocales(track.language.trim())[0];
    if (!language || !Object.values(SubtitleFormat).includes(track.format)) throw new Error("Select a subtitle format and a valid IETF language tag.");
    if (track.identifier && identifiers.has(track.identifier)) throw new Error("Subtitle identifiers must be unique within the list.");
    if (track.identifier) identifiers.add(track.identifier);
    const roles = track.roles?.map((role) => {
      if (!role.schemeIdUri.trim()) throw new Error("A subtitle role requires a schemeIdUri.");
      return { ...role };
    });
    return { ...track, url: track.url.trim(), label: track.label.trim(), language, ...(roles ? { roles } : {}) };
  });
}

export function parseAdItems(items: AdItemDraft[]): AdItem[] {
  return items.map((item) => {
    if (!item.sources.length) throw new Error("An ad item requires at least one source.");
    const sources = item.sources.map((source) => {
      if (!source.tag.trim() || !Object.values(AdSourceType).includes(source.type)) throw new Error("Enter an ad tag and select its source type.");
      if (source.type !== item.sources[0]?.type) throw new Error("Fallback ad sources must have the same source type.");
      return { ...source, tag: source.tag.trim() };
    });
    return { sources, ...(item.position ? { position: item.position } : {}),
      ...(item.preloadOffset.trim() ? { preloadOffset: finiteNumber(item.preloadOffset, "Ad preload offset", 0) } : {}) };
  });
}

export function applyNativeArrays(settings: NativeSettings, draft: NativeArrayDraft): void {
  if (draft.subtitles !== undefined) settings.source.subtitleTracks = parseSubtitleTracks(draft.subtitles);
  if (draft.offlineSubtitles !== undefined) settings.offline.sourceConfig.subtitleTracks = parseSubtitleTracks(draft.offlineSubtitles);
  if (draft.ads !== undefined) settings.player.advertisingConfig = { ...settings.player.advertisingConfig, schedule: parseAdItems(draft.ads) };
}
