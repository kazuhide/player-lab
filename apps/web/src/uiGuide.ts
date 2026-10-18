// Renders the in-app "How to customize the UI" guide (in Japanese). The demo's
// headline is that reshaping the Bitmovin player UI is easy and layered — so this
// panel spells out the levers, each with a short, real snippet from this repo and a
// pointer to the source file you'd edit. The theme selector above is these levers in
// action; this panel is the "how". Prose is Japanese; code/paths stay as-is.

import { pick, getLang, type L } from "./i18n";

// The displayed code snippets carry Japanese *comments*; their identifiers/strings are all
// ASCII, so the only Japanese in a snippet is in a comment. In English mode we translate
// those comment phrases (longest first, so a full row description wins over a row label) — one
// source snippet, localized at render time.
const CODE_COMMENTS: [string, string][] = [
  // Construction-code comments for the CSS/brand themes (added when those
  // snippets were introduced; the all-theme E2E guard keeps this complete).
  ["recommendations は UIConfig.metadata.recommendations で渡す:", "pass recommendations via UIConfig.metadata.recommendations:"],
  ["公式 tv 由来: 終了時の「次の動画」。最後＝最前面に描画", "from the official tv sample: end-of-playback \"up next\". Last = paints on top"],
  ["タイトル＋説明(既定で MetadataLabel 内蔵)", "title + description (default MetadataLabels built in)"],
  ["公式 tv 由来: 終了時の「次の動画」。最後＝最前面", "from the official tv sample: end-of-playback \"up next\". Last = on top"],
  ["1) 標準ツリーに class を1つ足すだけ", "1) Add one class to the Default tree"],
  ["自作 Component をツリーに足すだけ（sportsData.ts のサンプルを描画）", "Just add custom Components to the tree (rendering the sportsData.ts sample)"],
  ["上部オーバーレイ", "top overlay"],
  ["隅のカード", "corner card"],
  ["Live の操作列", "the Live control rows"],
  ["表示トグル", "show/hide toggle"],
  ["プレイリストと load はアプリ側。UI には title と「次へ」動作を渡す", "The playlist + load are app-side; pass the title + a \"next\" action to the UI"],
  ["表示直前に取得", "fetched right before it shows"],
  ["連続再生オプション", "the continuous-play option"],
  ["アプリが player.load", "the app calls player.load"],
  ["情報オーバーレイ", "informational overlay"],
  ["操作列に配置（クリック可能）", "placed in the control row (clickable)"],
  ["再生・シーク…", "play · seek …"],
  ["2) あとは CSS だけ", "2) the rest is CSS only"],
  ["グレーの再生バー", "gray played bar"],
  ["タイトル＋説明", "title + description"],
  ["色を抜く", "strip color"],
  ["標準のモダンUIツリーをそのまま使い、autohide だけ差し替え", "Reuse the stock modern-UI tree, swap only autohide"],
  ["← Autohide オフで -1（常時表示）", "← -1 when Autohide is off (always shown)"],
  ["オフ時は -1（常時表示）に切替", "switches to -1 (always shown) when off"],
  ["下段 = Creator風の1列", "bottom row = a Creator-style single row"],
  ["上段 = 全幅シーク", "top row = full-width seek"],
  ["歯車で開く設定", "settings opened by the gear"],
  ["標準構成そのまま", "stock structure as-is"],
  ["素早く自動非表示", "quick auto-hide"],
  ["1列インライン", "single inline row"],
  ["残り時間", "remaining time"],
  ["すりガラス", "frosted glass"],
  ["現在/全体", "current/total"],
  ["大型化", "enlarge"],
  ["上段", "top row"],
  ["下段", "bottom row"],
];
// Apply longest phrase first so a short phrase that is a substring of a longer one
// (such as a row label within a longer row description) cannot partial-match — independent of source order.
CODE_COMMENTS.sort((a, b) => b[0].length - a[0].length);

function localizeCode(code: string): string {
  if (getLang() !== "en") return code;
  let out = code;
  for (const [ja, en] of CODE_COMMENTS) out = out.split(ja).join(en);
  return out;
}

