#!/usr/bin/env node
import { createServer } from "node:http";
import { startFinalizationServer } from "../../tests/e2e/src/finalization-server.ts";

// Reuse the public 60-second media fixture and its exact HLS end-of-event signal.
const directory = process.argv[2];
if (!directory || process.argv.length !== 3) {
  throw new Error("Usage: node apps/ios/runtime-fixture.mjs <vod-baseline-directory>");
}
const media = await startFinalizationServer(directory, 5198);
const control = createServer((request, response) => {
  const send = (status, value) => {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(value));
  };
  if (request.method === "GET" && request.url === "/state") {
    send(200, media.counts());
  } else if (request.method === "POST" && request.url === "/reset") {
    media.reset();
    send(200, { reset: true });
  } else if (request.method === "POST" && request.url === "/finalize") {
    media.finalize();
    send(200, { finalized: true });
  } else send(404, { error: "Unknown fixture operation" });
});
control.requestTimeout = 2000;
control.headersTimeout = 2000;
try {
  await new Promise((accept, reject) => {
    control.once("error", reject);
    control.listen(5199, "127.0.0.1", accept);
  });
} catch (error) {
  await media.close();
  throw error;
}
console.log("Apple runtime fixture ready: media 5198, control 5199 (loopback only).");
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  control.closeAllConnections();
  await Promise.all([
    new Promise((accept, reject) => control.close((error) => error ? reject(error) : accept())),
    media.close(),
  ]);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { close().catch(() => { process.exitCode = 1; }); });
}
