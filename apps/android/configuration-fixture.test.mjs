import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startConfigurationServer } from "./configuration-fixture.mjs";

test("configuration fixture serves media unchanged and bounds temporary HTTP failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "android-configuration-"));
  const outside = await mkdtemp(join(tmpdir(), "android-outside-"));
  let server;
  try {
    await mkdir(join(directory, "vod-multiaudio"));
    await mkdir(join(directory, "vod-baseline"));
    const manifest = "#EXTM3U\n../vod-baseline/media_0.m3u8\n";
    await writeFile(join(directory, "vod-multiaudio/master.m3u8"), manifest);
    await writeFile(join(directory, "vod-baseline/media_0.m3u8"), "#EXTM3U\n#EXT-X-ENDLIST\n");
    await writeFile(join(directory, "outside.txt"), "not media");
    await writeFile(join(outside, "not-media.txt"), "outside media root");
    await symlink(join(outside, "not-media.txt"), join(directory, "vod-baseline/escape.m4s"));
    server = await startConfigurationServer(join(directory, "vod-baseline"), 0);
    assert.equal((await fetch(`${server.origin}/master.m3u8`)).status, 404);
    await server.close();
    server = await startConfigurationServer(directory, 0);
    server.reset(2);
    const url = `${server.origin}/retry/vod-multiaudio/master.m3u8`;
    assert.equal((await fetch(url)).status, 503);
    assert.equal((await fetch(url)).status, 503);
    const success = await fetch(url);
    assert.equal(success.status, 200);
    assert.equal(await success.text(), manifest);
    assert.equal((await fetch(`${server.origin}/retry/vod-baseline/media_0.m3u8`)).status, 200);
    assert.deepEqual(server.counts(), { remainingFailures: 0, retryManifestRequests: 3, retryFailures: 2, subtitleRequests: 0 });
    const subtitle = await fetch(`${server.origin}/captions.vtt`);
    assert.equal(subtitle.headers.get("content-type"), "text/vtt");
    const cues = await subtitle.text();
    assert.match(cues, /00:00:00\.250 --> 00:00:01\.750\nPlayer Lab external subtitle 1\n/);
    assert.match(cues, /00:00:58\.250 --> 00:00:59\.750\nPlayer Lab external subtitle 30\n/);
    assert.equal((cues.match(/ --> /g) ?? []).length, 30);
    assert.equal(server.counts().subtitleRequests, 1);
    for (const value of [-1, 4, 1.5, NaN]) assert.throws(() => server.reset(value), RangeError);
    server.reset(0);
    assert.deepEqual(server.counts(), { remainingFailures: 0, retryManifestRequests: 0, retryFailures: 0, subtitleRequests: 0 });
    assert.equal((await fetch(url, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${server.origin}/outside.txt`)).status, 404);
    assert.equal((await fetch(`${server.origin}/vod-baseline/escape.m4s`)).status, 404);
    assert.equal((await fetch(`${server.origin}/vod-baseline/%2e%2e/outside.txt`)).status, 404);
  } finally {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
