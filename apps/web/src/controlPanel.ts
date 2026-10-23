/**
 * The runtime control panel (§13): switch sources, jump to the edge / seek to a
 * relative offset, toggle DVR + absolute/relative time, change the buffer target
 * (§8), and watch the live event log (§10) + a player-state readout. It uses the web
 * app's playback timing logic (src/playback) for clamping and state.
 *
 * The panel emits intents for things that need the player's lifecycle (source
 * selection, DVR on/off); `main.ts` owns the player and acts on them — e.g. the
 * DVR toggle rebuilds the player with `PlaybackConfig.timeShift`, so the change is
 * reflected in the real player UI (§5.4), not just here.
 */
import type { PlayerAPI } from "bitmovin-player";
import type { CastingButtons, UIConfig } from "@showcase/ui-shared";
import { missingSourceSettings, type ShowcaseSource } from "./sources";
import { createSourceLoadHint } from "./playback/sourceLoad";
import type { DoubleClickMode } from "./gestures";
import { clampToWindow, liveLatencySeconds } from "./playback/window";
import { deriveTimelineState, type PlayerSnapshot } from "./playback/state";
import { infoChip } from "./infoChip";
import type { L } from "./i18n";
import { LangBinder } from "./i18nDom";

// The control panel doesn't re-mount on language change (that would clear its live event log /
// telemetry), so its labels follow the language via this binder instead. A fresh binder is set
// at the top of each mount; `relocalizeControlPanel()` (called from main.ts on language change)
// re-applies the current language to the current mount's labels.
let binder = new LangBinder();
export function relocalizeControlPanel(): void {
  binder.relocalize();
}

// TimeMode (§7) is a string enum the web SDK doesn't expose at runtime. Reference
// its values typed via getCurrentTime's own parameter signature so this stays safe.
type TimeMode = NonNullable<Parameters<PlayerAPI["getCurrentTime"]>[0]>;
const RELATIVE_TIME = "relativetime" as unknown as TimeMode;
const ABSOLUTE_TIME = "absolutetime" as unknown as TimeMode;

/** The SDK's own latency: `player.lowlatency.getLatency()` (distance from the live edge). Live
 *  only; wrapped because it isn't meaningful on VOD / no source. */
function sdkLatencySeconds(player: PlayerAPI): number | null {
  if (!player.isLive()) return null;
  try {
    const l = player.lowlatency.getLatency();
    return Number.isFinite(l) && l >= 0 ? l : null;
  } catch {
    return null;
  }
}

export interface ControlPanelOptions {
  /** Whether DVR is currently enabled in the player config. */
  timeShiftEnabled: boolean;
  /** Request a DVR enable/disable — `main.ts` rebuilds the player. */
  onTimeShiftToggle: (enabled: boolean) => void;
  /** The active source kind, including when this panel is rebuilt for a live source. */
  currentSourceIsLive: boolean;
  /** Select and load a source through the owner of the player lifecycle. */
  onSourceSelected: (source: ShowcaseSource) => Promise<void>;
  /** Reload the current source starting `offsetFromEdge` seconds behind the live
   *  edge (SourceConfig.options.startOffset, §11). 0 = default start. */
  onReloadWithStartOffset: (offsetFromEdge: number) => void;
  /** Current player double-click behavior (custom themes). */
  doubleClickMode: DoubleClickMode;
  /** Change the double-click behavior. */
  onDoubleClickModeChange: (mode: DoubleClickMode) => void;
  /** Whether the control bar auto-hides. Default off — controls stay visible. */
  autohideEnabled: boolean;
  /** Toggle control-bar auto-hide — `main.ts` rebuilds the active theme's UI with the
   *  new hideDelay. Works on every theme, including Default (DefaultUIFactory). */
  onAutohideToggle: (enabled: boolean) => void;
  /** The app's live UIConfig (the other UI-settings toggles). Used for the initial
   *  checkbox states; SDK defaults fill in anything unset. */
  uiConfig: UIConfig;
  /** Apply a UIConfig change — `main.ts` merges it and rebuilds the active theme's UI. */
  onUiConfigChange: (patch: Partial<UIConfig>) => void;
  /** Which casting buttons (AirPlay / PiP / Chromecast) are currently added to the custom UIs. */
  casting: CastingButtons;
  /** Toggle a casting button — `main.ts` adds/removes it on the custom trees (and rebuilds the
   *  player for Cast, which needs PlayerConfig.remotecontrol). */
  onCastingChange: (patch: Partial<CastingButtons>) => void;
  /** Whether the Binge theme auto-advances to the next episode at the end (continuous play). */
  autoplayNext: boolean;
  /** Toggle continuous play — `main.ts` rebuilds the active UI so the Binge Next-up card follows. */
  onAutoplayNextToggle: (enabled: boolean) => void;
  /** An optional persistent telemetry card (the QoE box) to place alongside the player-state +
   *  event log. It's owned by `main.ts` (its metrics accumulate across rebuilds), so the
   *  panel re-attaches the same node on each rebuild rather than recreating it. */
  extraTelemetry?: HTMLElement;
}

