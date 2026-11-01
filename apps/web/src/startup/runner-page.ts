import { preloadEngine, runBrowserTrial } from "./runner";
import type { EngineId, StartupTuning } from "./contract";

const query = new URLSearchParams(location.search);
const token = query.get("channel");
const engine = query.get("engine");
const mode = query.get("mode");
const engines = new Set<string>(["web-x", "hls", "shaka"]);
const controller = new AbortController();
let accepted = false;
const reply = (type: string, fields: Record<string, unknown> = {}) => {
  parent.postMessage({ type, channel: token, ...fields }, location.origin);
};

function validTuning(value: unknown): value is StartupTuning {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = Object.entries(value);
  return fields.length <= 3 && fields.every(([key, item]) =>
    key === "hlsWorker" ? typeof item === "boolean"
      : (key === "shakaPrefetchLimit" || key === "webXLoadControl") && [0, 1, 2].includes(item as number));
}

async function boot(): Promise<void> {
  if (window === parent || !token || !/^[\da-f-]{36}$/i.test(token) || !engine || !engines.has(engine)
    || (mode !== "on-demand" && mode !== "preloaded")) return;
  const video = document.querySelector<HTMLVideoElement>("video")!;
  const container = document.getElementById("stage")!;
  video.muted = true;
  video.playbackRate = 1;
  performance.setResourceTimingBufferSize(1000);
  let preloaded: { start: number; end: number } | undefined;
  if (mode === "preloaded") preloaded = await preloadEngine(engine as EngineId);
  window.addEventListener("message", async (event: MessageEvent<unknown>) => {
    if (event.source !== parent || event.origin !== location.origin || typeof event.data !== "object" || !event.data) return;
    const data = event.data as Record<string, unknown>;
    if (data.channel !== token) return;
    if (data.type === "cancel") { controller.abort(); return; }
    if (data.type !== "start" || accepted || !["bbb-360p", "bbb-180p"].includes(data.contentId as string)
      || !["default", "startup"].includes(data.profile as string) || !validTuning(data.tuning)
      || typeof data.selectedAt !== "number" || !Number.isFinite(data.selectedAt)
      || Math.abs(performance.timeOrigin + performance.now() - data.selectedAt) > 60_000) return;
    accepted = true;
    const source = new URL(`media/vod-baseline/comparison-${data.contentId === "bbb-360p" ? "360p" : "180p"}.m3u8`,
      new URL(import.meta.env.BASE_URL, location.origin));
    const result = await runBrowserTrial({
      engine: engine as EngineId, video, container, url: source.href,
      licenseKey: import.meta.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY ?? "",
      selectedAt: data.selectedAt, profile: data.profile as "default" | "startup",
      tuning: data.tuning, signal: controller.signal, ...(preloaded ? { preloaded } : {}),
    });
    reply("result", { result });
  });
  window.addEventListener("pagehide", () => controller.abort(), { once: true });
  reply("ready");
}

void boot().catch(() => reply("prepare-failed"));
