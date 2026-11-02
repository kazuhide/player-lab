import { pick } from "../i18n";
import { DEMO_ENGINES, ENGINE_NAMES, metricDuration, type DemoRecord } from "./demo-results";
import type { EngineId } from "./contract";

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const format = (value: number) => `${value.toFixed(0)} ms`;
const colors: Record<EngineId, string> = { "web-x": "#2054d8", hls: "#59677e", shaka: "#087b72" };

function status(record: DemoRecord | undefined, kind: "startup" | "seek"): string {
  const observation = record?.[kind];
  if (!observation) return pick({ ja: "未計測", en: "Not measured" });
  if (observation.failureCode === "unsupported") return pick({ ja: "非対応", en: "Unsupported" });
  if (observation.status === "cancelled") return pick({ ja: "中止", en: "Cancelled" });
  if (observation.status === "failure") return pick({ ja: "失敗", en: "Failed" });
  return pick({ ja: "フレーム時刻を観測できません", en: "Frame timing unavailable" });
}

function bars(records: readonly DemoRecord[], kind: "startup" | "seek"): HTMLElement {
  const figure = element("figure", undefined, "demo-chart");
  const title = kind === "startup" ? pick({ ja: "再生開始まで", en: "Playback startup" })
    : pick({ ja: "シーク後の再生再開", en: "Playback after seek" });
  figure.append(element("h3", title));
  figure.append(element("p", kind === "startup"
    ? pick({ ja: "開始操作から映像が動くまで", en: "Start action to a moving video frame" })
    : pick({ ja: "移動操作から移動先の映像が動くまで", en: "Seek action to moving video at the target" }), "demo-note"));
  const values = DEMO_ENGINES.map((engine) => {
    const record = records.find((item) => item.engine === engine);
    const trial = record?.[kind];
    const value = trial?.status === "success" ? kind === "startup"
      ? record?.startup?.marks.firstMovingFrame ?? null : record?.seek?.latencyMs ?? null : null;
    return { engine, record, value: value !== null && Number.isFinite(value) && value >= 0 ? value : null };
  });
  const max = Math.max(100, ...values.map(({ value }) => value ?? 0)) * 1.1;
  for (const { engine, record, value } of values) {
    const row = element("div", undefined, "demo-bar-row");
    row.dataset.engine = engine;
    row.dataset.metric = kind;
    row.dataset.valueMs = value === null ? "" : String(value);
    row.append(element("span", ENGINE_NAMES[engine], "demo-bar-label"));
    const track = element("div", undefined, "demo-bar-track");
    if (value !== null) {
      const bar = element("div", undefined, "demo-bar");
      bar.style.width = `${value / max * 100}%`;
      bar.style.backgroundColor = colors[engine];
      track.append(bar);
    }
    row.append(track, element("span", value === null ? status(record, kind) : format(value), "demo-bar-value"));
    figure.append(row);
  }
  figure.append(element("figcaption", pick({ ja: "今回の計測値 · 短いほど待ち時間が少ない", en: "This run · shorter bars mean less waiting" }), "demo-note"));
  return figure;
}

const svgElement = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

function bufferPlot(records: readonly DemoRecord[], maxTime: number): SVGSVGElement {
  const samples = records.flatMap((record) => record.samples);
  const maxBuffer = Math.max(5, ...samples.map((sample) => sample.bufferSeconds));
  const svg = svgElement("svg", { viewBox: "0 0 760 150", role: "img",
    "aria-label": pick({ ja: "先読み済みの再生時間の変化", en: "Buffered playback time ahead" }) });
  for (let tick = 0; tick <= 2; tick += 1) {
    const y = 115 - tick * 45;
    svg.append(svgElement("line", { x1: "55", x2: "740", y1: String(y), y2: String(y), class: "demo-grid-line" }));
    const label = svgElement("text", { x: "45", y: String(y + 4), "text-anchor": "end" });
    label.textContent = `${Math.round(maxBuffer * tick / 2)}s`; svg.append(label);
    const time = svgElement("text", { x: String(55 + tick * 685 / 2), y: "140", "text-anchor": "middle" });
    time.textContent = `${Math.round(maxTime * tick / 2)}s`; svg.append(time);
  }
  for (const record of records) {
    if (!record.samples.length) continue;
    svg.append(svgElement("polyline", { fill: "none", stroke: colors[record.engine], "stroke-width": "2",
      "stroke-dasharray": record.engine === "hls" ? "7 4" : record.engine === "shaka" ? "2 3" : "none",
      points: record.samples.map((sample) => `${55 + sample.elapsedMs / 1000 / maxTime * 685},${115 - sample.bufferSeconds / maxBuffer * 90}`).join(" ") }));
  }
  return svg;
}

