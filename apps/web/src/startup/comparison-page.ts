import "../styles.css";
import "./comparison.css";
import { getLang, onLangChange, pick, setLang, userGuideHref } from "../i18n";
import { SDK_VERSIONS, type EngineId, type StartupProfile, type StartupTuning } from "./contract";
import { TrialFrame, type ContentId, type SdkMode } from "./frame";
import { unavailableTrial, type BrowserTrial } from "./runner";
import { MAX_RESULTS, compareCohort, createTrialResult, makeTrialOrder, summarizeTrials, type Metric, type TrialResult } from "./model";
import { planScreening, selectStartupTuning, type TuningSelection } from "./calibration";
import { createComparisonExport } from "./export";
import { captureEnvironment, utcFromEpochMs, type EnvironmentSnapshot } from "./environment";

const engines: EngineId[] = ["web-x", "shaka", "hls"];
const names: Record<EngineId, string> = { "web-x": "Player Web X", shaka: "Shaka Player", hls: "hls.js" };
interface RecordEntry {
  engine: EngineId; contentId: ContentId; sdkMode: SdkMode; profile: StartupProfile;
  tuning: StartupTuning; result: BrowserTrial; measurement: TrialResult;
  run: number; seed: number; phase: "comparison" | "screening" | "confirmation";
  measuredAt: string; environment: EnvironmentSnapshot;
}
const records: RecordEntry[] = [];
const selections = new Map<number, TuningSelection>();
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
let planSeed = randomSeed();
let currentRun = 0;
let selectedMetric: Metric = "selectionToNativePlayingMs";
let frame: TrialFrame | null = null;
let generation = 0;
let running: AbortController | null = null;
let settings = { engine: "all", sdkMode: "on-demand" as SdkMode, profile: "startup" as StartupProfile, repeats: 6, tuning: {} as StartupTuning };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function selectControl(label: string, values: [string, string][], value: string, change: (value: string) => void, preparePlayer = true): HTMLElement {
  const wrapper = el("label", label);
  const select = el("select");
  select.setAttribute("aria-label", label);
  for (const [key, title] of values) { const option = el("option", title); option.value = key; select.append(option); }
  select.value = value;
  select.disabled = running !== null;
  select.addEventListener("change", () => {
    change(select.value);
    if (preparePlayer) { planSeed = randomSeed(); void prepare(); }
  });
  wrapper.append(select);
  return wrapper;
}
const fmt = (value: number | undefined | null) => value === undefined || value === null ? "—" : `${value.toFixed(1)} ms`;
function phaseLabel(phase: RecordEntry["phase"]): string {
  return pick({ ja: phase === "screening" ? "候補の評価" : phase === "confirmation" ? "確認" : "比較", en: phase });
}
function statusLabel(value: TrialResult["status"]): string {
  return pick({ ja: value === "success" ? "成功" : value === "failure" ? "失敗" : "中止", en: value });
}
const app = document.getElementById("comparison-app")!;
let status: HTMLElement;
let stage: HTMLElement;
let resultHost: HTMLElement;
let contentButtons: HTMLButtonElement[] = [];
function setStatus(text: string): void {
  if (running) {
    const message = status.querySelector("span");
    if (message) message.textContent = text;
  } else status.textContent = text;
}
function enableContent(): void {
  for (const button of contentButtons) button.disabled = running !== null ||
    (button.dataset.calibration === "true" && (settings.engine !== "all" || settings.profile !== "startup" || settings.repeats < 6));
}

