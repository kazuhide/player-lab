import "bitmovin-player-ui/dist/css/bitmovinplayer-ui.css";
import "./style.css";
import packageInfo from "../package.json";
import { readManifest, readSnapshot } from "./data.ts";
import { validatePrivateData, type PrivateData } from "./private-data.ts";
import { applyLocale, recordCount, text, timeLabel, type Locale } from "./i18n.ts";
import { renderIntegration, renderValues, setPrivateQuerySource, setSampleSource } from "./inspector.ts";
import { createPlayback, type Playback, type PlaybackState } from "./playback.ts";
import { createTimelineGeometry } from "./timeline-geometry.ts";
import { renderSamplePreviews } from "./sample-preview.ts";
import { renderApiEvidence } from "./api-evidence-view.ts";
import { createViewerExperienceView } from "./viewer-experience-view.ts";
import type { DemoManifest, MetricMode, TimelineSnapshot } from "./types.ts";

const query = new URLSearchParams(location.search);
const privateMode = query.get("data") === "private";
let locale: Locale = query.get("lang") === "ja" || (!query.has("lang") && navigator.language.startsWith("ja")) ? "ja" : "en";
let manifest: DemoManifest | undefined;
let snapshot: TimelineSnapshot | null = null;
let mode: MetricMode = privateMode ? "reach" : "replay";
let privateSource: { hls: string } | undefined;
let privateData: PrivateData | undefined;
let privateProfileId = "";
let playback: Playback | undefined;
let playbackState: PlaybackState = "loading";
let dataState: "loading" | "ready" | "empty" | "error" = "loading";
let controller: AbortController | undefined;
let generation = 0;
const manifestURL = new URL("data/manifest.json", new URL(import.meta.env.BASE_URL, location.href));
const profile = document.querySelector<HTMLSelectElement>("#profile")!;
const showGraph = document.querySelector<HTMLInputElement>("#show-graph")!;
const accent = document.querySelector<HTMLSelectElement>("#accent")!;
const status = document.querySelector<HTMLElement>("#data-status")!;
const videoStatus = document.querySelector<HTMLElement>("#player-status")!;
const retryData = document.querySelector<HTMLButtonElement>("#retry-data")!;
const retryVideo = document.querySelector<HTMLButtonElement>("#retry-video")!;
const viewerExperiences = createViewerExperienceView();

function renderViewerExperiences(): void {
  viewerExperiences.render({ playback, snapshot, content: manifest?.content, demoSource: !privateMode, locale });
}

function isQueryData(): boolean {
  return privateMode && (!privateData || privateData.kind === "query");
}

function hasProfiles(data: PrivateData | undefined): data is Exclude<PrivateData, { kind: "query" }> {
  return !!data && data.kind !== "query";
}

function updateAddress(): void {
  const url = new URL(location.href);
  url.searchParams.set("lang", locale);
  if (isQueryData()) url.searchParams.delete("sample");
  else if (profile.value) url.searchParams.set("sample", profile.value);
  history.replaceState(null, "", url);
}

function renderGraph(): void {
  const compatible = privateMode ? ["ready", "playing", "paused"].includes(playbackState) : playbackState !== "error" && playbackState !== "mismatch";
  playback?.ui.setGraphData(compatible ? snapshot : null, mode, locale, showGraph.checked && compatible);
}

function renderPlayback(): void {
  videoStatus.dataset.state = playbackState;
  videoStatus.textContent = text(locale, playbackState === "error" ? "videoError" : playbackState);
  retryVideo.hidden = playbackState !== "error";
  for (const button of document.querySelectorAll<HTMLButtonElement>("#peaks button")) button.disabled = !playback?.canSeek;
  renderGraph();
  renderViewerExperiences();
}

