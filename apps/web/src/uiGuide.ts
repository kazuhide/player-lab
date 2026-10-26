// Theme construction examples and optional comparisons for the active UI.

import { pick, type L } from "./i18n";
import type { UIConfig } from "@showcase/ui-shared";

// Per-theme "what changed from the default UI" — the point the demo makes concrete:
// each custom theme is a small, legible delta from the stock UI. Updated on switch.
interface ThemeDiff {
  /** Plain string when identical in both languages; an `L` when it differs (e.g. the
   *  localized style suffixes or Param labels). */
  label: string | L;
  /** What this theme is built on; null for the stock baseline. */
  base: string | null;
  changes: { op: "+" | "−" | "~"; text: L }[];
  /** How this exact UI is built — the real construction code + its source file. */
  construction: { lang: "ts" | "scss"; code: string; source: string };
}

const THEME_DIFFS: Record<string, ThemeDiff> = {
  default: {
    label: "Default (Bitmovin)",
    base: null,
    changes: [],
    construction: {
      lang: "ts",
      code: `// Keep the standard modern UI tree and customize autohide.
const stock = UIFactory.defaultLayouts.main(uiConfig);
const stockConfig = stock.getConfig();
stock.release();
const container = new UIContainer({
  ...stockConfig,  // Retain the standard components and optional settings.
  hideDelay,  // Use -1 to keep the UI visible.
});
new UIManager(player, [{ ui: container, identifier: UIVariantIdentifier.main }], uiConfig);`,
      source: "packages/ui-shared/src/liveUi.ts → buildDefaultUiContainer",
    },
  },
  "custom-live": {
    label: "Live (DVR)",
    base: "Default (Bitmovin)",
    changes: [
      { op: "+", text: { ja: "LiveButton — ライブ端の表示とジャンプ", en: "LiveButton — show the live edge and jump to it" } },
      { op: "+", text: { ja: "実時刻 ＋「−Xs behind live」ラベル", en: "Wall-clock + “−Xs behind live” labels" } },
      { op: "+", text: { ja: "QuickSeekButton ×2 — ±10秒スキップ(組み込み)", en: "QuickSeekButton ×2 — ±10s skip (built-in)" } },
    ],
    construction: {
      lang: "ts",
      code: `new UIContainer({ components: [
  new SubtitleOverlay(),
  new BufferingOverlay(),
  new PlaybackToggleOverlay(),
  new ControlBar({ components: [
    new Container({ components: [   // top row
      new WallClockLabel(),
      new SeekBar({ label: new SeekBarLabel() }),
      new BehindLiveLabel(),
    ] }),
    new Container({ components: [   // bottom row
      new QuickSeekButton({ seekSeconds: -10 }),
      new PlaybackToggleButton(),
      new QuickSeekButton({ seekSeconds: 10 }),
      new LiveButton(),
      new VolumeToggleButton(),
      new Spacer(),
      new FullscreenToggleButton(),
    ] }),
  ] }),
] });`,
      source: "packages/ui-shared/src/liveUi.ts → buildLiveUiContainer",
    },
  },
  "custom-sports": {
    label: "Sports",
    base: "Live (DVR)",
    changes: [
      { op: "+", text: { ja: "ScoreboardStrip — 他試合スコアを上部に", en: "ScoreboardStrip — other games across the top" } },
      { op: "+", text: { ja: "PlayerInfoCard — 打者/投手＋打順のカード", en: "PlayerInfoCard — batter/pitcher + lineup card" } },
      { op: "+", text: { ja: "SportsInfoToggleButton — オーバーレイ表示の切替", en: "SportsInfoToggleButton — show/hide the overlays" } },
    ],
    construction: {
      lang: "ts",
      code: `// Just add custom Components to the tree (rendering the sportsData.ts sample)
const scoreboard = new ScoreboardStrip();
const playerCard = new PlayerInfoCard();
new UIContainer({ components: [
  new SubtitleOverlay(), new BufferingOverlay(), new PlaybackToggleOverlay(),
  scoreboard,   // top overlay
  playerCard,   // corner card
  new ControlBar({ components: [
    /* the Live control rows */
    new SportsInfoToggleButton([scoreboard, playerCard]), // show/hide toggle
  ] }),
] });`,
      source: "packages/ui-shared/src/liveUi.ts → buildSportsUiContainer",
    },
  },
  "custom-binge": {
    label: "Binge",
    base: "Default (Bitmovin)",
    changes: [
      { op: "+", text: { ja: "SkipIntroButton — イントロ区間だけ表示しスキップ", en: "SkipIntroButton — shows during the intro range and skips it" } },
      { op: "+", text: { ja: "NextEpisodeButton — 次のエピソードへ", en: "NextEpisodeButton — jump to the next episode" } },
      { op: "+", text: { ja: "NextUpCard — 終了間際に表示、カウントダウンで自動再生", en: "NextUpCard — appears near the end; counts down + auto-advances" } },
    ],
    construction: {
      lang: "ts",
      code: `// The playlist + load are app-side; pass the title + a "next" action to the UI
const skip = new SkipIntroButton({ introStart: 5, introEnd: 18 });
const nextUp = new NextUpCard({
  getNextTitle: () => nextEpisodeTitle(), // fetched right before it shows
  autoplay: autoplayNext,                 // the continuous-play option
  onPlayNext: () => playNextEpisode(),    // the app calls player.load
});
new UIContainer({ components: [
  nextUp, // informational overlay
  new ControlBar({ components: [
    /* play · seek … */
    skip, // placed in the control row (clickable)
    new NextEpisodeButton({ onPlayNext: () => playNextEpisode() }),
  ] }),
] });`,
      source: "packages/ui-shared/src/liveUi.ts → buildBingeUiContainer",
    },
  },
  "custom-neon": {
    label: "Neon",
    base: "Default (Bitmovin)",
    changes: [{ op: "~", text: { ja: "ui-skin-neon — グラデのシークバー・グロー・ネオン配色", en: "ui-skin-neon — gradient seek bar, glow, neon palette" } }],
    construction: {
      lang: "scss",
      code: `// 1) Add one class to the Default tree
DefaultUIFactory.buildDefaultUI(player, undefined, {
  extraCssClasses: ["ui-skin-neon"],
});

// 2) the rest is CSS only
.bmpui-ui-skin-neon .bmpui-seekbar-playbackposition {
  background: linear-gradient(90deg, #00e5ff, #ff2bd6);
}`,
      source: "packages/ui-shared/src/styles/ui-shared.scss → .bmpui-ui-skin-neon",
    },
  },
  "custom-glass": {
    label: "Glass",
    base: "Default (Bitmovin)",
    changes: [{ op: "~", text: { ja: "ui-skin-glass — すりガラス(backdrop-blur)の半透明バー", en: "ui-skin-glass — frosted (backdrop-blur) translucent bar" } }],
    construction: {
      lang: "scss",
      code: `DefaultUIFactory.buildDefaultUI(player, undefined, {
  extraCssClasses: ["ui-skin-glass"],
});

.bmpui-ui-skin-glass .bmpui-ui-controlbar {
  background: rgba(255, 255, 255, 0.08);
  // frosted glass
  backdrop-filter: blur(14px) saturate(140%);
}`,
      source: "packages/ui-shared/src/styles/ui-shared.scss → .bmpui-ui-skin-glass",
    },
  },
  "custom-cinema": {
    label: "Cinema",
    base: "Default (Bitmovin)",
    changes: [
      { op: "~", text: { ja: "全幅シークバーを独立した上段に、操作は細い1列", en: "Full-width seek bar on its own top row, controls in a slim row" } },
      { op: "+", text: { ja: "大きな中央再生＋素早い自動非表示(没入)", en: "Big center play + quick auto-hide (immersive)" } },
      { op: "−", text: { ja: "LIVE ピル・音量など余分なクロムを省略", en: "Drops extra chrome like the LIVE pill and volume" } },
    ],
    construction: {
      lang: "ts",
      code: `new UIContainer({
  components: [
    new SubtitleOverlay(),
    new BufferingOverlay(),
    new PlaybackToggleOverlay(),
    new ControlBar({ components: [
      new Container({ components: [   // top row = full-width seek
        new SeekBar({ label: new SeekBarLabel() }),
      ] }),
      new Container({ components: [   // bottom row
        new PlaybackToggleButton(),
        new PlaybackTimeLabel({ /* … */ }),
        new Spacer(),
        new FullscreenToggleButton(),
      ] }),
    ] }),
  ],
  hideDelay: 1000, // quick auto-hide
});`,
      source: "packages/ui-shared/src/liveUi.ts → buildCinemaUiContainer",
    },
  },
  "custom-sunset": {
    label: "Sunset",
    base: "Default (Bitmovin)",
    changes: [{ op: "~", text: { ja: "ui-skin-sunset — 暖色グラデのシークバー・配色", en: "ui-skin-sunset — warm-gradient seek bar and palette" } }],
    construction: {
      lang: "scss",
      code: `DefaultUIFactory.buildDefaultUI(player, undefined, {
  extraCssClasses: ["ui-skin-sunset"],
});

.bmpui-ui-skin-sunset .bmpui-seekbar-playbackposition {
  background:
    linear-gradient(90deg, #ffb347, #ff5e62, #ff2e63);
}`,
      source: "packages/ui-shared/src/styles/ui-shared.scss → .bmpui-ui-skin-sunset",
    },
  },
  "custom-bold": {
    label: "Bold",
    base: "Default (Bitmovin)",
    changes: [{ op: "~", text: { ja: "ui-skin-bold — 大きなボタン・太いシークバー", en: "ui-skin-bold — big buttons, thick seek bar" } }],
    construction: {
      lang: "scss",
      code: `DefaultUIFactory.buildDefaultUI(player, undefined, {
  extraCssClasses: ["ui-skin-bold"],
});

.bmpui-ui-skin-bold .bmpui-ui-button {
  height: 2.4rem;     // enlarge
  min-width: 2.4rem;
}`,
      source: "packages/ui-shared/src/styles/ui-shared.scss → .bmpui-ui-skin-bold",
    },
  },
  "custom-mono": {
    label: "Mono",
    base: "Default (Bitmovin)",
    changes: [{ op: "~", text: { ja: "ui-skin-mono — グレースケールのバー＋四角いスクラバー", en: "ui-skin-mono — grayscale bar + a square scrubber" } }],
    construction: {
      lang: "scss",
      code: `DefaultUIFactory.buildDefaultUI(player, undefined, {
  extraCssClasses: ["ui-skin-mono"],
});

.bmpui-ui-skin-mono .bmpui-ui-button {
  filter: grayscale(1) contrast(1.1);  // strip color
}
.bmpui-ui-skin-mono .bmpui-seekbar-playbackposition {
  background: #e9e9e9;                  // gray played bar
}`,
      source: "packages/ui-shared/src/styles/ui-shared.scss → .bmpui-ui-skin-mono",
    },
  },
  "custom-compact": {
    label: "Compact",
    base: "Default (Bitmovin)",
    changes: [
      { op: "+", text: { ja: "1段だけ:再生 · シーク · 時刻", en: "One row only: play · seek · time" } },
      { op: "−", text: { ja: "中央オーバーレイ・音量・全画面など", en: "Center overlay, volume, fullscreen, etc." } },
    ],
    construction: {
      lang: "ts",
      code: `new UIContainer({
  components: [
    new BufferingOverlay(),
    new ControlBar({ components: [
      new Container({ components: [
        new PlaybackToggleButton(),
        new SeekBar({ label: new SeekBarLabel() }),
        new PlaybackTimeLabel({
          timeLabelMode: PlaybackTimeLabelMode.CurrentTime,
        }),
      ] }),
    ] }),
  ],
  // switches to -1 (always shown) when off
  hideDelay: 2000,
});`,
      source: "packages/ui-shared/src/liveUi.ts → buildCompactUiContainer",
    },
  },
  "custom-premiere": {
    label: "Premiere",
    base: "Default (Bitmovin)",
    changes: [
      { op: "+", text: { ja: "TitleBar — タイトル＋説明(MetadataLabel)", en: "TitleBar — title + description (MetadataLabel)" } },
      { op: "~", text: { ja: "全幅シークを独立行に、下に細い操作列", en: "Full-width seek on its own row, a slim control row below" } },
      { op: "+", text: { ja: "残り時間ラベル＋設定(歯車)", en: "Remaining-time label + settings (gear)" } },
      { op: "+", text: { ja: "RecommendationOverlay — 公式 tv サンプルの「次の動画」(終了時に表示)", en: "RecommendationOverlay — the official tv sample’s “up next” (shows at playback end)" } },
      { op: "~", text: { ja: "ui-skin-premiere — シネマ風グラデ・ブランド赤", en: "ui-skin-premiere — cinematic gradient, brand red" } },
    ],
    construction: {
      lang: "ts",
      code: `const container = new UIContainer({ components: [
  new SubtitleOverlay(),
  new BufferingOverlay(),
  new PlaybackToggleOverlay(),
  new TitleBar(),                  // Includes title and description metadata.
  new ControlBar({ components: [
    new Container({ components: [   // Top row: full-width seek bar.
      new SeekBar({ label: new SeekBarLabel() }),
    ] }),
    new Container({ components: [   // Bottom row.
      new PlaybackToggleButton(),
      new QuickSeekButton({ seekSeconds: -10 }),
      new QuickSeekButton({ seekSeconds: 10 }),
      new Spacer(),
      new PlaybackTimeLabel({        // Remaining time.
        timeLabelMode: PlaybackTimeLabelMode.RemainingTime,
      }),
      new SettingsToggleButton({ settingsPanel }),
      new FullscreenToggleButton(),
    ] }),
  ] }),
  settingsPanel,                   // Opened by the settings button.
  new RecommendationOverlay(),     // Last in the tree: recommendations appear above other controls.
] });
// Supply recommendations through UIConfig.metadata.recommendations:
new UIManager(player, [{ ui: container, identifier: UIVariantIdentifier.main }], {
  componentLayoutOverrides: { QuickSeekButton: UIComponentLayoutOverride.Include },
  metadata: { recommendations: [{ title, resource }] },
});`,
      source: "packages/ui-shared/src/liveUi.ts → buildPremiereUiContainer",
    },
  },
  "custom-creator": {
    label: "Creator",
    base: "Default (Bitmovin)",
    changes: [
      { op: "+", text: { ja: "TitleBar — タイトル＋説明(他のブランドと揃えて追加)", en: "TitleBar — title + description (added to match the other brands)" } },
      { op: "~", text: { ja: "最下部に全幅シーク、その下に1列の操作", en: "Full-width seek at the bottom, one control row below" } },
      { op: "+", text: { ja: "音量スライダー＋現在/全体時間＋設定(歯車)", en: "Volume slider + current/total time + settings (gear)" } },
      { op: "+", text: { ja: "RecommendationOverlay — 公式 tv サンプルの「次の動画」(終了時に表示)", en: "RecommendationOverlay — the official tv sample’s “up next” (shows at playback end)" } },
      { op: "~", text: { ja: "ui-skin-creator — 細い赤バー(ホバーで拡大)", en: "ui-skin-creator — thin red bar (grows on hover)" } },
    ],
    construction: {
      lang: "ts",
      code: `new UIContainer({ components: [
  new SubtitleOverlay(),
  new BufferingOverlay(),
  new PlaybackToggleOverlay(),
  new TitleBar(),                  // title + description
  new ControlBar({ components: [
    new Container({ components: [   // top row = full-width seek
      new SeekBar({ label: new SeekBarLabel() }),
    ] }),
    new Container({ components: [   // bottom row = a Creator-style single row
      new PlaybackToggleButton(),
      new QuickSeekButton({ seekSeconds: 10 }),
      new VolumeToggleButton(),
      new VolumeSlider(),
      new PlaybackTimeLabel({        // current/total
        timeLabelMode:
          PlaybackTimeLabelMode.CurrentAndTotalTime,
      }),
      new Spacer(),
      new SettingsToggleButton({ settingsPanel }),
      new FullscreenToggleButton(),
    ] }),
  ] }),
  settingsPanel,
] });`,
      source: "packages/ui-shared/src/liveUi.ts → buildCreatorUiContainer",
    },
  },
  "custom-studio": {
    label: "Studio",
    base: "Default (Bitmovin)",
    changes: [
      { op: "+", text: { ja: "TitleBar — タイトル＋説明(MetadataLabel)", en: "TitleBar — title + description (MetadataLabel)" } },
      { op: "~", text: { ja: "1列インライン:時刻ラベルの間にシークバー", en: "Single inline row: the seek bar between the time labels" } },
      { op: "+", text: { ja: "RecommendationOverlay — 公式 tv サンプルの「次の動画」(終了時に表示)", en: "RecommendationOverlay — the official tv sample’s “up next” (shows at playback end)" } },
      { op: "~", text: { ja: "ui-skin-studio — 濃紺クローム・ブランド青", en: "ui-skin-studio — navy chrome, brand blue" } },
    ],
    construction: {
      lang: "ts",
      code: `new UIContainer({ components: [
  new SubtitleOverlay(),
  new BufferingOverlay(),
  new PlaybackToggleOverlay(),
  new TitleBar(),                  // title + description
  new ControlBar({ components: [
    new Container({ components: [   // single inline row
      new PlaybackToggleButton(),
      new QuickSeekButton({ seekSeconds: -10 }),
      new QuickSeekButton({ seekSeconds: 10 }),
      new PlaybackTimeLabel({ /* CurrentTime */ }),
      new SeekBar({ label: new SeekBarLabel() }),
      new PlaybackTimeLabel({ /* TotalTime */ }),
      new SettingsToggleButton({ settingsPanel }),
      new FullscreenToggleButton(),
    ] }),
  ] }),
  settingsPanel,
  new RecommendationOverlay(),     // from the official tv sample: end-of-playback "up next". Last = on top
] });`,
      source: "packages/ui-shared/src/liveUi.ts → buildStudioUiContainer",
    },
  },
};

