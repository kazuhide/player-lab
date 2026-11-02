import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareDemoNetwork } from "../src/startup/demo-network";

const workerSource = readFileSync(new URL("../public/comparison-network-worker.js", import.meta.url), "utf8");
type Packet = { type?: string; id?: number; status?: { support: string; reason?: string; rateBytesPerSecond: number | null; shapedResponses: number; deliveredBytes: number; skippedResponses: number } };
function harness() {
  const events = new Map<string, (event: any) => void>();
  const packets: Packet[] = [];
  const port = { postMessage: (packet: Packet) => packets.push(packet), start: vi.fn(), close: vi.fn(), onmessage: null as null | ((event: { data: unknown }) => void) };
  const clients = new Map([["demo", { id: "demo", type: "window", url: "https://test.invalid/player-lab/web/demo-runner.html?demo=1" }],
    ["benchmark", { id: "benchmark", type: "window", url: "https://test.invalid/player-lab/web/comparison-runner.html" }],
    ["app", { id: "app", type: "window", url: "https://test.invalid/player-lab/web/index.html?demo=1" }]]);
  const network = vi.fn(async () => new Response(new Uint8Array(1024), { headers: { "Content-Type": "video/mp4", "Content-Length": "1024" } }));
  runInContext(workerSource, createContext({ self: { registration: { scope: "https://test.invalid/player-lab/web/demo-runner.html" },
    clients: { get: async (id: string) => clients.get(id), claim: vi.fn() }, skipWaiting: vi.fn(), addEventListener: (name: string, cb: (event: any) => void) => events.set(name, cb) },
    URL, Headers, Response, ReadableStream, Uint8Array, DOMException, AbortController, Date,
    performance: { now: () => Date.now() }, setTimeout, clearTimeout, fetch: network }));
  let sequence = 0;
  return { network, port, packets,
    async prepare(id = "demo") { let pending: Promise<unknown> | undefined; events.get("message")!({ data: { type: "player-lab-network-prepare" }, source: { id }, ports: [port], waitUntil: (p: Promise<unknown>) => { pending = p; } }); await pending; },
    command(type: string, value?: number | null) { port.onmessage?.({ data: { type, value, id: ++sequence } }); },
    fetch(url = "https://test.invalid/player-lab/web/media/test.m4s", clientId = "demo", options: RequestInit = {}) {
      let response: Promise<Response> | undefined;
      events.get("fetch")!({ request: new Request(url, options), clientId, respondWith: (p: Promise<Response>) => { response = p; } });
      return response;
    },
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("real response-body pacing worker (synthetic streams, not a browser)", () => {
  it.each(["app", "benchmark"])("refuses opt-in from %s and never intercepts its requests", async (id) => {
    const h = harness(); await h.prepare(id); expect(h.packets).toEqual([]);
    expect(h.fetch(undefined, id)).toBeUndefined(); expect(h.network).not.toHaveBeenCalled();
  });
  it("is inactive until opted-in and explicitly rate-enabled; SDK/license/POST stay outside fetch interception", async () => {
    const h = harness(); expect(h.fetch()).toBeUndefined(); await h.prepare(); expect(h.fetch()).toBeUndefined();
    h.command("rate", 1024);
    expect(h.fetch("https://test.invalid/sdk.js")).toBeUndefined();
    expect(h.fetch("https://test.invalid/license")).toBeUndefined();
    expect(h.fetch(undefined, "demo", { method: "POST" })).toBeUndefined();
    expect(h.network).not.toHaveBeenCalled();
  });
  it("shares one aggregate byte budget across concurrent media GETs and preserves backpressure", async () => {
    const h = harness(); await h.prepare(); h.command("rate", 1024);
    const [a, b] = await Promise.all([h.fetch()!, h.fetch()!]);
    const ar = a.body!.getReader(); const br = b.body!.getReader();
    const results: number[] = [];
    const first = ar.read().then((x) => results.push(x.value!.byteLength));
    const second = br.read().then((x) => results.push(x.value!.byteLength));
    await vi.advanceTimersByTimeAsync(999); expect(results).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); expect(results).toEqual([1024]);
    await vi.advanceTimersByTimeAsync(1000); await Promise.all([first, second]); expect(results).toEqual([1024, 1024]);
    expect(a.headers.has("content-length")).toBe(false);
    h.command("heartbeat"); expect(h.packets[h.packets.length - 1]!.status).toMatchObject({ shapedResponses: 2, deliveredBytes: 2048 });
    await ar.cancel(); await br.cancel(); h.command("dispose");
  });
  it("applies good/drop/recover rates to actual chunks of the same body", async () => {
    const h = harness(); await h.prepare();
    h.network.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(output) {
      for (let i = 0; i < 3; i += 1) output.enqueue(new Uint8Array(1024)); output.close();
    } }), { headers: { "Content-Type": "video/mp4" } }));
    h.command("rate", 4096); const reader = (await h.fetch()!).body!.getReader();
    for (const [rate, duration] of [[4096, 250], [1024, 1000], [4096, 250]]) {
      h.command("rate", rate); let completed = false;
      const read = reader.read().then((value) => { completed = true; expect(value.value!.byteLength).toBe(1024); });
      await vi.advanceTimersByTimeAsync(duration! - 1); expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1); await read; expect(completed).toBe(true);
    }
    h.command("heartbeat"); expect(h.packets[h.packets.length - 1]!.status!.deliveredBytes).toBe(3072);
    await reader.cancel(); h.command("dispose");
  });
  it("propagates request abort and retains partial-response status/range without rewriting credentials", async () => {
    const h = harness(); await h.prepare(); h.command("rate", 1024);
    h.network.mockResolvedValueOnce(new Response(new Uint8Array(1024), { status: 206,
      headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-1023/2048" } }));
    const abort = new AbortController(); const response = await h.fetch(undefined, "demo", { signal: abort.signal, credentials: "omit" })!;
    expect(response.status).toBe(206); expect(response.headers.get("content-range")).toBe("bytes 0-1023/2048");
    expect((h.network.mock.calls[0] as unknown as [Request])[0].credentials).toBe("omit");
    const pending = expect(response.body!.getReader().read()).rejects.toThrow(); await Promise.resolve(); abort.abort(); await pending;
    h.command("dispose"); expect(vi.getTimerCount()).toBe(0);
  });
  it("fails a bounded oversized upstream chunk explicitly and cancels an abandoned active stream", async () => {
    const h = harness(); await h.prepare(); h.command("rate", 1024);
    h.network.mockResolvedValueOnce(new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { "Content-Type": "video/mp4" } }));
    await expect((await h.fetch()!).body!.getReader().read()).rejects.toThrow("chunk limit");
    expect(h.packets[h.packets.length - 1]!.status).toMatchObject({ reason: "stream-limit", deliveredBytes: 0 });
    h.network.mockResolvedValueOnce(new Response(new Uint8Array(16 * 1024), { headers: { "Content-Type": "video/mp4" } }));
    const pending = expect((await h.fetch()!).body!.getReader().read()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(6051); await pending; expect(h.port.close).toHaveBeenCalledOnce();
  });
  it("changes the same live stream rate and null releases pending delivery without a new fetch", async () => {
    const h = harness(); await h.prepare(); h.command("rate", 1024);
    const response = await h.fetch()!; const reader = response.body!.getReader(); let read = false;
    const pending = reader.read().then(() => { read = true; });
    await vi.advanceTimersByTimeAsync(200); expect(read).toBe(false);
    h.command("rate", null); await pending; expect(read).toBe(true); expect(h.network).toHaveBeenCalledTimes(1);
    await reader.cancel(); h.command("dispose");
  });
  it("aborts an owned paced body on disposal, keeps other clients untouched and removes the opt-in", async () => {
    const h = harness(); await h.prepare(); h.command("rate", 1024);
    const response = await h.fetch()!; const pending = expect(response.body!.getReader().read()).rejects.toThrow();
    await Promise.resolve(); h.command("dispose"); await pending;
    expect(h.port.close).toHaveBeenCalledOnce(); expect(h.fetch()).toBeUndefined();
    expect(h.fetch(undefined, "app")).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  });
  it("marks opaque and extensionless controlled media unsupported rather than inventing delivery", async () => {
    const h = harness(); await h.prepare(); h.command("rate", 1024);
    const opaque = { type: "opaque" } as Response; h.network.mockResolvedValueOnce(opaque);
    expect(await h.fetch()!).toBe(opaque);
    expect(h.packets[h.packets.length - 1]!.status).toMatchObject({ support: "unsupported", reason: "opaque-media", shapedResponses: 0, deliveredBytes: 0, skippedResponses: 1 });
    await h.fetch("https://test.invalid/player-lab/web/media/extensionless")!;
    expect(h.packets[h.packets.length - 1]!.status).toMatchObject({ support: "unsupported", reason: "unclassified-media", shapedResponses: 0, skippedResponses: 2 });
    expect(JSON.stringify(h.packets)).not.toContain("https:"); h.command("dispose");
  });
  it("bounds abandoned opt-ins by lease and does not accept invalid rates", async () => {
    const h = harness(); await h.prepare(); h.command("rate", -1); expect(h.packets[h.packets.length - 1]!.status!.rateBytesPerSecond).toBeNull();
    h.command("rate", 1024); await vi.advanceTimersByTimeAsync(6001);
    expect(h.fetch()).toBeUndefined(); expect(h.port.close).toHaveBeenCalledOnce();
  });
});

