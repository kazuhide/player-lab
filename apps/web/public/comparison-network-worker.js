/* Opt-in media delivery demo. This is not a network emulator or an HTTP cache. */
const sessions = new Map();
const MAX_CHUNK = 16 * 1024;
const MAX_UPSTREAM_CHUNK = 2 * 1024 * 1024;
const LEASE_MS = 6000;
const scope = new URL(self.registration.scope);
const base = new URL("./", scope);
const mediaExtension = /\.(?:m3u8|mpd|m4s|mp4|m4a|aac|ts|cmfv|cmfa|vtt)$/i;

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
// Registration scope is the runner document, not the surrounding Web application.
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function snapshot(state) {
  return { support: state.reason ? "unsupported" : "ready", ...(state.reason ? { reason: state.reason } : {}),
    rateBytesPerSecond: state.rate, shapedResponses: state.shaped, deliveredBytes: state.bytes,
    skippedResponses: state.skipped };
}
function notify(state) { state.port.postMessage({ type: "status", status: snapshot(state) }); }
function unsupported(state, reason) { state.reason = reason; state.skipped += 1; notify(state); }
function abortError() { return new DOMException("The network demo ended.", "AbortError"); }
function stop(state) {
  if (state.closed) return;
  state.closed = true; clearTimeout(state.timer); clearTimeout(state.leaseTimer);
  state.pending.splice(0).forEach((item) => item.reject(abortError()));
  state.requests.forEach((controller) => controller.abort());
  state.requests.clear(); sessions.delete(state.id); state.port.close();
}
function renew(state) {
  state.expires = Date.now() + LEASE_MS;
  clearTimeout(state.leaseTimer); state.leaseTimer = setTimeout(() => stop(state), LEASE_MS);
}
function pump(state) {
  clearTimeout(state.timer);
  if (state.closed) return;
  if (Date.now() > state.expires) { stop(state); return; }
  const now = performance.now();
  state.credit = state.rate === null ? MAX_CHUNK
    : Math.min(MAX_CHUNK, state.credit + Math.max(0, now - state.last) * state.rate / 1000);
  state.last = now;
  while (state.pending.length && (state.rate === null || state.pending[0].size <= state.credit)) {
    const item = state.pending.shift();
    if (state.rate !== null) state.credit -= item.size;
    item.resolve();
  }
  if (state.pending.length) {
    const delay = Math.max(1, Math.min(50, (state.pending[0].size - state.credit) / state.rate * 1000));
    state.timer = setTimeout(() => pump(state), delay);
  }
}
function reserve(state, size, signal) {
  if (state.closed || signal.aborted) return Promise.reject(abortError());
  if (state.pending.length >= 32) return Promise.reject(new Error("Network demo queue limit."));
  return new Promise((resolve, reject) => {
    const item = { size, resolve: () => { signal.removeEventListener("abort", cancel); resolve(); },
      reject: (error) => { signal.removeEventListener("abort", cancel); reject(error); } };
    const cancel = () => { const index = state.pending.indexOf(item); if (index >= 0) state.pending.splice(index, 1); item.reject(abortError()); pump(state); };
    signal.addEventListener("abort", cancel, { once: true });
    state.pending.push(item); pump(state);
  });
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "player-lab-network-prepare" || !event.ports[0] || !event.source?.id) return;
  event.waitUntil((async () => {
    const client = await self.clients.get(event.source.id);
    if (!client || client.type !== "window") return;
    const url = new URL(client.url);
    if (url.origin !== scope.origin || url.pathname !== scope.pathname
      || !/\/demo-runner\.html$/.test(url.pathname) || url.searchParams.get("demo") !== "1") return;
    const port = event.ports[0];
    if (sessions.has(client.id)) stop(sessions.get(client.id));
    const state = { id: client.id, port, rate: null, credit: 0, last: performance.now(),
      expires: Date.now() + LEASE_MS, pending: [], requests: new Set(), shaped: 0, bytes: 0,
      skipped: 0, closed: false, reason: null, timer: undefined, leaseTimer: undefined };
    sessions.set(client.id, state); renew(state);
    port.onmessage = ({ data }) => {
      if (state.closed || !Number.isSafeInteger(data?.id)) return;
      if (data.type === "dispose") { port.postMessage({ id: data.id, status: snapshot(state) }); stop(state); return; }
      if (data.type === "rate") {
        if (data.value !== null && (!Number.isFinite(data.value) || data.value < 1024 || data.value > 125000000)) return;
        renew(state); state.rate = data.value; state.credit = 0; state.last = performance.now(); pump(state);
      } else if (data.type === "heartbeat") renew(state);
      else return;
      port.postMessage({ id: data.id, status: snapshot(state) });
    };
    port.start(); port.postMessage({ type: "ready", status: snapshot(state) });
  })());
});