function renderData(): void {
  status.dataset.state = dataState;
  status.textContent = text(locale, dataState === "error" ? "error" : dataState);
  retryData.hidden = dataState !== "error";
  document.querySelector<HTMLElement>("#session-count")!.textContent = snapshot ? recordCount(locale, snapshot.sessionCount) : "—";
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="metric"]')) {
    input.checked = input.value === mode;
    input.disabled = !snapshot?.sessionCount || (isQueryData() && input.value === "replay");
  }
  const note = document.querySelector<HTMLElement>("#metric-note")!;
  const noReplay = snapshot && !snapshot.points.some(point => (point.replay ?? 0) > 0);
  note.textContent = isQueryData() ? text(locale, "privateMetricNote") : !snapshot ? "" : snapshot.sessionCount === 0 ? text(locale, "empty") :
    text(locale, mode === "replay" && noReplay ? "noRewatchNote" : "relativeNote");
  renderSamplePreviews(snapshot, profile.value, locale, isQueryData(), privateData?.kind);
  renderValues(snapshot, locale);
  const observedProfile = privateData?.kind === "observability-replay-demo" ? privateData.profiles.find(item => item.id === privateProfileId) : undefined;
  renderApiEvidence(observedProfile?.evidence, observedProfile?.snapshot, locale);
  renderGraph();
  const peakBox = document.querySelector<HTMLElement>("#peaks")!;
  peakBox.replaceChildren();
  if (snapshot) {
    const geometry = createTimelineGeometry(snapshot, mode, snapshot.content.durationMs, 100);
    const peaks = geometry.peaks.sort((a, b) => b.rawValue - a.rawValue).slice(0, 3).sort((a, b) => a.x - b.x);
    for (const peak of peaks) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = timeLabel(peak.x);
      button.dataset.timeMs = String(peak.x);
      button.disabled = !playback?.canSeek;
      button.addEventListener("click", () => playback?.seek(peak.x));
      peakBox.append(button);
    }
  }
  if (!peakBox.childElementCount) {
    const empty = document.createElement("span");
    empty.textContent = snapshot ? text(locale, snapshot.sessionCount ? "noPeaks" : "empty") : "—";
    peakBox.append(empty);
  }
  const privateProfileIndex = hasProfiles(privateData) ? privateData.profiles.findIndex(item => item.id === privateProfileId) : 0;
  renderIntegration(manifest?.profiles.find(item => item.id === profile.value), mode, showGraph.checked, accent.value, locale, privateMode, Math.max(0, privateProfileIndex));
  renderViewerExperiences();
}

function renderLocale(): void {
  applyLocale(locale);
  const value = profile.value;
  profile.replaceChildren();
  if (privateMode) {
    const profiled = hasProfiles(privateData);
    const observed = privateData?.kind === "observability-replay-demo";
    if (hasProfiles(privateData)) {
      for (const item of privateData.profiles) profile.add(new Option(item.title[locale], item.id));
      profile.value = privateProfileId;
    } else profile.add(new Option(text(locale, "privateProfile"), "private"));
    profile.disabled = !profiled;
    profile.hidden = !profiled;
    document.querySelector<HTMLLabelElement>('label[for="profile"]')!.hidden = !profiled;
    const replacements = profiled ? {
      synthetic: observed ? "observedDemoData" : "liveDemoData", sourceCaption: "liveDemoSourceCaption", scenario: "liveDemoScenario",
      footerNote: observed ? "observedDemoFooter" : "liveDemoFooter", snapshotFile: "liveDemoSnapshot",
    } as const : {
      synthetic: "queryData", sourceCaption: "privateSourceCaption", scenario: "privateScenario",
      watched: "privateWatched", watchDefinition: "privateWatchDefinition", replayDefinition: "privateReplayDefinition",
      previewScale: "privatePreviewScale", watchCoverage: "privateWatched", footerNote: "privateFooter", snapshotFile: "privateQueryFile",
    } as const;
    for (const [original, replacement] of Object.entries(replacements)) {
      document.querySelector<HTMLElement>(`[data-i18n="${original}"]`)!.textContent = text(locale, replacement);
    }
    document.querySelector<HTMLElement>("#source-title")!.textContent = text(locale, "privateVideo");
    document.querySelector<HTMLAnchorElement>("#calculation-link")!.href =
      `https://github.com/kazuhide/player-lab/blob/main/references/player-ui/docs/${profiled ? "live-demo-data" : "private-query-data"}${locale === "ja" ? ".ja" : ""}.md`;
    setPrivateQuerySource(locale);
  } else {
    for (const item of manifest?.profiles ?? []) profile.add(new Option(item.title[locale], item.id));
    if (value) profile.value = value;
    setSampleSource(manifest?.profiles.find(item => item.id === profile.value), manifestURL, locale);
  }
  renderData();
  renderPlayback();
}

