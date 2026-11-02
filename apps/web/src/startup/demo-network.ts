export type DemoNetworkReason = "no-service-worker" | "insecure-context" | "wrong-document"
  | "registration-failed" | "worker-timeout" | "opaque-media" | "unclassified-media"
  | "unreadable-media" | "stream-limit";

export interface DemoNetworkStatus {
  support: "ready" | "unsupported" | "disposed";
  reason?: DemoNetworkReason;
  rateBytesPerSecond: number | null;
  shapedResponses: number;
  deliveredBytes: number;
  skippedResponses: number;
}
export interface DemoNetworkController {
  readonly status: DemoNetworkStatus;
  setRate(bytesPerSecond: number | null): Promise<void>;
  dispose(): Promise<void>;
}

const reasons = new Set<DemoNetworkReason>(["no-service-worker", "insecure-context", "wrong-document",
  "registration-failed", "worker-timeout", "opaque-media", "unclassified-media", "unreadable-media", "stream-limit"]);
function validStatus(value: unknown): value is DemoNetworkStatus {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return ["ready", "unsupported"].includes(data.support as string)
    && (data.reason === undefined || reasons.has(data.reason as DemoNetworkReason))
    && (data.rateBytesPerSecond === null || typeof data.rateBytesPerSecond === "number"
      && Number.isFinite(data.rateBytesPerSecond) && data.rateBytesPerSecond >= 1024 && data.rateBytesPerSecond <= 125000000)
    && ["shapedResponses", "deliveredBytes", "skippedResponses"].every((key) =>
      Number.isSafeInteger(data[key]) && (data[key] as number) >= 0);
}

