import { Player, PlayerEvent } from "bitmovin-player";
import type { PlayerAPI, PlayerConfig, SourceConfig } from "bitmovin-player";
import { initialMetrics, metricsSnapshot, reduceMetrics, type MetricsEvent } from "./analytics/metrics";
import {
  BingeUIFactory,
  CinemaUIFactory,
  CompactUIFactory,
  CreatorUIFactory,
  DefaultUIFactory,
  LiveUIFactory,
  PremiereUIFactory,
  SportsUIFactory,
  StudioUIFactory,
  UIManager,
  type CastingButtons,
  type UIConfig,
} from "@showcase/ui-shared";
import "@showcase/ui-shared/css";
import { SOURCES, missingSourceSettings, nextPlaylistSource, type ShowcaseSource } from "./sources";
import { configValue, deepMerge } from "./configState";
import { liveLatencySeconds } from "./dvr/window";
import { mountControlPanel, relocalizeControlPanel, type ControlPanelHandle } from "./controlPanel";
import { mountConfigPanel, type DeepPartial, type ConfigPanelOptions, type ConfigPanelHandle } from "./configPanel";
import { renderConstruction, renderUiGuide } from "./uiGuide";
import { createAnalyticsView } from "./analyticsView";
import { installPlayerGesture, type DoubleClickMode } from "./gestures";
import { installInfoOverlay, infoChip } from "./infoChip";
import { pick, getLang, setLang, onLangChange, G, type L, type Lang } from "./i18n";
import "./styles.css";

// TimelineReferencePoint ("end") is a string enum the SDK doesn't expose at
// runtime; reference it typed via SourceConfig.options (§11).
type StartOffsetRef = NonNullable<NonNullable<SourceConfig["options"]>["startOffsetTimelineReference"]>;
const END_REFERENCE = "end" as unknown as StartOffsetRef;

const licenseKey = import.meta.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY ?? "";
const analyticsKey = import.meta.env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY ?? "";
const playerEl = document.getElementById("player");
const panelEl = document.getElementById("control-panel");
const themeBarEl = document.getElementById("ui-theme-bar");
const guideEl = document.getElementById("ui-guide");
const constructionEl = document.getElementById("ui-construction");
const configEl = document.getElementById("config-panel");
const langToggleEl = document.getElementById("lang-toggle");
const taglineEl = document.getElementById("app-tagline");

if (!playerEl || !panelEl || !themeBarEl || !guideEl || !constructionEl || !configEl || !langToggleEl || !taglineEl) {
  throw new Error("missing one of #player / #control-panel / #ui-theme-bar / #ui-guide / #ui-construction / #config-panel / #lang-toggle / #app-tagline");
}
if (!licenseKey) {
  console.info("No Player key is configured. Web playback is available at localhost; other hostnames need a domain-allowed key. See .env.example.");
}

if (import.meta.env.MODE === "pages") {
  const footer = document.createElement("footer");
  footer.className = "distribution-notices";
  const links: [string, L][] = [
    ["media/ATTRIBUTION.txt", { ja: "テスト素材の出典", en: "Test media credits" }],
    ["notices/PROJECT-LICENSE.txt", { ja: "プロジェクトのライセンス", en: "Project license" }],
    ["notices/BITMOVIN-PLAYER-NOTICE.txt", { ja: "Player SDKの利用条件", en: "Player SDK notice" }],
    ["notices/BITMOVIN-PLAYER-UI-LICENSE.txt", { ja: "Player UIのライセンス", en: "Player UI license" }],
    ["notices/BITMOVIN-PLAYER-THIRD-PARTY-NOTICES.txt", { ja: "依存ソフトウェアのライセンス", en: "Third-party notices" }],
  ];
  function renderNotices(): void {
    footer.replaceChildren(...links.map(([href, label]) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = pick(label);
      return link;
    }));
  }
  renderNotices();
  onLangChange(renderNotices);
  document.getElementById("app")!.appendChild(footer);
}

// ---------------------------------------------------------------------------
// UI themes. The SAME player is driven by three different UI builds, switchable
// at runtime — the demo's point: reshaping the player UI is a one-liner swap of
// the UIManager. "Default" is the stock bitmovin-player-ui; the others are this
// repo's custom ui-shared builds.
// ---------------------------------------------------------------------------
type ThemeId =
  | "default"
  | "custom-live"
  | "custom-sports"
  | "custom-binge"
  | "custom-neon"
  | "custom-glass"
  | "custom-sunset"
  | "custom-bold"
  | "custom-mono"
  | "custom-cinema"
  | "custom-compact"
  | "custom-premiere"
  | "custom-creator"
  | "custom-studio";

// Customization method — the demo groups themes by HOW they were built, so the
// selector reads as a catalog of techniques, not a flat list:
//  - default: the unmodified bitmovin-player-ui.
//  - css:     the SAME Default tree, re-skinned via a CSS class only (no structure change).
//  - custom:  a different component tree (a custom factory); VOD- and live-capable.
type ThemeCategory = "default" | "css" | "custom";
const CATEGORY_LABEL: Record<ThemeCategory, L> = {
  default: { ja: "標準 UI", en: "Default UI" },
  css: { ja: "標準 UI ＋ CSS", en: "Default UI + CSS" },
  custom: { ja: "カスタム UI", en: "Custom UI" },
};

