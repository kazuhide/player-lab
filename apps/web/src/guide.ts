/**
 * Standalone "Player UI Customization Guide" page (apps/web/guide.html).
 *
 * Player Lab's right-hand panels are necessarily terse; this page is the long-form
 * companion — the architecture, the customization layers with real snippets, a component
 * catalogue, styling, configuration, and the cross-platform story — bilingual (JA/EN),
 * cross-referenced to the official Bitmovin docs and the player-ui source.
 */
import { pick, getLang, setLang, onLangChange, type L, type Lang } from "./i18n";
import "./styles.css";

type Lang3 = "ts" | "scss" | "bash";
type Block =
  | { kind: "p"; text: L }
  | { kind: "code"; lang: Lang3; code: string; caption?: L }
  | { kind: "list"; items: L[] }
  | { kind: "catalog"; rows: [string, L][] }
  // A callout box for a gotcha (warn) or a tip.
  | { kind: "callout"; tone: "tip" | "warn"; text: L }
  // A cookbook entry: a goal-titled, captioned snippet you can copy.
  | { kind: "recipe"; title: L; lang: Lang3; code: string; note: L }
  | { kind: "links"; items: { label: string; url: string }[] };

interface Section {
  id: string;
  heading: L;
  /** Optional one-line intro shown under the section heading. */
  intro?: L;
  blocks: Block[];
}

