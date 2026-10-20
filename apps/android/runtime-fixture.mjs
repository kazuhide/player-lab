#!/usr/bin/env node
// Serve the existing real-media finalization fixture for licensed Android tests.
import { createServer } from "node:http";
import { resolve } from "node:path";
import { startFinalizationServer } from "../../tests/e2e/src/finalization-server.ts";
import { startConfigurationServer } from "./configuration-fixture.mjs";

const directory = process.argv[2];
if (!directory || process.argv.length !== 3) {
  throw new Error("Usage: node apps/android/runtime-fixture.mjs PATH_TO_GENERATED_VOD_BASELINE");
}
const media = await startFinalizationServer(directory, 5272);
const configuration = await startConfigurationServer(resolve(directory, "..")).catch(async error => {
  await media.close();
  throw error;
});
let ended = false;
const control = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const route = url.pathname;
  if (route === "/configuration/reset" && request.method === "POST") {
    try { configuration.reset(Number(url.searchParams.get("failures") ?? 2)); }
    catch { response.writeHead(400).end(); return; }
  } else if (route === "/configuration/state" && request.method === "GET") {
    // Read-only counters are sufficient to prove the configured retry cap.
  } else if (request.method === "POST" && route === "/reset") {
    media.reset();
    ended = false;
  } else if (request.method === "POST" && route === "/finalize") {
    media.finalize();
    ended = true;
  } else if (request.method !== "GET" || route !== "/state") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(route.startsWith("/configuration/") ? configuration.counts() : { ended, ...media.counts() }));
});
await new Promise((accept, reject) => {
  control.once("error", reject);
  control.listen(5273, "127.0.0.1", accept);
}).catch(async error => {
  await Promise.all([media.close(), configuration.close()]);
  throw error;
});
console.log(`Android media: ${media.origin}; configuration: ${configuration.origin}; control: http://localhost:5273`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  control.closeAllConnections();
  await Promise.all([media.close(), configuration.close(), new Promise((accept, reject) => control.close(error => error ? reject(error) : accept()))]);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  close().then(() => process.exit(0), () => process.exit(1));
});
