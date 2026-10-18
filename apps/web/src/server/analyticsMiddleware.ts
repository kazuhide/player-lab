import { Buffer } from "node:buffer";
import type { RequestListener } from "node:http";
import { handleAnalyticsQuery, type AnalyticsProxyConfig } from "./analyticsProxy";

const MAX_BODY_BYTES = 1_000_000;

/** The existing dev proxy's HTTP boundary, also exercised on a loopback server in tests. */
export function createAnalyticsMiddleware(
  cfg: AnalyticsProxyConfig,
  fetchFn: typeof fetch = fetch,
): RequestListener {
  return (req, res) => {
    let done = false; // guard so we respond exactly once
    const send = (status: number, json: unknown): void => {
      if (done || res.destroyed) return;
      const payload = JSON.stringify(json);
      done = true;
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(payload);
    };
    if (req.method !== "POST") return send(405, { error: "method_not_allowed", message: "Use POST." });

    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length; // byte-accurate cap
      if (size > MAX_BODY_BYTES) {
        send(413, { error: "payload_too_large", message: "Request body exceeds 1 MB." });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", () => send(400, { error: "request_error", message: "The request stream errored." }));
    req.on("end", () => {
      if (done) return; // already responded (e.g. 413)
      void (async () => {
        let body: unknown = {};
        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { error: "bad_json", message: "Request body is not valid JSON." });
        }
        const result = await handleAnalyticsQuery(body, cfg, fetchFn);
        send(result.status, result.json);
      })().catch(() => {
        // Never expose an exception or leave an async request rejection unhandled.
        send(500, { error: "internal_error", message: "The Analytics query could not be processed." });
      });
    });
  };
}