function renderThemeDiff(activeThemeId: string): HTMLElement {
  const diff = THEME_DIFFS[activeThemeId] ?? THEME_DIFFS.default!;
  const box = document.createElement("div");
  box.className = "theme-diff";

  const lbl = typeof diff.label === "string" ? diff.label : pick(diff.label);
  const h3 = document.createElement("h3");
  h3.className = "theme-diff-title";
  h3.textContent = lbl;
  box.appendChild(h3);

  if (diff.base) {
    const base = document.createElement("p");
    base.className = "theme-diff-base";
    base.append(document.createTextNode(pick({ ja: "ベース: ", en: "Based on: " })));
    const strong = document.createElement("strong");
    strong.textContent = diff.base;
    base.appendChild(strong);
    box.appendChild(base);
  }

  if (diff.changes.length > 0) {
    const comparison = document.createElement("details");
    comparison.className = "theme-comparison";
    const summary = document.createElement("summary");
    summary.textContent = pick({ ja: "標準UIからの変更", en: "Changes from Default UI" });
    const list = document.createElement("ul");
    list.className = "theme-diff-list";
    for (const ch of diff.changes) {
      const li = document.createElement("li");
      const op = document.createElement("span");
      op.className =
        ch.op === "+" ? "theme-diff-op add" : ch.op === "−" ? "theme-diff-op remove" : "theme-diff-op reskin";
      op.textContent = ch.op;
      li.append(op, document.createTextNode(` ${pick(ch.text)}`));
      list.appendChild(li);
    }
    comparison.append(summary, list);
    box.appendChild(comparison);
  }

  // How this exact UI is built — the real construction code.
  const codeHead = document.createElement("p");
  codeHead.className = "theme-diff-codehead";
  codeHead.textContent = pick({ ja: "構築コード", en: "Construction code" });
  const pre = document.createElement("pre");
  pre.className = "theme-diff-code";
  pre.dataset.lang = diff.construction.lang;
  const code = document.createElement("code");
  code.textContent = diff.construction.code;
  pre.appendChild(code);
  const src = document.createElement("p");
  src.className = "theme-diff-codesrc";
  src.textContent = diff.construction.source;
  box.append(codeHead, pre, src);

  return box;
}