const SECTIONS: Section[] = [
  {
    id: "overview",
    heading: { ja: "概要", en: "Overview" },
    intro: {
      ja: "Bitmovin の Player UI(bitmovin-player-ui)は、プレイヤー API の上に乗る独立した TypeScript + SCSS レイヤーです。",
      en: "Bitmovin's Player UI (bitmovin-player-ui) is a standalone TypeScript + SCSS layer that sits on top of the player API.",
    },
    blocks: [
      {
        kind: "p",
        text: {
          ja: "プレイヤー本体とは別のパッケージで、UIを構造(コンポーネントのツリー)とスキン(SCSS)に分けています。構造を保ってスキンを変更したり、部品の配置を組み直したり、独自の部品を追加したりできます。このページではコードと公式ソースへのリンクを使い、変更方法を説明します。",
          en: "The UI is a separate package from the player core, with a structure (a tree of components) and a skin (SCSS). You can change the skin while retaining the structure, rearrange components, or add custom components. This page explains these changes with code and links to the official source.",
        },
      },
      {
        kind: "p",
        text: {
          ja: "Player Labでは、同じプレイヤーに対してUIを実行時に差し替えます。テーマは実装方法ごとに分類され、選択したテーマのコードは「構築コード」パネルに表示されます。このガイドでは、その仕組みと独自のUIを作る手順を説明します。",
          en: "Player Lab swaps UI builds against the same player at runtime, grouped by implementation technique. The construction-code panel shows the selected theme's source. This guide explains that mechanism and the steps for building a custom UI.",
        },
      },
    ],
  },
  {
    id: "architecture",
    heading: { ja: "アーキテクチャと用語", en: "Architecture & vocabulary" },
    intro: {
      ja: "UIを構成する主なクラスと、それぞれの役割を確認します。",
      en: "Review the main classes used to build the UI and their roles.",
    },
    blocks: [
      {
        kind: "list",
        items: [
          {
            ja: "UIManager — UI をプレイヤーに結び付け、ライフサイクル(初期化・破棄)を管理する司令塔。`new UIManager(player, uiContainerOrVariants, config?)` で生成し、`release()` で破棄します。テーマの「差し替え」は、古い UIManager を release して新しいものを作るだけです。",
            en: "UIManager — the conductor that binds a UI to the player and manages its lifecycle (init/destroy). Create with `new UIManager(player, uiContainerOrVariants, config?)`; tear down with `release()`. Swapping themes is just release()-ing the old UIManager and building a new one.",
          },
          {
            ja: "UIContainer — UI ツリーのルート。Container のサブクラスで、ControlBar や各種オーバーレイを内包します。自動非表示の `hideDelay`、ルートに付く `cssClasses` もここ。",
            en: "UIContainer — the root of the UI tree. A subclass of Container holding the ControlBar and overlays. Auto-hide `hideDelay` and the root `cssClasses` live here.",
          },
          {
            ja: "Component<Config> — すべての UI 部品の基底クラス。各部品は通常2ファイル:制御とプレイヤー API 連携の `.ts` と、見た目の `.scss`。ライフサイクルは constructor → `configure(player, uimanager)` → `release()`(後述)。",
            en: "Component<Config> — the base class of every UI part. Each part is usually two files: a `.ts` for control + player-API wiring, and a `.scss` for its look. Lifecycle is constructor → `configure(player, uimanager)` → `release()` (see below).",
          },
          {
            ja: "UIVariant[] — 条件付きの UI 一覧。複数の UI を条件付きで渡すと、文脈(モバイル幅・TV・広告中など)に応じて最初に条件を満たした UI が選ばれます。最後の要素は条件を省いてフォールバックにできます。",
            en: "UIVariant[] — a conditional list of UIs. Pass several UIs with conditions and the first whose condition matches the context (mobile width, TV, ad, …) is shown; the last entry may omit its condition as the fallback.",
          },
        ],
      },
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "プレイヤーの内蔵UIを無効にしてから、独自のUIを接続します。",
          en: "Disable the player's built-in UI, then attach a custom UI.",
        },
        code: `import { Player } from "bitmovin-player";
import { UIManager, UIFactory, UIVariantIdentifier, UIComponentLayoutOverride, type UIContainer } from "bitmovin-player-ui";

const player = new Player(el, { key, ui: false }); // ui:false is essential
const createUi = (container: UIContainer) => new UIManager(player,
  [{ ui: container, identifier: UIVariantIdentifier.main }],
  { componentLayoutOverrides: { QuickSeekButton: UIComponentLayoutOverride.Include } },
);
const ui = createUi(myUiContainer);    // or UIFactory.buildUI(player)
// later, swap just the UI (the player stays):
ui.release();
const ui2 = createUi(anotherContainer);`,
      },
      {
        kind: "callout",
        tone: "tip",
        text: {
          ja: "プレイヤー本体の挙動(自動再生・バッファ・ABR・DVR など)は PlayerConfig 側、見た目と操作は UI 側。混同しないことがカスタマイズの第一歩です。Player Labの「Player Config」パネルが前者、このガイドが後者です。",
          en: "Player behavior (autoplay, buffering, ABR, DVR…) lives in PlayerConfig; look and controls live in the UI. Keeping the two apart is the first step to customizing. Player Lab's “Player Config” panel is the former; this guide is the latter.",
        },
      },
    ],
  },
  {
    id: "start",
    heading: { ja: "UIの変更方法", en: "UI customization approaches" },
    intro: {
      ja: "標準UIを使うか、部品の配置を変えるか、色やサイズを変えるか、目的に応じて選びます。",
      en: "Choose an approach based on whether you need the standard UI, a different component layout, or changes to colors and sizes.",
    },
    blocks: [
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "A) プリセットをそのまま使う — 自分で組まない。レスポンシブな標準 UI。",
          en: "A) Use a preset as-is — compose nothing. The stock, responsive UI.",
        },
        code: `const ui = UIFactory.buildUI(player);`,
      },
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "B) ツリーを組む — 部品を選んで並べる。1行消せば操作が消え、1行足せば増える。",
          en: "B) Compose a tree — pick and arrange parts. Delete a line to drop a control, add one to gain it.",
        },
        code: `const container = new UIContainer({ components: [
  new PlaybackToggleOverlay(),
  new ControlBar({ components: [
    new PlaybackToggleButton(),
    new SeekBar({ label: new SeekBarLabel() }),
    new PlaybackTimeLabel(),
    new FullscreenToggleButton(),
  ] }),
] });
new UIManager(player, [{ ui: container, identifier: UIVariantIdentifier.main }]);`,
      },
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "C) CSS だけで再スキン — 構造はそのまま、クラスを足して見た目だけ変える。",
          en: "C) Re-skin with CSS only — keep the structure, add a class, change only the look.",
        },
        code: `LiveUIFactory.buildLiveUI(player, undefined, {
  extraCssClasses: ["ui-skin-neon"], // style .bmpui-ui-skin-neon in SCSS
});`,
      },
    ],
  },
  {
    id: "compose",
    heading: { ja: "ツリーを組む(構造)", en: "Composing the tree (structure)" },
    intro: {
      ja: "UI は入れ子のコンテナです:UIContainer > ControlBar > Container > 部品。並び順がそのまま画面の並びとレイヤー順(後ろほど前面)になります。",
      en: "A UI is nested containers: UIContainer > ControlBar > Container > parts. Order is both the visual order and the layer order (later = on top).",
    },
    blocks: [
      {
        kind: "list",
        items: [
          {
            ja: "UIContainer — ルート。オーバーレイ類(字幕・バッファ・中央再生・推薦)と ControlBar を並べる。",
            en: "UIContainer — the root; holds the overlays (subtitles, buffering, center play, recommendations) and the ControlBar.",
          },
          {
            ja: "ControlBar — 下部に固定される操作バー。中に Container を積めば「上段/下段」のような複数行を作れる。",
            en: "ControlBar — the bar pinned to the bottom; stack Containers inside it to build multiple rows (e.g. a top row + a bottom row).",
          },
          {
            ja: "Container — 汎用の入れ物。`cssClasses` でレイアウト用クラスを付け、Flex などで横並び/間隔を制御。`new Spacer()` で余白を押し広げる。",
            en: "Container — a generic box; tag it with `cssClasses` for layout and use Flex etc. to arrange/space children. `new Spacer()` pushes things apart.",
          },
        ],
      },
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "上段に全幅シーク、下段に操作列 — 2つの Container を積むだけ。Spacer が左右を分ける。",
          en: "A full-width seek row on top, a controls row below — just two stacked Containers. A Spacer splits left from right.",
        },
        code: `new ControlBar({ components: [
  new Container({                       // top row
    components: [new SeekBar({ label: new SeekBarLabel() })],
    cssClasses: ["controlbar-top"],     // your own layout class
  }),
  new Container({                       // bottom row
    components: [
      new QuickSeekButton({ seekSeconds: -10 }),
      new PlaybackToggleButton(),
      new QuickSeekButton({ seekSeconds: 10 }),
      new VolumeToggleButton(),
      new VolumeSlider(),
      new Spacer(),                     // split left from right here
      new SettingsToggleButton({ settingsPanel }),
      new FullscreenToggleButton(),
    ],
    cssClasses: ["controlbar-bottom"],
  }),
] });`,
      },
      {
        kind: "callout",
        tone: "tip",
        text: {
          ja: "「足す/消す/並べ替える」はこの配列を編集するだけ。Player Labの各テーマ(Live / Cinema / Premiere…)は、この同じ ControlBar を別の並びにしただけのものです。右の構築コードと見比べてください。",
          en: "“Add / remove / reorder” is just editing this array. Each Player Lab theme (Live / Cinema / Premiere…) is the same ControlBar in a different arrangement — compare them against the construction-code panel.",
        },
      },
    ],
  },
  {
    id: "catalog",
    heading: { ja: "コンポーネント・カタログ", en: "Component catalogue" },
    intro: {
      ja: "用途別の代表的な組み込み部品。全リファレンスは末尾の API ドキュメント/ソースへ。",
      en: "A representative set of built-in parts by purpose. Full reference in the API docs / source at the end.",
    },
    blocks: [
      {
        kind: "catalog",
        rows: [
          ["— 入れ物 / Containers —", { ja: "", en: "" }],
          ["UIContainer", { ja: "ツリーのルート。hideDelay・cssClasses を持つ。", en: "Root of the tree; carries hideDelay + cssClasses." }],
          ["ControlBar / Container / Spacer", { ja: "下部バー / 汎用入れ物 / 伸縮する余白。", en: "Bottom bar / generic box / stretchy gap." }],
          ["— ボタン / Buttons —", { ja: "", en: "" }],
          ["PlaybackToggleButton", { ja: "再生/一時停止。", en: "Play / pause." }],
          ["QuickSeekButton", { ja: "±N 秒スキップ(VOD はシーク、ライブは timeShift)。", en: "±N-second skip (seek on VOD, timeShift on live)." }],
          ["VolumeToggleButton / FullscreenToggleButton / PictureInPictureToggleButton", { ja: "ミュート / 全画面 / PiP。AirPlay・Cast・VR もあり。", en: "Mute / fullscreen / PiP (plus AirPlay, Cast, VR)." }],
          ["SettingsToggleButton", { ja: "設定パネルを開く歯車。", en: "The gear that opens the settings panel." }],
          ["— ラベル & バー / Labels & bars —", { ja: "", en: "" }],
          ["SeekBar / SeekBarLabel", { ja: "スクラバー＋プレビュー。ライブは DVR ウィンドウを表示。", en: "Scrubber + preview; shows the DVR window on live." }],
          ["VolumeSlider", { ja: "音量スライダー。", en: "Volume slider." }],
          ["PlaybackTimeLabel", { ja: "時刻(Current / Total / CurrentAndTotal / Remaining を timeLabelMode で選択)。", en: "Time (Current / Total / CurrentAndTotal / Remaining via timeLabelMode)." }],
          ["TitleBar / MetadataLabel", { ja: "ソースのタイトル・説明(SourceConfig 由来)。", en: "Source title / description (from SourceConfig)." }],
          ["— オーバーレイ / Overlays —", { ja: "", en: "" }],
          ["SubtitleOverlay", { ja: "字幕/キャプションの表示面。", en: "Subtitle/caption render surface." }],
          ["BufferingOverlay / PlaybackToggleOverlay", { ja: "バッファ表示・中央の大きな再生ボタン。", en: "Buffering indicator / big center play button." }],
          ["RecommendationOverlay", { ja: "終了時の「次の動画」(UIConfig.metadata.recommendations を読む)。", en: "End-of-playback “up next” (reads UIConfig.metadata.recommendations)." }],
          ["ErrorMessageOverlay / TitleBar", { ja: "エラー表示 / 上部チャ―ム。", en: "Error display / top chrome." }],
          ["— 設定パネル / Settings —", { ja: "", en: "" }],
          ["SettingsPanel / SettingsPanelPage / SettingsPanelItem", { ja: "歯車で開くパネル → ページ → 1項目。", en: "Panel opened by the gear → page → one item." }],
          ["VideoQualitySelectBox / AudioTrackSelectBox / PlaybackSpeedSelectBox / SubtitleSelectBox", { ja: "パネル内の選択ボックス。", en: "Select boxes inside the panel." }],
          ["— 自作の基底 / Base classes —", { ja: "", en: "" }],
          ["Component / Container / Button / ToggleButton / Label / ListBox", { ja: "継承して自作部品を作るための基底クラス(次節)。", en: "Base classes to extend for your own parts (next section)." }],
        ],
      },
    ],
  },
  {
    id: "custom-component",
    heading: { ja: "部品を自作する(中核)", en: "Writing a custom component (the core)" },
    intro: {
      ja: "ライブラリの基底クラスを継承し、constructorで見た目を設定します。configureでプレイヤーの操作やイベントにつなぎ、releaseで必要な後片付けを行います。",
      en: "Extend a library base class, set its appearance in the constructor, connect player actions and events in configure, and clean up owned resources in release.",
    },
    blocks: [
      {
        kind: "list",
        items: [
          {
            ja: "1. 基底を選ぶ — クリックする物は Button / ToggleButton、テキスト表示は Label、入れ物は Container。状態(オン/オフ)を持つなら ToggleButton。",
            en: "1. Pick a base — Button / ToggleButton for clickable things, Label for text, Container for boxes. ToggleButton if it has on/off state.",
          },
          {
            ja: "2. constructor で見た目を決める — `cssClass`(→ `.bmpui-` クラス)、`text`、ToggleButton なら `onClass` / `offClass` / ARIA テキスト。",
            en: "2. Set the look in the constructor — `cssClass` (→ a `.bmpui-` class), `text`, and for a ToggleButton its `onClass` / `offClass` / ARIA labels.",
          },
          {
            ja: "3. `configure(player, uimanager)` でプレイヤーに繋ぐ — まず `super.configure(...)`。`this.onClick.subscribe(...)` で操作を、`player.on(PlayerEvent.X, update)` で状態反映を購読。`this.on()/off()/show()/hide()/setText()` で自分を更新。",
            en: "3. Wire to the player in `configure(player, uimanager)` — call `super.configure(...)` first. Subscribe to actions with `this.onClick.subscribe(...)` and to state with `player.on(PlayerEvent.X, update)`. Update yourself with `this.on()/off()/show()/hide()/setText()`.",
          },
          {
            ja: "4. 後片付け — フレームワークは release 時にハンドラを自動解除しますが、`uimanager.onRelease.subscribe(...)` で明示しておくと契約が明確。重い資源は `release()` をオーバーライドして `super.release()` を呼ぶ。",
            en: "4. Teardown — the framework auto-removes handlers on release, but subscribing to `uimanager.onRelease` makes the contract explicit. For heavy resources, override `release()` and call `super.release()`.",
          },
        ],
      },
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "実物①:この demo の「LIVE」ボタン(packages/ui-shared/src/components/LiveButton.ts)。ToggleButton を継承し、端からの距離で on/off、クリックで端へジャンプ。",
          en: "Real example ①: this demo's “LIVE” button (packages/ui-shared/src/components/LiveButton.ts). Extends ToggleButton; toggles by distance from the edge; click jumps to the edge.",
        },
        code: `export class LiveButton extends ToggleButton<LiveButtonConfig> {
  constructor(config: LiveButtonConfig = {}) {
    super({
      cssClass: "ui-livebutton",        // → .bmpui-ui-livebutton
      text: "LIVE",
      buttonStyle: ButtonStyle.Text,    // default is icon-only -> render the text
      onClass: "at-live-edge",          // state class applied when ON
      offClass: "behind-live",          // state class applied when OFF
      ...config,
    });
  }

  override configure(player: PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);          // required
    const { PlayerEvent } = player.exports;

    const update = () => {
      if (!player.isLive()) return this.hide();   // hide on VOD
      this.show();
      // ON within 1s of the edge, else OFF
      Math.abs(player.getTimeShift()) <= 1 ? this.on() : this.off();
    };

    this.onClick.subscribe(() => player.timeShift(0, "ui-livebutton")); // jump to the live edge
    // (the real file watches a few more: SourceUnloaded, TimeShift, Paused, DurationChanged)
    for (const e of [PlayerEvent.TimeChanged, PlayerEvent.TimeShifted,
                     PlayerEvent.SourceLoaded, PlayerEvent.Playing]) {
      player.on(e, update);
    }
    update();
  }
}`,
      },
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "実物②:壁時計ラベル(WallClockLabel.ts)。Label を継承し、ライブの現在時刻を `setText` で流し込むだけ。値に追従する表示の最小形。",
          en: "Real example ②: the wall-clock label (WallClockLabel.ts). Extends Label and just feeds the live time in via `setText`. The minimal shape for a value-bound display.",
        },
        code: `export class WallClockLabel extends Label<LabelConfig> {
  constructor(config: LabelConfig = {}) {
    super({ cssClass: "ui-label-wallclock", ...config });
  }
  override configure(player: PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);
    const { PlayerEvent } = player.exports;
    const update = () => {
      if (!player.isLive()) return this.hide();
      this.show();
      this.setText(formatWallClock(player.getCurrentTime())); // value -> display
    };
    for (const e of [PlayerEvent.TimeChanged, PlayerEvent.SourceLoaded]) {
      player.on(e, update);
    }
    update();
  }
}`,
      },
      {
        kind: "callout",
        tone: "warn",
        text: {
          ja: "configure では必ず最初に super.configure(player, uimanager) を呼ぶこと。これを忘れると基底のDOM初期化やイベント配線が走らず、表示・操作が動きません。",
          en: "Always call super.configure(player, uimanager) first in configure. Skip it and the base's DOM init + event wiring never run, so the part won't render or react.",
        },
      },
    ],
  },
  {
    id: "settings",
    heading: { ja: "設定パネル(歯車)を作る", en: "Building the settings panel (the gear)" },
    intro: {
      ja: "歯車 = SettingsToggleButton、その中身 = SettingsPanel → SettingsPanelPage → SettingsPanelItem。各 Item に選択ボックスを差すだけ。",
      en: "The gear = SettingsToggleButton; its contents = SettingsPanel → SettingsPanelPage → SettingsPanelItem. Drop a select box into each Item.",
    },
    blocks: [
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "実物:この demo の設定パネル(画質・速度・音声)。`SettingsToggleButton({ settingsPanel })` をバーに置き、`settingsPanel` をルートにも並べます。",
          en: "Real example: this demo's settings panel (quality, speed, audio). Put `SettingsToggleButton({ settingsPanel })` in the bar and the `settingsPanel` itself at the root.",
        },
        code: `const settingsPanel = new SettingsPanel({
  components: [
    new SettingsPanelPage({
      components: [
        new SettingsPanelItem({ label: "Quality", settingComponent: new VideoQualitySelectBox() }),
        new SettingsPanelItem({ label: "Speed", settingComponent: new PlaybackSpeedSelectBox() }),
        new SettingsPanelItem({ label: "Audio", settingComponent: new AudioTrackSelectBox() }),
      ],
    }),
  ],
  hidden: true, // hidden until the gear is clicked
});

// gear in the bar, panel body at the root:
new ControlBar({ components: [ /* … */ new SettingsToggleButton({ settingsPanel }) ] });
new UIContainer({ components: [ controlBar, settingsPanel ] });`,
      },
      {
        kind: "callout",
        tone: "tip",
        text: {
          ja: "選択肢が1つもない項目(例:単一画質のソースでの画質)は自動で隠れます。再生速度の項目は UIConfig.playbackSpeedSelectionEnabled が false だと隠れます — Player Labの「UI settings」でこの挙動を試せます。",
          en: "An item with no real choices (e.g. quality on a single-rendition source) auto-hides. The speed item hides when UIConfig.playbackSpeedSelectionEnabled is false — try it in Player Lab's “UI settings”.",
        },
      },
    ],
  },
  {
    id: "events",
    heading: { ja: "イベント(UI と プレイヤー)", en: "Events (UI and player)" },
    intro: {
      ja: "自作部品が反応する先は2系統:UI コンポーネント自身のイベント(クリック等)と、プレイヤーのイベント(再生状況等)。",
      en: "A custom part reacts to two streams: the UI component's own events (clicks, …) and the player's events (playback state, …).",
    },
    blocks: [
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "UI 側 — コンポーネントは EventDispatcher を公開。subscribe で購読、unsubscribe で解除。",
          en: "UI side — components expose EventDispatchers; subscribe to listen, unsubscribe to stop.",
        },
        code: `button.onClick.subscribe((sender, args) => { /* … */ });
toggleButton.onToggle.subscribe(() => { /* on/off changed */ });
selectBox.onItemSelected.subscribe((sender, key) => { /* selection changed */ });`,
      },
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "プレイヤー側 — player.on(PlayerEvent.X, handler)。表示の更新はだいたいこれを購読して行います。",
          en: "Player side — player.on(PlayerEvent.X, handler). Most display updates subscribe to these.",
        },
        code: `const { PlayerEvent } = player.exports;
player.on(PlayerEvent.TimeChanged, update);   // frequent: ~every frame
player.on(PlayerEvent.Seeked, update);
player.on(PlayerEvent.TimeShifted, update);    // live timeShift finished
player.on(PlayerEvent.SourceLoaded, update);
player.on(PlayerEvent.PlaybackFinished, () => { /* … */ });
// remove: player.off(PlayerEvent.TimeChanged, update)`,
      },
      {
        kind: "callout",
        tone: "tip",
        text: {
          ja: "ライブ/DVR では maxTimeShift が「0」を返してから埋まることがあるため、状態の再読み込みは SourceLoaded だけでなく TimeChanged でも行うのが定石です(LiveButton がまさにそれ)。プレイヤー側の全イベントは Web SDK v8 のリファレンス参照。",
          en: "On live/DVR, maxTimeShift can read “0” before it fills, so re-read state on TimeChanged too, not only SourceLoaded (that's exactly what LiveButton does). See the Web SDK v8 reference for the full event list.",
        },
      },
    ],
  },
  {
    id: "styling",
    heading: { ja: "スタイリング(SCSS / CSS)", en: "Styling (SCSS / CSS)" },
    intro: {
      ja: "コンポーネントの cssClass がそのまま `bmpui-` 接頭辞付きの DOM クラスになります。あとは普通の CSS。",
      en: "A component's cssClass becomes its DOM class with a `bmpui-` prefix. After that it's just CSS.",
    },
    blocks: [
      {
        kind: "list",
        items: [
          {
            ja: "命名 — `cssClass: \"ui-livebutton\"` → `.bmpui-ui-livebutton`。状態クラスも `bmpui-` 付き(`.bmpui-on` / `.bmpui-off` / `.bmpui-hidden`、自分で付けた `.bmpui-at-live-edge` など)。",
            en: "Naming — `cssClass: \"ui-livebutton\"` → `.bmpui-ui-livebutton`. State classes are prefixed too (`.bmpui-on` / `.bmpui-off` / `.bmpui-hidden`, plus your own like `.bmpui-at-live-edge`).",
          },
          {
            ja: "再スキンの足場 — ルートに `extraCssClasses: [\"ui-skin-neon\"]` を足し、`.bmpui-ui-skin-neon …` で配下を上書き。構造は一切触らない(Player Labの Neon / Glass / Sunset / Bold / Mono がこれ)。",
            en: "Re-skin hook — add `extraCssClasses: [\"ui-skin-neon\"]` at the root and override descendants under `.bmpui-ui-skin-neon …`. No structure changes (Player Lab's Neon / Glass / Sunset / Bold / Mono are this).",
          },
        ],
      },
      {
        kind: "code",
        lang: "scss",
        caption: {
          ja: "ルートにタグ付け → そのフックを styling。これだけで全く別の見た目になる。",
          en: "Tag the root → style its hooks. That alone yields a wholly different look.",
        },
        code: `.bmpui-ui-skin-neon {
  .bmpui-seekbar-playbackposition {              // the played bar
    background: linear-gradient(90deg, #00e5ff, #ff2bd6);
    box-shadow: 0 0 8px rgba(0, 229, 255, 0.85);
  }
  .bmpui-ui-button:hover { filter: drop-shadow(0 0 6px #00e5ff); }
}`,
      },
      {
        kind: "callout",
        tone: "warn",
        text: {
          ja: "詳細度の罠:基底スキンは再生済みバーを `.bmpui-ui-seekbar .bmpui-seekbar .bmpui-seekbar-playbackposition`(詳細度0,3,0)で着色します。単色で上書きするには同じ深さまでセレクタを合わせる必要があります — `.ui-skin-x` 1枚(0,2,0)では負けて白いまま。グラデーションは background-image なので基底(background-color)と衝突せず、浅いセレクタでも効きます。",
          en: "Specificity trap: the base skin colors the played bar with `.bmpui-ui-seekbar .bmpui-seekbar .bmpui-seekbar-playbackposition` (specificity 0,3,0). A solid-color override must match that depth — a lone `.ui-skin-x` (0,2,0) loses and the bar stays white. A gradient is a background-image, so it doesn't collide with the base's background-color and wins even from a shallow selector.",
        },
      },
      {
        kind: "code",
        lang: "bash",
        caption: {
          ja: "ビルド — SCSS から配布 CSS/JS を作る。アプリはこの成果物を読み込む。",
          en: "Build — compile the SCSS into the shipped CSS/JS the app loads.",
        },
        code: `# clone bitmovin-player-ui, add your skin, then build:
npm install && npm run build   # → dist/bitmovinplayer-ui.js + .css
# or just layer your own rules on top of the shipped CSS`,
      },
    ],
  },
  {
    id: "config",
    heading: { ja: "設定(UIConfig & コンポーネント config)", en: "Configuration (UIConfig & component config)" },
    intro: {
      ja: "継承せずに挙動を変える層。UIManager 全体の UIConfig と、各部品の config の2段。",
      en: "Change behavior without subclassing. Two levels: the UIManager-wide UIConfig and each part's own config.",
    },
    blocks: [
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "UIManager 全体 — メタデータ・推薦・シークプレビュー・速度選択・ローカライズなど。",
          en: "UIManager-wide — metadata, recommendations, seek preview, speed selection, localization, …",
        },
        code: `new UIManager(player, [{ ui: container, identifier: UIVariantIdentifier.main }], {
  metadata: { title, description, recommendations: [{ title, resource }] },
  enableSeekPreview: false,            // stop real-time follow while scrubbing
  playbackSpeedSelectionEnabled: false,
  componentLayoutOverrides: { QuickSeekButton: UIComponentLayoutOverride.Include },
  disableAutoHideWhenHovered: true,
});`,
      },
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "各部品 — コンストラクタに渡す config。継承不要の調整はだいたいここ。",
          en: "Per part — config passed to the constructor. Most no-subclass tweaks live here.",
        },
        code: `new UIContainer({ components: [/* … */], hideDelay: -1 }); // -1 = always shown
new PlaybackTimeLabel({ timeLabelMode: PlaybackTimeLabelMode.RemainingTime });
new QuickSeekButton({ seekSeconds: 30 });`,
      },
      {
        kind: "callout",
        tone: "tip",
        text: {
          ja: "「UI settings」ではUIConfigの表示設定を、「Player Config」では画面に用意された再生設定を変更できます。各項目に表示された適用方法を確認し、再生結果と適用コードを見比べます。",
          en: "Use “UI settings” to change the exposed UIConfig options and “Player Config” for the available playback settings. Follow each field's application method, then compare the playback result with the applied code.",
        },
      },
    ],
  },
  {
    id: "variants",
    heading: { ja: "UI バリアント & TV(リモコン操作)", en: "UI variants & TV (remote control)" },
    intro: {
      ja: "文脈(画面サイズ・TV・広告)で UI を出し分け、TV ではリモコンの上下左右で操作できるようにします。",
      en: "Switch UIs by context (screen size, TV, ads), and make TVs navigable with the remote's arrow keys.",
    },
    blocks: [
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "UIVariant[] — 最初に条件を満たしたものが選ばれる。最後はフォールバック。",
          en: "UIVariant[] — the first matching condition wins; the last is the fallback.",
        },
        code: `new UIManager(player, [
  { ui: adsUi, identifier: UIVariantIdentifier.ads, condition: (ctx) => ctx.isAd },
  { ui: mobileUi, identifier: UIVariantIdentifier.smallScreen, condition: (ctx) => ctx.documentWidth < 600 },
  { ui: desktopUi, identifier: UIVariantIdentifier.main }, // no condition = fallback
]);`,
      },
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "TV(10フィート / リモコン)— 公式 playerUi/tv サンプルはこの SpatialNavigation で上下左右フォーカス移動を足しています。",
          en: "TV (10-foot / remote) — the official playerUi/tv samples add arrow-key focus movement with SpatialNavigation.",
        },
        code: `import { UIManager, UIVariantIdentifier, SpatialNavigation, RootNavigationGroup } from "bitmovin-player-ui";

const spatialNavigation = new SpatialNavigation(
  new RootNavigationGroup(uiContainer, /* focusable: */ playButton, settingsButton),
);
// { ui, spatialNavigation } is a UIVariant — pass it in an ARRAY (like the tv samples):
new UIManager(player, [{ ui: uiContainer, identifier: UIVariantIdentifier.tv, spatialNavigation }]);`,
      },
      {
        kind: "callout",
        tone: "tip",
        text: {
          ja: "このデモのストリーミング風テーマ(Premiere / Creator / Studio)は、公式 playerUi/tv サンプルの「良いとこ取り」です:TitleBar(タイトル＋説明)と RecommendationOverlay(終了時の「次の動画」)を取り込み、SpatialNavigation はこのガイドで“手法として”紹介する形にしています(Web 操作のままにするため)。",
          en: "This demo's streaming-style themes (Premiere / Creator / Studio) take the “good parts” of the official playerUi/tv samples: the TitleBar (title + description) and RecommendationOverlay (end-of-playback “up next”). SpatialNavigation is documented here as a technique rather than wired into these web themes (to keep mouse interaction).",
        },
      },
      {
        kind: "callout",
        tone: "tip",
        text: {
          ja: "一度作れば全プラットフォームへ:同じビルド済みバンドル(bitmovinplayer-ui.js / .css)を Android・iOS・React Native が WebView で読み込みます。Web でのカスタムがそのまま反映されます(tvOS と Vega は DOM ベース UI 非対応のためネイティブ UI を別途用意)。",
          en: "Customize once, ship everywhere: the same prebuilt bundle (bitmovinplayer-ui.js / .css) is loaded in a WebView by Android, iOS, and React Native, so your web customization carries over (tvOS and Vega can't use the DOM-based UI, so they get a native UI).",
        },
      },
    ],
  },
  {
    id: "gestures",
    heading: { ja: "プレイヤー面のジェスチャ", en: "Player-surface gestures" },
    intro: {
      ja: "コンポーネントが扱わない操作(面のタップ/ダブルクリック等)は、プレイヤー要素に自前のリスナーを付けて実装します。",
      en: "Interactions components don't handle (taps/double-clicks on the surface) are implemented with your own listeners on the player element.",
    },
    blocks: [
      {
        kind: "code",
        lang: "ts",
        caption: {
          ja: "例:ダブルクリックでフルスクリーン or ±10秒シークを切替。キャプチャフェーズで横取りし、標準の挙動と衝突させない。",
          en: "Example: a double-click that switches between fullscreen and ±10s seek. Intercept in the capture phase so it doesn't clash with the built-in behavior.",
        },
        code: `playerEl.addEventListener("dblclick", (e) => {
  if (mode === "seek") {
    e.stopPropagation();                    // suppress the built-in fullscreen
    const rect = playerEl.getBoundingClientRect();
    const left = e.clientX - rect.left < rect.width / 2;
    player.timeShift?.(left ? -10 : 10);    // left half = back / right half = forward
  }
}, { capture: true });`,
      },
    ],
  },
  {
    id: "cookbook",
    heading: { ja: "クックブック(コピペ用)", en: "Cookbook (copy-paste)" },
    intro: {
      ja: "よくあるカスタムを最小コードで。どれもこのデモのどこかで実際に使っています。",
      en: "Common customizations in minimal code. Each is actually used somewhere in this demo.",
    },
    blocks: [
      {
        kind: "recipe",
        title: { ja: "操作を1つ消す / 足す", en: "Remove / add one control" },
        note: { ja: "ControlBar の配列を編集するだけ。", en: "Just edit the ControlBar array." },
        lang: "ts",
        code: `new ControlBar({ components: [
  new PlaybackToggleButton(),
  // new VolumeToggleButton(),   // comment out to remove
  new SeekBar({ label: new SeekBarLabel() }),
  new SettingsToggleButton({ settingsPanel }), // add one line to gain the gear
  new FullscreenToggleButton(),
] });`,
      },
      {
        kind: "recipe",
        title: { ja: "コントロールを常時表示にする", en: "Keep controls always visible" },
        note: { ja: "UIContainer.hideDelay を -1 に(Player Labの Autohide オフと同じ)。", en: "Set UIContainer.hideDelay to -1 (same as Player Lab's Autohide off)." },
        lang: "ts",
        code: `new UIContainer({ components: [/* … */], hideDelay: -1 });`,
      },
      {
        kind: "recipe",
        title: { ja: "1要素だけ色を変える", en: "Recolor just one element" },
        note: { ja: "構造は不変。フックを1つ styling。詳細度の罠(上)に注意。", en: "No structure change; style one hook. Mind the specificity trap above." },
        lang: "scss",
        code: `.bmpui-ui-skin-mybrand .bmpui-seekbar-playbackposition { background: #e50914; }`,
      },
      {
        title: { ja: "タイトルと説明を出す", en: "Show title + description" },
        kind: "recipe",
        note: { ja: "TitleBar を置くだけ(既定で Title+Description の MetadataLabel 内蔵)。値は SourceConfig から。", en: "Just add a TitleBar (its default holds the Title+Description MetadataLabels). Values come from SourceConfig." },
        lang: "ts",
        code: `new UIContainer({ components: [new TitleBar(), /* … */] });
player.load({ hls: url, title: "My title", description: "My description" });`,
      },
      {
        kind: "recipe",
        title: { ja: "「次の動画」を出す", en: "Show “up next” recommendations" },
        note: { ja: "RecommendationOverlay を最後に置き、UIConfig.metadata.recommendations を渡す。終了時に表示。", en: "Put a RecommendationOverlay last and pass UIConfig.metadata.recommendations. Shows at playback end." },
        lang: "ts",
        code: `const container = new UIContainer({ components: [/* …, */ new RecommendationOverlay()] });
new UIManager(player, [{ ui: container, identifier: UIVariantIdentifier.main }], {
  metadata: { recommendations: [{ title: "Next", resource: { hls: nextUrl } }] },
});`,
      },
      {
        kind: "recipe",
        title: { ja: "プレイヤーの値に追従するラベル", en: "A label bound to a player value" },
        note: { ja: "Label を継承し、イベントで setText するだけ(WallClockLabel と同じ型)。", en: "Extend Label and setText on events (same shape as WallClockLabel)." },
        lang: "ts",
        code: `class BitrateLabel extends Label<LabelConfig> {
  override configure(player, uimanager) {
    super.configure(player, uimanager);
    const update = () => this.setText(\`\${Math.round((player.getDownloadedVideoData?.().bitrate ?? 0) / 1000)} kbps\`);
    player.on(player.exports.PlayerEvent.VideoDownloadQualityChanged, update);
    update();
  }
}`,
      },
    ],
  },
  {
    id: "references",
    heading: { ja: "参考リンク(ソース込み)", en: "References (incl. source)" },
    blocks: [
      {
        kind: "links",
        items: [
          { label: "Player UI — developer docs", url: "https://developer.bitmovin.com/playback/docs/bitmovin-player-ui" },
          { label: "Player UI — API reference (v4)", url: "https://cdn.bitmovin.com/player/ui/4/docs/index.html" },
          { label: "bitmovin-player-ui — source (GitHub)", url: "https://github.com/bitmovin/bitmovin-player-ui" },
          { label: "components/ — every built-in part's .ts", url: "https://github.com/bitmovin/bitmovin-player-ui/tree/main/src/ts/components" },
          { label: "UIFactory.ts — how the stock UIs are composed", url: "https://github.com/bitmovin/bitmovin-player-ui/blob/main/src/ts/uifactory.ts" },
          { label: "src/scss/ — the shipped skin", url: "https://github.com/bitmovin/bitmovin-player-ui/tree/main/src/scss" },
          { label: "playerUi/tv — official TV-style player samples", url: "https://github.com/bitmovin/bitmovin-player-web-samples/tree/main/playerUi/tv" },
          { label: "Web SDK v8 — API reference (PlayerEvent etc.)", url: "https://developer.bitmovin.com/playback/reference/web-sdk-v8-api-reference" },
        ],
      },
    ],
  },
];

