import type { ViewerCatalog, ViewerHistoryInput, ViewerHistorySample, ViewerPreferences, ViewerSection } from "./viewer-data.ts";

const CONTENT = { id: "bbb-60s", revision: "bbb-60s-demo-v1", durationMs: 60_000 };
const PERIOD = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" };
const SOURCE = "https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8";
const section = (id: string, startMs: number, endMs: number, en: string, ja: string): ViewerSection => ({ id, startMs, endMs, title: { en, ja } });

/** CMS-authored boundaries and titles, not scene labels inferred from Analytics. */
export const VIEWER_CATALOG: ViewerCatalog = {
  content: { ...CONTENT },
  chapters: [
    section("chapter-1", 0, 15_000, "Section 1", "区間1"),
    section("chapter-2", 15_000, 30_000, "Section 2", "区間2"),
    section("chapter-3", 30_000, 45_000, "Section 3", "区間3"),
    section("chapter-4", 45_000, 60_000, "Section 4", "区間4"),
  ],
  clips: [
    section("clip-1", 18_000, 24_000, "Forest section", "森の区間"),
    section("clip-2", 40_000, 46_000, "Rabbit section", "ウサギの区間"),
    section("clip-3", 28_000, 34_000, "Burrow section", "巣穴の区間"),
  ],
};

type Step = [state: string, start: number, end: number, preferences?: ViewerPreferences];
const CAPTIONS_ON: ViewerPreferences = { audioLanguage: "en", subtitleEnabled: true, subtitleLanguage: "ja" };
function visit(id: string, offset: number, steps: Step[]): ViewerHistoryInput["sessions"][number] {
  let clock = Date.parse(PERIOD.start) + offset;
  const samples = steps.map(([state, start, end, preferences], sequence_number): ViewerHistorySample => {
    const played = state === "playing" ? end - start : 0;
    const seeked = state === "seeking" ? 200 : 0;
    clock += played || seeked || 100;
    return { sequence_number, client_time: clock, state, ad: 0, played, seeked,
      videotime_start: start, videotime_end: end, video_duration: CONTENT.durationMs, video_id: CONTENT.id, m3u8_url: SOURCE,
      ...(preferences ? { audio_language: preferences.audioLanguage, subtitle_enabled: preferences.subtitleEnabled, subtitle_language: preferences.subtitleLanguage } : {}),
    };
  });
  return { id, expectedLastSequence: samples.length - 1, samples };
}
function input(sessions: ViewerHistoryInput["sessions"] = []): ViewerHistoryInput {
  return { schemaVersion: 1, synthetic: true, content: { ...CONTENT }, period: { ...PERIOD }, asOf: PERIOD.end,
    completeness: "complete", videoId: CONTENT.id, sourceUrl: SOURCE, sessions };
}
function saved(preferences: ViewerPreferences | null = CAPTIONS_ON): ViewerHistoryInput {
  return input([
    visit("example-visit-1", 60_000, [["playing", 0, 32_000, preferences ?? undefined], ["pause", 32_000, 32_000],
      ["seeking", 32_000, 40_000], ["playing", 40_000, 46_000]]),
    visit("example-visit-2", 180_000, [["playing", 8_000, 12_000, preferences ?? undefined]]),
  ]);
}

/** Every packet, clock and visit key is authored. No viewer/account data is collected. */
export const VIEWER_HISTORY_EXAMPLES: { id: string; title: { en: string; ja: string }; input: ViewerHistoryInput }[] = [
  { id: "saved", title: { en: "Saved progress", ja: "保存済みの履歴" }, input: saved() },
  { id: "partial", title: { en: "Partial history", ja: "一部だけの履歴" }, input: { ...saved(), completeness: "partial" } },
  { id: "completed", title: { en: "Completed viewing", ja: "全編の視聴記録" }, input: input([visit("example-completed", 60_000, [["playing", 0, 60_000, CAPTIONS_ON]])]) },
  { id: "first", title: { en: "First visit", ja: "初回の視聴" }, input: input() },
  { id: "unavailable", title: { en: "History unavailable", ja: "履歴を利用できない場合" }, input: { ...input(), completeness: "unavailable" } },
  { id: "captions-off", title: { en: "Captions were off", ja: "前回は字幕オフ" }, input: saved({ audioLanguage: "en", subtitleEnabled: false, subtitleLanguage: null }) },
  { id: "unknown-settings", title: { en: "Settings not recorded", ja: "字幕・音声の設定記録なし" }, input: saved(null) },
];