// Per-theme "what changed from the default UI" — the point the demo makes concrete:
// each custom theme is a small, legible delta from the stock UI. Updated on switch.
interface ThemeDiff {
  /** Plain string when identical in both languages; an `L` when it differs (e.g. the
   *  localized style suffixes or Param labels). */
  label: string | L;
  /** What this theme is built on; null for the stock baseline. */
  base: string | null;
  /** A one-line sense of how little it took. */
  effort: L;
  changes: { op: "+" | "−" | "~"; text: L }[];
  /** How this exact UI is built — the real construction code + its source file. */
  construction: { lang: "ts" | "scss"; code: string; source: string };
}

const THEME_DIFFS: Record<string, ThemeDiff> = {
  default: {
    label: "Default (Bitmovin)",
    base: null,
    effort: { ja: "標準の bitmovin-player-ui のモダンUI。構成は無変更、autohide(hideDelay)だけ切替できる出発点です。", en: "The stock bitmovin-player-ui modern UI. Structure unchanged — only autohide (hideDelay) is switchable; the starting point." },
    changes: [],
    construction: {
      lang: "ts",
      code: `// 標準のモダンUIツリーをそのまま使い、autohide だけ差し替え
const stock = UIFactory.defaultLayouts.main();
new UIContainer({
  components: stock.getConfig().components,  // 標準構成そのまま
  hidePlayerStateExceptions:
    stock.getConfig().hidePlayerStateExceptions,
  hideDelay,  // ← Autohide オフで -1（常時表示）
});`,
      source: "packages/ui-shared/src/liveUi.ts → buildDefaultUiContainer",
    },
  },
  "custom-live": {
    label: "Live (DVR)",
    base: "Default (Bitmovin)",
    effort: { ja: "デフォルトのコントロールバーに数点のコンポーネントを足しただけ。", en: "Just a few components added to the default control bar." },
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
    new Container({ components: [   // 上段
      new WallClockLabel(),
      new SeekBar({ label: new SeekBarLabel() }),
      new BehindLiveLabel(),
    ] }),
    new Container({ components: [   // 下段
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
    effort: { ja: "Live の操作列に、自作オーバーレイ2つ＋表示トグルを足すだけ。", en: "Just two custom overlays + a toggle added to the Live control set." },
    changes: [
      { op: "+", text: { ja: "ScoreboardStrip — 他試合スコアを上部に", en: "ScoreboardStrip — other games across the top" } },
      { op: "+", text: { ja: "PlayerInfoCard — 打者/投手＋打順のカード", en: "PlayerInfoCard — batter/pitcher + lineup card" } },
      { op: "+", text: { ja: "SportsInfoToggleButton — オーバーレイ表示の切替", en: "SportsInfoToggleButton — show/hide the overlays" } },
    ],
    construction: {
      lang: "ts",
      code: `// 自作 Component をツリーに足すだけ（sportsData.ts のサンプルを描画）
const scoreboard = new ScoreboardStrip();
const playerCard = new PlayerInfoCard();
new UIContainer({ components: [
  new SubtitleOverlay(), new BufferingOverlay(), new PlaybackToggleOverlay(),
  scoreboard,   // 上部オーバーレイ
  playerCard,   // 隅のカード
  new ControlBar({ components: [
    /* Live の操作列 */
    new SportsInfoToggleButton([scoreboard, playerCard]), // 表示トグル
  ] }),
] });`,
      source: "packages/ui-shared/src/liveUi.ts → buildSportsUiContainer",
    },
  },
  "custom-binge": {
    label: "Binge",
    base: "Default (Bitmovin)",
    effort: { ja: "VOD の操作列に、エピソード連結用の自作コンポーネントを3つ追加。", en: "Three custom components for stringing episodes together, on a VOD control set." },
    changes: [
      { op: "+", text: { ja: "SkipIntroButton — イントロ区間だけ表示しスキップ", en: "SkipIntroButton — shows during the intro range and skips it" } },
      { op: "+", text: { ja: "NextEpisodeButton — 次のエピソードへ", en: "NextEpisodeButton — jump to the next episode" } },
      { op: "+", text: { ja: "NextUpCard — 終了間際に表示、カウントダウンで自動再生", en: "NextUpCard — appears near the end; counts down + auto-advances" } },
    ],
    construction: {
      lang: "ts",
      code: `// プレイリストと load はアプリ側。UI には title と「次へ」動作を渡す
const skip = new SkipIntroButton({ introStart: 5, introEnd: 18 });
const nextUp = new NextUpCard({
  getNextTitle: () => nextEpisodeTitle(), // 表示直前に取得
  autoplay: autoplayNext,                 // 連続再生オプション
  onPlayNext: () => playNextEpisode(),    // アプリが player.load
});
new UIContainer({ components: [
  nextUp, // 情報オーバーレイ
  new ControlBar({ components: [
    /* 再生・シーク… */
    skip, // 操作列に配置（クリック可能）
    new NextEpisodeButton({ onPlayNext: () => playNextEpisode() }),
  ] }),
] });`,
      source: "packages/ui-shared/src/liveUi.ts → buildBingeUiContainer",
    },
  },
  "custom-neon": {
    label: "Neon",
    base: "Default (Bitmovin)",
    effort: { ja: "CSS クラス1つ＋ルール一式。コンポーネント変更ゼロ。", en: "One CSS class plus a set of rules. Zero component changes." },
    changes: [{ op: "~", text: { ja: "ui-skin-neon — グラデのシークバー・グロー・ネオン配色", en: "ui-skin-neon — gradient seek bar, glow, neon palette" } }],
    construction: {
      lang: "scss",
      code: `// 1) 標準ツリーに class を1つ足すだけ
DefaultUIFactory.buildDefaultUI(player, undefined, {
  extraCssClasses: ["ui-skin-neon"],
});

// 2) あとは CSS だけ
.bmpui-ui-skin-neon .bmpui-seekbar-playbackposition {
  background: linear-gradient(90deg, #00e5ff, #ff2bd6);
}`,
      source: "packages/ui-shared/src/styles/ui-shared.scss → .bmpui-ui-skin-neon",
    },
  },
  "custom-glass": {
    label: "Glass",
    base: "Default (Bitmovin)",
    effort: { ja: "これも CSS だけ。コンポーネント変更ゼロ。", en: "CSS only, again. Zero component changes." },
    changes: [{ op: "~", text: { ja: "ui-skin-glass — すりガラス(backdrop-blur)の半透明バー", en: "ui-skin-glass — frosted (backdrop-blur) translucent bar" } }],
    construction: {
      lang: "scss",
      code: `DefaultUIFactory.buildDefaultUI(player, undefined, {
  extraCssClasses: ["ui-skin-glass"],
});

.bmpui-ui-skin-glass .bmpui-ui-controlbar {
  background: rgba(255, 255, 255, 0.08);
  // すりガラス
  backdrop-filter: blur(14px) saturate(140%);
}`,
      source: "packages/ui-shared/src/styles/ui-shared.scss → .bmpui-ui-skin-glass",
    },
  },
  "custom-cinema": {
    label: "Cinema",
    base: "Default (Bitmovin)",
    effort: { ja: "構成を変えた没入レイアウト。CinemaUIFactory で組み直し。", en: "A re-composed, immersive layout. Rebuilt with CinemaUIFactory." },
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
      new Container({ components: [   // 上段 = 全幅シーク
        new SeekBar({ label: new SeekBarLabel() }),
      ] }),
      new Container({ components: [   // 下段
        new PlaybackToggleButton(),
        new PlaybackTimeLabel({ /* … */ }),
        new Spacer(),
        new FullscreenToggleButton(),
      ] }),
    ] }),
  ],
  hideDelay: 1000, // 素早く自動非表示
});`,
      source: "packages/ui-shared/src/liveUi.ts → buildCinemaUiContainer",
    },
  },
  "custom-sunset": {
    label: "Sunset",
    base: "Default (Bitmovin)",
    effort: { ja: "これも CSS だけ。コンポーネント変更ゼロ。", en: "CSS only, again. Zero component changes." },
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
    effort: { ja: "CSS だけ。操作系を大きく(TV / 10フィート向け)。", en: "CSS only. Bigger controls (TV / 10-foot)." },
    changes: [{ op: "~", text: { ja: "ui-skin-bold — 大きなボタン・太いシークバー", en: "ui-skin-bold — big buttons, thick seek bar" } }],
    construction: {
      lang: "scss",
      code: `DefaultUIFactory.buildDefaultUI(player, undefined, {
  extraCssClasses: ["ui-skin-bold"],
});