// --- DOM ---
function need(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`guide.html is missing #${id}`);
  return el;
}
const root = need("guide-root");
const titleEl = need("guide-title");
const taglineEl = need("guide-tagline");
const backLabelEl = need("guide-back-label");
const langToggleEl = need("lang-toggle");

const TITLE: L = { ja: "Player UI カスタマイズ・ガイド", en: "Player UI Customization Guide" };
const TAGLINE: L = {
  ja: "Bitmovin Player UI で何をどう変えられるか — 詳細版。",
  en: "What you can change in the Bitmovin Player UI, and how — the long form.",
};
const BACK: L = { ja: "Player Labに戻る", en: "Back to Player Lab" };

function renderLangToggle(): void {
  langToggleEl.innerHTML = "";
  for (const l of [
    { id: "ja" as Lang, label: "日本語" },
    { id: "en" as Lang, label: "English" },
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = l.label;
    b.className = getLang() === l.id ? "lang-btn active" : "lang-btn";
    b.setAttribute("aria-pressed", String(getLang() === l.id));
    b.addEventListener("click", () => setLang(l.id));
    langToggleEl.appendChild(b);
  }
}

/** A syntax-tagged code block with an optional caption above it. */
function codeBlock(lang: Lang3, code: string, caption?: L): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "guide-code";
  pre.dataset.lang = lang;
  const codeEl = document.createElement("code");
  codeEl.textContent = code;
  pre.appendChild(codeEl);
  if (!caption) return pre;
  const wrap = document.createElement("figure");
  wrap.className = "guide-codefig";
  const cap = document.createElement("figcaption");
  cap.className = "guide-codecap";
  cap.textContent = pick(caption);
  wrap.append(cap, pre);
  return wrap;
}

