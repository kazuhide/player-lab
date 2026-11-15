import "bitmovin-player-ui/dist/css/bitmovinplayer-ui.css";
import "./style.css";
import packageInfo from "../package.json";
import { readManifest, readSnapshot } from "./data.ts";
import { applyLocale, text, timeLabel, type Locale } from "./i18n.ts";
import { renderIntegration, renderValues, setSampleSource } from "./inspector.ts";
import { createPlayback, type Playback, type PlaybackState } from "./playback.ts";
import { createTimelineGeometry } from "./timeline-geometry.ts";
import type { DemoManifest, EngagementSnapshot, MetricMode } from "./types.ts";

const query = new URLSearchParams(location.search);
let locale: Locale = query.get("lang") === "ja" || (!query.has("lang") && navigator.language.startsWith("ja")) ? "ja" : "en";
let manifest: DemoManifest | undefined;
let snapshot: EngagementSnapshot | null = null;
let mode: MetricMode = "replay";
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

function updateAddress(): void {
  const url = new URL(location.href);
  url.searchParams.set("lang", locale);
  if (profile.value) url.searchParams.set("sample", profile.value);
  history.replaceState(null, "", url);
}

function renderGraph(): void {
  const compatible = playbackState !== "error" && playbackState !== "mismatch";
  for (const graph of playback?.ui.timelines ?? []) {
    graph.setData(compatible ? snapshot : null, mode, locale);
    graph.setEnabled(showGraph.checked && compatible);
  }
}

function renderPlayback(): void {
  videoStatus.dataset.state = playbackState;
  videoStatus.textContent = text(locale, playbackState === "error" ? "videoError" : playbackState);
  retryVideo.hidden = playbackState !== "error";
  for (const button of document.querySelectorAll<HTMLButtonElement>("#peaks button")) button.disabled = !playback?.canSeek;
  renderGraph();
}

function renderData(): void {
  status.dataset.state = dataState;
  status.textContent = text(locale, dataState === "error" ? "error" : dataState);
  retryData.hidden = dataState !== "error";
  document.querySelector<HTMLElement>("#session-count")!.textContent = snapshot ? `${snapshot.sessionCount} ${text(locale, "sessionCount")}` : "—";
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="metric"]')) {
    input.checked = input.value === mode;
    input.disabled = !snapshot?.sessionCount;
  }
  const note = document.querySelector<HTMLElement>("#metric-note")!;
  note.textContent = !snapshot ? "" : snapshot.sessionCount === 0 ? text(locale, "empty") :
    text(locale, mode === "replay" ? "replayNote" : snapshot.suggestedMode === "reach" ? "reachNote" : "watchedNote");
  renderValues(snapshot, locale);
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
  renderIntegration(manifest?.profiles.find(item => item.id === profile.value), mode, showGraph.checked, accent.value, locale);
}

function renderLocale(): void {
  applyLocale(locale);
  const value = profile.value;
  profile.replaceChildren();
  for (const item of manifest?.profiles ?? []) profile.add(new Option(item.title[locale], item.id));
  if (value) profile.value = value;
  setSampleSource(manifest?.profiles.find(item => item.id === profile.value), manifestURL, locale);
  renderData();
  renderPlayback();
}

async function chooseProfile(id: string): Promise<void> {
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
    mode = next.suggestedMode === "empty" ? "replay" : next.suggestedMode;
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
  try {
    playback = createPlayback(state => { playbackState = state; renderPlayback(); }, locale);
    renderGraph();
    void playback.load();
  } catch { playbackState = "error"; renderPlayback(); }
}

profile.addEventListener("change", () => void chooseProfile(profile.value));
retryData.addEventListener("click", () => void (manifest ? chooseProfile(profile.value) : initializeData()));
retryVideo.addEventListener("click", () => { if (playback) void playback.load(); else initializePlayer(); });
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="metric"]')) input.addEventListener("change", () => {
  if (input.checked) { mode = input.value as MetricMode; renderData(); }
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
window.addEventListener("pagehide", () => { controller?.abort(); playback?.destroy(); }, { once: true });
document.querySelector<HTMLElement>("#versions")!.textContent = `UI ${packageInfo.dependencies["bitmovin-player-ui"]} · Player ${packageInfo.dependencies["bitmovin-player"]}`;
renderLocale();
initializePlayer();
void initializeData();