interface UiTheme {
  id: ThemeId;
  category: ThemeCategory;
  label: L;
  note: L;
  /** The one-line build call this theme runs — shown next to the selector so the
   *  live example is tied to the code that produced it. */
  code: string;
  /** Builds the theme's UIManager. `hideDelay` (ms) threads the autohide setting
   *  (undefined = theme default, -1 = off); `config` layers the app's live UIConfig
   *  (the UI-settings toggles) on top of the theme's own preset; `casting` adds the
   *  AirPlay/PiP/Chromecast buttons (custom trees only — the Default tree already has them). */
  build: (player: PlayerAPI, hideDelay?: number, config?: UIConfig, casting?: CastingButtons) => UIManager;
}

// Sample "up next" recommendations for the brand themes' RecommendationOverlay (an element
// borrowed from the official playerUi/tv samples). The overlay reads
// UIConfig.metadata.recommendations and shows when a VOD finishes; clicking a tile loads that
// source. We reuse our own showcase VOD sources so the overlay is populated, not empty.
// These ids must exist in sources.ts; if one is renamed the overlay just shows fewer tiles
// (no error). Kept to a few distinct VOD sources so "up next" has something to show.
const RECOMMENDED_SOURCE_IDS = ["vod-dash", "vod-multiaudio", "vod-subtitles"];
const BRAND_UICONFIG: UIConfig = {
  metadata: {
    recommendations: SOURCES.filter((s) => RECOMMENDED_SOURCE_IDS.includes(s.id) && missingSourceSettings(s).length === 0).map((s) => ({
      title: s.config.title ?? s.label,
      resource: s.config,
    })),
  },
};

// Sample timeline markers (chapter marks) shown on the seek bar. They render on a VOD's seek
// bar and make the "Snap to markers" UI setting (UIConfig.seekbarSnappingEnabled) demonstrable.
// On a live/DVR stream the SDK still processes them, but their fixed times usually fall outside
// the moving DVR window, so you won't normally see them there.
const SAMPLE_MARKERS = [
  { time: 120, title: "Chapter 1" },
  { time: 360, title: "Chapter 2" },
  { time: 600, title: "Chapter 3" },
];
// The app's baseline UIConfig, applied to every theme: the markers above with the live
// UI-settings toggles layered on top (and the brand recommendations deep-merged for those).
const BASE_UICONFIG: UIConfig = { metadata: { markers: SAMPLE_MARKERS } };