function controllerFixture() {
  const surface = new EventTarget();
  Object.assign(surface, { isSecureContext: true });
  const sourceUrl = new URL("https://test.invalid/player-lab/web/demo-runner.html?demo=1");
  let currentRate: number | null = null;
  let unsupported = false;
  let workerPort: any;
  const status = () => ({ support: unsupported ? "unsupported" : "ready", ...(unsupported ? { reason: "opaque-media" } : {}), rateBytesPerSecond: currentRate, shapedResponses: 0, deliveredBytes: 0, skippedResponses: 0,
    privateUrl: "https://never-export.invalid/private-media" });
  const worker = Object.assign(new EventTarget(), { state: "activated", scriptURL: "https://test.invalid/player-lab/web/comparison-network-worker.js",
    postMessage: vi.fn((data: { type: string }, ports?: any[]) => {
      if (data.type !== "player-lab-network-prepare") return;
      workerPort = ports![0];
      workerPort.onmessage = ({ data: packet }: { data: { type: string; value: number | null; id: number } }) => {
        if (packet.type === "rate") currentRate = packet.value;
        workerPort.postMessage({ id: packet.id, status: status() });
      };
      workerPort.postMessage({ type: "ready", status: status() });
    }) });
  const container = Object.assign(new EventTarget(), { controller: worker, register: vi.fn(async () => ({ active: worker })) });
  const ports: any[] = [];
  class Channel {
    port1: any; port2: any;
    constructor() {
      const left: any = { onmessage: null, start: vi.fn(), close: vi.fn() };
      const right: any = { onmessage: null, start: vi.fn(), close: vi.fn() };
      left.postMessage = (data: unknown) => queueMicrotask(() => right.onmessage?.({ data }));
      right.postMessage = (data: unknown) => queueMicrotask(() => left.onmessage?.({ data }));
      this.port1 = left; this.port2 = right; ports.push(left, right);
    }
  }
  vi.stubGlobal("window", surface); vi.stubGlobal("location", sourceUrl);
  vi.stubGlobal("navigator", { serviceWorker: container }); vi.stubGlobal("MessageChannel", Channel);
  return { surface, container, worker, ports, unsupported() {
    unsupported = true; workerPort.postMessage({ type: "status", status: status() });
  } };
}