function renderResults(): void {
  resultHost.replaceChildren(el("h2", pick({ ja: "結果", en: "Results" })));
  if (!records.length) { resultHost.append(el("p", pick({ ja: "コンテンツを選択すると比較を開始します。", en: "Choose content to start a comparison." }), "startup-note")); return; }
  const metrics: [Metric, string][] = [
    ["selectionToNativePlayingMs", "Selection → Playing"], ["selectionToFirstFrameMs", "Selection → first frame"],
    ["selectionToFirstMovingFrameMs", "Selection → moving frame"], ["sdkImportMs", "SDK import"],
    ["constructorMs", "Player constructor"], ["attachMs", "Attach"], ["loadMs", "Load"],
    ["playPromiseMs", "Play promise"], ["playRequestToNativePlayingMs", "Playback startup (Play → Playing)"],
    ["playRequestToFirstMovingFrameMs", "Play request → moving frame"],
    ["selectionToSdkReadyMs", "Selection → SDK Ready"], ["selectionToSdkPlayingMs", "Selection → SDK Playing"],
  ];
  resultHost.append(selectControl(pick({ ja: "集計する指標", en: "Summary metric" }), metrics,
    selectedMetric, (value) => { selectedMetric = value as Metric; renderResults(); }, false));
  const cohort = records.filter((entry) => entry.run === currentRun && entry.phase !== "screening").map((entry) => entry.measurement);
  const summaryTable = el("table", undefined, "startup-table");
  summaryTable.append(el("caption", pick({ ja: "現在の比較", en: "Current comparison" })));
  const summaryHeader = el("tr");
  for (const title of [pick({ ja: "プレイヤー", en: "Player" }), pick({ ja: "有効な測定 / 試行", en: "Valid / attempted" }), pick({ ja: "中央値", en: "Median" }), "p95", pick({ ja: "失敗", en: "Failed" }), pick({ ja: "中止", en: "Cancelled" }), pick({ ja: "欠測", en: "Missing" })]) {
    const cell = el("th", title);
    if (title === "p95") cell.title = pick({ ja: "測定値の95%以上がこの時間以下になります。", en: "At least 95% of the observed values are at or below this duration." });
    summaryHeader.append(cell);
  }
  const summaryHead = el("thead"); summaryHead.append(summaryHeader); summaryTable.append(summaryHead);
  const summaryBody = el("tbody");
  for (const group of summarizeTrials(cohort, selectedMetric)) {
    const row = el("tr");
    for (const text of [names[group.context.engine], `${group.n} / ${group.total}`, fmt(group.medianMs), fmt(group.p95Ms), String(group.failureCount), String(group.cancelledCount), String(group.missingCount)]) row.append(el("td", text));
    summaryBody.append(row);
  }
  summaryTable.append(summaryBody);
  const summaryScroll = el("div", undefined, "startup-scroll"); summaryScroll.append(summaryTable); resultHost.append(summaryScroll);
  const commonMetrics: readonly Metric[] = ["selectionToNativePlayingMs", "selectionToFirstFrameMs",
    "selectionToFirstMovingFrameMs", "playRequestToNativePlayingMs", "playRequestToFirstMovingFrameMs"];
  const comparison = commonMetrics.includes(selectedMetric) ? compareCohort(cohort, selectedMetric, SDK_VERSIONS) : null;
  const verdict = comparison === null
    ? pick({ ja: "SDKごとに処理の範囲が異なるため、この指標の順位は表示しません。", en: "These operations differ between SDKs; this metric is not ranked." })
    : comparison.kind === "unavailable"
    ? pick({ ja: "順位の表示条件を満たしていません。", en: "The cohort does not qualify for a median comparison." }) + ` (${comparison.reason})`
    : pick({ ja: comparison.kind === "tie" ? "中央値が同じ: " : "この条件で中央値が最小: ", en: comparison.kind === "tie" ? "Equal medians: " : "Smallest median under these conditions: " })
      + comparison.engines.map((engine) => names[engine]).join(", ") + ` (${fmt(comparison.medianMs)})`;
  resultHost.append(el("p", verdict, "startup-note"));
  if (selections.has(currentRun)) resultHost.append(el("pre", JSON.stringify(selections.get(currentRun), null, 2), "startup-note"));
  const scroll = el("div", undefined, "startup-scroll");
  const table = el("table", undefined, "startup-table startup-trials");
  table.append(el("caption", pick({ ja: "選択を受け付けてからの経過時間", en: "Elapsed time from accepted content selection" })));
  const header = el("tr");
  for (const title of [pick({ ja: "プレイヤー", en: "Player" }), pick({ ja: "状態", en: "Status" }), "Playing", pick({ ja: "最初のフレーム", en: "First frame" }), "SDK Ready", "SDK Playing"]) header.append(el("th", title));
  const thead = el("thead"); thead.append(header); table.append(thead);
  const body = el("tbody");
  for (const entry of records) {
    const row = el("tr");
    for (const text of [`${names[entry.engine]} ${SDK_VERSIONS[entry.engine]} (${phaseLabel(entry.phase)})`, statusLabel(entry.measurement.status),
      fmt(entry.result.marks.nativePlaying), fmt(entry.result.marks.firstFrame),
      fmt(entry.result.marks.sdkReady), fmt(entry.result.marks.sdkPlaying)]) row.append(el("td", text));
    body.append(row);
  }
  table.append(body); scroll.append(table); resultHost.append(scroll);
  const actions = el("div", undefined, "startup-actions");
  const clear = el("button", pick({ ja: "結果を消去", en: "Clear results" }), "startup-button");
  clear.disabled = running !== null;
  clear.addEventListener("click", () => { records.length = 0; renderResults(); });
  const save = el("button", pick({ ja: "JSONを保存", en: "Save JSON" }), "startup-button");
  save.disabled = running !== null;
  save.addEventListener("click", () => {
    try {
      const exported = createComparisonExport(records.map((entry) => ({ run: entry.run, seed: entry.seed,
        phase: entry.phase, measuredAt: entry.measuredAt, environment: entry.environment,
        measurement: entry.measurement, observations: entry.result })), new Date().toISOString());
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }));
      const anchor = el("a"); anchor.href = url; anchor.download = "player-lab-startup-results.json"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { status.textContent = pick({ ja: "測定値が不正なため保存できませんでした。", en: "Invalid measurements prevented export." }); }
  });
  actions.append(clear, save); resultHost.append(actions);
  records.forEach((entry, index) => {
    const detail = el("details", undefined, "startup-detail");
    detail.append(el("summary", `${index + 1}. ${names[entry.engine]} · ${entry.contentId} · ${statusLabel(entry.measurement.status)}`));
    const { result } = entry;
    detail.append(el("pre", JSON.stringify({ run: entry.run, seed: entry.seed, phase: entry.phase,
      measurement: entry.measurement, observations: result }, null, 2)));
    resultHost.append(detail);
  });
}

