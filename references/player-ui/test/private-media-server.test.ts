import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { privateMediaHandler } from "../server/private-media.ts";

async function setup(t: TestContext, enabled = true) {
  const root = await mkdtemp(join(tmpdir(), "player-ui-local-media-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, "checkout");
  const directory = join(root, "media");
  await mkdir(repository);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, "master.m3u8"), "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nsegment-0.ts\n#EXT-X-ENDLIST\n", { mode: 0o600 });
  await writeFile(join(directory, "segment-0.ts"), "0123456789", { mode: 0o600 });
  let configuredDirectory: string | undefined = directory;
  const server = createServer((request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-credentials", "true");
    privateMediaHandler(enabled ? "private.json" : undefined, configuredDirectory, repository)(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { base: `http://127.0.0.1:${address.port}`, directory, repository,
    setDirectory: (next: string | undefined) => { configuredDirectory = next; } };
}

test("local HLS is opt-in, owner-only and same-origin, including HEAD", async t => {
  const { base, setDirectory } = await setup(t);
  const playlist = await fetch(base + "/__private/media/master.m3u8", { headers: { origin: base } });
  assert.equal(playlist.status, 200);
  assert.match(await playlist.text(), /segment-0.ts/);
  assert.equal(playlist.headers.get("content-type"), "application/vnd.apple.mpegurl");
  assert.equal(playlist.headers.get("cache-control"), "no-store");
  assert.equal(playlist.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(playlist.headers.get("access-control-allow-origin"), null);
  assert.equal(playlist.headers.get("access-control-allow-credentials"), null);
  const head = await fetch(base + "/__private/media/segment-0.ts", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(head.headers.get("content-type"), "video/mp2t");
  assert.equal(await head.text(), "");
  setDirectory(undefined);
  assert.equal((await fetch(base + "/__private/media/master.m3u8")).status, 404);
  const disabled = await setup(t, false);
  assert.equal((await fetch(disabled.base + "/__private/media/master.m3u8")).status, 404);
});

test("media byte ranges return exact bytes and reject invalid or multiple ranges", async t => {
  const { base } = await setup(t);
  for (const [range, body, contentRange] of [["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=0-99", "0123456789", "bytes 0-9/10"]]) {
    const response = await fetch(base + "/__private/media/segment-0.ts", { headers: { range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), contentRange);
    assert.equal(await response.text(), body);
  }
  for (const range of ["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=1-2,4-5", "garbage", "bytes=9999999999999999999-"]) {
    const response = await fetch(base + "/__private/media/segment-0.ts", { headers: { range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get("content-range"), "bytes */10");
  }
});

test("media rejects foreign origins, hosts, forwarding, queries and writes", async t => {
  const { base } = await setup(t);
  const rejectedHeaders: Record<string, string>[] = [{ origin: "https://example.com" }, { "sec-fetch-site": "cross-site" }, { forwarded: "for=127.0.0.1" }, { "x-forwarded-host": "localhost" }];
  for (const headers of rejectedHeaders) {
    assert.equal((await fetch(base + "/__private/media/master.m3u8", { headers })).status, 403);
  }
  assert.equal((await fetch(base + "/__private/media/master.m3u8?x=1")).status, 400);
  assert.equal((await fetch(base + "/__private/media/master.m3u8", { method: "POST" })).status, 405);
  assert.equal(await new Promise<number | undefined>((resolve, reject) => {
    const outgoing = request(base + "/__private/media/master.m3u8", { headers: { host: "example.com" } }, response => {
      response.resume(); response.on("end", () => resolve(response.statusCode));
    });
    outgoing.on("error", reject); outgoing.end();
  }), 403);
});

test("media refuses unsafe names, symlinks, repository files and public permissions", async t => {
  const { base, directory, repository, setDirectory } = await setup(t);
  for (const suffix of ["%2e%2e%2fsecret.ts", "nested/segment.ts", "secret.json", "segment-0.ts%3fsecret", "master.m3u8/extra"]) {
    assert.equal((await fetch(base + "/__private/media/" + suffix)).status, 400, suffix);
  }
  await symlink(join(directory, "segment-0.ts"), join(directory, "linked.ts"));
  assert.equal((await fetch(base + "/__private/media/linked.ts")).status, 503);
  await chmod(join(directory, "segment-0.ts"), 0o644);
  assert.equal((await fetch(base + "/__private/media/segment-0.ts")).status, 503);
  await chmod(directory, 0o755);
  assert.equal((await fetch(base + "/__private/media/master.m3u8")).status, 503);
  await chmod(directory, 0o700);
  const inside = join(repository, "media");
  await mkdir(inside, { mode: 0o700 });
  await writeFile(join(inside, "master.m3u8"), "#EXTM3U\n", { mode: 0o600 });
  setDirectory(inside);
  assert.equal((await fetch(base + "/__private/media/master.m3u8")).status, 503);
});

test("local manifests cannot request remote, absolute, variable or traversing resources", async t => {
  const { base, directory } = await setup(t);
  const rejected = ["https://example.com/segment.ts", "//example.com/segment.ts", "/segment.ts", "../segment.ts", "segment.ts?token=x", "{$host}.ts"];
  for (const uri of rejected) {
    for (const line of [uri, `#EXT-X-MEDIA:TYPE=AUDIO,URI="${uri}"`, `#EXT-X-CONTENT-STEERING:SERVER-URI="${uri}"`]) {
      await writeFile(join(directory, "master.m3u8"), `#EXTM3U\n${line}\n`);
      const response = await fetch(base + "/__private/media/master.m3u8");
      assert.equal(response.status, 503, line);
      assert.ok(!(await response.text()).includes(uri));
    }
  }
});

test("a bare carriage return cannot hide a remote HLS reference", async t => {
  const { base, directory } = await setup(t);
  for (const hidden of [
    "#EXTINF:4,\rhttps://example.invalid/segment.ts",
    '#comment\r#EXT-X-MEDIA:TYPE=AUDIO,URI="https://example.invalid/audio.m3u8"',
    "#comment\r#EXT-X-STREAM-INF:BANDWIDTH=1000\rhttps://example.invalid/variant.m3u8",
  ]) {
    await writeFile(join(directory, "master.m3u8"), `#EXTM3U\n${hidden}\n`);
    assert.equal((await fetch(base + "/__private/media/master.m3u8")).status, 503, hidden);
  }
});

test("every HLS playlist role requires a validated m3u8 child", async t => {
  const { base, directory } = await setup(t);
  for (const name of ["variant.ts", "variant.mp4", "variant.m4s", "variant.aac", "variant.vtt"]) {
    await writeFile(join(directory, name), "#EXTM3U\n#EXTINF:4,\nhttps://example.invalid/segment.ts\n", { mode: 0o600 });
    for (const reference of [
      `#EXT-X-STREAM-INF:BANDWIDTH=1000\n${name}`,
      `#EXT-X-MEDIA:TYPE=AUDIO,URI="${name}"`,
      `#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1000,URI="${name}"`,
      `#EXT-X-IMAGE-STREAM-INF:BANDWIDTH=1000,URI="${name}"`,
      `#EXT-X-RENDITION-REPORT:URI="${name}"`,
    ]) {
      await writeFile(join(directory, "master.m3u8"), `#EXTM3U\n${reference}\n`);
      assert.equal((await fetch(base + "/__private/media/master.m3u8")).status, 503, reference);
    }
  }
  for (const newline of ["\n", "\r\n"]) {
    const valid = ["#EXTM3U", '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"',
      "#EXT-X-STREAM-INF:BANDWIDTH=1000", "#comment", "video.m3u8", ""].join(newline);
    await writeFile(join(directory, "master.m3u8"), valid);
    assert.equal((await fetch(base + "/__private/media/master.m3u8")).status, 200);
  }
});

test("local HLS does not accept content steering through an opaque file", async t => {
  const { base, directory } = await setup(t);
  await writeFile(join(directory, "master.m3u8"), '#EXTM3U\n#EXT-X-CONTENT-STEERING:SERVER-URI="steering.mp4"\n');
  assert.equal((await fetch(base + "/__private/media/master.m3u8")).status, 503);
});