function button(label: string | L, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  binder.text(b, label);
  b.addEventListener("click", onClick);
  return b;
}

function checkbox(
  label: string | L,
  checked: boolean,
  onChange: (checked: boolean) => void,
  hint?: string | L,
): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "panel-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  // The label text is its own span (so it follows the language) between the box and the chip.
  // (.panel-check is an inline-flex with a gap, so no spacer text node is needed.)
  wrap.append(input, binder.span(label, "panel-check-text"));
  if (hint) wrap.append(infoChip(hint)); // "?" chip + shared overlay (bilingual)
  return wrap;
}

function select(
  value: string,
  opts: { value: string; label: string | L }[],
  onChange: (value: string) => void,
): HTMLSelectElement {
  const sel = document.createElement("select");
  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.value;
    binder.text(opt, o.label);
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function row(label: string | L, ...controls: HTMLElement[]): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "panel-row";
  div.append(binder.span(label, "panel-label"), ...controls);
  return div;
}

/** A settings row with a "?" chip carrying its guidance (shown via the shared overlay). */
function rowWithHint(label: string | L, hint: string | L, ...controls: HTMLElement[]): HTMLDivElement {
  const div = row(label, ...controls);
  div.querySelector(".panel-label")?.appendChild(infoChip(hint));
  return div;
}

function section(title: string | L, ...children: HTMLElement[]): HTMLElement {
  const sec = document.createElement("section");
  sec.className = "panel-section";
  const head = document.createElement("h2");
  binder.text(head, title);
  sec.append(head, ...children);
  return sec;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : String(n);
  return `${n.toFixed(1)}s`;
}

export interface ControlPanelHandle {
  /** Apply a temporary kind hint until this particular load settles. */
  beginSourceLoad: (isLive: boolean) => () => void;
  /** Reflect detailed UI edits without replacing this panel's log or input drafts. */
  refreshUi: (config: UIConfig, autohide: boolean) => void;
}