describe("runner opt-in controller", () => {
  it.each(["https://test.invalid/index.html?demo=1", "https://test.invalid/comparison-runner.html"])("does not register outside explicit demo runner %s", async (url) => {
    const register = vi.fn(); vi.stubGlobal("location", new URL(url)); vi.stubGlobal("navigator", { serviceWorker: { register } });
    const c = await prepareDemoNetwork(); expect(c.status).toMatchObject({ support: "unsupported", reason: "wrong-document" }); expect(register).not.toHaveBeenCalled();
  });
  it("never registers a worker for the legacy comparison runner even with demo=1", async () => {
    const register = vi.fn().mockRejectedValue(new Error("must not register"));
    vi.stubGlobal("window", Object.assign(new EventTarget(), { isSecureContext: true }));
    vi.stubGlobal("location", new URL("https://test.invalid/comparison-runner.html?demo=1"));
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const controller = await prepareDemoNetwork();
    expect(controller.status).toMatchObject({ support: "unsupported", reason: "wrong-document" });
    expect(register).not.toHaveBeenCalled();
  });
  it("registers only the runner scope, awaits actual control/handshake, updates rate and cleans pagehide", async () => {
    const f = controllerFixture(); const updates: unknown[] = [];
    const c = await prepareDemoNetwork({ onStatus: (value) => updates.push(value) });
    expect(c.status.support).toBe("ready");
    expect(f.container.register).toHaveBeenCalledExactlyOnceWith(
      "https://test.invalid/player-lab/web/comparison-network-worker.js",
      { scope: "https://test.invalid/player-lab/web/demo-runner.html", updateViaCache: "none" });
    await c.setRate(31250); expect(c.status.rateBytesPerSecond).toBe(31250);
    await c.setRate(null); expect(c.status.rateBytesPerSecond).toBeNull();
    expect(JSON.stringify(updates)).not.toContain("private-media");
    f.surface.dispatchEvent(new Event("pagehide")); await vi.advanceTimersByTimeAsync(0);
    expect(c.status.support).toBe("disposed"); expect(f.ports[0].close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    await c.dispose(); await expect(c.setRate(1024)).rejects.toThrow("unavailable");
  });
  it("observes cold controller activation without requiring a second controllerchange", async () => {
    const f = controllerFixture(); f.worker.state = "activating";
    (f.container as any).controller = null;
    const removed = vi.spyOn(f.worker, "removeEventListener");
    const operation = prepareDemoNetwork();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    f.container.controller = f.worker; f.container.dispatchEvent(new Event("controllerchange"));
    f.worker.state = "activated"; f.worker.dispatchEvent(new Event("statechange"));
    await vi.advanceTimersByTimeAsync(5000);
    const controller = await operation;
    expect(controller.status.support).toBe("ready");
    expect(f.worker.postMessage.mock.calls.filter(([packet]) => packet.type === "player-lab-network-prepare")).toHaveLength(1);
    expect(removed).toHaveBeenCalledWith("statechange", expect.any(Function));
    await controller.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it("removes both activation listeners at the original deadline and ignores late activation", async () => {
    const f = controllerFixture(); f.worker.state = "activating";
    const workerRemoved = vi.spyOn(f.worker, "removeEventListener");
    const containerRemoved = vi.spyOn(f.container, "removeEventListener");
    const operation = prepareDemoNetwork(); await vi.advanceTimersByTimeAsync(5000);
    const controller = await operation;
    expect(controller.status).toMatchObject({ support: "unsupported", reason: "registration-failed" });
    expect(workerRemoved).toHaveBeenCalledWith("statechange", expect.any(Function));
    expect(containerRemoved).toHaveBeenCalledWith("controllerchange", expect.any(Function));
    f.worker.state = "activated"; f.worker.dispatchEvent(new Event("statechange"));
    expect(f.worker.postMessage.mock.calls.filter(([packet]) => packet.type === "player-lab-network-prepare")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases a positive rate after unsupported media without claiming support recovered", async () => {
    const f = controllerFixture(); const controller = await prepareDemoNetwork();
    await controller.setRate(1024); f.unsupported(); await Promise.resolve();
    expect(controller.status).toMatchObject({ support: "unsupported", reason: "opaque-media", rateBytesPerSecond: 1024 });
    await expect(controller.setRate(2048)).rejects.toThrow("unavailable");
    await controller.setRate(null);
    expect(controller.status).toMatchObject({ support: "unsupported", reason: "opaque-media", rateBytesPerSecond: null });
    await controller.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not opt in after cancellation during registration", async () => {
    const f = controllerFixture(); const abort = new AbortController();
    let finish!: (value: { active: typeof f.worker }) => void;
    f.container.register.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const operation = prepareDemoNetwork({ signal: abort.signal }); abort.abort();
    finish({ active: f.worker }); const controller = await operation;
    expect(controller.status.support).toBe("disposed"); expect(f.worker.postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reports unavailable service workers and validates rates without fictitious counters", async () => {
    vi.stubGlobal("location", new URL("https://test.invalid/demo-runner.html?demo=1")); vi.stubGlobal("window", { isSecureContext: true }); vi.stubGlobal("navigator", {});
    const c = await prepareDemoNetwork(); expect(c.status).toMatchObject({ support: "unsupported", reason: "no-service-worker", shapedResponses: 0 });
    await expect(c.setRate(0)).rejects.toThrow(RangeError); await expect(c.setRate(1024)).rejects.toThrow("unavailable");
  });
});
