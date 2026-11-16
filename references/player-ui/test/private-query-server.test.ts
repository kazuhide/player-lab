import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { privateQueryHandler } from "../server/private-query.ts";

function input() {
  return {
    schemaVersion: 1, metricVersion: "watched-impression-incidence-v1", complete: true,
    content: { id: "example-video", revision: "fixture-v1", durationMs: 4000 },
    source: { hls: "https://example.com/video.m3u8" },
    period: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" },
    generatedAt: "2026-01-02T00:00:00.000Z", sessionCount: 10, bucketWidthMs: 2000,
    buckets: [{ startMs: 0, endMs: 2000, impressions: 10 }, { startMs: 2000, endMs: 4000, impressions: 4 }],
  };
}

async function setup(t: TestContext, enabled = true) {
  const directory = await mkdtemp(join(tmpdir(), "player-ui-private-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = join(directory, "checkout");
  await mkdir(repository);
  const file = join(directory, "private.json");
  await writeFile(file, JSON.stringify(input()), { mode: 0o600 });
  let configuredFile = enabled ? file : undefined;
  let mediaDirectory: string | undefined;
  const server = createServer((request, response) => {
    // An upstream middleware may have already set CORS headers.
    response.setHeader("access-control-allow-origin", "http://localhost:5199");
    response.setHeader("access-control-allow-credentials", "true");
    privateQueryHandler(configuredFile, repository, mediaDirectory)(request, response, () => {
      response.statusCode = 404;
      response.end("not found");
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { repository, file, base: `http://127.0.0.1:${address.port}`, setFile: (value: string | undefined) => { configuredFile = value; },
    setMediaDirectory: (value: string | undefined) => { mediaDirectory = value; } };
}

test("a local HLS source requires explicit private media configuration", async t => {
  const context = await setup(t);
  const data = input();
  data.source.hls = "/__private/media/master.m3u8";
  await writeFile(context.file, JSON.stringify(data));
  assert.equal((await fetch(context.base + "/__private/query-data")).status, 503);
  context.setMediaDirectory("/explicit/private/media");
  assert.equal((await fetch(context.base + "/__private/query-data")).status, 200);
});

test("the guarded private endpoint also serves explicit synthetic live scenarios", async t => {
  const context = await setup(t);
  const data = input();
  const pack = {
    schemaVersion: 1, kind: "synthetic-live-demo",
    source: { hls: "/__private/media/master.m3u8" },
    profiles: [{
      id: "focused", title: { en: "Focused replay", ja: "集中" },
      snapshot: {
        schemaVersion: 1, metricVersion: "replay-coverage-v1", synthetic: true,
        content: data.content, period: data.period, generatedAt: data.generatedAt,
        sessionCount: 10, bucketWidthMs: 2_000, suggestedMode: "replay",
        points: [{ startMs: 0, endMs: 2_000, support: 10, reach: 1, replay: 0.5 },
          { startMs: 2_000, endMs: 4_000, support: 4, reach: 0.4, replay: 0 }],
      },
    }],
  };
  await writeFile(context.file, JSON.stringify(pack));
  assert.equal((await fetch(context.base + "/__private/query-data")).status, 503);
  context.setMediaDirectory("/explicit/private/media");
  const response = await fetch(context.base + "/__private/query-data", { headers: { origin: context.base } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), pack);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  pack.profiles[0].snapshot.synthetic = false;
  await writeFile(context.file, JSON.stringify(pack));
  assert.equal((await fetch(context.base + "/__private/query-data")).status, 503);
});

test("private data is opt-in, validated, uncached and restricted to the local origin", async t => {
  const context = await setup(t);
  const response = await fetch(context.base + "/__private/query-data", { headers: { origin: context.base } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), input());
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  context.setFile(undefined);
  assert.equal((await fetch(context.base + "/__private/query-data")).status, 404);
});

test("private data rejects cross-site, forged-host, forwarded and write requests", async t => {
  const { base } = await setup(t);
  const rejectedHeaders: Record<string, string>[] = [
    { origin: "https://example.com" },
    { "sec-fetch-site": "cross-site" }, { "x-forwarded-for": "127.0.0.1" },
  ];
  for (const headers of rejectedHeaders) assert.equal((await fetch(base + "/__private/query-data", { headers })).status, 403);
  // Fetch rewrites Host, so use an HTTP request to send the forged value unchanged.
  const forgedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const outgoing = request(base + "/__private/query-data", { headers: { host: "example.com" } }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await fetch(base + "/__private/query-data", { method: "POST" })).status, 405);
  assert.equal((await fetch(base + "/__private/query-data?file=other.json")).status, 400);
});

test("private files and symlink targets must stay outside the repository", async t => {
  const context = await setup(t);
  const inside = join(context.repository, "sensitive.json");
  await writeFile(inside, JSON.stringify(input()), { mode: 0o600 });
  context.setFile(inside);
  assert.equal((await fetch(context.base + "/__private/query-data")).status, 503);
  const linked = context.file + ".link";
  await symlink(inside, linked);
  context.setFile(linked);
  assert.equal((await fetch(context.base + "/__private/query-data")).status, 503);
});

test("private endpoint refuses oversized, permissive, invalid and missing files without disclosing input", async t => {
  const context = await setup(t);
  const original = await readFile(context.file);
  for (const value of [" ".repeat(524289), "not JSON", JSON.stringify({ ...input(), apiKey: "private-test-value" })]) {
    await writeFile(context.file, value);
    const response = await fetch(context.base + "/__private/query-data");
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(!body.includes(context.file));
    assert.ok(!body.includes("private-test-value"));
  }
  await writeFile(context.file, original);
  await chmod(context.file, 0o644);
  assert.equal((await fetch(context.base + "/__private/query-data")).status, 503);
  context.setFile(context.file + ".missing");
  assert.equal((await fetch(context.base + "/__private/query-data")).status, 503);
});
