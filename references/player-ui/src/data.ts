import { validateManifest, validateSnapshot } from "./snapshot.ts";
import type { DemoContent, DemoManifest, EngagementSnapshot } from "./types.ts";

const MAX_JSON_BYTES = 512 * 1024;

export async function readJSON(url: URL, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error("Data request failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let value = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_JSON_BYTES) throw new Error("Data exceeds the supported size");
      value += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(value + decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export async function readManifest(url: URL, signal?: AbortSignal): Promise<DemoManifest> {
  return validateManifest(await readJSON(url, signal));
}

export async function readSnapshot(url: URL, expected: DemoContent, signal?: AbortSignal): Promise<EngagementSnapshot> {
  const snapshot = validateSnapshot(await readJSON(url, signal));
  if (snapshot.content.id !== expected.id || snapshot.content.revision !== expected.revision ||
      snapshot.content.durationMs !== expected.durationMs) throw new Error("Snapshot content does not match the video");
  return snapshot;
}
