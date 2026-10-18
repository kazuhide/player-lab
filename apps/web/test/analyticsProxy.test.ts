import { describe, it, expect, vi } from "vitest";
import {
  handleAnalyticsQuery,
  buildBitmovinQuery,
  shapeAnalyticsResponse,
  isAggregation,
  ANALYTICS_BASE_URL,
  type AnalyticsProxyConfig,
} from "../src/server/analyticsProxy";

const CFG: AnalyticsProxyConfig = { apiKey: "secret-key", licenseKey: "lic-123", orgId: "org-9" };
const VALID = { aggregation: "avg", dimension: "STARTUPTIME", start: "2024-01-01T00:00:00Z", end: "2024-01-02T00:00:00Z" };

/** A fetch mock returning a Bitmovin-shaped response; records the call. */
function mockFetch(status: number, payload: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    } as unknown as Response;
  });
}

describe("isAggregation", () => {
  it("accepts allow-listed aggregations and rejects others", () => {
    expect(isAggregation("avg")).toBe(true);
    expect(isAggregation("count")).toBe(true);
    expect(isAggregation("../../evil")).toBe(false);
    expect(isAggregation("DROP")).toBe(false);
    expect(isAggregation(undefined)).toBe(false);
  });
});

describe("buildBitmovinQuery", () => {
  it.each([null, [], 0, "", true].map((body) => ({ body })))("rejects a non-object JSON body ($body)", ({ body }) => {
    expect(buildBitmovinQuery(body, CFG))
      .toMatchObject({ ok: false, status: 400, message: "Request body must be a JSON object." });
  });
  it("injects the license + caps the limit and passes through optional fields", () => {
    const r = buildBitmovinQuery({ ...VALID, interval: "HOUR", groupBy: ["x"], limit: 99999 }, CFG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.aggregation).toBe("avg");
    expect(r.query).toMatchObject({ licenseKey: "lic-123", dimension: "STARTUPTIME", interval: "HOUR", groupBy: ["x"], limit: 1000 });
  });
  it("rejects a bad aggregation (SSRF guard)", () => {
    const r = buildBitmovinQuery({ ...VALID, aggregation: "../secrets" }, CFG);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
  it("rejects missing dimension / non-ISO timestamps", () => {
    expect(buildBitmovinQuery({ ...VALID, dimension: "" }, CFG)).toMatchObject({ ok: false, status: 400 });
    expect(buildBitmovinQuery({ ...VALID, start: "yesterday" }, CFG)).toMatchObject({ ok: false, status: 400 });
  });
  it("is not_configured (503) when the license key is absent", () => {
    expect(buildBitmovinQuery(VALID, { apiKey: "k" })).toMatchObject({ ok: false, status: 503, error: "not_configured" });
  });
});

describe("shapeAnalyticsResponse", () => {
  it("extracts rows/rowCount defensively", () => {
    expect(shapeAnalyticsResponse({ data: { result: { rows: [[1], [2]], rowCount: 2 } } })).toEqual({ rows: [[1], [2]], rowCount: 2 });
    expect(shapeAnalyticsResponse({})).toEqual({ rows: [], rowCount: 0 });
    expect(shapeAnalyticsResponse(null)).toEqual({ rows: [], rowCount: 0 });
  });
});

describe("handleAnalyticsQuery", () => {
  it.each([null, [], 0, "", true].map((body) => ({ body })))("rejects non-object JSON before contacting upstream ($body)", async ({ body }) => {
    const f = mockFetch(200, {});
    const r = await handleAnalyticsQuery(body, CFG, f);
    expect(r.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("does not echo server credentials in a transport error", async () => {
    const f = vi.fn(async () => { throw new Error(CFG.apiKey); });
    const r = await handleAnalyticsQuery(VALID, CFG, f);
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.json)).not.toContain(CFG.apiKey);
  });
  it("does not echo credentials reflected in an upstream error body", async () => {
    const f = mockFetch(401, { message: CFG.apiKey });
    const r = await handleAnalyticsQuery(VALID, CFG, f);
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.json)).not.toContain(CFG.apiKey);
  });
  it("returns 503 not_configured when the API key is missing (never calls fetch)", async () => {
    const f = mockFetch(200, {});
    const r = await handleAnalyticsQuery(VALID, { licenseKey: "lic" }, f);
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ error: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });

  it("forwards to the allow-listed path with the secret header + injected license, and shapes the result", async () => {
    const f = mockFetch(200, { data: { result: { rows: [[1234.5]], rowCount: 1 } } });
    const r = await handleAnalyticsQuery({ ...VALID, interval: "DAY" }, CFG, f);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ rows: [[1234.5]], rowCount: 1, aggregation: "avg", dimension: "STARTUPTIME" });
    // The upstream call: correct URL (aggregation in path), secret header, org header, injected license.
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`${ANALYTICS_BASE_URL}/avg`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("secret-key");
    expect(headers["X-Tenant-Org-Id"]).toBe("org-9");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toMatchObject({ licenseKey: "lic-123", dimension: "STARTUPTIME", interval: "DAY" });
  });

  it("never includes the secret key / license / org in the response JSON", async () => {
    const f = mockFetch(200, { data: { result: { rows: [[1]], rowCount: 1 } } });
    const r = await handleAnalyticsQuery(VALID, CFG, f);
    const serialized = JSON.stringify(r.json);
    expect(serialized).not.toContain("secret-key");
    expect(serialized).not.toContain("lic-123");
    expect(serialized).not.toContain("org-9");
    expect(serialized).not.toMatch(/X-Api-Key/i);
  });

  it("omits X-Tenant-Org-Id when no orgId is configured", async () => {
    const f = mockFetch(200, { data: { result: { rows: [], rowCount: 0 } } });
    await handleAnalyticsQuery(VALID, { apiKey: "k", licenseKey: "l" }, f);
    const headers = (f.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("k");
    expect(headers["X-Tenant-Org-Id"]).toBeUndefined();
  });

  it("rejects an invalid aggregation before any fetch (SSRF guard)", async () => {
    const f = mockFetch(200, {});
    const r = await handleAnalyticsQuery({ ...VALID, aggregation: "../../v1/encoding" }, CFG, f);
    expect(r.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("preserves an upstream 401 without exposing the response body", async () => {
    const f = mockFetch(401, { message: "Invalid API key" });
    const r = await handleAnalyticsQuery(VALID, CFG, f);
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ error: "upstream_error", upstreamStatus: 401, message: "Bitmovin Analytics returned HTTP 401." });
  });

  it("collapses a non-auth upstream error to 502", async () => {
    const f = mockFetch(500, { message: "boom" });
    const r = await handleAnalyticsQuery(VALID, CFG, f);
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ error: "upstream_error", upstreamStatus: 500 });
  });

  it("returns 502 upstream_unreachable when fetch throws", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = await handleAnalyticsQuery(VALID, CFG, f as unknown as typeof fetch);
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ error: "upstream_unreachable" });
  });
});