const THEMES: UiTheme[] = [
  // ── 1) Default UI (stock bitmovin-player-ui) ──────────────────────────────
  {
    id: "default",
    category: "default",
    label: { ja: "Default (Bitmovin)", en: "Default (Bitmovin)" },
    note: { ja: "標準の bitmovin-player-ui(モダンUI)。構成はそのまま、autohide だけ切り替えられる基準点。", en: "The stock bitmovin-player-ui (modern UI) — the baseline. Structure unchanged; only autohide is switchable." },
    code: "DefaultUIFactory.buildDefaultUI(player)",
    build: (p, hd, cfg) => DefaultUIFactory.buildDefaultUI(p, cfg, { hideDelay: hd }),
  },
  // ── 2) Default UI + CSS (the SAME Default tree, re-skinned via one class) ──
  {
    id: "custom-neon",
    category: "css",
    label: { ja: "Neon", en: "Neon" },
    note: { ja: "標準 UI を CSS だけで再スキン(構成は変えずクラス追加のみ)。", en: "Re-skins the Default UI with CSS only — a class, no structural change." },
    code: 'DefaultUIFactory.buildDefaultUI(player, undefined, { extraCssClasses: ["ui-skin-neon"] })',
    build: (p, hd, cfg) => DefaultUIFactory.buildDefaultUI(p, cfg, { extraCssClasses: ["ui-skin-neon"], hideDelay: hd }),
  },
  {
    id: "custom-glass",
    category: "css",
    label: { ja: "Glass", en: "Glass" },
    note: { ja: "これも CSS だけ。すりガラス(backdrop-blur)の半透明コントロールバー。", en: "Also CSS-only: a frosted-glass (backdrop-blur) translucent control bar." },
    code: 'DefaultUIFactory.buildDefaultUI(player, undefined, { extraCssClasses: ["ui-skin-glass"] })',
    build: (p, hd, cfg) => DefaultUIFactory.buildDefaultUI(p, cfg, { extraCssClasses: ["ui-skin-glass"], hideDelay: hd }),
  },
  {
    id: "custom-sunset",
    category: "css",
    label: { ja: "Sunset", en: "Sunset" },
    note: { ja: "CSS だけ。夕焼けの暖色グラデーション(Neon/Glass とは別配色)。", en: "CSS only: a warm sunset gradient (a different palette from Neon/Glass)." },
    code: 'DefaultUIFactory.buildDefaultUI(player, undefined, { extraCssClasses: ["ui-skin-sunset"] })',
    build: (p, hd, cfg) => DefaultUIFactory.buildDefaultUI(p, cfg, { extraCssClasses: ["ui-skin-sunset"], hideDelay: hd }),
  },
  {
    id: "custom-bold",
    category: "css",
    label: { ja: "Bold", en: "Bold" },
    note: { ja: "CSS だけ。大きく高コントラストな操作系(TV/10フィート向け)。autohide オフと好相性。", en: "CSS only: big, high-contrast controls (TV / 10-foot). Pairs well with autohide off." },
    code: 'DefaultUIFactory.buildDefaultUI(player, undefined, { extraCssClasses: ["ui-skin-bold"] })',
    build: (p, hd, cfg) => DefaultUIFactory.buildDefaultUI(p, cfg, { extraCssClasses: ["ui-skin-bold"], hideDelay: hd }),
  },
  {
    id: "custom-mono",
    category: "css",
    label: { ja: "Mono", en: "Mono" },
    note: { ja: "CSS だけ。色を一切使わないモノクロ(編集・印刷風)。同じ標準ツリーを再スキン。", en: "CSS only: a hue-free monochrome (editorial / print) look, re-skinning the same Default tree." },
    code: 'DefaultUIFactory.buildDefaultUI(player, undefined, { extraCssClasses: ["ui-skin-mono"] })',
    build: (p, hd, cfg) => DefaultUIFactory.buildDefaultUI(p, cfg, { extraCssClasses: ["ui-skin-mono"], hideDelay: hd }),
  },
  // ── 3) Custom UI (a different component tree; VOD- and live-capable) ───────
  {
    id: "custom-live",
    category: "custom",
    label: { ja: "Live (DVR)", en: "Live (DVR)" },
    note: { ja: "LIVE ピル・壁時計ラベル・「−Xs behind live」をカスタムコンポーネントで追加。Live の DVR 表示が最も充実した例。", en: "Adds custom components: a LIVE pill, a wall-clock label, and a “−Xs behind live” readout — the fullest live/DVR example." },
    code: "LiveUIFactory.buildLiveUI(player)",
    build: (p, hd, cfg, casting) => LiveUIFactory.buildLiveUI(p, cfg, { hideDelay: hd, casting }),
  },
  {
    id: "custom-sports",
    category: "custom",
    label: { ja: "スポーツ中継", en: "Sports" },
    note: {
      ja: "野球中継風。自作コンポーネントで他試合スコア(上部)と選手情報カード(打者/投手＋打順)を映像にオーバーレイ。数秒で自動的に消え、INFO ボタンで再表示。データはサンプル(sportsData.ts)。",
      en: "A baseball-broadcast look: custom components overlay other games’ scores (top) and a player-info card (batter/pitcher + lineup). They auto-hide after a few seconds; the INFO button re-shows them. Sample data (sportsData.ts).",
    },
    code: "SportsUIFactory.buildSportsUI(player)",
    build: (p, hd, cfg, casting) => SportsUIFactory.buildSportsUI(p, cfg, { hideDelay: hd, casting }),
  },
  {
    id: "custom-binge",
    category: "custom",
    label: { ja: "連続再生", en: "Binge" },
    note: {
      ja: "エピソード VOD 向け。自作コンポーネントで「イントロをスキップ」(イントロ区間のみ表示)、「次のエピソード」(終了間際のみ表示)、終了間際の Next-up カード(連続再生オン時はカウントダウンで自動再生)。再生リストはデモ用 VOD。",
      en: "For episodic VOD: custom components for a Skip Intro button (shown only during the intro), a Next-episode button (shown only near the end), and an end-of-clip Next-up card (auto-advances with a countdown when continuous play is on). The playlist is the demo VODs.",
    },
    code: "BingeUIFactory.buildBingeUI(player)",
    build: (p, hd, cfg, casting) =>
      BingeUIFactory.buildBingeUI(p, cfg, {
        hideDelay: hd,
        casting,
        continuousPlay: {
          introStart: 5,
          introEnd: 18,
          getNextTitle: nextEpisodeTitle,
          autoplayNext,
          onPlayNext: playNextEpisode,
        },
      }),
  },
  {
    id: "custom-cinema",
    category: "custom",
    label: { ja: "Cinema", en: "Cinema" },
    note: { ja: "没入レイアウト:大きな中央再生＋細いバーで、すぐ自動的に隠れる。", en: "An immersive layout: a big center play + a slim bar that hides quickly." },
    code: "CinemaUIFactory.buildCinemaUI(player)",
    build: (p, hd, cfg, casting) => CinemaUIFactory.buildCinemaUI(p, cfg, { hideDelay: hd, casting }),
  },
  {
    id: "custom-compact",
    category: "custom",
    label: { ja: "Compact", en: "Compact" },
    note: { ja: "中央オーバーレイなしの細い1段(埋め込み向け)。再生はジェスチャ操作。", en: "A slim single row with no center overlay (for embeds); play via gesture." },
    code: "CompactUIFactory.buildCompactUI(player)",
    build: (p, hd, cfg, casting) => CompactUIFactory.buildCompactUI(p, cfg, { hideDelay: hd, casting }),
  },
  // Streaming-service "house style" homages — unbranded names (the layouts evoke familiar
  // services; we keep the styling but not the company/service names).
  {
    id: "custom-premiere",
    category: "custom",
    label: { ja: "Premiere", en: "Premiere" },
    note: { ja: "タイトルバー(タイトル＋説明)＋全幅シーク＋細い操作列。終了時の「次の動画」オーバーレイ入り、赤基調のシネマティック。", en: "A title bar (title + description) + a full-width scrubber over a slim row, with an end-of-playback “up next” overlay. Cinematic, red-accented." },
    code: "PremiereUIFactory.buildPremiereUI(player)",
    build: (p, hd, cfg, casting) => PremiereUIFactory.buildPremiereUI(p, deepMerge(BRAND_UICONFIG, cfg ?? {}), { hideDelay: hd, casting }),
  },
  {
    id: "custom-creator",
    category: "custom",
    label: { ja: "Creator", en: "Creator" },
    note: { ja: "最下部に全幅の赤いシークバー、その下に1列(再生・音量・時刻・設定)。タイトルバーと「次の動画」オーバーレイ入り。", en: "A full-width red scrubber at the bottom with one row below (play · volume · time · settings), plus a title bar and an “up next” overlay." },
    code: "CreatorUIFactory.buildCreatorUI(player)",
    build: (p, hd, cfg, casting) => CreatorUIFactory.buildCreatorUI(p, deepMerge(BRAND_UICONFIG, cfg ?? {}), { hideDelay: hd, casting }),
  },
  {
    id: "custom-studio",
    category: "custom",
    label: { ja: "Studio", en: "Studio" },
    note: { ja: "タイトル＋説明と、1列インライン(時刻ラベルに挟まれたシーク)。「次の動画」オーバーレイ入り、濃紺×青のプレミアム調。", en: "A title + description and a single inline row (the scrubber between time labels), with an “up next” overlay. Navy × blue, premium feel." },
    code: "StudioUIFactory.buildStudioUI(player)",
    build: (p, hd, cfg, casting) => StudioUIFactory.buildStudioUI(p, deepMerge(BRAND_UICONFIG, cfg ?? {}), { hideDelay: hd, casting }),
  },
];
let currentThemeId: ThemeId = "custom-live";
let uiManager: UIManager | undefined;