async function deliver(event, state) {
  const request = event.request;
  const url = new URL(request.url);
  const extension = mediaExtension.test(url.pathname);
  const localMedia = url.origin === base.origin && url.pathname.startsWith(new URL("media/", base).pathname);
  if (!extension) {
    if (localMedia) unsupported(state, "unclassified-media");
    return fetch(request);
  }
  if (state.requests.size >= 8) { unsupported(state, "stream-limit"); return fetch(request); }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  state.requests.add(controller);
  let reader;
  const finish = (passthrough = false) => {
    state.requests.delete(controller);
    if (!passthrough) request.signal.removeEventListener("abort", cancel);
  };
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.type === "opaque" || response.type === "opaqueredirect") {
      unsupported(state, "opaque-media"); finish(true); return response;
    }
    if (!response.ok || !response.body || response.redirected) {
      unsupported(state, "unreadable-media"); finish(true); return response;
    }
    const mime = (response.headers.get("content-type") || "").split(";")[0].trim();
    if (mime && !/^(?:video\/|audio\/|application\/(?:octet-stream|vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)|text\/vtt)/i.test(mime)) {
      unsupported(state, "unclassified-media"); finish(true); return response;
    }
    reader = response.body.getReader();
    let chunk = null; let offset = 0;
    const stream = new ReadableStream({
      async pull(output) {
        try {
          if (state.closed || controller.signal.aborted || Date.now() > state.expires) throw abortError();
          if (!chunk || offset === chunk.byteLength) {
            const value = await reader.read();
            if (value.done) { output.close(); finish(); return; }
            chunk = value.value; offset = 0;
            if (!(chunk instanceof Uint8Array) || chunk.byteLength > MAX_UPSTREAM_CHUNK) {
              unsupported(state, "stream-limit"); throw new Error("Network demo chunk limit.");
            }
          }
          const size = Math.min(MAX_CHUNK, chunk.byteLength - offset);
          await reserve(state, size, controller.signal);
          if (state.closed || controller.signal.aborted) throw abortError();
          output.enqueue(chunk.slice(offset, offset + size)); offset += size;
          state.bytes += size;
        } catch (error) { output.error(error); controller.abort(); void reader.cancel().catch(() => {}); finish(); }
      },
      cancel() { controller.abort(); finish(); return reader.cancel().catch(() => {}); },
    }, { highWaterMark: 0 });
    const headers = new Headers(response.headers);
    // Fetch exposes decoded bytes; retaining wire encoding/length would describe a different body.
    headers.delete("content-encoding"); headers.delete("content-length");
    state.shaped += 1; notify(state);
    return new Response(stream, { status: response.status, statusText: response.statusText, headers });
  } catch (error) { finish(); throw error; }
}

self.addEventListener("fetch", (event) => {
  const state = sessions.get(event.clientId);
  if (!state || state.closed || state.rate === null || event.request.method !== "GET") return;
  if (Date.now() > state.expires) { stop(state); return; }
  if (event.request.destination && !["video", "audio", "track"].includes(event.request.destination)) return;
  const url = new URL(event.request.url);
  const localMedia = url.origin === base.origin && url.pathname.startsWith(new URL("media/", base).pathname);
  if (!mediaExtension.test(url.pathname) && !localMedia) return;
  // All requests attributed to this client share one budget, including concurrent audio/video.
  event.respondWith(deliver(event, state));
});
