#!/usr/bin/env node
/**
 * Run after building apps/web. No build or package installation is performed.
 * Pass a prepared local media directory with --media-root and a fresh external
 * results directory with --output. Four rounds complete the Latin order block.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const compress = promisify(gzip);

const scriptFile = fileURLToPath(import.meta.url);
const repository = resolve(dirname(scriptFile), "../../..");
const dist = join(repository, "apps/web/dist");
const engines = ["web-x", "bitmovin-8", "shaka", "hls"];
const policies = ["on-demand", "metadata", "segments", "decoded"];
// Each complete four-round block balances positions and directed predecessors.
const latinRows = [[0, 1, 3, 2], [1, 2, 0, 3], [2, 3, 1, 0], [3, 0, 2, 1]];

function usage() {
  return `Usage: node tests/e2e/experiments/use-case-sweep.mjs --output EXTERNAL_DIRECTORY --media-root FIXTURE_DIRECTORY [options]
  --media-root DIRECTORY     Required directory containing comparison-360p.m3u8 and its complete local media closure
  --rounds N                 Repetitions per engine/cohort, default 1
  --policies LIST            on-demand,metadata,segments,decoded
  --warmups LIST             Preparation windows in ms, default 0,500
  --lookaheads LIST          Sources ahead (1..3), default 1,3
  --steps N                  Transitions per trial (1..12), default 2
  --response-delay-ms N      Fixed delay before each media response, default 0
  --media-mbps N             Only 0 (unlimited) is currently supported
  --download-mbps N          Whole-page CDP download cap, default 0 (unlimited)
  --latency-ms N             Whole-page CDP latency, default 0
  --cpu-rate N               CDP CPU slowdown rate (1..20), default 1
  --worker-enabled true|false hls.js worker configuration, default true
  --hls-metadata-detached true|false Defer hls.js metadata video's MSE attachment, default false
  --shaka-strategy pool|shared Per-source players or a shared preload player, default pool
  --cache disabled|managed   CDP/browser cache policy, default disabled
  --port N                   Owned IPv4 loopback server port, default 0 (assigned)
  --budget-ms N              Overall execution budget, default 900000
  --trial-timeout-ms N       Runner response deadline, maximum/default 45000
  --help                     Show this text
Results retain failed, unsupported, timed-out and budget-skipped trials. No retries.`;
}

function number(value, name, minimum, maximum, integer = false) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum || (integer && !Number.isInteger(result))) {
    throw new Error(`Invalid ${name}.`);
  }
  return result;
}

function argumentsFor(argv) {
  const values = new Map();
  const allowed = new Set(["output", "media-root", "rounds", "policies", "warmups", "lookaheads", "steps", "response-delay-ms",
    "media-mbps", "download-mbps", "latency-ms", "cpu-rate", "worker-enabled", "hls-metadata-detached", "shaka-strategy", "cache", "port", "budget-ms", "trial-timeout-ms"]);
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help") return null;
    const name = flag.startsWith("--") ? flag.slice(2) : "";
    if (!allowed.has(name) || values.has(name) || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("Invalid command-line options.");
    values.set(name, argv[++index]);
  }
  if (!values.get("output")) throw new Error("--output is mandatory and must be outside the repository.");
  if (!values.get("media-root")) throw new Error("--media-root is mandatory and must contain the complete local fixture.");
  const list = (name, fallback, parse) => {
    const items = (values.get(name) ?? fallback).split(",");
    if (items.length === 0 || items.some((item) => item.trim() === "")) throw new Error(`Invalid ${name}.`);
    const parsed = items.map((item) => parse(item.trim()));
    if (new Set(parsed).size !== parsed.length) throw new Error(`Duplicate ${name}.`);
    return parsed;
  };
  const selectedPolicies = list("policies", policies.join(","), (value) => {
    if (!policies.includes(value)) throw new Error("Invalid policies.");
    return value;
  });
  const cache = values.get("cache") ?? "disabled";
  if (!["disabled", "managed"].includes(cache)) throw new Error("Invalid cache policy.");
  const mediaMbps = number(values.get("media-mbps") ?? 0, "media-mbps", 0, 100000);
  if (mediaMbps !== 0) throw new Error("Shared media-only bandwidth limiting is not implemented; use --download-mbps for whole-page CDP shaping.");
  const worker = values.get("worker-enabled") ?? "true";
  const detached = values.get("hls-metadata-detached") ?? "false";
  const shakaStrategy = values.get("shaka-strategy") ?? "pool";
  if (!["true", "false"].includes(worker) || !["true", "false"].includes(detached)
    || !["pool", "shared"].includes(shakaStrategy)) throw new Error("Invalid player variant.");
  return {
    output: resolve(values.get("output")), mediaRoot: resolve(values.get("media-root")),
    rounds: number(values.get("rounds") ?? 1, "rounds", 1, 100, true),
    policies: selectedPolicies,
    warmups: list("warmups", "0,500", (value) => number(value, "warmups", 0, 10000)),
    lookaheads: list("lookaheads", "1,3", (value) => number(value, "lookaheads", 1, 3, true)),
    steps: number(values.get("steps") ?? 2, "steps", 1, 12, true),
    responseDelayMs: number(values.get("response-delay-ms") ?? 0, "response-delay-ms", 0, 30000),
    workerEnabled: worker === "true", hlsMetadataDetached: detached === "true", shakaStrategy,
    mediaMbps, downloadMbps: number(values.get("download-mbps") ?? 0, "download-mbps", 0, 100000),
    latencyMs: number(values.get("latency-ms") ?? 0, "latency-ms", 0, 30000),
    cpuRate: number(values.get("cpu-rate") ?? 1, "cpu-rate", 1, 20), cache,
    port: number(values.get("port") ?? 0, "port", 0, 65535, true),
    budgetMs: number(values.get("budget-ms") ?? 900000, "budget-ms", 1000, 43200000, true),
    trialTimeoutMs: number(values.get("trial-timeout-ms") ?? 45000, "trial-timeout-ms", 1000, 45000, true),
  };
}

const within = (base, target) => target === base || (!isAbsolute(relative(base, target)) && !relative(base, target).startsWith(`..${sep}`) && relative(base, target) !== "..");
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function hashFile(file) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest("hex") };
}

async function sdkVersions() {
  const contractText = await readFile(join(repository, "apps/web/src/startup/contract.ts"), "utf8");
  const constants = ["SDK_VERSIONS", "DEMO_SDK_VERSIONS"];
  const contract = {};
  for (const name of constants) {
    const block = contractText.match(new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\};`))?.[1];
    if (!block) throw new Error("SDK version contract is unavailable.");
    for (const match of block.matchAll(/(?:"([a-z0-9-]+)"|([a-z][a-z0-9-]*))\s*:\s*"([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?)"/g)) contract[match[1] ?? match[2]] = match[3];
  }
  const requireWeb = createRequire(join(repository, "apps/web/package.json"));
  const packages = { "web-x": "@bitmovin/player-web-x", "bitmovin-8": "bitmovin-player", shaka: "shaka-player", hls: "hls.js" };
  const result = {};
  for (const engine of engines) {
    const packageName = packages[engine];
    try {
      const metadata = JSON.parse(await readFile(join(repository, "apps/web/node_modules", packageName, "package.json"), "utf8"));
      if (metadata.name === packageName && typeof metadata.version === "string" && contract[engine]) {
        result[engine] = { contract: contract[engine], installed: metadata.version, matches: contract[engine] === metadata.version };
        continue;
      }
    } catch { /* Export maps can hide package.json; filesystem metadata is still read-only. */ }
    let location;
    try { location = requireWeb.resolve(`${packageName}/package.json`); }
    catch { location = requireWeb.resolve(packageName); }
    let current = dirname(location), installed = null;
    for (let depth = 0; depth < 12; depth++) {
      try {
        const metadata = JSON.parse(await readFile(join(current, "package.json"), "utf8"));
        if (metadata.name === packageName && typeof metadata.version === "string") { installed = metadata.version; break; }
      } catch { /* Continue toward the package root without exposing paths. */ }
      const parent = dirname(current); if (parent === current) break; current = parent;
    }
    if (!installed || !contract[engine]) throw new Error("Installed SDK version is unavailable.");
    result[engine] = { contract: contract[engine], installed, matches: contract[engine] === installed };
  }
  return { versions: result, contractSha256: digest(contractText) };
}

