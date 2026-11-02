import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoSession } from "../src/startup/demo-frame";

const origin = "https://player-lab.invalid";
const source = { url: "https://media.invalid/a.m3u8?token=private", format: "hls" as const, label: "Custom HLS", custom: true };
const result = { status: "success", failureCode: null, sdkCode: null, marks: { nativePlaying: 20, firstMovingFrame: 30 }, metadata: null, frameCallbackAvailable: true };
let surface: EventTarget;
let iframe: { title: string; allow: string; src: string; contentWindow: { postMessage: ReturnType<typeof vi.fn> }; remove: ReturnType<typeof vi.fn> };
const sessions: DemoSession[] = [];
function message(data: unknown, sender: unknown = iframe.contentWindow, from = origin) {
  const event = new Event("message"); Object.defineProperties(event, { data: { value: data }, source: { value: sender }, origin: { value: from } }); surface.dispatchEvent(event);
}
function fixture() {
  const sample = vi.fn(); const container = { replaceChildren: vi.fn() };
  const session = new DemoSession({ engine: "hls", container: container as unknown as HTMLElement, onSample: sample }); sessions.push(session);
  const channel = new URL(iframe.src).searchParams.get("channel");
  return { session, sample, packet: (type: string, fields: Record<string, unknown> = {}) => ({ type, channel, ...fields }) };
}
async function drain() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.useFakeTimers(); surface = new EventTarget(); vi.stubGlobal("window", surface); vi.stubGlobal("location", new URL(origin + "/comparison.html"));
  iframe = { title: "", allow: "", src: "", contentWindow: { postMessage: vi.fn() }, remove: vi.fn() };
  vi.stubGlobal("document", { createElement: vi.fn(() => iframe) });
});
afterEach(async () => {
  const close = sessions.splice(0).map((session) => session.dispose().catch(() => {}));
  await vi.advanceTimersByTimeAsync(6_001); await Promise.all(close); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("retained demo iframe ownership", () => {
  it("keeps custom addresses out of the document URL and accepts only matching origin/source/channel/operation", async () => {
    const f = fixture(); expect(iframe.src).not.toContain("private"); expect(new URL(iframe.src).pathname).toBe("/demo-runner.html");
    expect(new URL(iframe.src).searchParams.get("demo")).toBe("1");
    const pending = f.session.start({ source, signal: new AbortController().signal, selectedAt: 123 });
    message(f.packet("ready"), {}); await drain(); expect(iframe.contentWindow.postMessage).not.toHaveBeenCalled();
    message(f.packet("ready")); await drain(); const sent = iframe.contentWindow.postMessage.mock.calls[0]![0];
    expect(sent).toMatchObject({ type: "start", payload: { source, selectedAt: 123 } });
    let done = false; void pending.then(() => { done = true; });
    message(f.packet("response", { operationId: sent.operationId + 1, result }));
    message(f.packet("response", { operationId: sent.operationId, result }), {});
    message(f.packet("response", { operationId: sent.operationId, result }), iframe.contentWindow, "https://other.invalid");
    await drain(); expect(done).toBe(false);
    message(f.packet("response", { operationId: sent.operationId, result })); expect(await pending).toEqual(result);
  });
  it("closes before readiness immediately and rejects the pending start without a30second wait", async () => {
    const f = fixture(); const start = expect(f.session.start({ source, signal: new AbortController().signal })).rejects.toThrow("aborted");
    await f.session.dispose(); await start; expect(iframe.remove).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    message(f.packet("ready")); expect(iframe.contentWindow.postMessage).not.toHaveBeenCalled();
  });
  it("cancels preparation promptly when the supplied start signal aborts", async () => {
    const f = fixture(); const controller = new AbortController();
    const start = expect(f.session.start({ source, signal: controller.signal })).rejects.toThrow("aborted");
    controller.abort(); await start; expect(iframe.remove).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("forwards only bounded finite observation fields and preserves legitimate zeros", async () => {
    const f = fixture(); message(f.packet("ready"));
    const sample = { elapsedMs: 0, mediaTime: 0, width: 640, height: 360, bufferSeconds: 0, paused: false, stalled: false,
      droppedFrames: 0, durationSeconds: null, seekableStart: 0, seekableEnd: 60 };
    message(f.packet("sample", { sample: { ...sample, elapsedMs: NaN } }));
    message(f.packet("sample", { sample: { ...sample, droppedFrames: Infinity } })); expect(f.sample).not.toHaveBeenCalled();
    message(f.packet("sample", { sample: { ...sample, privateURL: source.url } }));
    expect(f.sample).toHaveBeenCalledExactlyOnceWith(sample);
  });
  it("sends cancellation for only the active seek and ignores stale replies", async () => {
    const f = fixture(); message(f.packet("ready")); const controller = new AbortController();
    const seek = f.session.seek(40, controller.signal); await drain();
    const sent = iframe.contentWindow.postMessage.mock.calls[0]![0]; controller.abort();
    expect(iframe.contentWindow.postMessage).toHaveBeenLastCalledWith(f.packet("cancel", { operationId: sent.operationId }), origin);
    const cancelled = { status: "cancelled", failureCode: "aborted", latencyMs: null, targetSeconds: 40, buffered: false, frameCallbackAvailable: true };
    message(f.packet("response", { operationId: sent.operationId, result: cancelled })); expect(await seek).toEqual(cancelled);
  });
});