// Categories are shown in this order — increasing customization depth, so the
// selector reads as default → re-skin with CSS → rebuild the tree.
const CATEGORY_ORDER: ThemeCategory[] = ["default", "css", "custom"];

function renderThemeBar(): void {
  themeBarEl!.innerHTML = "";
  const label = document.createElement("span");
  label.className = "ui-theme-bar-label";
  label.textContent = pick(G.themeBarLabel);
  themeBarEl!.appendChild(label);

  // Group the buttons by customization method, each under its own labeled chip.
  for (const cat of CATEGORY_ORDER) {
    const inCat = THEMES.filter((t) => t.category === cat);
    if (inCat.length === 0) continue;
    const group = document.createElement("div");
    group.className = "theme-cat";
    const catLabel = document.createElement("span");
    catLabel.className = "theme-cat-label";
    catLabel.textContent = pick(CATEGORY_LABEL[cat]);
    group.appendChild(catLabel);
    for (const theme of inCat) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = pick(theme.label);
      b.title = pick(theme.note);
      b.className = theme.id === currentThemeId ? "theme-btn active" : "theme-btn";
      b.addEventListener("click", () => {
        if (player) applyTheme(player, theme.id);
      });
      group.appendChild(b);
    }
    themeBarEl!.appendChild(group);
  }

  const active = THEMES.find((t) => t.id === currentThemeId);
  const note = document.createElement("span");
  note.className = "ui-theme-bar-note";
  note.textContent = active ? pick(active.note) : "";
  themeBarEl!.appendChild(note);
  const code = document.createElement("code");
  code.className = "ui-theme-bar-code";
  code.textContent = active?.code ?? "";
  themeBarEl!.appendChild(code);
}

/** A JA / EN language toggle in the header. */
function renderLangToggle(): void {
  langToggleEl!.innerHTML = "";
  const langs: { id: Lang; label: string }[] = [
    { id: "ja", label: "日本語" },
    { id: "en", label: "English" },
  ];
  for (const l of langs) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = l.label;
    b.className = getLang() === l.id ? "lang-btn active" : "lang-btn";
    b.setAttribute("aria-pressed", String(getLang() === l.id));
    b.addEventListener("click", () => setLang(l.id));
    langToggleEl!.appendChild(b);
  }
}

/** Swap the UI theme without rebuilding the player — release the old UIManager,
 *  build the selected one against the same, still-playing player. */
function applyTheme(p: PlayerAPI, id: ThemeId): void {
  uiManager?.release();
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]!;
  uiManager = theme.build(p, autohideEnabled ? undefined : -1, deepMerge(BASE_UICONFIG, uiConfig), castingButtons);
  currentThemeId = theme.id;
  renderThemeBar();
  renderConstruction(constructionEl as HTMLElement, currentThemeId);
}

