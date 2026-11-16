import { text, timeLabel, type Locale, type TextKey } from "./i18n.ts";
import { observedEvidenceInput, type ObservedReplayEvidence, type RawObservedSample } from "./observed-evidence.ts";
import { inspectObservedReplay, type Interval, type ObservedReplayInspection, type ObservedSampleReason } from "./observed-replay.ts";
import type { ObservedReplaySnapshot } from "./types.ts";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const panel = element<HTMLDetailsElement>("api-evidence");
const link = element<HTMLAnchorElement>("api-evidence-link");
const recordSelect = element<HTMLSelectElement>("evidence-record");
const bucketSelect = element<HTMLSelectElement>("evidence-bucket");
const cache = new WeakMap<ObservedReplayEvidence, ObservedReplayInspection>();
let evidence: ObservedReplayEvidence | undefined;
let snapshot: ObservedReplaySnapshot | undefined;
let inspection: ObservedReplayInspection | undefined;
let locale: Locale = "en";
let recordId = "";
let selectedRow = 0;
let bucket = 0;

const COLUMNS: (keyof RawObservedSample)[] = ["state", "videotime_start", "videotime_end", "played", "seeked"];
const REASONS: Record<ObservedSampleReason, TextKey> = {
  played: "apiReasonPlayed", "seek-backward": "apiReasonBackward", "seek-forward": "apiReasonForward",
  "ambiguous-before-seek": "apiReasonAmbiguous", "carried-seek-target": "apiReasonCarried",
  "not-playing": "apiReasonNotPlaying", "no-played-range": "apiReasonNoRange",
};
const number = (value: number) => value.toLocaleString(locale);
const range = (value: Interval | null) => value ? `${number(value[0])}–${number(value[1])} ms` : "—";
const cells = (row: HTMLTableRowElement, values: string[]) => values.forEach(value => { row.insertCell().textContent = value; });

function selectOptions(select: HTMLSelectElement, options: [string, string][], value: string): void {
  select.replaceChildren(...options.map(([id, label]) => new Option(label, id)));
  select.value = value;
  select.disabled = options.length === 0;
}

function selectSample(id: string, index: number): void {
  if (id !== recordId || !evidence?.sessions.find(session => session.id === id)?.response.data.result[index]) return;
  const rows = element<HTMLTableSectionElement>("evidence-samples");
  const restoreFocus = rows.contains(document.activeElement);
  selectedRow = index;
  renderSource();
  if (restoreFocus) rows.rows[selectedRow].querySelector<HTMLButtonElement>("button")!.focus({ preventScroll: true });
}

function renderSource(): void {
  const record = inspection?.records.find(item => item.id === recordId);
  const session = evidence?.sessions.find(item => item.id === recordId);
  const body = element<HTMLTableSectionElement>("evidence-samples");
  body.replaceChildren();
  if (!record || !session) {
    element("evidence-json").textContent = element("evidence-receipt").textContent = "";
    element("evidence-decision").textContent = text(locale, "noRecords");
    return;
  }
  if (!session.response.data.result[selectedRow]) selectedRow = 0;
  const point = snapshot!.points[bucket];
  const traces = new Map(record.samples.map(sample => [sample.sequenceNumber, sample]));
  const seen = new Set<number>();
  let selectedDuplicate = false;
  session.response.data.result.forEach((raw, index) => {
    const trace = traces.get(raw.sequence_number)!;
    const duplicate = seen.has(raw.sequence_number);
    seen.add(raw.sequence_number);
    const row = body.insertRow();
    row.dataset.row = String(index);
    row.dataset.sequence = String(raw.sequence_number);
    row.dataset.duplicate = String(duplicate);
    row.dataset.selected = String(index === selectedRow);
    row.dataset.contributes = String(!duplicate && trace.countedRange !== null && covered([trace.countedRange], point.startMs, point.endMs) > 0);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(raw.sequence_number);
    if (index === selectedRow) { button.setAttribute("aria-current", "true"); selectedDuplicate = duplicate; }
    button.addEventListener("click", () => selectSample(record.id, index));
    row.insertCell().append(button);
    for (const field of COLUMNS) { const cell = row.insertCell(); cell.dataset.field = field; cell.textContent = String(raw[field]); }
    const treatment = duplicate ? "apiDuplicateShort" : trace.reason === "played" ? "apiCounted" : trace.reason.startsWith("seek-") ? "apiSeek" : "apiExcluded";
    row.insertCell().textContent = `${text(locale, treatment)} · ${trace.passIndex + 1}`;
  });
  const raw = session.response.data.result[selectedRow];
  const selected = traces.get(raw.sequence_number)!;
  element("evidence-receipt").textContent = `${text(locale, "apiFetchedAt")}: ${session.fetchedAt} · ${text(locale, "apiLastSequence")}: ${session.expectedLastSequence}`;
  // Keep every retained original sample, including response ordering and identical retries.
  element("evidence-json").textContent = JSON.stringify(session.response, null, 2);
  const seek = selected.seekOriginMs === null ? "" : ` · ${number(selected.seekOriginMs)} → ${number(selected.seekTargetMs!)} ms`;
  element("evidence-decision").textContent = `#${raw.sequence_number} · ${text(locale, selectedDuplicate ? "apiDuplicate" : REASONS[selected.reason])} · ${text(locale, "apiPass")} ${selected.passIndex + 1} · ${range(selectedDuplicate ? null : selected.countedRange)}${selectedDuplicate ? "" : seek}`;
  // Reveal the selected row within its table without scrolling the document.
  const scroller = body.closest<HTMLElement>(".table-scroll")!;
  const viewport = scroller.getBoundingClientRect();
  const bounds = body.rows[selectedRow].getBoundingClientRect();
  const top = viewport.top + body.closest("table")!.tHead!.getBoundingClientRect().height;
  if (bounds.top < top) scroller.scrollTop += bounds.top - top;
  else if (bounds.bottom > viewport.bottom) scroller.scrollTop += bounds.bottom - viewport.bottom;
}

