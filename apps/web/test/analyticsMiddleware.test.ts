import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createAnalyticsMiddleware } from "../src/server/analyticsMiddleware";
import type { AnalyticsProxyConfig } from "../src/server/analyticsProxy";

const CFG = { apiKey: "dummy-api-key", licenseKey: "dummy-license" } satisfies AnalyticsProxyConfig;
const VALID = { aggregation: "avg", dimension: "STARTUPTIME", start: "2024-01-01T00:00:00Z", end: "2024-01-02T00:00:00Z" };

function mockFetch() {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    data: { result: { rows: [[123]], rowCount: 1 } },
  }), { status: 200 }));
}

async function withServer(
  cfg: AnalyticsProxyConfig,
  fetchFn: typeof fetch,
  test: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer(createAnalyticsMiddleware(cfg, fetchFn));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address() as AddressInfo;
    await test(`http://127.0.0.1:${address.port}/api/analytics/query`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function post(url: string, body: string): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body, signal: AbortSignal.timeout(1000) });
}

describe("Analytics HTTP boundary", () => {
  it("rejects invalid JSON shapes and keeps serving valid requests", async () => {
    const upstream = mockFetch();
    await withServer(CFG, upstream, async (url) => {
      for (const body of ["null", "[]", "true", "42", '"text"', "["]) {
        const response = await post(url, body);
        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.text()).not.toContain(CFG.apiKey);
      }
      expect(upstream).not.toHaveBeenCalled();
      const response = await post(url, JSON.stringify(VALID));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ rows: [[123]], rowCount: 1 });
      expect(upstream).toHaveBeenCalledTimes(1);
    });
  });

  it("contains an unexpected handler rejection and serves the next request", async () => {
    let fail = true;
    const cfg = { ...CFG, get apiKey() {
      if (fail) { fail = false; throw new Error(CFG.apiKey); }
      return CFG.apiKey;
    } };
    const upstream = mockFetch();
    await withServer(cfg, upstream, async (url) => {
      const failed = await post(url, JSON.stringify(VALID));
      expect(failed.status).toBe(500);
      const text = await failed.text();
      expect(JSON.parse(text)).toMatchObject({ error: "internal_error" });
      expect(text).not.toContain(CFG.apiKey);
      expect(upstream).not.toHaveBeenCalled();
      const next = await post(url, JSON.stringify(VALID));
      expect(next.status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(1);
    });
  });
});
