import { readJSON } from "./data.ts";
import { text, timeLabel, type Locale } from "./i18n.ts";
import { SOURCE } from "./playback.ts";
import type { DemoProfile, EngagementSnapshot, MetricMode } from "./types.ts";

const code = document.querySelector<HTMLElement>("#configuration-code")!;
const samplesCode = document.querySelector<HTMLElement>("#samples-code")!;
const samplesDetails = document.querySelector<HTMLDetailsElement>("#samples")!;
let sampleGeneration = 0;
let controller: AbortController | undefined;
let sampleURL: URL | undefined;
let language: Locale = "en";

export function renderIntegration(profile: DemoProfile | undefined, mode: MetricMode, enabled: boolean, accent: string, locale: Locale): void {
  language = locale;
  const key = import.meta.env.VITE_PUBLIC_PLAYER_LICENSE_KEY ? "<PUBLIC_PLAYER_KEY>" : "";
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
const { manager, timelines } = createPlayerUi(player, ${JSON.stringify(locale)});
const response = await fetch(${JSON.stringify(snapshotPath)});
if (!response.ok) throw new Error("Could not load the snapshot");
const snapshot = validateSnapshot(await response.json());
for (const graph of timelines) {
  graph.setData(snapshot, ${JSON.stringify(mode)}, ${JSON.stringify(locale)});
  graph.setEnabled(${enabled});
}
// Accent applies only to the added graph.
document.querySelector(".player-frame").dataset.accent = ${JSON.stringify(accent)};
await player.load(${JSON.stringify(SOURCE, null, 2)});

// Release the UI and Player when leaving the page.
// manager.release();
// await player.destroy();`;
}

export function renderValues(snapshot: EngagementSnapshot | null, locale: Locale): void {
  const body = document.querySelector<HTMLTableSectionElement>("#values-body")!;
  body.replaceChildren();
  if (!snapshot) return;
  for (const point of snapshot.points) {
    const row = body.insertRow();
    const metric = (value: number | null) => value === null ? text(locale, "unobserved") : `${(value * 100).toFixed(1)}%`;
    for (const value of [`${timeLabel(point.startMs)}–${timeLabel(point.endMs)}`, metric(point.replay), metric(point.reach), String(point.support)]) row.insertCell().textContent = value;
  }
}

export function setSampleSource(profile: DemoProfile | undefined, manifestURL: URL, locale: Locale): void {
  language = locale;
  sampleGeneration += 1;
  controller?.abort();
  sampleURL = profile ? new URL(profile.samples, manifestURL) : undefined;
  samplesCode.textContent = "";
  const snapshotLink = document.querySelector<HTMLAnchorElement>("#snapshot-link")!;
  const samplesLink = document.querySelector<HTMLAnchorElement>("#samples-link")!;
  if (profile) {
    snapshotLink.href = new URL(profile.snapshot, manifestURL).href;
    samplesLink.href = sampleURL!.href;
  } else {
    snapshotLink.removeAttribute("href");
    samplesLink.removeAttribute("href");
  }
  if (samplesDetails.open) void loadSamples();
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