.bmpui-ui-skin-bold .bmpui-ui-button {
  height: 2.4rem;     // 大型化
  min-width: 2.4rem;
}`,
      source: "packages/ui-shared/src/styles/ui-shared.scss → .bmpui-ui-skin-bold",
    },
  },
  "custom-mono": {
    label: "Mono",
    base: "Default (Bitmovin)",
    effort: { ja: "CSS だけ。色を一切使わないモノクロ化。コンポーネント変更ゼロ。", en: "CSS only. A fully hue-free monochrome pass. Zero component changes." },
    changes: [{ op: "~", text: { ja: "ui-skin-mono — グレースケールのバー＋四角いスクラバー", en: "ui-skin-mono — grayscale bar + a square scrubber" } }],
    construction: {
      lang: "scss",
      code: `DefaultUIFactory.buildDefaultUI(player, undefined, {
  extraCssClasses: ["ui-skin-mono"],
});

.bmpui-ui-skin-mono .bmpui-ui-button {
  filter: grayscale(1) contrast(1.1);  // 色を抜く
}
.bmpui-ui-skin-mono .bmpui-seekbar-playbackposition {
  background: #e9e9e9;                  // グレーの再生バー
}`,
      source: "packages/ui-shared/src/styles/ui-shared.scss → .bmpui-ui-skin-mono",
    },
  },
  "custom-compact": {
    label: "Compact",
    base: "Default (Bitmovin)",
    effort: { ja: "構成を変更:中央オーバーレイなしの細い1段。", en: "Re-composed: a slim single row with no center overlay." },
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
  // オフ時は -1（常時表示）に切替
  hideDelay: 2000,
});`,
      source: "packages/ui-shared/src/liveUi.ts → buildCompactUiContainer",
    },
  },
  "custom-premiere": {
    label: "Premiere",
    base: "Default (Bitmovin)",
    effort: { ja: "構成を変えた別ツリー＋ブランド配色の CSS。PremiereUIFactory で組み直し。", en: "A different tree + brand-colored CSS. Rebuilt with PremiereUIFactory." },
    changes: [
      { op: "+", text: { ja: "TitleBar — タイトル＋説明(MetadataLabel)", en: "TitleBar — title + description (MetadataLabel)" } },
      { op: "~", text: { ja: "全幅シークを独立行に、下に細い操作列", en: "Full-width seek on its own row, a slim control row below" } },
      { op: "+", text: { ja: "残り時間ラベル＋設定(歯車)", en: "Remaining-time label + settings (gear)" } },
      { op: "+", text: { ja: "RecommendationOverlay — 公式 tv サンプルの「次の動画」(終了時に表示)", en: "RecommendationOverlay — the official tv sample’s “up next” (shows at playback end)" } },
      { op: "~", text: { ja: "ui-skin-premiere — シネマ風グラデ・ブランド赤", en: "ui-skin-premiere — cinematic gradient, brand red" } },
    ],
    construction: {
      lang: "ts",
      code: `new UIContainer({ components: [
  new SubtitleOverlay(),
  new BufferingOverlay(),
  new PlaybackToggleOverlay(),
  new TitleBar(),                  // タイトル＋説明(既定で MetadataLabel 内蔵)
  new ControlBar({ components: [
    new Container({ components: [   // 上段 = 全幅シーク
      new SeekBar({ label: new SeekBarLabel() }),
    ] }),
    new Container({ components: [   // 下段
      new PlaybackToggleButton(),
      new QuickSeekButton({ seekSeconds: -10 }),
      new QuickSeekButton({ seekSeconds: 10 }),
      new Spacer(),
      new PlaybackTimeLabel({        // 残り時間
        timeLabelMode: PlaybackTimeLabelMode.RemainingTime,
      }),
      new SettingsToggleButton({ settingsPanel }),
      new FullscreenToggleButton(),
    ] }),
  ] }),
  settingsPanel,                   // 歯車で開く設定
  new RecommendationOverlay(),     // 公式 tv 由来: 終了時の「次の動画」。最後＝最前面に描画
] });
// recommendations は UIConfig.metadata.recommendations で渡す:
new UIManager(player, container, {
  metadata: { recommendations: [{ title, resource }] },
});`,
      source: "packages/ui-shared/src/liveUi.ts → buildPremiereUiContainer",
    },
  },
  "custom-creator": {
    label: "Creator",
    base: "Default (Bitmovin)",
    effort: { ja: "別ツリー＋赤いバーの CSS。CreatorUIFactory で組み直し。", en: "A different tree + red-bar CSS. Rebuilt with CreatorUIFactory." },
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
  new TitleBar(),                  // タイトル＋説明
  new ControlBar({ components: [
    new Container({ components: [   // 上段 = 全幅シーク
      new SeekBar({ label: new SeekBarLabel() }),
    ] }),
    new Container({ components: [   // 下段 = Creator風の1列
      new PlaybackToggleButton(),
      new QuickSeekButton({ seekSeconds: 10 }),
      new VolumeToggleButton(),
      new VolumeSlider(),
      new PlaybackTimeLabel({        // 現在/全体
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
    effort: { ja: "別ツリー＋濃紺×青の CSS。StudioUIFactory で組み直し。", en: "A different tree + navy×blue CSS. Rebuilt with StudioUIFactory." },
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
  new TitleBar(),                  // タイトル＋説明
  new ControlBar({ components: [
    new Container({ components: [   // 1列インライン
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
  new RecommendationOverlay(),     // 公式 tv 由来: 終了時の「次の動画」。最後＝最前面
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
  h3.textContent = diff.base
    ? pick({ ja: `「${lbl}」とデフォルト UI の差分`, en: `“${lbl}” vs the default UI` })
    : pick({ ja: `「${lbl}」— 基準`, en: `“${lbl}” — baseline` });
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
    box.appendChild(list);
  }

  const effort = document.createElement("p");
  effort.className = "theme-diff-effort";
  effort.textContent = pick(diff.effort);
  box.appendChild(effort);

  // How this exact UI is built — the real construction code.
  const codeHead = document.createElement("p");
  codeHead.className = "theme-diff-codehead";
  codeHead.textContent = pick({ ja: "構築コード", en: "Construction code" });
  const pre = document.createElement("pre");
  pre.className = "theme-diff-code";
  pre.dataset.lang = diff.construction.lang;
  const code = document.createElement("code");
  code.textContent = localizeCode(diff.construction.code);
  pre.appendChild(code);
  const src = document.createElement("p");
  src.className = "theme-diff-codesrc";
  src.textContent = diff.construction.source;
  box.append(codeHead, pre, src);

  return box;
}

/** Render the ACTIVE theme's "how it's built" (diff + construction code) into a
 *  container — used for the panel beside the player. Updated on every theme switch. */
export function renderConstruction(container: HTMLElement, activeThemeId: string): void {
  container.innerHTML = "";
  container.appendChild(renderThemeDiff(activeThemeId));
}

/** Render the general "how to customize the UI" levers (static, theme-independent). */
export function renderUiGuide(container: HTMLElement): void {
  container.innerHTML = "";

  const head = document.createElement("div");
  head.className = "ui-guide-head";
  const h2 = document.createElement("h2");
  h2.textContent = pick({ ja: "UI はどうカスタムするか", en: "How to customize the UI" });
  const intro = document.createElement("p");
  intro.className = "ui-guide-intro";
  intro.textContent = pick({
    ja:
      "上のどのテーマも「同じプレイヤー × 違う UI」です。UIManager の差し替え、コンポーネントの組み替え、" +
      "CSS 再スキン、自作コンポーネント、config、ジェスチャ — その手順とコンポーネント一覧、公式ドキュメントへの" +
      "リンクを、別ページの詳細ガイドにまとめました。",
    en:
      "Every theme above is “the same player × a different UI”. Swapping the UIManager, re-composing components, " +
      "CSS re-skinning, custom components, config, gestures — the steps, a component catalogue, and links to the " +
      "official docs are collected in a dedicated guide page.",
  });
  const link = document.createElement("a");
  link.className = "ui-guide-link";
  link.href = "/guide.html";
  link.textContent = pick({ ja: "詳細なカスタマイズ・ガイドを開く →", en: "Open the full customization guide →" });
  head.append(h2, intro, link);
  container.appendChild(head);
}