/** Explicitly opt this demo document into response-body pacing, never a benchmark or global proxy. */
export async function prepareDemoNetwork(options: {
  onStatus?: (status: DemoNetworkStatus) => void;
  signal?: AbortSignal;
} = {}): Promise<DemoNetworkController> {
  let status: DemoNetworkStatus = { support: "ready", rateBytesPerSecond: null,
    shapedResponses: 0, deliveredBytes: 0, skippedResponses: 0 };
  let disposed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let port: MessagePort | undefined;
  let sequence = 0;
  let cancelPreparation: (() => void) | undefined;
  const pending = new Map<number, { resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
  const update = (next: DemoNetworkStatus) => {
    status = { support: next.support, ...(next.reason ? { reason: next.reason } : {}),
      rateBytesPerSecond: next.rateBytesPerSecond, shapedResponses: next.shapedResponses,
      deliveredBytes: next.deliveredBytes, skippedResponses: next.skippedResponses };
    try { options.onStatus?.({ ...status }); } catch { /* A view callback cannot own transport cleanup. */ }
  };
  const fail = (reason: DemoNetworkReason) => update({ ...status, support: "unsupported", reason });
  const request = (type: string, value?: number | null): Promise<void> => new Promise((resolve, reject) => {
    if (!port) { reject(new Error("Network demo worker is unavailable.")); return; }
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Network demo worker deadline.")); }, 2000);
    pending.set(id, { resolve, reject: () => reject(new Error("Network demo disposed.")), timer });
    port.postMessage({ type, id, ...(type === "rate" ? { value } : {}) });
  });
  const controller: DemoNetworkController = {
    get status() { return { ...status }; },
    async setRate(value) {
      if (value !== null && (!Number.isFinite(value) || value < 1024 || value > 125000000)) {
        throw new RangeError("The demo delivery rate must be 1024–125000000 bytes per second or null.");
      }
      if (disposed || !port || (value !== null && status.support !== "ready")) {
        throw new Error("Network demo shaping is unavailable.");
      }
      try {
        await request("rate", value);
        if (status.rateBytesPerSecond !== value) throw new Error("Network demo rate was not acknowledged.");
      } catch (error) { fail("worker-timeout"); await controller.dispose(); throw error; }
    },
    async dispose() {
      if (disposed) return;
      disposed = true; clearInterval(heartbeat);
      update({ ...status, support: "disposed", rateBytesPerSecond: null });
      window.removeEventListener("pagehide", onPageHide);
      options.signal?.removeEventListener("abort", onPageHide);
      cancelPreparation?.();
      if (port) { try { await request("dispose"); } catch { /* The worker also expires abandoned client leases. */ } }
      pending.forEach((entry) => { clearTimeout(entry.timer); entry.reject(); }); pending.clear();
      port?.close(); port = undefined;
      update({ ...status, support: "disposed", rateBytesPerSecond: null });
    },
  };
  const onPageHide = () => { void controller.dispose(); };
  const url = new URL(location.href);
  if (!/\/demo-runner\.html$/.test(url.pathname) || url.searchParams.get("demo") !== "1") {
    fail("wrong-document"); return controller;
  }
  if (!window.isSecureContext) { fail("insecure-context"); return controller; }
  if (!("serviceWorker" in navigator) || typeof MessageChannel === "undefined") {
    fail("no-service-worker"); return controller;
  }
  window.addEventListener("pagehide", onPageHide, { once: true });
  options.signal?.addEventListener("abort", onPageHide, { once: true });
  if (options.signal?.aborted) { await controller.dispose(); return controller; }
  try {
    const workerUrl = new URL("comparison-network-worker.js", url);
    // Exact document-prefix scope leaves index.html and the comparison parent uncontrolled.
    const registration = await bounded(navigator.serviceWorker.register(workerUrl.href, {
      scope: new URL(url.pathname, url.origin).href, updateViaCache: "none",
    }));
    if (disposed) return controller;
    const worker = await controlledWorker(workerUrl.href, registration);
    if (disposed) return controller;
    const channel = new MessageChannel(); port = channel.port1;
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Network demo worker deadline.")), 5000);
      cancelPreparation = () => { clearTimeout(timer); reject(new Error("Network demo disposed.")); };
      port!.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (typeof data !== "object" || data === null) return;
        const packet = data as { type?: string; id?: number; status?: unknown };
        if (!validStatus(packet.status)) return;
        if (!disposed) update(packet.status);
        if (packet.type === "ready" && !disposed) { clearTimeout(timer); cancelPreparation = undefined; resolve(); }
        else if (typeof packet.id === "number") {
          const entry = pending.get(packet.id);
          if (entry) { clearTimeout(entry.timer); pending.delete(packet.id); entry.resolve(); }
        }
      };
    });
    port.start(); worker.postMessage({ type: "player-lab-network-prepare" }, [channel.port2]);
    await ready;
    let inFlight = false;
    heartbeat = setInterval(() => {
      if (inFlight || disposed) return;
      inFlight = true;
      void request("heartbeat").catch(() => {
        fail("worker-timeout"); void controller.dispose();
      }).finally(() => { inFlight = false; });
    }, 1000);
  } catch {
    if (!disposed) {
      port?.close(); port = undefined; fail("registration-failed");
      window.removeEventListener("pagehide", onPageHide);
      options.signal?.removeEventListener("abort", onPageHide);
    }
  }
  return controller;
}

function bounded<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Network demo preparation deadline.")), 5000);
    operation.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}
function controlledWorker(script: string, registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  return new Promise((resolve, reject) => {
    const container = navigator.serviceWorker;
    let observed: ServiceWorker | null = null;
    const clean = () => {
      clearTimeout(timer); container.removeEventListener("controllerchange", check);
      observed?.removeEventListener("statechange", check);
    };
    const check = () => {
      const worker = container.controller;
      const candidate = worker?.scriptURL === script ? worker : null;
      if (candidate !== observed) {
        observed?.removeEventListener("statechange", check);
        observed = candidate;
        observed?.addEventListener("statechange", check);
      }
      if (candidate?.state === "activated") { clean(); resolve(candidate); }
    };
    const timer = setTimeout(() => { clean(); reject(new Error("Network demo control deadline.")); }, 5000);
    container.addEventListener("controllerchange", check);
    registration.active?.postMessage({ type: "player-lab-network-control" });
    check();
  });
}
