import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(join(tmpdir(), "player-lab-diagnostics-test-"));
async function reports(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? reports(join(directory, entry.name))
    : entry.name === "browser-diagnostics.json" ? [join(directory, entry.name)] : []))).flat();
}
try {
  const run = spawnSync(process.execPath, [resolve(root, "node_modules/@playwright/test/cli.js"), "test",
    "--config", "playwright.diagnostics.config.ts", "--output", output],
    { cwd: root, encoding: "utf8", timeout: 90_000, maxBuffer: 256 * 1024 });
  assert.equal(run.status, 1, "The isolated fixture must fail, rather than silently passing or failing to launch.");
  const paths = await reports(output);
  assert.equal(paths.length, 1, "A failed test must save exactly one sanitized diagnostic attachment.\n"
    + (run.stdout + run.stderr).slice(-8000));
  const text = await readFile(paths[0], "utf8");
  const snapshot = JSON.parse(text);
  assert.equal(snapshot.uncaughtErrors, 1);
  assert.ok(snapshot.events.some(event => event.kind === "pageerror" && event.category === "licensing-impression"));
  assert.ok(snapshot.events.some(event => event.kind === "requestfailed"));
  assert.doesNotMatch(text, /private-fixture-marker|diagnostic-fixture\.invalid|token=/);
  console.log("Browser diagnostic self-test passed: the intentional failure saved a redacted report.");
} finally {
  await rm(output, { recursive: true, force: true });
}
