import { text, timeLabel, type Locale, type TextKey } from "./i18n.ts";
import { observedEvidenceInput, type ObservedReplayEvidence, type RawObservedSample } from "./observed-evidence.ts";
import { inspectObservedReplay, type Interval, type ObservedReplayInspection, type ObservedSampleReason } from "./observed-replay.ts";
import type { ObservedReplaySnapshot } from "./types.ts";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const panel = element<HTMLDetailsElement>("api-evidence");
const link = element<HTMLAnchorElement>("api-evidence-link");
const recordSelect = element<HTMLSelectElement>("evidence-record");
const sequenceSelect = element<HTMLSelectElement>("evidence-sequence");
const bucketSelect = element<HTMLSelectElement>("evidence-bucket");
const cache = new WeakMap<ObservedReplayEvidence, ObservedReplayInspection>();
let evidence: ObservedReplayEvidence | undefined;
let snapshot: ObservedReplaySnapshot | undefined;
let inspection: ObservedReplayInspection | undefined;
let locale: Locale = "en";
let recordId = "";
let sequence = 0;
let bucket = 0;

const FIELDS: [keyof RawObservedSample, TextKey][] = [
  ["sequence_number", "apiSequenceMeaning"], ["state", "apiStateMeaning"],
  ["videotime_start", "apiStartMeaning"], ["videotime_end", "apiEndMeaning"], ["played", "apiPlayedMeaning"], ["seeked", "apiSeekedMeaning"],
  ["client_time", "apiClockMeaning"], ["ad", "apiAdMeaning"], ["video_duration", "apiDurationMeaning"],
  ["video_id", "apiVideoMeaning"], ["m3u8_url", "apiSourceMeaning"],
];
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

function renderRecord(): void {
  const record = inspection?.records.find(item => item.id === recordId);
  const session = evidence?.sessions.find(item => item.id === recordId);
  if (!record || !session) return;
  if (!record.samples.some(item => item.sequenceNumber === sequence)) sequence = record.samples[0].sequenceNumber;
  selectOptions(sequenceSelect, record.samples.map(item => [String(item.sequenceNumber), `${item.sequenceNumber} · ${text(locale, REASONS[item.reason])}`]), String(sequence));
  const raw = session.response.data.result.find(item => item.sequence_number === sequence)!;
  const selected = record.samples.find(item => item.sequenceNumber === sequence)!;
  element("evidence-receipt").textContent = `${text(locale, "apiFetchedAt")}: ${session.fetchedAt} · ${text(locale, "apiLastSequence")}: ${session.expectedLastSequence}`;
  const fields = element<HTMLTableSectionElement>("evidence-fields");
  fields.replaceChildren();
  for (const [field, meaning] of FIELDS) {
    const row = fields.insertRow();
    row.dataset.field = field;
    const name = document.createElement("code");
    name.textContent = field;
    const description = document.createElement("span");
    description.textContent = text(locale, meaning);
    row.insertCell().append(name, description);
    row.insertCell().textContent = String(raw[field]);
  }
  // Keep every retained original sample, including response ordering and identical retries.
  element("evidence-json").textContent = JSON.stringify(session.response, null, 2);
  const seek = selected.seekOriginMs === null ? "" : ` · ${number(selected.seekOriginMs)} → ${number(selected.seekTargetMs!)} ms`;
  element("evidence-decision").textContent = `${text(locale, REASONS[selected.reason])} · ${text(locale, "apiPass")} ${selected.passIndex + 1} · ${range(selected.countedRange)}${seek}`;
  const decisions = element<HTMLTableSectionElement>("evidence-decisions");
  decisions.replaceChildren();
  for (const sample of record.samples) {
    const row = decisions.insertRow();
    row.dataset.sequence = String(sample.sequenceNumber);
    row.dataset.selected = String(sample.sequenceNumber === sequence);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(sample.sequenceNumber);
    if (sample.sequenceNumber === sequence) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => { sequence = sample.sequenceNumber; renderRecord(); });
    row.insertCell().append(button);
    cells(row, [String(sample.passIndex + 1), range(sample.countedRange), text(locale, REASONS[sample.reason])]);
  }
  const passes = element("evidence-passes");
  passes.replaceChildren();
  record.passes.forEach((intervals, index) => {
    const line = document.createElement("p");
    line.textContent = `${text(locale, "apiPass")} ${index + 1}: ${intervals.map(value => range(value)).join(" · ") || "—"}`;
    passes.append(line);
  });
}

/** Intersect the canonical merged ranges with the selected bucket; do not infer passes here. */
function covered(intervals: Interval[], start: number, end: number): number {
  return intervals.reduce((total, interval) => total + Math.max(0, Math.min(end, interval[1]) - Math.max(start, interval[0])), 0);
}

function preferredSequence(id: string): number {
  const record = inspection!.records.find(item => item.id === id)!;
  const point = snapshot!.points[bucket];
  const overlaps = (sample: typeof record.samples[number]) => sample.countedRange !== null && covered([sample.countedRange], point.startMs, point.endMs) > 0;
  const sample = covered(record.replay, point.startMs, point.endMs) > 0 ? record.samples.findLast(overlaps) : record.samples.find(overlaps);
  return (sample ?? record.samples[0]).sequenceNumber;
}

function chooseRecord(id: string): void {
  if (!inspection?.records.some(record => record.id === id)) return;
  recordId = id;
  sequence = preferredSequence(id);
  recordSelect.value = id;
  renderRecord();
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
      if (recordId) sequence = preferredSequence(recordId);
    }
    selectOptions(recordSelect, inspection.records.map(record => [record.id, record.id]), recordId);
    selectOptions(bucketSelect, snapshot.points.map((point, index) => [String(index), `${timeLabel(point.startMs)}–${timeLabel(point.endMs)}`]), String(bucket));
    if (recordId) renderRecord();
    else {
      selectOptions(sequenceSelect, [], "");
      element("evidence-fields").replaceChildren();
      element("evidence-decisions").replaceChildren();
      element("evidence-passes").replaceChildren();
      element("evidence-json").textContent = "";
      element("evidence-decision").textContent = text(locale, "noRecords");
      element("evidence-receipt").textContent = "";
    }
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
    sequence = 0;
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
sequenceSelect.addEventListener("change", () => { sequence = Number(sequenceSelect.value); renderRecord(); });
bucketSelect.addEventListener("change", () => { bucket = Number(bucketSelect.value); renderBucket(); });