function safe(value, key = "", depth = 0) {
  if (depth > 20) return "[redacted-depth]";
  if (/^(?:key|licenseKey|license|token|secret|authorization|headers?|sourceUrls?|url|uri)$/i.test(key)) return "[redacted]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (/(?:https?|wss?|file|data|blob):/i.test(value) || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return "[redacted-location]";
    if (/<\?xml|<MPD\b|#EXTM3U/i.test(value)) return "[redacted-document]";
    return value.slice(0, 1024);
  }
  if (Array.isArray(value)) return value.map((item) => safe(item, "", depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, safe(item, name, depth + 1)]));
  return null;
}

function timeout(promise, milliseconds, code = "deadline") {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), Math.max(1, milliseconds)); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function sleep(milliseconds, signal) {
  return new Promise((resolvePromise, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new Error("cancelled")); };
    timer = setTimeout(() => { cleanup(); resolvePromise(); }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function byteCounts() {
  const category = () => ({ requests: 0, responses: 0, bodyBytes: 0, gzipResponses: 0, completedResponses: 0, abortedResponses: 0, statusCodes: {} });
  return { media: category(), javascript: category(), other: category() };
}

const contentTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm",
  ".m3u8": "application/vnd.apple.mpegurl", ".mpd": "application/dash+xml", ".ts": "video/mp2t",
  ".mp4": "video/mp4", ".m4s": "video/iso.segment", ".aac": "audio/aac", ".vtt": "text/vtt",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

async function safeFile(base, requested) {
  const parts = requested.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("invalid-path");
  if ((await lstat(base)).isSymbolicLink()) throw new Error("invalid-path");
  let file = base;
  for (const part of parts) {
    file = join(file, part);
    const information = await lstat(file);
    if (information.isSymbolicLink()) throw new Error("invalid-path");
  }
  if (!within(base, file)) throw new Error("invalid-path");
  const information = await lstat(file);
  if (!information.isFile()) throw new Error("invalid-path");
  return { file, size: information.size };
}

async function servingFile(pathname, mediaRoot) {
  const decoded = decodeURIComponent(pathname);
  if (!decoded.startsWith("/") || decoded.includes("\\") || decoded.includes("\0")) throw new Error("invalid-path");
  const media = decoded.match(/^\/media\/(?:use-cases\/source-[0-9]+|vod-baseline)\/(.+)$/);
  if (media) return { ...await safeFile(mediaRoot, media[1]), media: true };
  // A malformed/missing fixture route must never fall through to app HTML.
  if (decoded.startsWith("/media/")) throw new Error("invalid-path");
  return { ...await safeFile(dist, decoded.slice(1)), media: false };
}

async function fixturePreflight(mediaRoot) {
  const pending = ["comparison-360p.m3u8"], seen = new Set(), files = [];
  while (pending.length) {
    const name = pending.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const target = await safeFile(mediaRoot, name);
    const extension = extname(name).toLowerCase(), mime = contentTypes[extension];
    if (![".m3u8", ".m4s", ".mp4", ".ts", ".aac", ".vtt"].includes(extension) || !mime) throw new Error("Unsupported fixture MIME type.");
    files.push({ file: name, mime, ...await hashFile(target.file) });
    if (extension !== ".m3u8") continue;
    const text = await readFile(target.file, "utf8");
    if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("The fixture playlist is invalid.");
    const uris = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    for (const match of text.matchAll(/\bURI\s*=\s*"([^"]+)"/g)) uris.push(match[1]);
    for (const uri of uris) {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:|^[\\/]|\\|\0/.test(uri)) throw new Error("The controlled fixture must use local relative media URIs.");
      const parsed = new URL(uri, `http://fixture.invalid/fixture-root/${name}`);
      if (!parsed.pathname.startsWith("/fixture-root/")) throw new Error("The fixture closure escapes its root.");
      const child = decodeURIComponent(parsed.pathname.slice("/fixture-root/".length));
      if (!child || child.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("The fixture closure escapes its root.");
      pending.push(child);
    }
  }
  return { entry: "comparison-360p.m3u8", closureFiles: files.sort((left, right) => left.file.localeCompare(right.file)),
    manifestBytesRewritten: false, localClosureVerified: true, mimeVerifiedByExtension: true };
}

async function gzipAssets(directory, encoded = new Map()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Build symlinks are not allowed.");
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "media") await gzipAssets(file, encoded);
    } else if (entry.isFile() && [".js", ".mjs", ".css"].includes(extname(entry.name))) {
      encoded.set(file, await compress(await readFile(file), { level: 6 }));
    }
  }
  return encoded;
}

