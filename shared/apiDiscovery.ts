export interface ApiIdentity { id: string }
export interface FeatureLabel { en: string; ja: string }

const actions: Record<string, FeatureLabel> = {
  play: { en: "Play", ja: "再生" }, pause: { en: "Pause", ja: "一時停止" }, seek: { en: "Seek", ja: "シーク" },
  getvolume: { en: "Volume", ja: "音量" }, setvolume: { en: "Volume", ja: "音量" },
  mute: { en: "Mute", ja: "ミュート" }, unmute: { en: "Unmute", ja: "ミュート解除" },
};
const leafName = (id: string) => id.slice(id.lastIndexOf(".") + 1).toLocaleLowerCase();
const actionFor = (leaf: string) => Object.prototype.hasOwnProperty.call(actions, leaf) ? actions[leaf] : undefined;

const features: readonly [RegExp, FeatureLabel, string][] = [
  [/analytic/i, { en: "Analytics", ja: "分析" }, "analytics qoe metrics 分析 品質指標"],
  [/volume|muted|(?:^|\.)(?:mute|unmute)$/i, { en: "Volume", ja: "音量" }, "volume audio sound mute unmute 音量 音声 ミュート"],
  [/subtitle|caption|texttrack/i, { en: "Subtitles", ja: "字幕" }, "subtitle captions text 字幕"],
  [/drm|widevine|fairplay|playready|license|certificate/i, { en: "DRM", ja: "DRM" }, "drm encryption license certificate 暗号 ライセンス 証明書"],
  [/(?:^|\.)key$|licensing|licensekey/i, { en: "License", ja: "ライセンス" }, "license key ライセンス キー"],
  [/advertis|(?:^|\.)(?:ads?|ima)(?:\.|$)|vast/i, { en: "Advertising", ja: "広告" }, "ads advertising vast vmap 広告"],
  [/network|request|http|retry|timeout/i, { en: "Network", ja: "通信" }, "network request http retry timeout 通信 リクエスト タイムアウト 再試行"],
  [/adaptation|quality|bitrate|bandwidth|resolution|codec/i, { en: "Quality", ja: "画質" }, "quality bitrate bandwidth resolution codec 画質 ビットレート 解像度"],
  [/buffer|latency/i, { en: "Buffer", ja: "バッファ" }, "buffer latency delay バッファ 遅延"],
  [/audio|language/i, { en: "Audio", ja: "音声" }, "audio language track 音声 言語 トラック"],
  [/seek|timeshift|currenttime|golive/i, { en: "Seek", ja: "再生位置" }, "seek rewind dvr position シーク 巻き戻し 再生位置"],
  [/playback|(?:^|\.)(?:play|pause|isplaying|getduration|destroy)$/i, { en: "Playback", ja: "再生" }, "play pause playback autoplay duration 再生 一時停止 自動再生 長さ"],
  [/uimanager|uiconfig|uicomponent|uiconstructor|style|view|fullscreen|pictureinpicture|(?:^|\.)ui(?:\.|$)/i, { en: "View and UI", ja: "画面とUI" }, "ui view controls style fullscreen pip 画面 表示 全画面"],
  [/source|load|poster|thumbnail/i, { en: "Source", ja: "ソース" }, "source load url poster thumbnail ソース 読み込み ポスター サムネイル"],
  [/analytic|log|error|event/i, { en: "Diagnostics", ja: "診断" }, "analytics logs events error 診断 ログ イベント エラー"],
];

export function apiFeature(id: string): FeatureLabel {
  return actionFor(leafName(id)) ?? features.find(([pattern]) => pattern.test(id))?.[1] ?? { en: "SDK", ja: "SDK" };
}

const normalize = (text: string): string => text.normalize("NFKC").toLocaleLowerCase().trim();

/** Exact SDK identities and method names precede namespace and feature matches. */
export function findApiEntries<T extends ApiIdentity>(entries: readonly T[], input: string): T[] {
  const query = normalize(input);
  if (!query) return [...entries];
  const words = query.split(/\s+/);
  return entries.flatMap((entry, index) => {
    const id = normalize(entry.id);
    const leaf = id.slice(id.lastIndexOf(".") + 1);
    const action = actionFor(leaf);
    const labels = features.filter(([pattern]) => pattern.test(entry.id));
    const text = normalize(id + " " + (action ? `${action.en} ${action.ja} ` : "") + labels.map(([, label, aliases]) => `${label.en} ${label.ja} ${aliases}`).join(" "));
    if (!words.every(word => text.includes(word))) return [];
    const rank = id === query ? 0 : leaf === query || action && [action.en, action.ja].some(label => normalize(label) === query) ? 1 : leaf.startsWith(query) ? 2
      : query.includes(".") && id.startsWith(query) ? 2 : leaf.includes(query) ? 3
        : labels.some(([, label, aliases]) => normalize(`${label.en} ${label.ja} ${aliases}`).includes(query)) ? 4 : 5;
    return [{ entry, index, rank }];
  }).sort((left, right) => left.rank - right.rank || left.index - right.index).map(match => match.entry);
}
