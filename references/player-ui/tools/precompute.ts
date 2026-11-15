import { readFileSync, writeFileSync } from "node:fs";
import { computeEngagement } from "../src/engagement.ts";
import { validateManifest } from "../src/snapshot.ts";
import { serializeSnapshot } from "./generate-fixtures.ts";
import type { DemoExport } from "../src/types.ts";

const args = process.argv.slice(2);
if (args.some((argument) => argument !== "--check") || args.length > 1) throw new Error("Usage: node tools/precompute.ts [--check]");
const check = args.includes("--check");
const root = new URL("../public/data/", import.meta.url);
const manifest = validateManifest(JSON.parse(readFileSync(new URL("manifest.json", root), "utf8")));
let stale = false;
for (const profile of manifest.profiles) {
  const input = JSON.parse(readFileSync(new URL(profile.samples, root), "utf8")) as DemoExport;
  if (JSON.stringify(input.content) !== JSON.stringify(manifest.content)) throw new Error(`Content identity differs for ${profile.id}`);
  const serialized = serializeSnapshot(computeEngagement(input));
  const destination = new URL(profile.snapshot, root);
  if (check) {
    let existing: string | undefined;
    try { existing = readFileSync(destination, "utf8"); } catch { existing = undefined; }
    if (existing !== serialized) { console.error(`Stale or missing snapshot: ${profile.snapshot}`); stale = true; }
  } else writeFileSync(destination, serialized);
}
if (stale) process.exitCode = 1;
else console.log(`${check ? "Verified" : "Prepared"} ${manifest.profiles.length} deterministic synthetic snapshots.`);