// DVR allow/forbid is a load-time PlayerConfig option (PlaybackConfig.timeShift),
// so toggling it rebuilds the player; source switching uses player.load().
let timeShiftEnabled = true;
let sourcePreset: SourceConfig = SOURCES[0]?.config ?? {};
let sourceOverrides: DeepPartial<SourceConfig> = {};
let currentSource: SourceConfig = sourcePreset;
// A preset loaded directly by the SDK UI replaces the prior overrides, even
// when it has the same ID. App-owned reloads retain their applied overrides.
let appSourceLoad: { player: PlayerAPI; source: SourceConfig; settle: (() => void) | undefined } | undefined;
let player: PlayerAPI | undefined;
let controlPanel: ControlPanelHandle | undefined;
let configPanel: ConfigPanelHandle | undefined;
// 🔁 PlayerConfig overrides staged + committed from the comprehensive config panel.
// They're deep-merged onto the base config every time the player is (re)built.
let playerOverrides: DeepPartial<PlayerConfig> = {};
// Player-surface double-click behavior (custom themes only). "fullscreen" matches
// the stock default; "seek" makes a double-click jump ±10s by which half is clicked.
let doubleClickMode: DoubleClickMode = "fullscreen";
// Control-bar auto-hide. Default OFF — controls stay visible until you switch it on.
// Every theme (incl. Default, which reuses the stock tree via DefaultUIFactory) builds
// with hideDelay -1 when off, or the theme's own default delay when on.
let autohideEnabled = false;
// The app's live UIConfig (the UI-settings toggles) layered onto each theme's own
// preset when it builds. Empty until the UI-settings panel changes something.
let uiConfig: UIConfig = {};
// AirPlay / PiP / Chromecast buttons added to the CUSTOM trees (the Default tree already
// ships all three). All off by default; toggled live from the control panel. Enabling Cast
// also needs PlayerConfig.remotecontrol (set in doBuild), so the Cast toggle rebuilds the
// player; AirPlay/PiP are tree-only and just rebuild the UI.
let castingButtons: CastingButtons = { airplay: false, pip: false, cast: false };
// Continuous play (the Binge theme): an ordered VOD "playlist" the Next-up card / Next-episode
// button advance through, and whether to auto-advance at the end. Toggling autoplayNext rebuilds
// the active UI (so the Binge tree picks up the new setting). The Next-up card reads the title +
// advance action live, so they stay correct after an episode change without a player rebuild.
let autoplayNext = true;
const EPISODE_PLAYLIST: string[] = ["vod-hls", "vod-dash", "vod-multiaudio", "vod-subtitles"];
// Track the current source by ID, not by `currentSource` object identity: the config panel's
// reload band reassigns `currentSource` to a deep-merged NEW object (losing reference equality
// with any SOURCES[*].config), which would otherwise reset the playlist to episode 1. The ID is
// stable across reload overrides (overrides overlay the same logical source).
let currentSourceId: string = SOURCES[0]?.id ?? "";
function nextEpisodeSource(): (typeof SOURCES)[number] | undefined {
  return nextPlaylistSource(SOURCES, EPISODE_PLAYLIST, currentSourceId);
}
function nextEpisodeTitle(): string | undefined {
  const s = nextEpisodeSource();
  return s?.config.title ?? s?.label;
}
function playNextEpisode(): void {
  const s = nextEpisodeSource();
  if (!s || !player) return;
  void selectSource(s).catch((err: unknown) => console.error("next-episode load failed", err));
}

/** Every load path announces the active source kind, including playlist advances
 * and config reloads. The hint belongs to this load, never to all future playback. */
async function loadCurrentSource(instance: PlayerAPI): Promise<void> {
  const isLive = SOURCES.find((source) => source.id === currentSourceId)?.isLive ?? false;
  const settle = controlPanel?.beginSourceLoad(isLive);
  const request = { player: instance, source: structuredClone(currentSource), settle };
  appSourceLoad = request;
  try {
    await instance.load(request.source);
  } catch (error) {
    if (appSourceLoad === request) appSourceLoad = undefined;
    if (player === instance) request.settle?.();
    throw error;
  } finally {
    if (player === instance) configPanel?.refresh();
  }
}

async function selectSource(source: ShowcaseSource): Promise<void> {
  const missing = missingSourceSettings(source);
  if (missing.length > 0) throw new Error(`Source is not configured. Set ${missing.join(", ")} in apps/web/.env.`);
  const instance = player;
  if (!instance) return;
  sourcePreset = source.config;
  sourceOverrides = {};
  currentSource = sourcePreset;
  currentSourceId = source.id;
  await loadCurrentSource(instance);
  if (player === instance) await instance.play();
}

// §15 — the QoE metrics card. It's created once (not rebuilt with the control panel,
// which clears its container on every rebuild) because its metrics accumulate across the
// session; the control panel re-attaches this same node into its telemetry row each build.
let metrics = initialMetrics();
let metricsTimer: number | undefined;
const metricsEl = document.createElement("pre");
metricsEl.className = "metrics metrics-qoe";
/** Wrap a telemetry box in a titled card matching the control panel's section style. The
 *  title lives in its own span (so a trailing "?" chip on the h2 survives re-labeling); an
 *  optional `hint` adds that chip. Returns the section + the title span to re-label on a
 *  language change. */