function blockEl(b: Block): HTMLElement {
  if (b.kind === "p") {
    const p = document.createElement("p");
    p.className = "guide-p";
    p.textContent = pick(b.text);
    return p;
  }
  if (b.kind === "code") {
    return codeBlock(b.lang, b.code, b.caption);
  }
  if (b.kind === "callout") {
    const div = document.createElement("div");
    div.className = `guide-callout ${b.tone}`;
    div.textContent = pick(b.text);
    return div;
  }
  if (b.kind === "recipe") {
    const card = document.createElement("div");
    card.className = "guide-recipe";
    const h = document.createElement("h3");
    h.className = "guide-recipe-title";
    h.textContent = pick(b.title);
    const note = document.createElement("p");
    note.className = "guide-recipe-note";
    note.textContent = pick(b.note);
    card.append(h, note, codeBlock(b.lang, b.code));
    return card;
  }
  if (b.kind === "list") {
    const ul = document.createElement("ul");
    ul.className = "guide-list";
    for (const it of b.items) {
      const li = document.createElement("li");
      li.textContent = pick(it);
      ul.appendChild(li);
    }
    return ul;
  }
  if (b.kind === "catalog") {
    const dl = document.createElement("dl");
    dl.className = "guide-catalog";
    for (const [name, desc] of b.rows) {
      const dt = document.createElement("dt");
      dt.textContent = name;
      const dd = document.createElement("dd");
      dd.textContent = pick(desc);
      dl.append(dt, dd);
    }
    return dl;
  }
  // links
  const ul = document.createElement("ul");
  ul.className = "guide-links";
  for (const it of b.items) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = it.url;
    a.textContent = it.label;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    li.appendChild(a);
    ul.appendChild(li);
  }
  return ul;
}

function render(): void {
  document.documentElement.lang = getLang();
  titleEl.textContent = pick(TITLE);
  taglineEl.textContent = pick(TAGLINE);
  backLabelEl.textContent = pick(BACK);
  renderLangToggle();

  root.innerHTML = "";
  // A small table of contents.
  const toc = document.createElement("nav");
  toc.className = "guide-toc";
  for (const s of SECTIONS) {
    const a = document.createElement("a");
    a.href = `#${s.id}`;
    a.textContent = pick(s.heading);
    toc.appendChild(a);
  }
  root.appendChild(toc);

  for (const s of SECTIONS) {
    const sec = document.createElement("section");
    sec.className = "guide-section";
    sec.id = s.id;
    const h2 = document.createElement("h2");
    h2.textContent = pick(s.heading);
    sec.appendChild(h2);
    if (s.intro) {
      const intro = document.createElement("p");
      intro.className = "guide-section-intro";
      intro.textContent = pick(s.intro);
      sec.appendChild(intro);
    }
    for (const b of s.blocks) sec.appendChild(blockEl(b));
    root.appendChild(sec);
  }
}

render();
onLangChange(render);
