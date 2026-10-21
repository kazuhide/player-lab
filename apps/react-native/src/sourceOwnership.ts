import type { Player, Source, SourceConfig } from "bitmovin-player-react-native";

type Host = Pick<Player, "source" | "load" | "loadSource" | "unload" | "isDestroyed">;
interface Request {
  host: Host;
  create: () => Source;
  source?: Source;
  initialized: boolean;
  cancelled: boolean;
  released: boolean;
  settled: boolean;
  result: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}
const owners = new WeakMap<Host, Request>();
const disposed = new WeakSet<Host>();
const waiting = new Set<Request>();
// Only one native Source initialization is allowed to remain unresolved in this process.
let initializing = false;
let pumping = false;

function current(request: Request): boolean {
  return !request.cancelled && !disposed.has(request.host) && !request.host.isDestroyed && owners.get(request.host) === request;
}
function settle(request: Request, error?: unknown): void {
  if (request.settled) return;
  request.settled = true;
  if (error !== undefined) request.reject(error); else request.resolve();
}
function release(request: Request): void {
  if (!request.source || !request.initialized || request.released) return;
  request.released = true;
  if (!request.source.isDestroyed) request.source.destroy();
}

/** Restore the exact own-property descriptor even when a synchronous SDK call throws or reenters. */
function scopedMethod<T extends object, K extends keyof T, R>(target: T, key: K, replacement: T[K], run: () => R): R {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor && (!("value" in descriptor) || !descriptor.writable)) throw new Error("The SDK method cannot be scoped safely.");
  Object.defineProperty(target, key, { ...(descriptor ?? { configurable: true, enumerable: true, writable: true }), value: replacement });
  try { return run(); }
  finally {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
}

/** Capture the real Source constructed by Player.load without starting an unfenced SDK continuation. */
function captureLoad(host: Host, configuration: SourceConfig): Source {
  let captured: Source | undefined;
  const capture = (source: Source): void => {
    if (captured) throw new Error("The installed Player.load created more than one source.");
    captured = source;
  };
  try { scopedMethod(host, "loadSource", capture, () => host.load(configuration)); }
  catch (error) { captured?.destroy(); throw error; }
  if (!captured) throw new Error("The installed Player.load did not provide a Source.");
  return captured;
}

/** Guard the actual SDK .then(native loadSource) invocation, including same-tick retirement. */
function attach(request: Request, source: Source): void {
  const completed = Promise.resolve();
  const then = completed.then.bind(completed);
  completed.then = function<TResult1 = void, TResult2 = never>(
    fulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const guarded = then<TResult1, TResult2>(fulfilled ? (value) => {
      if (!current(request)) { release(request); settle(request); return new Promise<never>(() => {}); }
      try {
        const result = fulfilled(value);
        void Promise.resolve(result).then(() => settle(request), (error) => fail(request, error));
        return result;
      } catch (error) { fail(request, error); throw error; }
    } : fulfilled, rejected);
    // SDK 1.29 ignores this chain. Its failures are surfaced through the managed request instead.
    void guarded.catch(() => {});
    return guarded;
  };
  scopedMethod(source, "initialize", () => completed, () => request.host.loadSource(source));
}

function fail(request: Request, error: unknown): void {
  if (owners.get(request.host) === request) {
    owners.delete(request.host);
    request.host.unload();
    if (request.host.source === request.source) delete request.host.source;
  }
  release(request);
  settle(request, request.cancelled ? undefined : error);
}

function pump(): void {
  if (initializing || pumping) return;
  pumping = true;
  try {
    while (!initializing && waiting.size) {
      const request = waiting.values().next().value!;
      waiting.delete(request);
      if (!current(request)) { settle(request); continue; }
      let source: Source;
      try { source = request.create(); request.source = source; }
      catch (error) { if (owners.get(request.host) === request) owners.delete(request.host); settle(request, error); continue; }
      if (!current(request)) {
        request.initialized = true; release(request); settle(request); continue;
      }
      request.host.source = source;
      initializing = true;
      let initialization: Promise<void>;
      try { initialization = source.initialize(); }
      catch (error) { initialization = Promise.reject(error); }
      void initialization.then(() => {
        request.initialized = true;
        if (current(request)) attach(request, source);
        else { release(request); settle(request); }
      }, (error) => { request.initialized = true; fail(request, error); }).catch((error) => fail(request, error)).finally(() => {
        initializing = false;
        pump();
      });
    }
  } finally { pumping = false; }
}

/** Retire pending work synchronously; native Source destruction waits for initialization settlement. */
function retire(host: Host): void {
  const request = owners.get(host);
  if (request) {
    request.cancelled = true;
    owners.delete(host);
    waiting.delete(request);
    settle(request);
  }
  const previous = host.source;
  if (request || previous) host.unload();
  if (previous && host.source === previous) delete host.source;
  if (request) release(request);
  // Sources created outside this adapter are already owned by the caller; do not guess at a pending initializer.
  if (previous && previous !== request?.source && previous.isInitialized && !previous.isDestroyed) previous.destroy();
}
function enqueue(host: Host, create: () => Source): Promise<void> {
  if (disposed.has(host) || host.isDestroyed) return Promise.reject(new Error("The previous player has been retired."));
  retire(host);
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
  const request: Request = { host, create, initialized: false, cancelled: false, released: false, settled: false, result, resolve, reject };
  owners.set(host, request); waiting.add(request);
  pump();
  return result;
}

/** Call the real SDK Player.load while retaining its exact constructed Source identity. */
export function loadOwnedSource(host: Host, source: SourceConfig): Promise<void> {
  return enqueue(host, () => captureLoad(host, source));
}
export function loadOwnedSourceInstance(host: Host, create: () => Source): Promise<void> {
  return enqueue(host, create);
}
export function initializeOwnedSource(host: Host): Promise<void> {
  const request = owners.get(host);
  if (request && !request.settled) return request.result;
  if (!host.source) return Promise.reject(new Error("Load a source first."));
  return host.source.initialize();
}
export function unloadOwnedSource(host: Host): void {
  const hadSource = owners.has(host) || Boolean(host.source);
  retire(host);
  if (!hadSource) host.unload();
}
export function disposeOwnedSources(host: Host): void {
  disposed.add(host); retire(host);
}

export const unloadSourceCode = 'import { unloadOwnedSource } from "./src/sourceOwnership";\nunloadOwnedSource(player);';