async function initializePrivateData(): Promise<void> {
  const request = ++generation;
  controller?.abort();
  controller = new AbortController();
  dataState = "loading";
  snapshot = null;
  renderData();
  try {
    // The loopback-only server caps this response at 512 KiB before delivery.
    const response = await fetch("/__private/query-data", { cache: "no-store", credentials: "omit", signal: controller.signal });
    if (!response.ok) throw new Error("Private data request failed");
    const next = validatePrivateData(await response.json());
    if (request !== generation) return;
    privateData = next;
    privateSource = next.source;
    if (hasProfiles(next)) {
      const requested = query.get("sample") ?? privateProfileId;
      const selected = next.profiles.find(item => item.id === requested) ?? next.profiles[0];
      privateProfileId = selected.id;
      snapshot = selected.snapshot;
      mode = "replay";
    } else {
      snapshot = next.snapshot;
      mode = "reach";
    }
    dataState = snapshot.sessionCount === 0 ? "empty" : "ready";
    renderLocale();
    initializePlayer();
    updateAddress();
  } catch {
    if (request !== generation) return;
    dataState = "error";
    renderData();
  }
}

async function chooseProfile(id: string): Promise<void> {
  if (hasProfiles(privateData)) {
    const selected = privateData.profiles.find(item => item.id === id);
    if (!selected) return;
    privateProfileId = id;
    snapshot = selected.snapshot;
    dataState = snapshot.sessionCount === 0 ? "empty" : "ready";
    renderData();
    updateAddress();
    return;
  }
  if (!manifest) return;
  const selected = manifest.profiles.find(item => item.id === id);
  if (!selected) return;
  const request = ++generation;
  controller?.abort();
  controller = new AbortController();
  snapshot = null;
  dataState = "loading";
  setSampleSource(undefined, manifestURL, locale);
  renderData();
  try {
    const next = await readSnapshot(new URL(selected.snapshot, manifestURL), manifest.content, controller.signal);
    if (request !== generation) return;
    snapshot = next;
    dataState = next.sessionCount === 0 ? "empty" : "ready";
    setSampleSource(selected, manifestURL, locale);
  } catch {
    if (request !== generation) return;
    dataState = "error";
  }
  renderData();
  updateAddress();
}

async function initializeData(): Promise<void> {
  try {
    manifest = await readManifest(manifestURL);
    renderLocale();
    profile.disabled = false;
    const requested = query.get("sample") ?? "sparse";
    profile.value = manifest.profiles.some(item => item.id === requested) ? requested : manifest.profiles[0].id;
    await chooseProfile(profile.value);
  } catch { dataState = "error"; renderData(); }
}

function initializePlayer(): void {
  if (privateMode && (!privateSource || !snapshot)) return;
  try {
    const options = privateMode ? { source: { hls: privateSource!.hls, title: "" }, expectedDurationMs: snapshot!.content.durationMs } : undefined;
    playback = createPlayback(state => { playbackState = state; renderPlayback(); }, locale, options);
    renderGraph();
    void playback.load();
  } catch { playbackState = "error"; renderPlayback(); }
}

profile.addEventListener("change", () => void chooseProfile(profile.value));
retryData.addEventListener("click", () => void (privateMode ? initializePrivateData() : manifest ? chooseProfile(profile.value) : initializeData()));
retryVideo.addEventListener("click", () => { if (playback) void playback.load(); else initializePlayer(); });
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="metric"]')) input.addEventListener("change", () => {
  if (input.checked && (!isQueryData() || input.value === "reach")) { mode = input.value as MetricMode; renderData(); }
});
showGraph.addEventListener("change", renderData);
accent.addEventListener("change", () => {
  document.querySelector<HTMLElement>(".player-frame")!.dataset.accent = accent.value;
  renderData();
});
document.querySelector<HTMLButtonElement>("#language")!.addEventListener("click", () => {
  locale = locale === "en" ? "ja" : "en";
  playback?.setLocale(locale);
  renderLocale();
  updateAddress();
});
// A persisted page is frozen for browser back navigation and keeps its Player.
window.addEventListener("pagehide", event => {
  if (!event.persisted) { controller?.abort(); playback?.destroy(); }
});
document.querySelector<HTMLElement>("#versions")!.textContent = `UI ${packageInfo.dependencies["bitmovin-player-ui"]} · Player ${packageInfo.dependencies["bitmovin-player"]}`;
renderLocale();
if (privateMode) void initializePrivateData();
else { initializePlayer(); void initializeData(); }