function telemetryCard(title: string, body: HTMLElement, hint?: L): { sec: HTMLElement; titleEl: HTMLElement } {
  const sec = document.createElement("section");
  sec.className = "panel-section";
  const h2 = document.createElement("h2");
  const titleEl = document.createElement("span");
  titleEl.textContent = title;
  h2.append(titleEl);
  if (hint) h2.append(infoChip(hint));
  sec.append(h2, body);
  return { sec, titleEl };
}
// The QoE readout is computed CLIENT-SIDE in real time from the player's event stream — an
// honest note distinguishes it from Bitmovin Analytics (the dashboard), which the same signals
// also feed when an analytics key is set, but whose query API is a server-side call.
const QOE_HINT: L = import.meta.env.MODE === "pages" ? {
  ja: "現在の再生セッションの品質をプレイヤーのイベントからブラウザー内で計測します。",
  en: "Playback quality measurements from the current session, computed in the browser from player events.",
} : {
  ja: "今のセッションの QoE を、player のイベントからブラウザ側でリアルタイム計測した値です(集計済みの Bitmovin Analytics は下の「サーバー経由クエリ」)。",
  en: "The current session's QoE, measured client-side in real time from the player's events. (Aggregated Bitmovin Analytics is the server-proxied panel below.)",
};
const qoeSection = telemetryCard(pick(G.sideQoe), metricsEl, QOE_HINT);

// The server-proxied Bitmovin Analytics query view (a sibling of the config panel). Created once
// and re-localized in place on language change (so a shown result survives a toggle).
const analyticsView = createAnalyticsView();
const analyticsContainer = document.getElementById("analytics-panel");
if (import.meta.env.MODE === "pages") {
  analyticsView.el.hidden = true;
  const collectorNotice = analyticsView.el.querySelector(".analytics-collector-notice");
  if (collectorNotice) analyticsContainer?.appendChild(collectorNotice);
}
analyticsContainer?.appendChild(analyticsView.el);

function renderMetrics(): void {
  const m = metricsSnapshot(metrics, performance.now());
  metricsEl.textContent = [
    `startup      ${m.startupMs !== null ? `${Math.round(m.startupMs)} ms` : "—"}`,
    `rebuffering  ${(m.rebufferRatio * 100).toFixed(2)}%  (${m.rebufferCount}×)`,
    `errors       ${m.errorCount}`,
    `seek time    ${m.lastSeekMs !== null ? `${Math.round(m.lastSeekMs)} ms` : "—"}`,
    `live latency ${m.liveLatencySec !== null ? `${m.liveLatencySec.toFixed(1)} s` : "—"}  (vs real-time · now−PDT)`,
    `edge latency ${m.sdkLatencySec !== null ? `${m.sdkLatencySec.toFixed(1)} s` : "—"}  (SDK getLatency · vs edge)`,
  ].join("\n");
}
function feed(ev: MetricsEvent): void {
  metrics = reduceMetrics(metrics, ev);
  renderMetrics();
  // Render the active phase even when no player event arrives, such as during
  // a long stall or uninterrupted VOD playback. One timer serves this readout;
  // elapsed time comes from the clock, never from counting timer ticks.
  const active = metrics.phase === "playing" || metrics.phase === "stalled";
  if (active && metricsTimer === undefined) metricsTimer = window.setInterval(renderMetrics, 500);
  else if (!active && metricsTimer !== undefined) {
    window.clearInterval(metricsTimer);
    metricsTimer = undefined;
  }
}

// TimeMode (§7) isn't exposed at runtime by the web SDK — reference the documented string value.
const ABSOLUTE_TIME = "absolutetime" as unknown as NonNullable<Parameters<PlayerAPI["getCurrentTime"]>[0]>;

/**
 * The SDK's own latency: `player.lowlatency.getLatency()` (distance from the live edge), as opposed
 * to the wall-clock `liveLatencySeconds` (distance from real-time). Live only; wrapped because it
 * isn't meaningful on VOD / no source. Works on a normal HLS/DASH live stream (not just LL-HLS).
 */
function sdkLatencySeconds(p: PlayerAPI): number | null {
  if (!p.isLive()) return null;
  try {
    const l = p.lowlatency.getLatency();
    return Number.isFinite(l) && l >= 0 ? l : null;
  } catch {
    return null;
  }
}