async function startServer(options, encodedAssets) {
  if ((await lstat(dist)).isSymbolicLink()) throw new Error("The dist directory must not be a symlink.");
  let currentTrial = null;
  const pending = new Set(), sockets = new Set();
  const server = createServer((request, response) => {
    const trial = currentTrial;
    const controller = new AbortController();
    response.once("close", () => controller.abort());
    response.on("error", () => controller.abort());
    const task = (async () => {
      let counter = trial?.other;
      let counted = false;
      try {
        if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
        const target = await servingFile(new URL(request.url ?? "/", "http://localhost").pathname, options.mediaRoot);
        const extension = extname(target.file).toLowerCase();
        counter = trial?.[target.media ? "media" : extension === ".js" || extension === ".mjs" ? "javascript" : "other"];
        if (counter) { counter.requests++; counted = true; }
        if (target.media && options.responseDelayMs) await sleep(options.responseDelayMs, controller.signal);
        if (controller.signal.aborted || response.destroyed) return;
        const encoded = !request.headers.range && /(?:^|[,\s])gzip(?:[,\s;]|$)/i.test(request.headers["accept-encoding"] ?? "") ? encodedAssets.get(target.file) : undefined;
        const size = encoded?.length ?? target.size;
        let start = 0, end = size - 1, status = 200;
        if (request.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
          if (!match || (!match[1] && !match[2])) { response.writeHead(416, { "Content-Range": `bytes */${target.size}` }).end(); return; }
          if (match[1]) { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
          else start = Math.max(0, target.size - Number(match[2]));
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= target.size) {
            response.writeHead(416, { "Content-Range": `bytes */${target.size}` }).end(); return;
          }
          end = Math.min(end, target.size - 1); status = 206;
        }
        response.writeHead(status, {
          "Content-Type": contentTypes[extension] ?? "application/octet-stream", "Content-Length": Math.max(0, end - start + 1),
          "Accept-Ranges": "bytes", "Cache-Control": options.cache === "disabled" ? "no-store" : "public, max-age=3600",
          ...(encoded ? { "Content-Encoding": "gzip", "Vary": "Accept-Encoding" } : {}),
          "X-Content-Type-Options": "nosniff", ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${target.size}` } : {}),
        });
        if (counter && encoded) counter.gzipResponses++;
        if (request.method === "HEAD" || target.size === 0) { response.end(); return; }
        const stream = encoded ? null : createReadStream(target.file, { start, end, highWaterMark: 16 * 1024 });
        if (encoded) {
          const ready = response.write(encoded);
          if (counter) counter.bodyBytes += encoded.length;
          if (!ready) await new Promise((accept) => {
            const done = () => { response.off("drain", done); response.off("close", done); accept(); };
            response.once("drain", done); response.once("close", done); if (response.destroyed) done();
          });
          if (!response.destroyed) response.end();
          return;
        }
        const abort = () => stream.destroy();
        controller.signal.addEventListener("abort", abort, { once: true });
        try {
          for await (const chunk of stream) {
            if (response.destroyed || controller.signal.aborted) break;
            // Count actual entity chunks accepted by Node, never file-size guesses.
            const ready = response.write(chunk);
            if (counter) counter.bodyBytes += chunk.length;
            if (!ready) await new Promise((accept) => {
              const done = () => { response.off("drain", done); response.off("close", done); accept(); };
              response.once("drain", done); response.once("close", done);
              if (response.destroyed) done();
            });
          }
          if (!response.destroyed) response.end();
        } finally { controller.signal.removeEventListener("abort", abort); stream.destroy(); }
      } catch {
        if (!response.headersSent && !response.destroyed) {
          response.writeHead(404, { "Content-Length": 0 });
          response.end();
        } else if (!response.destroyed) response.destroy();
      } finally {
        if (!response.destroyed && !response.writableFinished) await new Promise((accept) => {
          const done = () => { response.off("finish", done); response.off("close", done); accept(); };
          response.once("finish", done); response.once("close", done);
          if (response.destroyed || response.writableFinished) done();
        });
        if (counter) {
          if (!counted) counter.requests++;
          if (response.headersSent) {
            counter.responses++; counter.statusCodes[response.statusCode] = (counter.statusCodes[response.statusCode] ?? 0) + 1;
          }
          if (response.writableFinished) counter.completedResponses++; else counter.abortedResponses++;
        }
      }
    })();
    pending.add(task); void task.finally(() => pending.delete(task));
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(options.port, "127.0.0.1", accept); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server address is unavailable.");
  return {
    origin: `http://localhost:${address.port}`, port: address.port,
    begin(counts) { currentTrial = counts; },
    async end() { currentTrial = null; await timeout(Promise.allSettled([...pending]), 3000); },
    async close() {
      currentTrial = null;
      const closed = new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
      server.closeAllConnections(); for (const socket of sockets) socket.destroy();
      await timeout(closed, 5000); await timeout(Promise.allSettled([...pending]), 3000);
      await new Promise((accept) => setImmediate(accept));
      return { listening: server.listening, openSockets: sockets.size, pendingResponses: pending.size };
    },
  };
}

async function httpFixturePreflight(server, files, options, deadline) {
  const entry = files.closureFiles.find((row) => row.file === files.entry);
  if (!entry) throw new Error("The fixture entry is unavailable.");
  const checks = [];
  for (const source of [0, 1]) {
    const response = await fetch(`${server.origin}/media/use-cases/source-${source}/${files.entry}`, {
      redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(deadline - Date.now(), options.responseDelayMs + 5000))),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status !== 200 || response.headers.get("content-type") !== entry.mime || digest(bytes) !== entry.sha256) {
      throw new Error("The HTTP fixture alias or MIME preflight failed.");
    }
    checks.push({ sourceAlias: source, bytes: bytes.length, sha256: digest(bytes), mime: entry.mime });
  }
  return { passed: true, checks, includedInTrialByteCounts: false };
}

function plan(options) {
  const trials = [];
  let cohortIndex = 0;
  for (const policy of options.policies) for (const warmupMs of options.warmups) for (const lookahead of options.lookaheads) {
    const cohort = ++cohortIndex;
    for (let round = 0; round < options.rounds; round++) {
      const row = (cohort - 1 + round) % latinRows.length;
      for (const [position, index] of latinRows[row].entries()) trials.push({
        trial: trials.length + 1, cohort, round: round + 1, latinRow: row, position: position + 1,
        pairingUnit: `${cohort}:${round + 1}`, freshBrowserContext: true, sharedBrowserProcess: true,
        engine: engines[index], policy, warmupMs, lookahead, steps: options.steps,
        workerEnabled: options.workerEnabled, hlsMetadataDetached: options.hlsMetadataDetached, shakaStrategy: options.shakaStrategy,
      });
    }
  }
  return trials;
}

function errorCategory(message) {
  if (/licen[cs]|impression|domain|key/i.test(message)) return "licensing";
  if (/manifest|playlist|segment|network|net::|fetch|download/i.test(message)) return "media-or-network";
  if (/media|sourcebuffer|decode|codec|playback|play\(/i.test(message)) return "media-playback";
  return "unclassified";
}

async function metrics(session) {
  try {
    const result = await timeout(session.send("Performance.getMetrics"), 1500);
    const selected = Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
    return {
      scriptDurationSeconds: selected.ScriptDuration ?? null, jsHeapUsedBytes: selected.JSHeapUsedSize ?? null,
      jsHeapTotalBytes: selected.JSHeapTotalSize ?? null, taskDurationSeconds: selected.TaskDuration ?? null,
    };
  } catch { return null; }
}

function actualMarks(transition) {
  if (!transition) return null;
  const dispatch = typeof transition.inputDispatchDelayMs === "number" ? transition.inputDispatchDelayMs : null;
  return {
    sourceId: transition.sourceId, status: transition.status, inputDispatchDelayMs: dispatch,
    marksFromIntendedAtMs: transition.marks,
    marksFromActualActivationMs: Object.fromEntries(Object.entries(transition.marks ?? {}).map(([name, value]) =>
      [name, typeof value === "number" && dispatch !== null ? value - dispatch : null])),
  };
}

async function runTrial(browser, server, options, trial, deadline, signal) {
  const began = Date.now(), counts = byteCounts();
  const bounded = (promise, maximum = 5000) => timeout(promise, Math.min(maximum, Math.max(1, deadline - Date.now())));
  const record = { ...trial, status: "failure", failureStage: null, durationMs: null, result: null,
    observedErrors: { pageErrors: 0, consoleErrors: 0, requestFailures: 0, crashes: 0, providerErrors: [] },
    http: counts, diagnostics: { beforeNavigation: null, beforeRun: null, afterRun: null }, cleanup: { stop: false, contextClosed: false, httpSettled: false } };
  let context, page, session, abortListener;
  let phase = "context";
  server.begin(counts);
  try {
    context = await bounded(browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1, serviceWorkers: "block" }));
    context.setDefaultTimeout(Math.min(5000, Math.max(1, deadline - Date.now())));
    page = await bounded(context.newPage());
    page.on("pageerror", () => { record.observedErrors.pageErrors++; });
    page.on("crash", () => { record.observedErrors.crashes++; });
    page.on("requestfailed", () => { record.observedErrors.requestFailures++; });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      record.observedErrors.consoleErrors++;
      if (record.observedErrors.providerErrors.length < 100) record.observedErrors.providerErrors.push({
        category: errorCategory(message.text()), message: "redacted", elapsedMs: Date.now() - began,
      });
    });
    session = await bounded(context.newCDPSession(page));
    await bounded(session.send("Network.enable"));
    await bounded(session.send("Network.setCacheDisabled", { cacheDisabled: options.cache === "disabled" }));
    await bounded(session.send("Network.emulateNetworkConditions", {
      offline: false, latency: options.latencyMs,
      downloadThroughput: options.downloadMbps > 0 ? options.downloadMbps * 1000000 / 8 : -1,
      uploadThroughput: -1,
    }));
    await bounded(session.send("Emulation.setCPUThrottlingRate", { rate: options.cpuRate }));
    await bounded(session.send("Performance.enable"));
    record.diagnostics.beforeNavigation = await metrics(session);
    phase = "navigation";
    await page.goto(`${server.origin}/use-cases.html`, { waitUntil: "load", timeout: Math.min(15000, Math.max(1, deadline - Date.now())) });
    await page.waitForFunction(() => typeof window.playerLabUseCases?.run === "function", undefined, { timeout: Math.min(10000, Math.max(1, deadline - Date.now())) });
    await bounded(page.addStyleTag({ content: "#stage { width:960px !important; height:540px !important; aspect-ratio:auto !important; }" }));
    const stage = await bounded(page.locator("#stage").boundingBox());
    record.stage = stage ? { width: stage.width, height: stage.height } : null;
    if (!stage || stage.width !== 960 || stage.height !== 540) throw new Error("stage-size");
    record.diagnostics.beforeRun = await metrics(session);
    phase = "runner";
    if (signal.aborted || Date.now() >= deadline) throw new Error("deadline");
    const sourceUrls = Array.from({ length: trial.steps + trial.lookahead + 2 }, (_, index) =>
      `${server.origin}/media/use-cases/source-${index}/comparison-360p.m3u8`);
    const running = page.evaluate((parameters) => window.playerLabUseCases.run(parameters), {
      engine: trial.engine, policy: trial.policy, warmupMs: trial.warmupMs, lookahead: trial.lookahead,
      steps: trial.steps, sourceUrls, retain: false, workerEnabled: trial.workerEnabled,
      hlsMetadataDetached: trial.hlsMetadataDetached, shakaStrategy: trial.shakaStrategy,
    });
    const cancelled = new Promise((_, reject) => {
      abortListener = () => reject(new Error("budget-exhausted"));
      signal.addEventListener("abort", abortListener, { once: true }); if (signal.aborted) abortListener();
    });
    const result = await timeout(Promise.race([running, cancelled]), Math.min(options.trialTimeoutMs, Math.max(1, deadline - Date.now())), "runner-deadline");
    if (!result || result.schemaVersion !== 1 || !["success", "failure", "unsupported"].includes(result.status)) throw new Error("invalid-result");
    record.result = safe(result);
    record.status = result.status;
    record.failureStage = result.failureStage;
    record.initialMetrics = safe(actualMarks(result.initial));
    record.coldOverallMarks = safe(result.initialFromCaseStart ?? null);
    record.transitionMetrics = safe((result.transitions ?? []).map(actualMarks));
    if (result.retained !== false || result.cleanupMs === null) { record.status = "failure"; record.failureStage = "runner-disposal"; }
  } catch {
    record.status = signal.aborted ? "budget-exhausted" : Date.now() >= deadline ? "timeout" : "failure";
    record.failureStage = phase;
  } finally {
    if (abortListener) signal.removeEventListener("abort", abortListener);
    if (page && !page.isClosed()) {
      try { await timeout(page.evaluate(() => window.playerLabUseCases?.stop()), 2500); record.cleanup.stop = true; }
      catch { /* Context closure below still releases the owned media and requests. */ }
    }
    if (session) record.diagnostics.afterRun = await metrics(session);
    if (context) {
      try { await timeout(context.close(), 5000); record.cleanup.contextClosed = true; }
      catch { record.status = "failure"; record.failureStage = "context-cleanup"; }
    }
    try { await server.end(); record.cleanup.httpSettled = true; }
    catch { record.status = "failure"; record.failureStage = "http-cleanup"; }
    record.durationMs = Date.now() - began;
  }
  const before = record.diagnostics.beforeRun, after = record.diagnostics.afterRun;
  record.diagnostics.runnerScriptDurationMs = before && after && before.scriptDurationSeconds !== null && after.scriptDurationSeconds !== null
    ? (after.scriptDurationSeconds - before.scriptDurationSeconds) * 1000 : null;
  record.diagnostics.runnerHeapUsedDifferenceBytes = before && after && before.jsHeapUsedBytes !== null && after.jsHeapUsedBytes !== null
    ? after.jsHeapUsedBytes - before.jsHeapUsedBytes : null;
  return safe(record);
}

async function processExited(child, milliseconds) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  try {
    await timeout(new Promise((accept) => child.once("exit", accept)), milliseconds);
    return true;
  } catch { return child.exitCode !== null || child.signalCode !== null; }
}

function pidExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; }
}

