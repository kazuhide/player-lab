import "../styles.css";
import "./comparison.css";
import { getLang, onLangChange, pick, setLang, userGuideHref } from "../i18n";
import { DEMO_SDK_VERSIONS, type DemoEngineId } from "./contract";
import { DemoComparison } from "./demo-controller";
import { customSource, DEMO_ENGINES, ENGINE_NAMES, safeDemoExport } from "./demo-results";
import { element as el, renderDemoResults } from "./demo-charts";
import { defaultDemoSource } from "./demo-default-source";
import type { DemoSource } from "./demo-session";
import { appliedConfiguration } from "./demo-configuration";

const app = document.getElementById("comparison-app")!;
let comparison: DemoComparison | null = null;
let custom = false;
let customURL = "";
let format: "hls" | "dash" = "hls";
let network = false;
let hasMeasured = false;

function button(text: string, action: () => void, className = ""): HTMLButtonElement {
  const node = el("button", text, `demo-button ${className}`);
  node.type = "button"; node.addEventListener("click", action); return node;
}

function render(): void {
  document.documentElement.lang = getLang();
  document.title = pick({ ja: "Player Lab · プレイヤー比較", en: "Player Lab · Player comparison" });
  document.getElementById("comparison-title")!.textContent = pick({ ja: "プレイヤー比較", en: "Player comparison" });
  const guide = document.getElementById("comparison-guide") as HTMLAnchorElement;
  guide.href = userGuideHref("web-startup-comparison"); guide.textContent = pick({ ja: "使い方", en: "Guide" });
  const languages = document.getElementById("comparison-language")!; languages.replaceChildren();
  for (const [lang, label] of [["ja", "日本語"], ["en", "English"]] as const) {
    const control = el("button", label, `lang-btn${lang === getLang() ? " active" : ""}`);
    control.type = "button"; control.addEventListener("click", () => setLang(lang));
    control.setAttribute("aria-pressed", String(lang === getLang())); languages.append(control);
  }
  app.className = "demo"; app.replaceChildren();
  const intro = el("p", pick({ ja: "同じ映像で起動・シーク・回線変化を比較", en: "Compare startup, seeking and network changes using the same video" }), "demo-intro");
  const toolbar = el("form", undefined, "demo-toolbar");
  const sourceField = el("label", pick({ ja: "コンテンツ", en: "Content" }));
  const sourceSelect = el("select"); sourceSelect.setAttribute("aria-label", sourceField.textContent!);
  for (const [value, title] of [["default", "Big Buck Bunny"], ["custom", pick({ ja: "カスタムURL", en: "Custom URL" })]]) {
    const option = el("option", title); option.value = value!; sourceSelect.append(option);
  }
  sourceSelect.value = custom ? "custom" : "default"; sourceField.append(sourceSelect);
  const urlFields = el("div", undefined, "demo-url-fields");
  const urlLabel = el("label", "URL");
  const urlInput = el("input"); urlInput.type = "url"; urlInput.placeholder = "https://…";
  urlInput.autocomplete = "off"; urlInput.spellcheck = false; urlInput.maxLength = 4096;
  urlInput.setAttribute("aria-label", pick({ ja: "カスタムURL", en: "Custom URL" })); urlInput.value = customURL;
  const formatLabel = el("label", pick({ ja: "形式", en: "Format" }));
  const formatSelect = el("select"); formatSelect.setAttribute("aria-label", formatLabel.textContent!);
  for (const value of ["hls", "dash"]) { const option = el("option", value.toUpperCase()); option.value = value; formatSelect.append(option); }
  formatSelect.value = format;
  urlLabel.append(urlInput); formatLabel.append(formatSelect); urlFields.append(urlLabel, formatLabel);
  urlFields.hidden = !custom; urlInput.required = custom;
  sourceSelect.addEventListener("change", () => {
    custom = sourceSelect.value === "custom"; urlFields.hidden = !custom; urlInput.required = custom;
    if (custom) network = false;
    update();
  });
  urlInput.addEventListener("input", () => { customURL = urlInput.value; });
  formatSelect.addEventListener("change", () => { format = formatSelect.value as "hls" | "dash"; });
  const measure = button(pick({ ja: "計測する", en: "Measure" }), () => {}, "demo-primary");
  measure.type = "submit";
  const stop = button(pick({ ja: "中止", en: "Stop" }), () => comparison?.cancel()); stop.hidden = true;
  toolbar.append(sourceField, urlFields, measure, stop);
  const error = el("p", undefined, "demo-error"); error.setAttribute("role", "alert"); error.hidden = true;
  const sourceNote = el("p", "", "demo-source-note");

  const navigation = el("div", undefined, "demo-navigation");
  const scenarios = el("div", undefined, "demo-switch"); scenarios.setAttribute("role", "group");
  scenarios.setAttribute("aria-label", pick({ ja: "計測内容", en: "Measurement scenario" }));
  const startupMode = button(pick({ ja: "起動とシーク", en: "Startup and seek" }), () => { network = false; update(); });
  const networkMode = button(pick({ ja: "回線変化", en: "Network change" }), () => { network = true; update(); });
  scenarios.append(startupMode, networkMode);
  const layouts = el("div", undefined, "demo-switch"); layouts.setAttribute("role", "group");
  layouts.setAttribute("aria-label", pick({ ja: "表示", en: "View" }));
  const single = button(pick({ ja: "一画面", en: "Single view" }), () => {
    if (!comparison) return; comparison.parallel = false; update(); void comparison.preview();
  });
  const parallel = button(pick({ ja: "並べて表示", en: "Side by side" }), () => {
    if (!comparison) return; comparison.parallel = true; update(); void comparison.preview();
  });
  layouts.append(single, parallel); navigation.append(scenarios, layouts);

  const workspace = el("div", undefined, "demo-workspace");
  const videoPanel = el("section", undefined, "demo-video-panel");
  const playerTabs = el("div", undefined, "demo-player-tabs"); playerTabs.setAttribute("role", "group");
  playerTabs.setAttribute("aria-label", pick({ ja: "表示するプレイヤー", en: "Displayed player" }));
  const tabs = new Map<DemoEngineId, HTMLButtonElement>();
  const grid = el("div", undefined, "demo-video-grid");
  const cells = new Map<DemoEngineId, HTMLElement>(); const stages = new Map<DemoEngineId, HTMLElement>();
  for (const engine of DEMO_ENGINES) {
    const tab = button(ENGINE_NAMES[engine], () => {
      if (!comparison) return; comparison.selected = engine; update(); void comparison.preview(engine);
    });
    tabs.set(engine, tab); playerTabs.append(tab);
    const cell = el("article", undefined, "demo-video-cell"); cell.dataset.engine = engine;
    const stage = el("div", undefined, "demo-stage");
    stage.append(el("p", pick({ ja: "「計測する」で再生を開始", en: "Select Measure to start playback" }), "demo-placeholder"));
    const label = el("p", `${ENGINE_NAMES[engine]} ${DEMO_SDK_VERSIONS[engine]}`, "demo-engine-name");
    cell.append(stage, label); grid.append(cell); cells.set(engine, cell); stages.set(engine, stage);
  }
  const playback = el("div", undefined, "demo-playback-controls");
  const play = button(pick({ ja: "再生", en: "Play" }), () => { void comparison?.play(); });
  const pause = button(pick({ ja: "一時停止", en: "Pause" }), () => comparison?.pause());
  const seek = button(pick({ ja: "シーク", en: "Seek" }), () => { void comparison?.seek(); });
  playback.append(play, pause, seek);
  const playbackNote = el("p", "", "demo-note");
  videoPanel.append(playerTabs, grid, playback, playbackNote);
  const results = el("section", undefined, "demo-results");
  results.setAttribute("aria-label", pick({ ja: "計測結果", en: "Measurement results" }));
  workspace.append(videoPanel, results);
  const status = el("p", pick({ ja: "計測する内容を選び、計測ボタンを押してください。", en: "Choose a scenario and select Measure." }), "demo-status");
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const conditions = el("p", "", "demo-note demo-conditions");
  const networkStatus = el("p", "", "demo-network-status"); networkStatus.hidden = true;
  const timeline = el("section"); timeline.id = "demo-timeline";
  const applied = el("details", undefined, "demo-details demo-applied-configuration");
  applied.append(el("summary", pick({ ja: "適用した設定", en: "Applied configuration" })));
  const configurationNote = el("p", pick({ ja: "計測後に、使った設定を表示します。キーやURLは変数で示します。", en: "Shows the settings used after measurement. Keys and URLs are represented by variables." }), "demo-note");
  const configurationGuide = el("a", pick({ ja: "設定の理由と既定値", en: "Setting choices and defaults" }));
  configurationGuide.href = userGuideHref("web-comparison-configuration");
  configurationNote.append(" ", configurationGuide); applied.append(configurationNote);
  const configurations = el("div", undefined, "demo-configurations");
  const configurationCards = new Map<DemoEngineId, { summary: HTMLElement; note: HTMLElement; pre: HTMLElement; code: HTMLElement; snapshot: unknown }>();
  for (const engine of DEMO_ENGINES) {
    const card = el("details", undefined, "demo-configuration-player");
    const summary = el("summary", ENGINE_NAMES[engine]);
    const note = el("p", pick({ ja: "このプレイヤーの計測後に表示します。", en: "Available after this player is measured." }), "demo-note");
    const pre = el("pre"); const code = el("code"); pre.append(code); pre.hidden = true; pre.tabIndex = 0;
    pre.setAttribute("aria-label", `${ENGINE_NAMES[engine]} ${pick({ ja: "適用した設定", en: "applied configuration" })}`);
    card.append(summary, note, pre); configurations.append(card);
    configurationCards.set(engine, { summary, note, pre, code, snapshot: undefined });
  }
  applied.append(configurations);
  const details = el("details", undefined, "demo-details");
  details.append(el("summary", pick({ ja: "計測条件・内訳", en: "Conditions and breakdown" })));
  details.append(el("p", pick({ ja: "プレイヤーを単独で順番に計測します。キャッシュはブラウザー管理です。Playingイベントと映像表示の時刻は別々に観測します。", en: "Players are measured sequentially in isolation. The browser manages caching. Playing events and rendered frames are observed separately." }), "demo-note"));
  const observations = el("div", undefined, "demo-observations"); observations.id = "demo-observations";
  const exportButton = button(pick({ ja: "JSONを保存", en: "Save JSON" }), () => {
    if (!comparison?.records.length || !comparison.source) return;
    const data = safeDemoExport(comparison.records, comparison.source.format, comparison.source.custom, comparison.measuredNetwork);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = el("a"); anchor.href = url; anchor.download = "player-lab-comparison.json"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const benchmark = el("a", pick({ ja: "起動の詳細ベンチマーク", en: "Advanced startup benchmark" }), "demo-link");
  benchmark.href = "startup-benchmark.html";
  details.append(observations, exportButton, benchmark);
  app.append(intro, toolbar, sourceNote, error, navigation, status, conditions, workspace, networkStatus, timeline, applied, details);
  const current = new DemoComparison({ stages, update, status: (text) => { status.textContent = text; },
    network: (text) => { networkStatus.textContent = text; networkStatus.hidden = !text; } });
  comparison = current;

  function update(): void {
    if (!comparison) return;
    const active = comparison.running;
    sourceNote.textContent = custom
      ? pick({ ja: "HLS / DASH · CORS対応の配信URL", en: "HLS / DASH · cross-origin media allowed" })
      : network ? pick({ ja: "Big Buck Bunny · HLS · 60s · 自動画質", en: "Big Buck Bunny · HLS · 60s · adaptive quality" })
        : pick({ ja: "Big Buck Bunny · HLS · 60s · 360p固定", en: "Big Buck Bunny · HLS · 60s · fixed 360p" });
    const any = comparison.records.some((record) => record.startup);
    hasMeasured ||= any;
    measure.textContent = hasMeasured ? pick({ ja: "再計測", en: "Measure again" }) : pick({ ja: "計測する", en: "Measure" });
    for (const control of [sourceSelect, urlInput, formatSelect, measure, startupMode, networkMode, single, parallel]) control.disabled = active;
    urlInput.disabled = active || !custom;
    formatSelect.disabled = active || !custom;
    networkMode.disabled = active || custom;
    networkMode.title = custom ? pick({ ja: "回線制御は共通のテスト素材で利用できます。", en: "Delivery control uses the common test fixture." }) : "";
    for (const control of languages.querySelectorAll<HTMLButtonElement>("button")) control.disabled = active;
    stop.hidden = !active;
    for (const [engine, cell] of cells) {
      cell.hidden = !comparison.parallel && comparison.selected !== engine;
      cell.classList.toggle("is-measuring", active && comparison.selected === engine);
      tabs.get(engine)!.disabled = active;
      tabs.get(engine)!.setAttribute("aria-pressed", String(comparison.selected === engine));
    }
    playerTabs.hidden = comparison.parallel;
    workspace.classList.toggle("is-parallel", comparison.parallel);
    grid.classList.toggle("is-parallel", comparison.parallel);
    single.setAttribute("aria-pressed", String(!comparison.parallel)); parallel.setAttribute("aria-pressed", String(comparison.parallel));
    startupMode.setAttribute("aria-pressed", String(!network)); networkMode.setAttribute("aria-pressed", String(network));
    for (const control of [play, pause, seek]) control.disabled = active || !comparison.hasPlayback;
    exportButton.disabled = active || !any;
    playbackNote.textContent = comparison.parallel ? pick({ ja: "同時再生は見比べるための表示です。グラフには単独計測の値を残します。", en: "Side-by-side playback is a visual preview. Graphs retain isolated measurements." })
      : pick({ ja: "計測後も再生・シークを試せます。", en: "Playback and seeking remain available after measurement." });
    conditions.textContent = network ? pick({ ja: "配信速度を2 Mbit/s → 100 kbit/s → 2 Mbit/sに変更。ブラウザー内での受け渡し速度を制御します。", en: "Delivery changes from 2 Mbit/s to 100 kbit/s, then back to 2 Mbit/s. This controls media delivery inside the browser." })
      : pick({ ja: "映像が動き始めた後も再生を続け、シーク時の待ち時間を計測します。", en: "Playback continues after startup, followed by a measured seek." });
    renderDemoResults(results, comparison.records, comparison.measuredNetwork, network);
    for (const [engine, card] of configurationCards) {
      const startup = comparison.records.find((record) => record.engine === engine)?.startup ?? null;
      if (card.snapshot === startup) continue;
      card.snapshot = startup;
      const snapshot = startup?.metadata ? appliedConfiguration(startup.metadata, engine) : null;
      card.summary.textContent = snapshot ? `${ENGINE_NAMES[engine]} ${snapshot.version}` : ENGINE_NAMES[engine];
      card.code.textContent = snapshot?.code ?? ""; card.pre.hidden = !snapshot; card.note.hidden = !!snapshot;
      card.note.textContent = !startup ? pick({ ja: "このプレイヤーの計測後に表示します。", en: "Available after this player is measured." })
        : pick({ ja: "この計測の設定をコードで表示できません。", en: "Configuration code is unavailable for this measurement." });
    }
  }
  toolbar.addEventListener("submit", (event) => {
    event.preventDefault(); error.hidden = true;
    let source: DemoSource;
    try { source = custom ? customSource(urlInput.value, format)
      : defaultDemoSource(new URL(import.meta.env.BASE_URL, location.origin).href, network); }
    catch { error.textContent = pick({ ja: "認証情報を含まないHTTP(S)の配信URLを入力してください。", en: "Enter an HTTP(S) media URL without embedded credentials." }); error.hidden = false; return; }
    void current.measure(source, network);
  });
  update();
}

onLangChange(() => {
  const previous = comparison; comparison = null;
  void previous?.dispose().finally(render);
});
window.addEventListener("pagehide", () => { void comparison?.dispose(); });
render();
