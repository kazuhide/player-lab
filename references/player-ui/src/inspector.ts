import { readJSON } from "./data.ts";
import { text, timeLabel, type Locale } from "./i18n.ts";
import { SOURCE } from "./playback.ts";
import type { DemoProfile, MetricMode, TimelineSnapshot } from "./types.ts";

const code = document.querySelector<HTMLElement>("#configuration-code")!;
const samplesCode = document.querySelector<HTMLElement>("#samples-code")!;
const samplesDetails = document.querySelector<HTMLDetailsElement>("#samples")!;
let sampleGeneration = 0;
let controller: AbortController | undefined;
let sampleURL: URL | undefined;
let language: Locale = "en";

export function renderIntegration(profile: DemoProfile | undefined, mode: MetricMode, enabled: boolean, accent: string, locale: Locale, privateData = false): void {
  language = locale;
  const key = import.meta.env.VITE_PUBLIC_PLAYER_LICENSE_KEY ? "<PUBLIC_PLAYER_KEY>" : "";
  if (privateData) {
    // Render the integration pattern without serializing the private source URL or metadata.
    code.textContent = `import { Player, PlayerEvent } from "bitmovin-player";
import "bitmovin-player-ui/dist/css/bitmovinplayer-ui.css";
import "./style.css";
import { validatePrivateQueryData } from "./query-incidence";
import { createPlayerUi } from "./create-player-ui";

const response = await fetch("/__private/query-data", {
  cache: "no-store",
  credentials: "omit",
});
if (!response.ok) throw new Error("Could not load the query data");
const { snapshot, source } = validatePrivateQueryData(await response.json());
const player = new Player(document.querySelector("#player"), {
  key: ${JSON.stringify(key)}, // localhost does not need a Player key
  ui: false,
  analytics: false,
  playback: { autoplay: false, muted: true },
});
const { manager, setGraphData } = createPlayerUi(player, ${JSON.stringify(locale)});
player.on(PlayerEvent.Ready, () => {
  const duration = player.getDuration() * 1000;
  const matches = Number.isFinite(duration) && Math.abs(duration - snapshot.content.durationMs) <= 1000;
  setGraphData(matches ? snapshot : null, "reach", ${JSON.stringify(locale)}, ${enabled} && matches);
});
document.querySelector(".player-frame").dataset.accent = ${JSON.stringify(accent)};
await player.load({ hls: source.hls, title: "" });

// Release the UI and Player when leaving the page.
// manager.release();
// await player.destroy();`;
    return;
  }
  const snapshotPath = `./data/${profile?.snapshot ?? "sparse.snapshot.json"}`;
  code.textContent = `import { Player } from "bitmovin-player";
import "bitmovin-player-ui/dist/css/bitmovinplayer-ui.css";
import "./style.css";
import { validateSnapshot } from "./snapshot";
import { createPlayerUi } from "./create-player-ui";

const player = new Player(document.querySelector("#player"), {
  key: ${JSON.stringify(key)}, // localhost does not need a Player key
  ui: false,
  analytics: false,
  playback: { autoplay: false, muted: true },
});
const { manager, setGraphData } = createPlayerUi(player, ${JSON.stringify(locale)});
const response = await fetch(${JSON.stringify(snapshotPath)});
if (!response.ok) throw new Error("Could not load the snapshot");
const snapshot = validateSnapshot(await response.json());
setGraphData(snapshot, ${JSON.stringify(mode)}, ${JSON.stringify(locale)}, ${enabled});
// Accent applies only to the added graph.
document.querySelector(".player-frame").dataset.accent = ${JSON.stringify(accent)};
await player.load(${JSON.stringify(SOURCE, null, 2)});

// Release the UI and Player when leaving the page.
// manager.release();
// await player.destroy();`;
}

export function renderValues(snapshot: TimelineSnapshot | null, locale: Locale): void {
  const body = document.querySelector<HTMLTableSectionElement>("#values-body")!;
  body.replaceChildren();
  if (!snapshot) return;
  for (const point of snapshot.points) {
    const row = body.insertRow();
    const metric = (value: number | null) => value === null ? text(locale, "unobserved") : `${(value * 100).toFixed(1)}%`;
    const replay = snapshot.synthetic ? metric(point.replay) : text(locale, "unavailable");
    for (const value of [`${timeLabel(point.startMs)}–${timeLabel(point.endMs)}`, replay, metric(point.reach), String(point.support)]) row.insertCell().textContent = value;
  }
}

export function setSampleSource(profile: DemoProfile | undefined, manifestURL: URL, locale: Locale): void {
  language = locale;
  sampleGeneration += 1;
  controller?.abort();
  sampleURL = profile ? new URL(profile.samples, manifestURL) : undefined;
  samplesCode.textContent = "";
  samplesDetails.hidden = false;
  const snapshotLink = document.querySelector<HTMLAnchorElement>("#snapshot-link")!;
  const samplesLink = document.querySelector<HTMLAnchorElement>("#samples-link")!;
  samplesLink.hidden = false;
  if (profile) {
    snapshotLink.href = new URL(profile.snapshot, manifestURL).href;
    samplesLink.href = sampleURL!.href;
  } else {
    snapshotLink.removeAttribute("href");
    samplesLink.removeAttribute("href");
  }
  if (samplesDetails.open) void loadSamples();
}

export function setPrivateQuerySource(locale: Locale): void {
  language = locale;
  sampleGeneration += 1;
  controller?.abort();
  sampleURL = undefined;
  samplesCode.textContent = "";
  samplesDetails.hidden = true;
  document.querySelector<HTMLAnchorElement>("#samples-link")!.hidden = true;
  document.querySelector<HTMLAnchorElement>("#snapshot-link")!.href = "/__private/query-data";
}

async function loadSamples(): Promise<void> {
  if (!sampleURL) return;
  const generation = ++sampleGeneration;
  controller?.abort();
  controller = new AbortController();
  samplesCode.textContent = text(language, "loading");
  try {
    const data = await readJSON(sampleURL, controller.signal);
    if (generation === sampleGeneration) samplesCode.textContent = JSON.stringify(data, null, 2);
  } catch {
    if (generation === sampleGeneration) samplesCode.textContent = text(language, "sourceError");
  }
}

samplesDetails.addEventListener("toggle", () => { if (samplesDetails.open && !samplesCode.textContent) void loadSamples(); });
document.querySelector<HTMLButtonElement>("#copy-code")!.addEventListener("click", async event => {
  const button = event.currentTarget as HTMLButtonElement;
  try { await navigator.clipboard.writeText(code.textContent ?? ""); button.textContent = text(language, "copied"); }
  catch { button.textContent = text(language, "copyError"); }
});