function plannedOrder(): EngineId[] {
  return settings.engine === "all" ? makeTrialOrder(settings.repeats, planSeed).flat()
    : Array<EngineId>(settings.repeats).fill(settings.engine as EngineId);
}
function firstEngine(): EngineId { return plannedOrder()[0] ?? "web-x"; }
async function prepare(engine = firstEngine(), signal?: AbortSignal): Promise<TrialFrame | null> {
  const own = ++generation;
  frame?.close(); frame = null;
  contentButtons.forEach((button) => { button.disabled = true; });
  setStatus(pick({ ja: "準備中", en: "Preparing" }));
  const created = new TrialFrame(engine, settings.sdkMode, stage);
  frame = created;
  const abort = () => created.close();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    await created.ready();
    if (own !== generation) { created.close(); return null; }
    if (!running) setStatus(pick({ ja: "コンテンツを選択してください。", en: "Choose content." }));
    if (!running) enableContent();
    return created;
  } catch {
    created.close();
    if (own === generation) setStatus(pick({ ja: "準備できませんでした。設定を変更して再試行してください。", en: "Preparation failed. Change a setting to retry." }));
    return null;
  } finally { signal?.removeEventListener("abort", abort); }
}

async function compare(contentId: ContentId, calibrate = false): Promise<void> {
  if (running || !frame || document.visibilityState !== "visible") return;
  if (calibrate && (settings.engine !== "all" || settings.profile !== "startup" || settings.repeats < 6)) return;
  const plannedCount = calibrate ? 18 + settings.repeats * 3 : plannedOrder().length;
  if (records.length + plannedCount > MAX_RESULTS) {
    status.textContent = pick({ ja: "結果を保存して消去してから再実行してください。", en: "Save and clear the results before running again." });
    return;
  }
  const acceptedAt = performance.timeOrigin + performance.now();
  stage.hidden = false;
  const controller = new AbortController(); running = controller;
  const snapshot = { ...settings, tuning: { ...settings.tuning } };
  const seed = planSeed;
  const run = ++currentRun;
  contentButtons.forEach((button) => { button.disabled = true; });
  app.querySelectorAll("select").forEach((select) => { select.disabled = true; });
  document.querySelectorAll<HTMLButtonElement>("#comparison-language button").forEach((button) => { button.disabled = true; });
  const stop = el("button", pick({ ja: "中止", en: "Stop" }), "startup-button");
  stop.addEventListener("click", () => { controller.abort(); stop.disabled = true; });
  const statusText = el("span"); status.replaceChildren(statusText, stop);
  const tasks: { engine: EngineId; tuning: StartupTuning; phase: RecordEntry["phase"] }[] = calibrate
    ? planScreening(seed).map((trial) => ({ ...trial, phase: "screening" }))
    : plannedOrder().map((engine) => ({ engine, tuning: snapshot.tuning, phase: "comparison" }));
  const screeningLength = calibrate ? tasks.length : 0;
  try {
    for (let index = 0; index < tasks.length; index += 1) {
      if (controller.signal.aborted) break;
      const task = tasks[index]; if (!task) break;
      const { engine, tuning, phase } = task;
      const current: TrialFrame | null = index === 0 ? frame : await prepare(engine, controller.signal);
      status.replaceChildren(statusText, stop);
      statusText.textContent = `${names[engine]} ${SDK_VERSIONS[engine]} · ${phaseLabel(phase)} (${index + 1}/${tasks.length})`;
      const selectedAt = index === 0 ? acceptedAt : performance.timeOrigin + performance.now();
      const measuredAt = utcFromEpochMs(selectedAt);
      const environment = captureEnvironment({ userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio });
      const result = current && !controller.signal.aborted
        ? await current.start(contentId, snapshot.profile, tuning, controller.signal, selectedAt)
          .catch(() => unavailableTrial(controller.signal.aborted ? "aborted" : "initialization-failed"))
        : unavailableTrial(controller.signal.aborted ? "aborted" : "initialization-failed");
      const context = { engine, version: SDK_VERSIONS[engine], contentId, sdkMode: snapshot.sdkMode,
        profile: snapshot.profile, tuning, httpCache: "browser-managed" as const };
      let measurement: TrialResult;
      try { measurement = createTrialResult({ context, status: result.status, failureCode: result.failureCode,
        selectionAtMs: 0, observedAtMs: result.marks }); }
      catch { measurement = createTrialResult({ context, status: "failure", failureCode: "invalid-playback",
        selectionAtMs: 0, observedAtMs: {} }); }
      records.push({ engine, contentId, sdkMode: snapshot.sdkMode, profile: snapshot.profile, tuning,
        result, measurement, run, seed, phase, measuredAt, environment });
      current?.close(); if (frame === current) frame = null;
      renderResults();
      if (calibrate && index + 1 === screeningLength && !controller.signal.aborted) {
        const selection = selectStartupTuning(records.filter((entry) => entry.run === run).map((entry) => entry.measurement));
        selections.set(run, selection); settings.tuning = { ...selection.tuning };
        tasks.push(...makeTrialOrder(snapshot.repeats, (seed ^ 0x9e3779b9) >>> 0).flat()
          .map((next) => ({ engine: next, tuning: selection.tuning, phase: "confirmation" as const })));
      }
    }
  } catch {
    statusText.textContent = pick({ ja: "比較を継続できませんでした。", en: "The comparison could not continue." });
  } finally {
    frame?.close(); frame = null; running = null; planSeed = randomSeed();
    render();
  }
}