function wireMetrics(p: PlayerAPI): void {
  const now = (): number => performance.now();
  p.on(PlayerEvent.SourceLoaded, () => feed({ type: "load", t: now() }));
  p.on(PlayerEvent.SourceUnloaded, () => feed({ type: "unload", t: now() }));
  p.on(PlayerEvent.Destroy, () => feed({ type: "unload", t: now() }));
  p.on(PlayerEvent.PlaybackFinished, () => feed({ type: "ended", t: now() }));
  p.on(PlayerEvent.Playing, () => feed({ type: "playing", t: now() }));
  p.on(PlayerEvent.Paused, () => feed({ type: "paused", t: now() }));
  p.on(PlayerEvent.StallStarted, () => feed({ type: "stallStart", t: now() }));
  p.on(PlayerEvent.StallEnded, () => feed({ type: "stallEnd", t: now() }));
  p.on(PlayerEvent.Error, () => feed({ type: "error" }));
  p.on(PlayerEvent.Seek, () => feed({ type: "seek", t: now() }));
  p.on(PlayerEvent.Seeked, () => feed({ type: "seeked", t: now() }));
  p.on(PlayerEvent.TimeShift, () => feed({ type: "seek", t: now() }));
  p.on(PlayerEvent.TimeShifted, () => feed({ type: "seeked", t: now() }));
  p.on(PlayerEvent.TimeChanged, () => {
    if (!p.isLive()) return;
    // §15 — true end-to-end live latency (vs real-time), not the behind-live scrub offset.
    const latency = liveLatencySeconds(p.getCurrentTime(ABSOLUTE_TIME), Date.now() / 1000);
    // Only feed a real value: if the wall clock lapses (no PDT), the QoE box keeps the last-known
    // latency (sticky), which is fine for the aggregate card. The control-panel Player-state
    // readout is the live, authoritative view — it shows "— (needs PDT)" immediately instead.
    if (latency !== null) feed({ type: "liveLatency", seconds: latency });
    // Alongside it, the SDK's own latency (distance from the live edge), so the QoE card shows both
    // notions side by side. Same sticky-when-null behaviour as above.
    const sdk = sdkLatencySeconds(p);
    if (sdk !== null) feed({ type: "sdkLatency", seconds: sdk });
  });
}

// Config panel options (stable) — kept so the panel can be re-mounted on language change.
// 🔁 recreate edits restart the player with merged overrides; 📥 reload edits re-load the
// current source with merged overrides; ⚡ runtime edits hit the live player API.
const configOptions: ConfigPanelOptions = {
  getPlayer: () => player,
  getSource: () => currentSource,
  onRecreate: (overrides) => {
    playerOverrides = deepMerge(playerOverrides, overrides);
    void build();
  },
  onReload: (srcOverrides) => {
    sourceOverrides = deepMerge(sourceOverrides, srcOverrides);
    currentSource = deepMerge(sourcePreset, sourceOverrides);
    if (player) void loadCurrentSource(player).catch((err: unknown) => console.error("config reload failed", err));
  },
};

/** (Re)render every prose surface for the current language. The control panel + gestures
 *  carry no translatable prose, so they're untouched (no rebuild). The config panel
 *  re-mounts — its staged-but-unapplied edits reset, which is fine on a language switch. */
function renderAll(): void {
  document.documentElement.lang = getLang();
  taglineEl!.textContent = pick(G.tagline);
  renderLangToggle();
  renderThemeBar();
  renderUiGuide(guideEl!);
  renderConstruction(constructionEl!, currentThemeId);
  qoeSection.titleEl.textContent = pick(G.sideQoe);
  // The control panel doesn't re-mount on language change (that would clear its live event log /
  // telemetry), so re-localize its labels in place instead.
  relocalizeControlPanel();
  analyticsView.relocalize();
  configPanel = mountConfigPanel(configEl!, configOptions);
  // Keep the landmark aria-labels consistent with the visible language.
  themeBarEl!.setAttribute("aria-label", pick(G.themeBarLabel));
  constructionEl!.setAttribute("aria-label", pick(G.ariaConstruction));
  panelEl!.setAttribute("aria-label", pick(G.ariaControl));
  configEl!.setAttribute("aria-label", pick(G.ariaConfig));
  langToggleEl!.setAttribute("aria-label", pick(G.langLabel));
}

renderMetrics();
renderAll();
onLangChange(renderAll);
installInfoOverlay(); // the shared "?" chip overlay (config panel + control panel)

// Own the player-surface click/double-click for the custom themes. Installed once
// on the container; it reads the live player, the chosen mode, and the active theme
// through getters, so it survives player rebuilds and theme swaps. The teardown is
// intentionally discarded — the listener lives for the page (playerEl is never replaced).
installPlayerGesture(playerEl, {
  getPlayer: () => player,
  getMode: () => doubleClickMode,
  isActive: () => currentThemeId !== "default",
});

// Serialize (re)builds: each call waits for the previous to finish, so the rebuild
// triggers (startup, the DVR toggle, the config panel's 🔁 apply) can't interleave on
// the shared `player` during the async destroy. A failed build doesn't block later ones.
let buildChain: Promise<void> = Promise.resolve();
function build(): Promise<void> {
  buildChain = buildChain.then(doBuild, doBuild);
  return buildChain;
}

