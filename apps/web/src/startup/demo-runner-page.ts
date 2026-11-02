import { DemoRuntime } from "./demo-session";
import type { EngineId, StartupProfile, StartupTuning } from "./contract";
import type { DemoSource } from "./demo-contract";

function validTuning(value: unknown): value is StartupTuning | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) => key === "hlsWorker" ? typeof item === "boolean"
    : (key === "shakaPrefetchLimit" || key === "webXLoadControl") && [0, 1, 2].includes(item as number));
}

/** Called only by the existing runner entry's explicit demo=1 branch. */
export function bootDemoRunner(): void {
  const query = new URLSearchParams(location.search);
  const channel = query.get("channel"); const engine = query.get("engine");
  if (window === parent || query.get("demo") !== "1" || !channel || !/^[\da-f-]{36}$/i.test(channel)
    || !engine || !["web-x", "hls", "shaka"].includes(engine)) return;
  const video = document.querySelector<HTMLVideoElement>("video"); const container = document.getElementById("stage");
  if (!video || !container) return;
  const reply = (type: string, fields: Record<string, unknown> = {}) => parent.postMessage({ type, channel, ...fields }, location.origin);
  const runtime = new DemoRuntime({ engine: engine as EngineId, video, container, clock: parent.performance,
    onSample: (sample) => reply("sample", { sample }) });
  const pending = new Map<number, AbortController>();
  let latest = 0;
  const listener = async (event: MessageEvent<unknown>) => {
    if (event.origin !== location.origin || event.source !== parent || !event.data || typeof event.data !== "object") return;
    const data = event.data as Record<string, unknown>;
    if (data.channel !== channel || !Number.isSafeInteger(data.operationId) || (data.operationId as number) < 1) return;
    const id = data.operationId as number;
    if (data.type === "cancel") { pending.get(id)?.abort(); return; }
    if (id <= latest) return; latest = id;
    if (!data.payload || typeof data.payload !== "object" || Array.isArray(data.payload)) return;
    const payload = data.payload as Record<string, unknown>;
    const controller = new AbortController(); pending.set(id, controller);
    try {
      let result: unknown;
      switch (data.type) {
        case "start":
          if (![undefined, "default", "startup"].includes(payload.profile as string | undefined)
            || !validTuning(payload.tuning)
            || (payload.selectedAt !== undefined && (typeof payload.selectedAt !== "number" || !Number.isFinite(payload.selectedAt)))) throw new Error("invalid");
          result = await runtime.start({ source: payload.source as DemoSource, signal: controller.signal,
            ...(payload.profile === undefined ? {} : { profile: payload.profile as StartupProfile }),
            ...(payload.tuning === undefined ? {} : { tuning: payload.tuning as StartupTuning }),
            ...(payload.selectedAt === undefined ? {} : { selectedAt: payload.selectedAt as number }) }); break;
        case "seek":
          if (typeof payload.targetSeconds !== "number" || !Number.isFinite(payload.targetSeconds)) throw new Error("invalid");
          result = await runtime.seek(payload.targetSeconds, controller.signal); break;
        case "play": await runtime.play(); break;
        case "pause": runtime.pause(); break;
        case "network":
          if (payload.rate !== null && (typeof payload.rate !== "number" || !Number.isFinite(payload.rate))) throw new Error("invalid");
          result = await runtime.setNetworkRate(payload.rate as number | null); break;
        case "dispose": await runtime.dispose(); break;
        default: return;
      }
      reply("response", { operationId: id, result });
    } catch { reply("response", { operationId: id, error: "operation-failed" }); }
    finally { pending.delete(id); }
  };
  window.addEventListener("message", listener);
  window.addEventListener("pagehide", () => {
    window.removeEventListener("message", listener);
    for (const controller of pending.values()) controller.abort();
    void runtime.dispose().catch(() => {});
  }, { once: true });
  reply("ready");
}