function render(): void {
  document.documentElement.lang = getLang();
  document.getElementById("comparison-title")!.textContent = pick({ ja: "起動性能の比較", en: "Startup comparison" });
  const guide = document.getElementById("comparison-guide") as HTMLAnchorElement;
  guide.href = userGuideHref("web-startup-integration"); guide.textContent = pick({ ja: "実装ガイド", en: "Implementation guide" });
  const languages = document.getElementById("comparison-language")!; languages.replaceChildren();
  for (const [language, label] of [["ja", "日本語"], ["en", "English"]] as const) {
    const button = el("button", label, `lang-btn${getLang() === language ? " active" : ""}`);
    button.setAttribute("aria-pressed", String(getLang() === language));
    button.addEventListener("click", () => setLang(language)); languages.append(button);
  }
  app.replaceChildren();
  const controls = el("section", undefined, "startup-controls");
  const fields = el("div", undefined, "startup-settings");
  fields.append(
    selectControl(pick({ ja: "プレイヤー", en: "Player" }), [["all", pick({ ja: "すべて", en: "All players" })], ...engines.map((engine): [string, string] => [engine, `${names[engine]} ${SDK_VERSIONS[engine]}`])], settings.engine, (value) => { settings.engine = value; }),
    selectControl(pick({ ja: "SDKの読み込み", en: "SDK import" }), [["on-demand", pick({ ja: "動画の選択時", en: "On selection" })], ["preloaded", pick({ ja: "動画の選択前", en: "Before selection" })]], settings.sdkMode, (value) => { settings.sdkMode = value as SdkMode; }),
    selectControl(pick({ ja: "設定", en: "Settings" }), [["default", pick({ ja: "共通条件＋SDK標準値", en: "Common conditions + SDK defaults" })], ["startup", pick({ ja: "共通条件＋起動向け設定", en: "Common conditions + startup settings" })]], settings.profile, (value) => {
      settings.profile = value as StartupProfile;
      if (settings.profile === "default") settings.tuning = {};
      app.querySelectorAll<HTMLSelectElement>(".startup-candidates select").forEach((select) => {
        select.disabled = settings.profile === "default";
        if (settings.profile === "default") select.value = "default";
      });
    }),
    selectControl(pick({ ja: "各プレイヤーの繰り返し", en: "Trials per player" }), ["1", "6", "12"].map((value) => [value, value]), String(settings.repeats), (value) => { settings.repeats = Number(value); }),
  );
  controls.append(fields);
  const candidates = el("details", undefined, "startup-candidates");
  candidates.append(el("summary", pick({ ja: "設定候補", en: "Configuration candidates" })));
  const tuningFields = el("div", undefined, "startup-settings");
  tuningFields.append(
    selectControl("hls.js enableWorker", [["default", "SDK default"], ["true", "true"], ["false", "false"]], settings.tuning.hlsWorker === undefined ? "default" : String(settings.tuning.hlsWorker), (value) => {
      const { hlsWorker: _previous, ...rest } = settings.tuning;
      settings.tuning = value === "default" ? rest : { ...rest, hlsWorker: value === "true" };
    }),
    ...(["shakaPrefetchLimit", "webXLoadControl"] as const).map((key) => selectControl(key === "shakaPrefetchLimit" ? "Shaka segmentPrefetchLimit" : "Web X LoadControl", [["default", "SDK default"], ["0", "0"], ["1", "1"], ["2", "2"]], String(settings.tuning[key] ?? "default"), (value) => {
      const mutable = settings.tuning as { shakaPrefetchLimit?: 0 | 1 | 2; webXLoadControl?: 0 | 1 | 2 };
      if (value === "default") delete mutable[key]; else mutable[key] = Number(value) as 0 | 1 | 2;
    })),
  );
  candidates.append(tuningFields); controls.append(candidates);
  const loadControl = tuningFields.querySelector<HTMLSelectElement>('select[aria-label="Web X LoadControl"]');
  loadControl?.querySelectorAll("option").forEach((option) => {
    if (option.value === "0" || option.value === "1") {
      option.disabled = true;
      option.textContent = option.value === "0" ? "Nothing (0; no segment loading)" : "Metadata (1; no segment loading)";
    } else if (option.value === "2") option.textContent = "Data (2)";
  });
  tuningFields.querySelectorAll("select").forEach((select) => { select.disabled = settings.profile === "default"; });
  controls.append(el("p", pick({ ja: "同じ解像度と音声を使い、プレイヤーを順番に実行します。HTTPキャッシュはブラウザーが管理します。", en: "Players run sequentially with the same resolution and audio. HTTP caching is browser-managed." }), "startup-note"));
  const content = el("div", undefined, "startup-content"); contentButtons = [];
  for (const [id, resolution] of [["bbb-360p", "640 × 360"], ["bbb-180p", "320 × 180"]] as const) {
    const card = el("article", undefined, "startup-card");
    card.append(el("h2", "Big Buck Bunny"), el("p", `${resolution} · H.264 / AAC · English`));
    const button = el("button", pick({ ja: "この動画で比較", en: "Compare this video" }), "startup-button primary");
    button.disabled = true; button.addEventListener("click", () => { void compare(id); });
    contentButtons.push(button); card.append(button); content.append(card);
    const calibrate = el("button", pick({ ja: "設定候補を評価して比較", en: "Evaluate candidates and compare" }), "startup-button");
    calibrate.disabled = true;
    calibrate.dataset.calibration = "true";
    calibrate.addEventListener("click", () => { void compare(id, true); });
    contentButtons.push(calibrate); card.append(calibrate);
  }
  controls.append(content); status = el("div", undefined, "startup-status"); status.setAttribute("role", "status"); controls.append(status);
  stage = el("div", undefined, "startup-stage"); stage.hidden = true;
  resultHost = el("section", undefined, "startup-results");
  app.append(controls, stage, resultHost); renderResults(); void prepare();
}

document.addEventListener("visibilitychange", () => { if (running && document.visibilityState !== "visible") running.abort(); });
window.addEventListener("pagehide", () => { running?.abort(); frame?.close(); }, { once: true });
onLangChange(render);
render();
