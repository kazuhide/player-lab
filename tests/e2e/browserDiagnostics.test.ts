import assert from "node:assert/strict";
import { test } from "node:test";
import { DiagnosticBuffer, safeDestination } from "./src/browser-diagnostics.ts";

test("destinations keep public endpoint context while dropping credentials and private paths", () => {
  assert.deepEqual(safeDestination("https://user:private-value@licensing.bitmovin.com/licensing?key=private-value#private-value"), {
    origin: "https://licensing.bitmovin.com", path: "/licensing",
  });
  assert.deepEqual(safeDestination("http://localhost:5214/player-lab/web/media/vod-baseline/media_0.m3u8?token=private-value"), {
    origin: "http://localhost:5214", path: "/player-lab/web/media/vod-baseline/media_0.m3u8",
  });
  assert.deepEqual(safeDestination("https://customer.invalid/private-value?authorization=private-value"), {
    origin: "redacted", path: "redacted",
  });
  assert.deepEqual(safeDestination("http://localhost:5214/customer/private-value.js"), {
    origin: "http://localhost:5214", path: "redacted",
  });
  for (const address of ["data:text/plain,private-value", "not a URL", "x".repeat(100_000)]) {
    assert.deepEqual(safeDestination(address), { origin: "redacted", path: "redacted" });
  }
});

test("uncaught errors retain their category and safe stack positions without free text", () => {
  const buffer = new DiagnosticBuffer({ now: () => 0 });
  const error = new TypeError("licensing impression failed with private-value");
  error.stack = "TypeError: private-value\n"
    + " at customer (https://customer.invalid/private-value.js:14:2)\n"
    + " at local (http://localhost:5214/player-lab/web/assets/main-abcdefgh.js?token=private-value:21:4)\n"
    + " at sdk (https://cdn.bitmovin.com/player/web/8/bitmovinplayer.js:32:5)";
  buffer.pageError(error);
  const snapshot = buffer.snapshot();
  assert.equal(snapshot.uncaughtErrors, 1);
  assert.equal(snapshot.events[0]?.kind, "pageerror");
  assert.equal(snapshot.events[0]?.category, "licensing-impression");
  assert.equal(snapshot.events[0]?.name, "TypeError");
  assert.equal(snapshot.events[0]?.at, "1970-01-01T00:00:00.000Z");
  assert.match(JSON.stringify(snapshot), /bitmovinplayer\.js/);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-value|customer\.invalid|token=|at customer/);
});

test("response status and failed requests are recorded without arbitrary failure messages", () => {
  const buffer = new DiagnosticBuffer();
  buffer.response("https://licensing.bitmovin.com/licensing", 200);
  buffer.response("https://customer.invalid/private-value", 403);
  buffer.response("http://localhost:5214/player-lab/web/", 200);
  buffer.requestFailed("https://customer.invalid/private-value", "net::ERR_CONNECTION_RESET", "GET", "fetch");
  buffer.requestFailed("https://customer.invalid/private-value", "private-value", "private-value", "private-value");
  const snapshot = buffer.snapshot();
  assert.equal(snapshot.events.length, 4);
  assert.equal(snapshot.events[1]?.status, 403);
  assert.equal(snapshot.events[2]?.reason, "net::ERR_CONNECTION_RESET");
  assert.equal(snapshot.events[3]?.reason, "other");
  assert.equal(snapshot.events[3]?.method, "OTHER");
  assert.equal(snapshot.events[3]?.resourceType, "other");
  assert.doesNotMatch(JSON.stringify(snapshot), /private-value|customer\.invalid/);
});

test("the event buffer is bounded and an error cannot disappear from the total", () => {
  const buffer = new DiagnosticBuffer({ limit: 3 });
  buffer.pageError(new Error("private-value"));
  for (let index = 0; index < 10; index++) buffer.response("https://licensing.bitmovin.com/licensing", 503);
  const snapshot = buffer.snapshot();
  assert.equal(snapshot.uncaughtErrors, 1);
  assert.equal(snapshot.events.length, 3);
  assert.equal(snapshot.droppedEvents, 8);
  snapshot.events.length = 0;
  assert.equal(buffer.snapshot().events.length, 3);
  for (const limit of [0, -1, 100_000, Number.NaN]) {
    assert.throws(() => new DiagnosticBuffer({ limit }), /limit/);
  }
});

test("private content in public-looking URLs is not retained", () => {
  const samples = [
    "https://licensing.bitmovin.com/private-value/secret",
    "https://cdn.bitmovin.com/private-value.js",
    "http://localhost:5214/player-lab/web/assets/private-value-abcdefgh.js",
    "http://localhost:5214/player-lab/guide/private-value/",
    "http://localhost:5214/player-lab/web/media/vod-baseline/private-value.m4s",
    "https://licensing.bitmovin.com/%70rivate-value",
  ];
  for (const sample of samples) assert.doesNotMatch(JSON.stringify(safeDestination(sample)), /private-value|secret|%70/);
});
