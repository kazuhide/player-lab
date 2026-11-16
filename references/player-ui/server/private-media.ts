import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, join, relative, sep } from "node:path";

const PREFIX = "/__private/media/";
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_PLAYLIST_BYTES = 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.(m3u8|ts|m4s|mp4|aac|vtt)$/;
const TYPES: Record<string, string> = {
  m3u8: "application/vnd.apple.mpegurl", ts: "video/mp2t", m4s: "video/iso.segment",
  mp4: "video/mp4", aac: "audio/aac", vtt: "text/vtt; charset=utf-8",
};

function end(response: ServerResponse, status: number): void {
  response.statusCode = status;
  response.end();
}

function validatePlaylist(text: string): void {
  if (!text.startsWith("#EXTM3U\n") && !text.startsWith("#EXTM3U\r\n")) throw new Error("Invalid local playlist");
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (!line.startsWith("#")) {
      if (!SAFE_NAME.test(line)) throw new Error("Nonlocal playlist reference");
      continue;
    }
    if (line.startsWith("#EXT-X-DEFINE:")) throw new Error("Playlist variables are unsupported");
    for (const match of line.matchAll(/\b[A-Z0-9-]*URI\s*=\s*(?:"([^"]*)"|([^,\r\n]*))/gi)) {
      if (!SAFE_NAME.test(match[1] ?? match[2])) throw new Error("Nonlocal playlist attribute");
    }
  }
}

async function openMedia(directory: string, name: string, repository: string): Promise<{ handle: FileHandle; size: number; playlist?: Buffer }> {
  const [target, root, original] = await Promise.all([realpath(directory), realpath(repository), lstat(directory)]);
  const relativePath = relative(root, target);
  if (relativePath === "" || (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`)) ||
    !original.isDirectory() || original.isSymbolicLink() || (original.mode & 0o077) !== 0 ||
    (process.getuid && original.uid !== process.getuid())) throw new Error("Invalid private media directory");
  const handle = await open(join(target, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size < 1 || stats.size > MAX_FILE_BYTES || (stats.mode & 0o077) !== 0 ||
      (process.getuid && stats.uid !== process.getuid())) throw new Error("Invalid private media file");
    if (!name.endsWith(".m3u8")) return { handle, size: stats.size };
    if (stats.size > MAX_PLAYLIST_BYTES) throw new Error("Oversized local playlist");
    // Bound allocation and preserve the validated bytes for the response.
    const bytes = Buffer.alloc(MAX_PLAYLIST_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_PLAYLIST_BYTES) throw new Error("Oversized local playlist");
    const playlist = bytes.subarray(0, length);
    validatePlaylist(playlist.toString("utf8"));
    return { handle, size: length, playlist };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function byteRange(value: string | undefined, size: number): [number, number] | null {
  if (value === undefined) return [0, size - 1];
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))) return null;
  const start = first ?? Math.max(0, size - (last ?? 0));
  const finish = first === undefined ? size - 1 : Math.min(last ?? size - 1, size - 1);
  return start >= size || finish < start || (first === undefined && last === 0) ? null : [start, finish];
}

/** Serves explicitly configured private HLS files only on the loopback development server. */
export function privateMediaHandler(file: string | undefined, directory: string | undefined, repository: string) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    if (!request.url?.startsWith(PREFIX)) { next(); return; }
    response.removeHeader("access-control-allow-origin");
    response.removeHeader("access-control-allow-credentials");
    response.setHeader("cache-control", "no-store");
    response.setHeader("cross-origin-resource-policy", "same-origin");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    const host = request.headers.host ?? "";
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?$/.test(host) ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "") ||
      (request.headers.origin !== undefined && request.headers.origin !== `http://${host}`) ||
      request.headers["sec-fetch-site"] === "cross-site" ||
      Object.keys(request.headers).some(name => name === "forwarded" || name.startsWith("x-forwarded-"))) {
      end(response, 403); return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD"); end(response, 405); return;
    }
    const name = request.url.slice(PREFIX.length);
    if (!SAFE_NAME.test(name)) { end(response, 400); return; }
    if (!file || !directory) { end(response, 404); return; }
    void openMedia(directory, name, repository).then(async ({ handle, size, playlist }) => {
      if (response.destroyed) { await handle.close(); return; }
      const range = byteRange(request.headers.range, size);
      response.setHeader("accept-ranges", "bytes");
      if (!range) {
        await handle.close(); response.setHeader("content-range", `bytes */${size}`); end(response, 416); return;
      }
      const [start, finish] = range;
      response.statusCode = request.headers.range ? 206 : 200;
      response.setHeader("content-type", TYPES[name.slice(name.lastIndexOf(".") + 1)]);
      response.setHeader("content-length", finish - start + 1);
      if (request.headers.range) response.setHeader("content-range", `bytes ${start}-${finish}/${size}`);
      if (request.method === "HEAD" || playlist) {
        await handle.close(); response.end(request.method === "HEAD" ? undefined : playlist!.subarray(start, finish + 1)); return;
      }
      const stream = handle.createReadStream({ start, end: finish, autoClose: true });
      response.once("close", () => stream.destroy());
      stream.once("error", () => response.destroy());
      stream.pipe(response);
    }).catch(() => { if (!response.headersSent) end(response, 503); else response.destroy(); });
  };
}