async function main(options) {
  if (within(repository, options.output)) throw new Error("The output directory must be outside the repository.");
  await mkdir(options.output, { recursive: true });
  if (within(await realpath(repository), await realpath(options.output))) throw new Error("The output directory must resolve outside the repository.");
  const runId = randomUUID();
  const manifestFile = join(options.output, "manifest.json"), trialsFile = join(options.output, "trials.jsonl"), summaryFile = join(options.output, "summary.json");
  // Refuse accidental overwrites of prior measurement evidence.
  await writeFile(trialsFile, "", { flag: "wx" });
  const began = Date.now(), deadline = began + options.budgetMs;
  const life = new AbortController();
  const budget = setTimeout(() => life.abort(), options.budgetMs);
  const interrupted = () => life.abort();
  process.once("SIGINT", interrupted); process.once("SIGTERM", interrupted);
  let server, browserServer, browser, child, fatal = null, ownsManifest = false, harnessStage = "preflight";
  const results = [], planned = plan(options);
  const { output: _output, mediaRoot: _mediaRoot, ...publicOptions } = options;
  const manifest = {
    schemaVersion: 1, runId, created: new Date(began).toISOString(),
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    options: publicOptions, engines,
    ordering: { kind: "balanced-Williams-Latin-rotation", rows: latinRows.map((row) => row.map((index) => engines[index])),
      roundsPerEnginePerCohort: options.rounds, completeFourRoundBlocks: Math.floor(options.rounds / 4), incompleteBlockRounds: options.rounds % 4 },
    metricDefinitions: {
      coldOverall: "result.initialFromCaseStart measures from before driver/SDK import through initial playback, including synchronous preparation and downloads. This is the cold overall comparison.",
      initial: "Initial activation marks begin after driver import; these exclude SDK download and are reported separately from cold overall and source transitions.",
      transition: "Playback after the fixed preparation window. Initial playback is excluded from transition metrics.",
      intendedTime: "Runner marks measured from intendedAt, including input dispatch delay.",
      actualActivation: "Runner marks minus its inputDispatchDelayMs; no frame from preparation is reused.",
      scriptAndHeap: "Diagnostic whole runner invocation including setup, initial playback, preparation, transitions and cleanup; not SDK-only. Navigation has a separate raw baseline. No forced GC.",
      httpBodyBytes: "Encoded entity chunks accepted by the owned HTTP server's response.write, including preparation and partial aborted responses. JS/CSS use gzip when accepted. Excludes headers, wire overhead and TLS; queued bytes can outlive a client cancellation.",
      cache: "Every trial has a fresh browser context. Managed permits normal within-trial caching; disabled also serves no-store and sets CDP cacheDisabled.",
      shaping: "CDP Network.emulateNetworkConditions applies one page-level download-throughput/latency profile before navigation for every engine. Optional media response-start delay is additional. No server-side shared media bandwidth cap or browser-wire byte claim.",
      sampling: "All planned trials are retained. No retries, outlier exclusions, or removal of failed/unsupported cases.",
    },
    sameBytes: "Every distinct source alias resolves to the identical fixture file without rewriting manifests or relative playlist URIs.",
    contextIsolation: "one fresh browser context per engine trial; one owned Chromium process for the run",
    compression: { method: "gzip", level: 6, assets: ["javascript", "css"], timing: "precomputed before measured trials", mediaRewritten: false },
    networkProfile: { mechanism: "CDP Network.emulateNetworkConditions", scope: "whole page before navigation",
      offline: false, downloadMbps: options.downloadMbps || null,
      downloadBytesPerSecond: options.downloadMbps > 0 ? options.downloadMbps * 1000000 / 8 : null,
      upload: "unlimited", latencyMs: options.latencyMs, additionalMediaResponseDelayMs: options.responseDelayMs },
    plannedTrials: planned.length, trialPlan: planned,
  };
  try {
    await writeFile(manifestFile, JSON.stringify(safe(manifest), null, 2), { flag: "wx" }); ownsManifest = true;
    manifest.harnessSha256 = await hashFile(scriptFile);
    manifest.builtEntrySha256 = await hashFile(join(dist, "use-cases.html"));
    manifest.runnerSourceSha256 = await hashFile(join(repository, "apps/web/src/startup/use-cases/runner.ts"));
    harnessStage = "sdk-version-preflight";
    manifest.sdk = await sdkVersions();
    harnessStage = "fixture-preflight";
    manifest.fixture = await fixturePreflight(options.mediaRoot);
    if (life.signal.aborted) throw new Error("budget-exhausted");
    harnessStage = "gzip-preflight";
    const encodedAssets = await gzipAssets(dist);
    manifest.compression.precomputedAssetCount = encodedAssets.size;
    manifest.compression.totalEncodedBytes = [...encodedAssets.values()].reduce((sum, body) => sum + body.length, 0);
    await writeFile(manifestFile, JSON.stringify(safe(manifest), null, 2));
    harnessStage = "http-server";
    server = await startServer(options, encodedAssets);
    harnessStage = "http-fixture-preflight";
    manifest.httpFixturePreflight = await httpFixturePreflight(server, manifest.fixture, options, deadline);
    const requireE2E = createRequire(join(repository, "tests/e2e/package.json"));
    const { chromium } = requireE2E("@playwright/test");
    harnessStage = "browser-launch";
    browserServer = await chromium.launchServer({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"], timeout: Math.min(30000, Math.max(1, deadline - Date.now())) });
    child = browserServer.process();
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: Math.min(10000, Math.max(1, deadline - Date.now())) });
    manifest.browser = { version: browser.version(), headless: true, autoplayPolicy: "no-user-gesture-required", viewport: { width: 1280, height: 960 }, stage: { width: 960, height: 540 } };
    await writeFile(manifestFile, JSON.stringify(safe(manifest), null, 2));
    harnessStage = "trial-loop";
    for (const trial of planned) {
      const record = life.signal.aborted || Date.now() >= deadline ? {
        ...trial, status: "budget-exhausted", failureStage: "not-started", result: null,
      } : await runTrial(browser, server, options, trial, Math.min(deadline, Date.now() + options.trialTimeoutMs), life.signal);
      results.push(record); await appendFile(trialsFile, `${JSON.stringify(record)}\n`);
      console.log(`trial ${trial.trial}/${planned.length} cohort=${trial.cohort} round=${trial.round} ${trial.engine} ${trial.policy} warmup=${trial.warmupMs} lookahead=${trial.lookahead} status=${record.status}`);
    }
  } catch {
    fatal = `${harnessStage}-failure`;
    for (const trial of planned.slice(results.length)) {
      const record = { ...trial, status: "failure", failureStage: `harness-${harnessStage}`, result: null };
      results.push(record); await appendFile(trialsFile, `${JSON.stringify(record)}\n`);
    }
  } finally {
    clearTimeout(budget); life.abort();
    process.removeListener("SIGINT", interrupted); process.removeListener("SIGTERM", interrupted);
    const cleanup = { browserClosed: false, browserProcessExited: child ? false : null, browserPidAbsent: child ? false : null, http: null };
    try { if (browser) await timeout(browser.close(), 5000); cleanup.browserClosed = true; } catch { fatal ??= "browser-cleanup"; }
    if (browserServer) {
      try { await timeout(browserServer.close(), 5000); } catch { try { await timeout(browserServer.kill(), 3000); } catch { fatal ??= "browser-server-cleanup"; } }
      cleanup.browserProcessExited = await processExited(child, 3000);
      if (!cleanup.browserProcessExited) {
        try { await timeout(browserServer.kill(), 3000); } catch { /* The following owned-child death check remains authoritative. */ }
        cleanup.browserProcessExited = await processExited(child, 3000);
      }
      if (!cleanup.browserProcessExited) fatal ??= "browser-process-alive";
      cleanup.browserPidAbsent = !pidExists(child?.pid);
      if (!cleanup.browserPidAbsent) fatal ??= "browser-pid-alive";
    }
    if (server) {
      try {
        cleanup.http = await server.close();
        if (cleanup.http.listening || cleanup.http.openSockets || cleanup.http.pendingResponses) fatal ??= "http-server-alive";
      }
      catch { fatal ??= "http-server-cleanup"; }
    }
    const counts = {};
    for (const row of results) counts[row.status] = (counts[row.status] ?? 0) + 1;
    const summary = { schemaVersion: 1, runId, durationMs: Date.now() - began, plannedTrials: planned.length, retainedTrials: results.length,
      requestedRoundsPerEnginePerCohort: options.rounds, counts, fatal, cleanup,
      noRetries: true, noOutlierExclusions: true, initialAndTransitionsSeparate: true };
    if (ownsManifest) { manifest.fatal = fatal; await writeFile(manifestFile, JSON.stringify(safe(manifest), null, 2)); }
    await writeFile(summaryFile, JSON.stringify(safe(summary), null, 2), { flag: "wx" });
    console.log(`retained ${results.length}/${planned.length} trials; statuses=${JSON.stringify(counts)}; cleanup=${fatal ?? "verified"}`);
    if (fatal || results.some((row) => ["failure", "timeout", "budget-exhausted"].includes(row.status))) process.exitCode = 1;
  }
}

try {
  const options = argumentsFor(process.argv.slice(2));
  if (options) await main(options); else console.log(usage());
} catch (error) {
  // Configuration errors contain only harness-authored messages, never browser/provider details.
  const message = error instanceof Error && /^(?:Invalid |Duplicate |--output |--media-root |Shared bandwidth |The output directory )/.test(error.message)
    ? error.message : "Harness setup failed. Build apps/web and provide a fresh external output directory.";
  console.error(message); process.exitCode = 1;
}