export function mountControlPanel(
  player: PlayerAPI,
  container: HTMLElement,
  sources: ShowcaseSource[],
  options: ControlPanelOptions,
): ControlPanelHandle {
  const { PlayerEvent, BufferType, MediaType, ViewMode } = player.exports;
  const timeShiftEnabled = options.timeShiftEnabled;
  // Fresh label binder for this mount — relocalizeControlPanel() re-applies the language.
  // Invariant: every binder.text/span call below runs synchronously during this mount (before
  // any await), so they all bind to THIS mount's binder, not a later one.
  binder = new LangBinder();

  const readout = document.createElement("pre");
  readout.className = "panel-readout";
  const logEl = document.createElement("pre");
  logEl.className = "panel-log";

  function log(message: string): void {
    const stamp = new Date().toLocaleTimeString();
    const next = `[${stamp}] ${message}\n${logEl.textContent ?? ""}`;
    logEl.textContent = next.split("\n").slice(0, 80).join("\n");
  }

  function seekToOffset(offset: number): void {
    // Offset is relative to the live edge (timeShift semantics); clamp to the window.
    player.timeShift(clampToWindow(offset, player.getMaxTimeShift()), "panel");
  }

  // A source hint only covers a pending load. Once it settles, duration is
  // authoritative, including a live stream finalizing into on-demand media.
  const sourceHint = createSourceLoadHint();
  sourceHint.begin(options.currentSourceIsLive);

  // --- Sources (§13) ---
  const sourceRow = document.createElement("div");
  sourceRow.className = "panel-row";
  const missingAssets = document.createElement("p");
  const missingDescriptions: string[] = [];
  for (const source of sources) {
    const missing = missingSourceSettings(source);
    const sourceButton = button(source.label, () => {
      void options.onSourceSelected(source).catch((err: unknown) => log(`load error: ${String(err)}`));
    });
    if (missing.length > 0) {
      sourceButton.disabled = true;
      sourceButton.setAttribute("aria-describedby", "source-requirements");
      missingDescriptions.push(`${source.label}: ${missing.join(", ")}`);
    }
    sourceRow.append(sourceButton);
  }
  missingAssets.id = "source-requirements";
  missingAssets.hidden = missingDescriptions.length === 0;
  binder.text(missingAssets, {
    ja: `未設定のデモは無効です。apps/web/.env に次を設定してください: ${missingDescriptions.join("; ")}`,
    en: `Unconfigured demos are disabled. Set these values in apps/web/.env: ${missingDescriptions.join("; ")}`,
  });

  // --- Seek (§5.1–5.3) ---
  const seekInput = document.createElement("input");
  seekInput.type = "number";
  seekInput.value = "-30";
  seekInput.step = "5";
  seekInput.className = "seek-input";
  const seekBtn = button({ ja: "シーク", en: "Seek" }, () => seekToOffset(Number(seekInput.value)));
  const quickRow = document.createElement("div");
  quickRow.className = "panel-row";
  for (const off of [-10, -30, -60, -120]) {
    quickRow.append(button(`${off}s`, () => seekToOffset(off)));
  }

  // --- Config (§5.4, §7) ---
  const timeShiftToggle = checkbox(
    { ja: "DVR を許可 (timeShift)", en: "Allow DVR (timeShift)" },
    timeShiftEnabled,
    (checked) => options.onTimeShiftToggle(checked),
    {
      ja: "ライブ配信で DVR ウィンドウ内へのシーク(巻き戻し)を許可(PlaybackConfig.timeShift)。オフは再生をライブ端に固定。",
      en: "Allow seeking back into a live stream's DVR window (PlaybackConfig.timeShift). Off pins playback to the live edge.",
    },
  );

  // Auto-hide the control bar. Off (the default) keeps the controls always visible —
  // handy while switching/inspecting UIs. It maps to the UIContainer `hideDelay`
  // (-1 = always shown) and works on every theme, including Default.
  const autohideToggle = checkbox(
    { ja: "コントロールを自動で隠す", en: "Autohide controls" },
    options.autohideEnabled,
    (checked) => options.onAutohideToggle(checked),
    {
      ja: "数秒間操作がないとコントロールバーを自動で隠す(UIContainer の hideDelay)。オフは常時表示。",
      en: "Auto-hide the control bar after a few seconds idle (UIContainer hideDelay). Off keeps it always shown.",
    },
  );

  // --- UI settings (UIConfig): the UIManager-level options beyond autohide. Each flips one
  // UIConfig flag and rebuilds the active theme's UI (via onUiConfigChange → main.ts →
  // applyTheme). We surface every flag that has an applicable effect on the app's trees —
  // some are broadly visible, others are conditional/subtle (the title says when each applies).
  // SDK defaults fill the initial state. (The truly-inert ones are listed in the note below.)
  type BoolKey =
    | "enableSeekPreview"
    | "disableAutoHideWhenHovered"
    | "playbackSpeedSelectionEnabled"
    | "seekbarSnappingEnabled"
    | "enterFullscreenOnInitialPlayback"
    | "forceSubtitlesIntoViewContainer"
    | "disableStorageApi"
    | "enablePersistentPreferences"
    | "enableResumeFromLastPosition"
    | "enableTimestampDeepLink"
    | "showPersistentPreferencesToggle";
  const UI_TOGGLES: { key: BoolKey; label: L; def: boolean; title: L }[] = [
    {
      key: "enableSeekPreview",
      label: { ja: "シーク中のプレビュー", en: "Seek scrub-preview" },
      def: true,
      title: {
        ja: "ドラッグ中、映像が動きに追従してプレビューします。オフは指を離した位置でシーク。(UIConfig.enableSeekPreview)",
        en: "While dragging the scrubber the video previews in real time; off seeks only on release. (UIConfig.enableSeekPreview)",
      },
    },
    {
      key: "disableAutoHideWhenHovered",
      label: { ja: "ホバー中はバーを隠さない", en: "Keep bar on hover" },
      def: false,
      title: {
        ja: "ポインタがプレイヤー上にある間はコントロールを隠しません(Autohide オン時のみ効果)。(UIConfig.disableAutoHideWhenHovered)",
        en: "Keep the controls while the pointer is over the player (only with Autohide on). (UIConfig.disableAutoHideWhenHovered)",
      },
    },
    {
      key: "playbackSpeedSelectionEnabled",
      label: { ja: "設定歯車に再生速度を表示", en: "Speed item in settings gear" },
      def: true,
      title: {
        ja: "設定(歯車)に再生速度の項目を出します(歯車のあるテーマ＝Premiere / Creator / Studio のみ)。(UIConfig.playbackSpeedSelectionEnabled)",
        en: "Show the playback-speed item in the settings gear (gear themes only: Premiere / Creator / Studio). (UIConfig.playbackSpeedSelectionEnabled)",
      },
    },
    {
      key: "seekbarSnappingEnabled",
      label: { ja: "シークをマーカーにスナップ", en: "Snap seeks to markers" },
      def: true,
      title: {
        ja: "マーカー付近でシークするとスナップします(本デモは VOD にチャプターマーカーを表示)。(UIConfig.seekbarSnappingEnabled)",
        en: "Snap to a timeline marker when you seek near one (this demo shows chapter markers on VODs). (UIConfig.seekbarSnappingEnabled)",
      },
    },
    {
      key: "enterFullscreenOnInitialPlayback",
      label: { ja: "初回再生で全画面", en: "Fullscreen on first play" },
      def: false,
      title: {
        ja: "再生ボタンで初回再生を始めるとき全画面化(本デモは自動再生なので発火は稀)。(UIConfig.enterFullscreenOnInitialPlayback)",
        en: "Go fullscreen when the play button starts the first playback (rare here — the demo autoplays). (UIConfig.enterFullscreenOnInitialPlayback)",
      },
    },
    {
      key: "forceSubtitlesIntoViewContainer",
      label: { ja: "字幕を画面内に収める", en: "Keep subtitles in view" },
      def: false,
      title: {
        ja: "はみ出す字幕を切り取らず映像内に収めます(字幕ソースで確認)。(UIConfig.forceSubtitlesIntoViewContainer)",
        en: "Keep overflowing subtitle labels inside the video instead of cropping them (see a subtitle source). (UIConfig.forceSubtitlesIntoViewContainer)",
      },
    },
    {
      key: "disableStorageApi",
      label: { ja: "UI のストレージを無効化", en: "Disable UI storage" },
      def: false,
      title: {
        ja: "Player UIによるlocalStorageの利用を無効にします。設定の保存と再開位置の保存も無効になります。(UIConfig.disableStorageApi)",
        en: "Disable Player UI access to localStorage, including playback preferences and resume positions. (UIConfig.disableStorageApi)",
      },
    },
    {
      key: "enablePersistentPreferences",
      label: { ja: "音量・ミュート・速度を保存", en: "Remember playback preferences" },
      def: false,
      title: {
        ja: "音量・ミュート・再生速度をブラウザーに保存します。UIのストレージが有効な場合に動作します。設定歯車の保存スイッチで選択済みの場合は、その選択が優先されます。(UIConfig.enablePersistentPreferences)",
        en: "Store volume, mute and playback speed in the browser when UI storage is enabled. An existing choice made with the preferences switch takes precedence. (UIConfig.enablePersistentPreferences)",
      },
    },
    {
      key: "enableResumeFromLastPosition",
      label: { ja: "VODの再生位置を保存して再開", en: "Resume VOD position" },
      def: false,
      title: {
        ja: "VODの再生位置をブラウザーに保存し、次回の読み込み時に再開します。UIのストレージが有効な場合に動作します。(UIConfig.enableResumeFromLastPosition)",
        en: "Store a VOD playback position in the browser and resume it on a later load. Requires UI storage. (UIConfig.enableResumeFromLastPosition)",
      },
    },
    {
      key: "enableTimestampDeepLink",
      label: { ja: "URLの再生位置を読み取る", en: "Read timestamp from URL" },
      def: true,
      title: {
        ja: "URLのクエリまたはフラグメントの t=30 などからVODの開始位置を読み取ります。最初のソース読み込み時に適用されるため、切り替え後はソースを再読み込みしてください。(UIConfig.enableTimestampDeepLink)",
        en: "Read a VOD start position such as t=30 from the URL query or fragment. Applied on the first source load after UI creation; reload the source after changing it. (UIConfig.enableTimestampDeepLink)",
      },
    },
    {
      key: "showPersistentPreferencesToggle",
      label: { ja: "標準UIの歯車に保存スイッチを表示", en: "Preference switch in default settings" },
      def: false,
      title: {
        ja: "標準UIとCSSテーマの設定歯車に、音量・ミュート・速度の保存スイッチを表示します。UIのストレージが有効な場合に表示されます。独自構成のテーマには追加しません。(UIConfig.showPersistentPreferencesToggle)",
        en: "Add the preferences switch to the Default and CSS themes' settings gear when UI storage is enabled. Custom component layouts do not add this switch. (UIConfig.showPersistentPreferencesToggle)",
      },
    },
  ];
  const uiToggles = UI_TOGGLES.map((t) =>
    checkbox(
      t.label,
      options.uiConfig[t.key] ?? t.def,
      (checked) => options.onUiConfigChange({ [t.key]: checked }),
      t.title,
    ),
  );

  // Numeric UIConfig settings (apply on change/blur).
  const UI_NUMBERS: { key: "seekbarSnappingRange" | "cea608SmallPlayerHeightThreshold"; label: L; def: number; title: L }[] = [
    {
      key: "seekbarSnappingRange",
      label: { ja: "スナップ範囲 (%)", en: "Snap range (%)" },
      def: 1,
      title: {
        ja: "マーカーにスナップする距離(シークバー幅に対する%)。「シークをマーカーにスナップ」がオン時に有効。(UIConfig.seekbarSnappingRange)",
        en: "How close to a marker (in % of the seek bar) a seek must be to snap. (UIConfig.seekbarSnappingRange)",
      },
    },
    {
      key: "cea608SmallPlayerHeightThreshold",
      label: { ja: "CEA-608 小型プレイヤー px", en: "CEA-608 small-player px" },
      def: 360,
      title: {
        ja: "この高さ(px)以下で CEA-608 字幕を中央セーフエリア表示に切替(CEA-608 字幕の配信で確認)。(UIConfig.cea608SmallPlayerHeightThreshold)",
        en: "Below this player height (px), CEA-608 captions switch to a centered safe area. (UIConfig.cea608SmallPlayerHeightThreshold)",
      },
    },
  ];
  const uiNumbers = UI_NUMBERS.map((n) => {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "seek-input";
    input.min = "0";
    input.step = n.key === "seekbarSnappingRange" ? "0.5" : "10";
    input.value = String(options.uiConfig[n.key] ?? n.def);
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) options.onUiConfigChange({ [n.key]: v });
    });
    return rowWithHint(n.label, n.title, input);
  });

  const uiLanguage = document.createElement("input");
  uiLanguage.type = "text";
  uiLanguage.className = "seek-input";
  uiLanguage.value = options.uiConfig.localization?.language ?? "en";
  uiLanguage.addEventListener("change", () => options.onUiConfigChange({
    localization: { language: uiLanguage.value.trim() || "auto" },
  }));
  const uiLanguageRow = rowWithHint(
    { ja: "Player UIの言語", en: "Player UI language" },
    {
      ja: "autoはブラウザーの言語を使用します。SDKの組み込み言語はen・de・es・fr・nl・ptです。未対応の言語は英語になります。アプリ自体の日英切替とは別の設定です。(UIConfig.localization.language)",
      en: "auto follows the browser. Built-in SDK languages: en, de, es, fr, nl, pt. Unsupported languages fall back to English. Separate from the app's Japanese/English selector. (UIConfig.localization.language)",
    },
    uiLanguage,
  );
  const uiLanguageLabel = uiLanguageRow.querySelector<HTMLElement>(".panel-label")!;
  uiLanguageLabel.id = "player-ui-language-label";
  uiLanguage.setAttribute("aria-labelledby", uiLanguageLabel.id);
  const followSubtitleLanguage = checkbox(
    { ja: "字幕の言語にUIを合わせる", en: "Follow subtitle language" },
    options.uiConfig.localization?.adaptLocalizationToSubtitleLanguage ?? false,
    (checked) => options.onUiConfigChange({ localization: { adaptLocalizationToSubtitleLanguage: checked } }),
    {
      ja: "選択中の字幕の言語にPlayer UIを合わせます。対応する翻訳がない場合は既定のUI言語になります。(UIConfig.localization.adaptLocalizationToSubtitleLanguage)",
      en: "Use the selected subtitle language for Player UI, falling back to the configured UI language if no translation is available. (UIConfig.localization.adaptLocalizationToSubtitleLanguage)",
    },
  );

  // Casting / remote-playback buttons (§6). These are component-tree additions, not UIConfig:
  // each toggle adds/removes the library button on the CUSTOM trees (the Default UI ships all
  // three already). They live in their own section so it's clear they're a different lever.
  const CASTING_TOGGLES: { key: keyof CastingButtons; label: L; title: L }[] = [
    {
      key: "pip",
      label: { ja: "PiP ボタン", en: "PiP button" },
      title: {
        ja: "ピクチャ・イン・ピクチャのボタンを追加(カスタム UI のみ。標準 UI は既定で内蔵)。Chrome 系で動作し、非対応環境では自動的に隠れます。(PictureInPictureToggleButton)",
        en: "Add a Picture-in-Picture button (custom UIs only; the Default UI already has it). Works in Chromium/Chrome and auto-hides where unsupported. (PictureInPictureToggleButton)",
      },
    },
    {
      key: "airplay",
      label: { ja: "AirPlay ボタン", en: "AirPlay button" },
      title: {
        ja: "AirPlay のボタンを追加(カスタム UI のみ)。Safari でのみ表示され、他ブラウザでは自動的に隠れます。(AirPlayToggleButton)",
        en: "Add an AirPlay button (custom UIs only). Shows in Safari and auto-hides in other browsers. (AirPlayToggleButton)",
      },
    },
    {
      key: "cast",
      label: { ja: "Chromecast ボタン", en: "Chromecast button" },
      title: {
        ja: "Chromecast(Google Cast)のボタンを追加。プレイヤーの remotecontrol を有効化するため、切り替え時にプレイヤーを再生成します。同一ネットワークに対応デバイスがある時に表示されます。(CastToggleButton)",
        en: "Add a Chromecast (Google Cast) button. Enabling it turns on the player's remotecontrol, so toggling rebuilds the player; the button appears when a Cast device is on the network. (CastToggleButton)",
      },
    },
  ];
  const castingToggles = CASTING_TOGGLES.map((c) =>
    checkbox(
      c.label,
      options.casting[c.key] ?? false,
      (checked) => options.onCastingChange({ [c.key]: checked }),
      c.title,
    ),
  );
  // Continuous play (the Binge theme): auto-advance to the next episode at the end of a clip.
  const autoplayNextToggle = checkbox(
    { ja: "連続再生(自動で次へ)", en: "Continuous play (auto-next)" },
    options.autoplayNext,
    (checked) => options.onAutoplayNextToggle(checked),
    {
      ja: "「連続再生」テーマの Next-up カードは、終了前にカウントダウンを表示して次のエピソードへ自動で進みます。オフの場合はコントロールバーの Next ボタンで手動で進みます。",
      en: "In the Binge theme, the Next-up card counts down before the clip ends and then advances automatically. When off, use the control-bar Next button to advance manually.",
    },
  );

  // Make the "only affects custom UIs" behavior explicit (the Default + CSS themes already
  // ship all three from the stock layout, so these toggles are visible no-ops there).
  const castingNote = document.createElement("p");
  castingNote.className = "panel-subnote";
  binder.text(castingNote, {
    ja: "標準 UI は3つとも内蔵済み。これらはカスタム UI のツリーに追加/削除します。",
    en: "The Default UI already includes all three; these add/remove them on the Custom UI trees.",
  });

  // Honest note: the UIConfig/UIContainerConfig options NOT surfaced here, and why — so the
  // panel reads as "the full surface minus the inapplicable", not an arbitrary short list.
  const uiNote = document.createElement("p");
  uiNote.className = "panel-subnote";
  binder.text(uiNote, {
    ja: "未掲載(このデモのツリーでは効かない、またはコードで設定): ecoMode・includeWatermark(専用コンポーネントが必要)、shadowDom、autoUiVariantResolve、hidePlayerStateExceptions、UIContainer の hideImmediatelyOnMouseLeave・deferUiHideWhileSettingsOpen、metadata・独自の翻訳辞書。",
    en: "Not shown (inert on this demo’s trees, or set in code): ecoMode + includeWatermark (need dedicated components), shadowDom, autoUiVariantResolve, hidePlayerStateExceptions, UIContainer hideImmediatelyOnMouseLeave + deferUiHideWhileSettingsOpen, metadata + custom vocabularies.",
  });

  // Double-click behavior (custom themes): fullscreen (the stock default) or ±10s seek.
  const doubleClickRow = rowWithHint(
    { ja: "ダブルクリック", en: "Double-click" },
    {
      ja: "プレイヤー面をダブルクリックしたときの動作(カスタムテーマのみ):全画面切替か、クリックした左右半分で ±10秒シーク。標準は全画面。",
      en: "What a double-click on the player surface does (custom themes only): toggle fullscreen, or seek ±10s by which half you click. Stock default is fullscreen.",
    },
    select(
      options.doubleClickMode,
      [
        { value: "fullscreen", label: { ja: "全画面", en: "Fullscreen" } },
        { value: "seek", label: { ja: "±10秒シーク", en: "Seek ±10s" } },
      ],
      (v) => options.onDoubleClickModeChange(v as DoubleClickMode),
    ),
  );

  // --- Start offset (§11): start N seconds behind the live edge on (re)load ---
  const startOffsetInput = document.createElement("input");
  startOffsetInput.type = "number";
  startOffsetInput.value = "-20";
  startOffsetInput.step = "5";
  startOffsetInput.className = "seek-input";
  const startOffsetBtn = button({ ja: "オフセットで再読み込み", en: "Reload at offset" }, () => {
    options.onReloadWithStartOffset(Number(startOffsetInput.value));
  });

  // --- Buffer target (§8) ---
  const bufferInput = document.createElement("input");
  bufferInput.type = "number";
  bufferInput.value = "40";
  bufferInput.min = "1";
  bufferInput.className = "seek-input";
  const bufferBtn = button({ ja: "バッファ目標を設定", en: "Set buffer target" }, () => {
    const value = Number(bufferInput.value);
    player.buffer.setTargetLevel(BufferType.ForwardDuration, value, MediaType.Video);
    log(`buffer target → ${value}s; maxTimeShift unchanged: ${fmt(player.getMaxTimeShift())}`);
    refresh();
  });

  // --- Capabilities: Picture-in-Picture (Casting / VR are documented, see README) ---
  const pipBtn = button({ ja: "ピクチャインピクチャ切替", en: "Toggle Picture-in-Picture" }, () => {
    const inPip = player.getViewMode() === ViewMode.PictureInPicture;
    player.setViewMode(inPip ? ViewMode.Inline : ViewMode.PictureInPicture);
  });

  // Interactive controls flow in a responsive grid (multi-column on wide screens) so the
  // panel reads as a tidy board. Five focused cards: Source (what plays), Seek (where in
  // the window), Playback (DVR on/off, gestures, start offset, buffer §8, PiP), UI settings
  // (the UIManager-level UIConfig toggles — autohide + the others from the Player UI source),
  // and Casting & PiP (compose AirPlay/PiP/Chromecast buttons onto the custom trees). Each
  // UI-settings toggle rebuilds the active theme's UI.
  const controlsGrid = document.createElement("div");
  controlsGrid.className = "panel-grid";
  controlsGrid.append(
    section({ ja: "ソース", en: "Source" }, sourceRow, missingAssets),
    section(
      { ja: "シーク", en: "Seek" },
      row({ ja: "ライブ", en: "Live" }, button({ ja: "ライブ端へ移動", en: "Go to live edge" }, () => player.timeShift(0, "panel"))),
      rowWithHint(
        { ja: "端からのオフセット (秒)", en: "Offset from edge (s)" },
        {
          ja: "ライブ端からこの秒数だけ戻った位置へシーク(0=端、負値=過去)。DVR ウィンドウにクランプされます。ライブ配信のみ。",
          en: "Seek to this many seconds behind the live edge (0 = edge, negative = into the past). Clamped to the DVR window. Live streams only.",
        },
        seekInput,
        seekBtn,
      ),
      quickRow,
    ),
    section(
      { ja: "再生", en: "Playback" },
      timeShiftToggle,
      doubleClickRow,
      rowWithHint(
        { ja: "端からの開始オフセット (秒)", en: "Start offset behind edge (s)" },
        {
          ja: "ライブ端からこの距離だけ後ろの位置からソースを再読み込みします(SourceConfig.options.startOffset、End 基準、§11)。負値=端より過去。",
          en: "Reload the source starting this far behind the live edge (SourceConfig.options.startOffset with End reference, §11). Negative = behind the edge.",
        },
        startOffsetInput,
        startOffsetBtn,
      ),
      rowWithHint(
        { ja: "バッファ目標 (秒) (§8)", en: "Buffer target (s) (§8)" },
        {
          ja: "前方バッファの目標秒数(player.buffer.setTargetLevel)。大きいほどジッタに強い一方、遅延とメモリが増えます。DVR ウィンドウは広がりません(§8)。",
          en: "Forward buffer target in seconds (player.buffer.setTargetLevel). Bigger = steadier under jitter, more latency/memory. It does NOT widen the DVR window (§8).",
        },
        bufferInput,
        bufferBtn,
      ),
      rowWithHint(
        { ja: "ピクチャインピクチャ", en: "Picture-in-Picture" },
        {
          ja: "ブラウザのピクチャインピクチャ表示を切り替えます(player.setViewMode)。利用可否はブラウザ/OS に依存します。",
          en: "Toggle the browser's picture-in-picture window (player.setViewMode). Availability depends on the browser/OS.",
        },
        pipBtn,
      ),
      autoplayNextToggle,
    ),
    section({ ja: "UI 設定", en: "UI settings" }, autohideToggle, ...uiToggles, ...uiNumbers, uiLanguageRow, followSubtitleLanguage, uiNote),
    section({ ja: "キャスト・PiP", en: "Casting & PiP" }, ...castingToggles, castingNote),
  );

  // Live telemetry — the dark read-only boxes (player state · event log · QoE) grouped as
  // one row, visually distinct from the interactive controls above. QoE (if provided)
  // is a persistent node owned by main.ts; appending it here just moves it into place.
  const stateGrid = document.createElement("div");
  stateGrid.className = "panel-grid panel-grid-state";
  stateGrid.append(
    // "Player state" (not "DVR state"): the readout applies to VOD too — mode, current time,
    // and (for live) the DVR window fields, which simply read 0/false on VOD.
    section({ ja: "プレイヤー状態", en: "Player state" }, readout),
    section({ ja: "イベントログ (§10)", en: "Event log (§10)" }, logEl),
  );
  if (options.extraTelemetry) stateGrid.append(options.extraTelemetry);

  container.innerHTML = "";
  container.append(controlsGrid, stateGrid);

  function snapshot(): PlayerSnapshot {
    return {
      isLive: player.isLive(),
      duration: player.getDuration(),
      maxTimeShift: player.getMaxTimeShift(),
      timeShift: player.getTimeShift(),
      currentTime: player.getCurrentTime(),
    };
  }

  function refresh(): void {
    const snap = sourceHint.snapshot(snapshot());
    const state = deriveTimelineState(snap, { timeShiftEnabled });
    // §7 — both times, from the real TimeMode API:
    //  - relative: scrubber position / "behind live" (window start = 0)
    //  - absolute: wall-clock (Unix ts from PDT on live HLS / availabilityStartTime
    //    on live DASH); falls back to "needs PDT" for VOD / streams without it.
    const relTime = player.getCurrentTime(RELATIVE_TIME);
    const absTime = player.getCurrentTime(ABSOLUTE_TIME);
    const absStr =
      Number.isFinite(absTime) && absTime > 1e6 ? new Date(absTime * 1000).toLocaleTimeString() : "— (needs PDT)";
    // §15 — true end-to-end live latency (behind real-time): wall-clock of the rendered frame vs
    // now. Distinct from behindLive (the scrub offset): non-zero even at the edge. Live only.
    const latencySec = snap.isLive ? liveLatencySeconds(absTime, Date.now() / 1000) : null;
    const latencyStr = latencySec !== null ? `${latencySec.toFixed(1)}s` : "— (needs PDT)";
    // The SDK's own latency (getLatency(), distance from the live edge) shown beside the wall-clock
    // one (distance from real-time) — the two notions differ and are worth comparing.
    const sdkLatencySec = sdkLatencySeconds(player);
    const sdkLatencyStr = sdkLatencySec !== null ? `${sdkLatencySec.toFixed(1)}s` : "—";
    readout.textContent = [
      `mode:           ${state.mode}`,
      `dvrAvailable:   ${state.dvrAvailable}`,
      `maxTimeShift:   ${fmt(snap.maxTimeShift)}`,
      `timeShift:      ${fmt(snap.timeShift)}`,
      `behindLive:     ${state.behindLive.toFixed(1)}s`,
      `liveLatency:    ${latencyStr}   (now−PDT)`,
      `getLatency:     ${sdkLatencyStr}   (SDK · vs edge)`,
      `atLiveEdge:     ${state.atLiveEdge}`,
      `windowDuration: ${state.windowDuration.toFixed(0)}s`,
      `seekProgress:   ${(state.seekProgress * 100).toFixed(0)}%`,
      `time (rel):     ${relTime.toFixed(1)}s`,
      `time (abs/PDT): ${absStr}`,
    ].join("\n");
    // Reflect DVR allow/forbid in the panel too (§5.4): disable the seek controls.
    const disabled = !state.dvrAvailable;
    seekInput.toggleAttribute("disabled", disabled);
    seekBtn.toggleAttribute("disabled", disabled);
  }

  // --- Event log (§10) ---
  const loggedEvents = [
    PlayerEvent.SourceLoaded,
    PlayerEvent.SourceUnloaded,
    PlayerEvent.Play,
    PlayerEvent.Playing,
    PlayerEvent.Paused,
    PlayerEvent.Seek,
    PlayerEvent.Seeked,
    PlayerEvent.TimeShift,
    PlayerEvent.TimeShifted,
    PlayerEvent.DVRWindowExceeded,
    PlayerEvent.DurationChanged,
    PlayerEvent.StallStarted,
    PlayerEvent.StallEnded,
    PlayerEvent.Error,
  ];
  for (const event of loggedEvents) {
    player.on(event, (e: { type: string }) => log(e.type));
  }
  // §5.3: recover from DVRWindowExceeded by snapping back to the edge.
  player.on(PlayerEvent.DVRWindowExceeded, () => {
    log("DVRWindowExceeded → recovering to live edge");
    player.timeShift(0, "recover");
  });
  // Readout follows TimeChanged (frequent; not logged) plus source/duration changes.
  player.on(PlayerEvent.TimeChanged, refresh);
  player.on(PlayerEvent.SourceLoaded, refresh);
  player.on(PlayerEvent.DurationChanged, refresh);

  refresh();
  return {
    refreshUi: (config, autohide) => {
      const sync = (input: HTMLInputElement, value: string | boolean) => {
        if (document.activeElement === input) return;
        if (input.type === "checkbox") input.checked = Boolean(value);
        else input.value = String(value);
      };
      sync(autohideToggle.querySelector("input")!, autohide);
      UI_TOGGLES.forEach((field, index) => sync(uiToggles[index]!.querySelector("input")!, config[field.key] ?? field.def));
      UI_NUMBERS.forEach((field, index) => sync(uiNumbers[index]!.querySelector("input")!, String(config[field.key] ?? field.def)));
      sync(uiLanguage, config.localization?.language ?? "en");
      sync(followSubtitleLanguage.querySelector("input")!, config.localization?.adaptLocalizationToSubtitleLanguage ?? false);
    },
    beginSourceLoad: (isLive) => {
      const token = sourceHint.begin(isLive);
      refresh();
      return () => { sourceHint.settle(token); refresh(); };
    },
  };
}
