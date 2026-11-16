import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, sep } from "node:path";
import type { Plugin } from "vite";
import { validatePrivateData } from "../src/private-data.ts";
import { privateMediaHandler } from "./private-media.ts";

const ENDPOINT = "/__private/query-data";
const MAX_BYTES = 524_288;
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?$/;
const LOOPBACK_PEERS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function reply(response: ServerResponse, status: number, data: unknown): void {
  response.statusCode = status;
  response.removeHeader("access-control-allow-origin");
  response.removeHeader("access-control-allow-credentials");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.end(JSON.stringify(data));
}

async function readPrivateFile(file: string, repository: string, mediaDirectory?: string): Promise<unknown> {
  const [target, root] = await Promise.all([realpath(file), realpath(repository)]);
  const path = relative(root, target);
  if (path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))) {
    throw new Error("Private data must be outside the repository");
  }
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAX_BYTES || (stats.mode & 0o077) !== 0) {
      throw new Error("Private data must be a bounded, owner-only regular file");
    }
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) throw new Error("Private data exceeds the size limit");
    const data: unknown = JSON.parse(buffer.subarray(0, length).toString("utf8"));
    const { source } = validatePrivateData(data);
    if (source.hls === "/__private/media/master.m3u8" && !mediaDirectory) throw new Error("Private media is not configured");
    return data;
  } finally {
    await handle.close();
  }
}

/** Serves one explicitly configured local file; it never forwards account credentials or API requests. */
export function privateQueryHandler(file: string | undefined, repository: string, mediaDirectory?: string) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    if (request.url?.split("?")[0] !== ENDPOINT) { next(); return; }
    const host = request.headers.host ?? "";
    const origin = request.headers.origin;
    const forwarded = Object.keys(request.headers).some(name => name === "forwarded" || name.startsWith("x-forwarded-"));
    if (!LOOPBACK_HOST.test(host) || !LOOPBACK_PEERS.has(request.socket.remoteAddress ?? "") ||
      (origin !== undefined && origin !== `http://${host}`) || request.headers["sec-fetch-site"] === "cross-site" || forwarded) {
      reply(response, 403, { error: "Private data requires a direct same-origin loopback request" });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      reply(response, 405, { error: "Read-only endpoint" });
      return;
    }
    if (request.url?.includes("?")) { reply(response, 400, { error: "Query parameters are not supported" }); return; }
    if (!file) { reply(response, 404, { error: "Private Query data is not configured" }); return; }
    void readPrivateFile(file, repository, mediaDirectory).then(
      data => reply(response, 200, data),
      () => reply(response, 503, { error: "Private Query data is unavailable or invalid" }),
    );
  };
}

/** Dev-server middleware only. Private files are never read by the production build. */
export function privateQueryPlugin(file: string | undefined, repository: string, mediaDirectory?: string): Plugin {
  return {
    name: "player-ui-private-query",
    apply: "serve",
    configureServer(server) {
      if ((file || mediaDirectory) && !["127.0.0.1", "localhost", "::1"].includes(String(server.config.server.host))) {
        throw new Error("Private Query data requires a loopback dev server");
      }
      server.middlewares.use(privateMediaHandler(file, mediaDirectory, repository));
      server.middlewares.use(privateQueryHandler(file, repository, mediaDirectory));
    },
  };
}