async function doBuild(): Promise<void> {
  if (player) {
    uiManager?.release();
    uiManager = undefined;
    // Clear the ref before the async destroy so the gesture's getPlayer() can't act
    // on a tearing-down instance during the rebuild window.
    const old = player;
    if (appSourceLoad?.player === old) appSourceLoad = undefined;
    player = undefined;
    await old.destroy();
  }
  const baseConfig: PlayerConfig = {
    key: licenseKey,
    ui: false,
    // autoplay (muted) so a switched source is analyzed immediately — otherwise the
    // duration stays Infinity until DurationChanged and the DVR UI lingers in "live"
    // mode for seconds after switching live→VOD.
    playback: { autoplay: true, muted: true, timeShift: timeShiftEnabled },
    ...(analyticsKey ? { analytics: { key: analyticsKey } } : {}),
    // Chromecast: the modular player bundles the Cast sender framework, so enabling it is just
    // this config (no external SDK to load). Only set when the Cast button is on — the button
    // needs it to function, and it pulls in the Cast framework, so we don't pay for it otherwise.
    // Omitting receiverApplicationId uses Bitmovin's default receiver app.
    ...(castingButtons.cast ? { remotecontrol: { type: "googlecast" } } : {}),
  };
  // Layer the config panel's 🔁 PlayerConfig overrides on top of the base. Clone the
  // overrides first so the live Player never shares a mutable sub-object with our stored
  // `playerOverrides` (the overrides are plain data — no functions — so this is safe).
  const config = deepMerge(baseConfig, structuredClone(playerOverrides));
  const instance = new Player(playerEl as HTMLElement, config);
  player = instance;
  applyTheme(instance, currentThemeId);
  wireMetrics(instance);
  controlPanel = mountControlPanel(instance, panelEl as HTMLElement, SOURCES, {
    timeShiftEnabled,
    onTimeShiftToggle: (enabled) => {
      timeShiftEnabled = enabled;
      void build();
    },
    currentSourceIsLive: SOURCES.find((source) => source.id === currentSourceId)?.isLive ?? false,
    onSourceSelected: selectSource,
    onReloadWithStartOffset: (offsetFromEdge) => {
      sourceOverrides = deepMerge(sourceOverrides, {
        options: { startOffset: offsetFromEdge, startOffsetTimelineReference: END_REFERENCE },
      });
      currentSource = deepMerge(sourcePreset, sourceOverrides);
      void loadCurrentSource(instance).catch((err: unknown) => console.error("reload-with-offset failed", err));
    },
    doubleClickMode,
    onDoubleClickModeChange: (mode) => {
      doubleClickMode = mode;
    },
    autohideEnabled,
    onAutohideToggle: (enabled) => {
      autohideEnabled = enabled;
      if (player) applyTheme(player, currentThemeId); // rebuild the active UI with the new hideDelay
    },
    uiConfig,
    onUiConfigChange: (patch) => {
      uiConfig = { ...uiConfig, ...patch };
      if (player) applyTheme(player, currentThemeId); // rebuild the active UI with the new UIConfig
    },
    casting: castingButtons,
    onCastingChange: (patch) => {
      const needsPlayerRebuild = patch.cast !== undefined && patch.cast !== castingButtons.cast;
      castingButtons = { ...castingButtons, ...patch };
      // Cast needs PlayerConfig.remotecontrol → rebuild the player; AirPlay/PiP are tree-only.
      if (needsPlayerRebuild) void build();
      else if (player) applyTheme(player, currentThemeId);
    },
    autoplayNext,
    onAutoplayNextToggle: (enabled) => {
      autoplayNext = enabled;
      // Tree-only: rebuild the active UI so the Binge theme's Next-up card picks up the setting.
      if (player) applyTheme(player, currentThemeId);
    },
    extraTelemetry: qoeSection.sec,
  });
  // Runtime fields reset with a new player; source/static fields read the applied
  // config. Refresh the existing form so unrelated staged edits are not discarded.
  instance.on(PlayerEvent.SourceLoaded, () => {
    if (player !== instance) return;
    const loaded = instance.getSource();
    if (!loaded) return;
    // RecommendationOverlay loads through the SDK directly. Keep later rebuilds
    // and source edits attached to that source rather than the previous preset.
    const selected = SOURCES.find((source) => source.config.hls === loaded.hls &&
      source.config.dash === loaded.dash && source.config.title === loaded.title);
    const request = appSourceLoad?.player === instance ? appSourceLoad : undefined;
    const appManaged = request !== undefined && [
      "hls", "dash", "title", "description", "poster",
      "options.startOffset", "options.startOffsetTimelineReference",
    ].every((path) => configValue(request.source, path) === configValue(loaded, path));
    // SourceLoaded may be delivered after load() resolves. Consume the request
    // and retire its source-kind hint here, after the SDK has loaded the source.
    if (request) {
      appSourceLoad = undefined;
      request.settle?.();
    }
    if (selected && (!appManaged || selected.id !== currentSourceId)) {
      currentSourceId = selected.id;
      sourcePreset = selected.config;
      sourceOverrides = {};
    }
    currentSource = loaded;
  });
  const refreshConfig = (): void => { if (player === instance) configPanel?.refresh(); };
  for (const event of [PlayerEvent.VolumeChanged, PlayerEvent.Muted, PlayerEvent.Unmuted,
    PlayerEvent.PlaybackSpeedChanged, PlayerEvent.ViewModeChanged, PlayerEvent.SourceLoaded]) {
    instance.on(event, refreshConfig);
  }
  refreshConfig();
  await loadCurrentSource(instance).catch((err: unknown) => console.error("load failed", err));
}

void build();