/** Intersect the canonical merged ranges with the selected bucket; do not infer passes here. */
function covered(intervals: Interval[], start: number, end: number): number {
  return intervals.reduce((total, interval) => total + Math.max(0, Math.min(end, interval[1]) - Math.max(start, interval[0])), 0);
}

function inside(intervals: Interval[], start: number, end: number): Interval[] {
  return intervals.flatMap(interval => {
    const clipped: Interval = [Math.max(start, interval[0]), Math.min(end, interval[1])];
    return clipped[1] > clipped[0] ? [clipped] : [];
  });
}

function renderFlow(): void {
  const record = inspection!.records.find(item => item.id === recordId);
  const id = record?.id ?? "";
  const point = snapshot!.points[bucket];
  const samples = element("evidence-flow-samples");
  samples.replaceChildren();
  element("evidence-flow-record").textContent = record?.id ?? text(locale, "noRecords");
  for (const sample of record?.samples ?? []) {
    const clipped = sample.countedRange && inside([sample.countedRange], point.startMs, point.endMs)[0];
    if (!clipped) continue;
    const item = document.createElement("div");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.sequence = String(sample.sequenceNumber);
    button.textContent = `#${sample.sequenceNumber} · ${text(locale, "apiPass")} ${sample.passIndex + 1}`;
    button.addEventListener("click", () => {
      const index = evidence?.sessions.find(session => session.id === id)?.response.data.result.findIndex(raw => raw.sequence_number === sample.sequenceNumber) ?? -1;
      selectSample(id, index);
    });
    const positions = document.createElement("code");
    positions.textContent = range(clipped);
    item.append(button, positions);
    samples.append(item);
  }
  if (!samples.childElementCount) samples.textContent = text(locale, "apiNoContributing");
  for (const mode of ["reach", "replay"] as const) {
    const intervals = inside(record?.[mode] ?? [], point.startMs, point.endMs);
    element(`evidence-flow-${mode}-ranges`).textContent = intervals.map(value => range(value)).join(" · ") || "—";
    element(`evidence-flow-${mode}-ms`).textContent = `${number(covered(intervals, point.startMs, point.endMs))} ms`;
  }
}

function preferredSequence(id: string): number {
  const record = inspection!.records.find(item => item.id === id)!;
  const point = snapshot!.points[bucket];
  const overlaps = (sample: typeof record.samples[number]) => sample.countedRange !== null && covered([sample.countedRange], point.startMs, point.endMs) > 0;
  const sample = covered(record.replay, point.startMs, point.endMs) > 0 ? record.samples.findLast(overlaps) : record.samples.find(overlaps);
  return (sample ?? record.samples[0]).sequenceNumber;
}