/** Render the ACTIVE theme's "how it's built" (diff + construction code) into a
 *  container — used for the panel beside the player. Updated on every theme switch. */
export function renderConstruction(container: HTMLElement, activeThemeId: string, uiConfig: UIConfig = {}, appliedUiCode?: string, sdkManaged = false): void {
  container.innerHTML = "";
  const content = document.createElement("div");
  content.className = "construction-content";
  if (sdkManaged) {
    const heading = document.createElement("h3");
    heading.textContent = pick({ ja: "SDKが生成するUI", en: "SDK-managed UI" });
    const note = document.createElement("p");
    note.textContent = "PlayerConfig.ui · style.uiManagerFactory";
    content.append(heading, note);
  } else content.appendChild(renderThemeDiff(activeThemeId));
  const details = document.createElement("details");
  details.className = "ui-config-preview";
  const summary = document.createElement("summary");
  summary.textContent = pick({ ja: "適用中のUIConfigの上書き値", en: "Applied UIConfig overrides" });
  const pre = document.createElement("pre");
  pre.className = "theme-diff-code";
  const code = document.createElement("code");
  code.textContent = `const uiConfig = ${appliedUiCode ?? JSON.stringify(uiConfig, null, 2)};`;
  pre.appendChild(code);
  details.append(summary, pre);
  content.appendChild(details);
  container.appendChild(content);
}

/** Render the general "how to customize the UI" levers (static, theme-independent). */
export function renderUiGuide(container: HTMLElement): void {
  container.innerHTML = "";

  const head = document.createElement("div");
  head.className = "ui-guide-head";
  const h2 = document.createElement("h2");
  h2.textContent = pick({ ja: "UIの実装ガイド", en: "UI implementation guide" });
  const link = document.createElement("a");
  link.className = "ui-guide-link";
  link.href = "./guide.html";
  link.textContent = pick({ ja: "コンポーネントとコード例", en: "Components and code examples" });
  head.append(h2, link);
  container.appendChild(head);
}