function timeline(records: readonly DemoRecord[], network: boolean): HTMLElement {
  const figure = element("figure", undefined, "demo-chart demo-timeline");
  figure.append(element("h3", pick({ ja: "再生中の画質と停止", en: "Playback quality and stalls" })));
  const samples = records.flatMap((record) => record.samples);
  if (!samples.length) {
    figure.append(element("p", pick({ ja: "再生中に取得した映像の高さと停止区間を表示します。", en: "Video height and playback stalls appear here during playback." }), "demo-empty"));
    return figure;
  }
  const maxTime = Math.max(10, ...samples.map((sample) => sample.elapsedMs / 1000));
  const maxHeight = Math.max(360, ...samples.map((sample) => sample.height));
  const svg = svgElement("svg", { viewBox: "0 0 760 190", role: "img",
    "aria-label": pick({ ja: "各プレイヤーの再生開始からの表示画質と停止区間", en: "Rendered video height and stalls by elapsed playback session time" }) });
  for (let tick = 0; tick <= 3; tick += 1) {
    const y = 150 - tick * 42;
    svg.append(svgElement("line", { x1: "55", x2: "740", y1: String(y), y2: String(y), class: "demo-grid-line" }));
    const label = svgElement("text", { x: "45", y: String(y + 4), "text-anchor": "end" });
    label.textContent = `${Math.round(maxHeight * tick / 3)}p`; svg.append(label);
    const time = svgElement("text", { x: String(55 + tick * 685 / 3), y: "178", "text-anchor": "middle" });
    time.textContent = `${Math.round(maxTime * tick / 3)}s`; svg.append(time);
  }
  for (const record of records) {
    const points = record.samples.filter((sample) => sample.height > 0);
    if (!points.length) continue;
    svg.append(svgElement("polyline", { fill: "none", stroke: colors[record.engine], "stroke-width": "2",
      "stroke-dasharray": record.engine === "hls" ? "7 4" : record.engine === "shaka" ? "2 3" : "none",
      points: points.map((sample) => `${55 + sample.elapsedMs / 1000 / maxTime * 685},${150 - sample.height / maxHeight * 126}`).join(" ") }));
    for (const sample of points.filter((point) => point.stalled)) {
      svg.append(svgElement("circle", { cx: String(55 + sample.elapsedMs / 1000 / maxTime * 685),
        cy: String(150 - sample.height / maxHeight * 126), r: "3", fill: colors[record.engine] }));
    }
  }
  figure.append(svg);
  if (network) {
    figure.append(element("p", pick({ ja: "先読み済みの再生時間", en: "Buffered playback time ahead" }), "demo-note"), bufferPlot(records, maxTime));
  }
  const legend = element("div", undefined, "demo-legend");
  for (const engine of DEMO_ENGINES) {
    const record = records.find((item) => item.engine === engine);
    const stalled = record?.samples.filter((sample) => sample.stalled).length ?? 0;
    const item = element("span", `${ENGINE_NAMES[engine]}${stalled ? ` · ${pick({ ja: "停止を観測", en: "stall observed" })}` : ""}`);
    item.style.setProperty("--engine-color", colors[engine]); legend.append(item);
  }
  figure.append(legend, element("figcaption", network
    ? pick({ ja: "横軸は各試行の開始からの経過時間。点は再生待ちを観測した区間です。", en: "Time is relative to each trial. Dots mark observed playback stalls." })
    : pick({ ja: "同じコンテンツを単独再生した観測値。シーク中の停止も含みます。", en: "Observed during isolated playback of the same content, including seeks." }), "demo-note"));
  if (network && records.some((record) => record.networkPhases?.some((phase) => !phase.controlled))) {
    figure.append(element("p", pick({ ja: "速度制御を確認できなかった区間があります。回線変化による優劣は判定しません。", en: "Some intervals have no confirmed delivery control. These results do not establish network adaptation superiority." }), "demo-note"));
  }
  return figure;
}

export function renderDemoResults(host: HTMLElement, records: readonly DemoRecord[], network: boolean, focusNetwork = network): void {
  const timelineHost = document.getElementById("demo-timeline");
  if (focusNetwork) {
    host.replaceChildren(timeline(records, network));
    timelineHost?.replaceChildren(bars(records, "startup"), bars(records, "seek"));
    timelineHost?.classList.add("demo-secondary-bars");
  } else {
    host.replaceChildren(bars(records, "startup"), bars(records, "seek"));
    timelineHost?.replaceChildren(timeline(records, network));
    timelineHost?.classList.remove("demo-secondary-bars");
  }
  const details = document.getElementById("demo-observations");
  if (!details) return;
  details.replaceChildren();
  for (const record of records) {
    const row = element("div", undefined, "demo-observation");
    row.append(element("h3", ENGINE_NAMES[record.engine]));
    const marks = record.startup?.marks ?? {};
    const metrics = [["SDK import", metricDuration(marks, "sdkImportStart", "sdkImportEnd")],
      [pick({ ja: "初期化", en: "Initialization" }), metricDuration(marks, "constructorStart", "constructorEnd")],
      ["Load", metricDuration(marks, "loadStart", "loadComplete")], ["Playing", marks.nativePlaying ?? null]] as const;
    for (const [name, value] of metrics) row.append(element("p", `${name}: ${value === null ? "—" : format(value)}`));
    if (record.seek) row.append(element("p", `${pick({ ja: "シーク先", en: "Seek target" })}: ${record.seek.targetSeconds.toFixed(1)}s · ${pick({
      ja: record.seek.buffered ? "バッファー内" : "バッファー外", en: record.seek.buffered ? "buffered" : "unbuffered" })}`));
    if (record.startup?.failureCode) row.append(element("p", record.startup.failureCode));
    details.append(row);
  }
}