function chooseRecord(id: string): void {
  const session = evidence?.sessions.find(item => item.id === id);
  if (!snapshot || !session || !inspection?.records.some(record => record.id === id)) return;
  recordId = id;
  selectedRow = session.response.data.result.findIndex(raw => raw.sequence_number === preferredSequence(id));
  recordSelect.value = id;
  renderSource();
  renderFlow();
}

function renderBucket(): void {
  const point = snapshot!.points[bucket];
  const body = element<HTMLTableSectionElement>("evidence-contributions");
  body.replaceChildren();
  let reachMs = 0;
  let replayMs = 0;
  for (const record of inspection!.records) {
    const reach = covered(record.reach, point.startMs, point.endMs);
    const replay = covered(record.replay, point.startMs, point.endMs);
    reachMs += reach;
    replayMs += replay;
    const row = body.insertRow();
    row.dataset.record = record.id;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = record.id;
    button.addEventListener("click", () => chooseRecord(record.id));
    row.insertCell().append(button);
    cells(row, [number(reach), number(replay)]);
  }
  const width = point.endMs - point.startMs;
  const count = inspection!.snapshot.sessionCount;
  const formula = (numerator: number, value: number | null) => count === 0 ? text(locale, "apiNoEligible") : `${number(numerator)} / (${number(width)} × ${number(count)}) = ${value === null ? text(locale, "unobserved") : `${(value * 100).toFixed(1)}%`}`;
  element("evidence-reach-formula").textContent = formula(reachMs, point.reach);
  element("evidence-replay-formula").textContent = formula(replayMs, point.replay);
  renderSource();
  renderFlow();
}

function renderOpenPanel(): void {
  if (!panel.open || !snapshot) return;
  const state = element("evidence-state");
  const content = element("evidence-content");
  if (!evidence) {
    panel.dataset.state = "missing";
    state.textContent = text(locale, "apiMissing");
    state.hidden = false;
    content.hidden = true;
    return;
  }
  try {
    inspection = cache.get(evidence);
    if (!inspection) {
      inspection = inspectObservedReplay(observedEvidenceInput(evidence, snapshot), snapshot.bucketWidthMs);
      cache.set(evidence, inspection);
    }
    panel.dataset.state = "ready";
    state.hidden = true;
    content.hidden = false;
    if (!inspection.records.some(record => record.id === recordId)) {
      recordId = inspection.records[0]?.id ?? "";
      if (recordId) selectedRow = evidence.sessions.find(session => session.id === recordId)!.response.data.result.findIndex(raw => raw.sequence_number === preferredSequence(recordId));
    }
    selectOptions(recordSelect, inspection.records.map(record => [record.id, record.id]), recordId);
    selectOptions(bucketSelect, snapshot.points.map((point, index) => [String(index), `${timeLabel(point.startMs)}–${timeLabel(point.endMs)}`]), String(bucket));
    renderBucket();
  } catch {
    panel.dataset.state = "error";
    state.textContent = text(locale, "apiError");
    state.hidden = false;
    content.hidden = true;
  }
}

function openPanel(): void {
  if (panel.hidden) return;
  panel.open = true;
  renderOpenPanel();
  panel.scrollIntoView({ block: "start" });
}

/** Open and calculate only on demand; locale changes keep the current raw selection. */
export function renderApiEvidence(next: ObservedReplayEvidence | undefined, nextSnapshot: ObservedReplaySnapshot | undefined, nextLocale: Locale): void {
  const wasHidden = panel.hidden;
  if (evidence !== next || snapshot !== nextSnapshot) {
    evidence = next;
    snapshot = nextSnapshot;
    recordId = "";
    selectedRow = 0;
    bucket = snapshot ? snapshot.points.reduce((best, point, index, points) => (point.replay ?? 0) > (points[best].replay ?? 0) ? index : best, 0) : 0;
  }
  locale = nextLocale;
  panel.hidden = !snapshot;
  link.hidden = !snapshot;
  if (wasHidden && snapshot && location.hash === "#api-evidence") openPanel();
  else renderOpenPanel();
}

panel.addEventListener("toggle", renderOpenPanel);
link.addEventListener("click", openPanel);
window.addEventListener("hashchange", () => { if (location.hash === "#api-evidence") openPanel(); });
recordSelect.addEventListener("change", () => chooseRecord(recordSelect.value));
bucketSelect.addEventListener("change", () => { bucket = Number(bucketSelect.value); renderBucket(); });
