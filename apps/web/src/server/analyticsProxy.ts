/**
 * Server-side proxy logic for Bitmovin Analytics queries — framework-agnostic so the same code
 * runs in the Vite dev middleware (see vite.config.ts) or any serverless function. It takes a
 * parsed request body, the SERVER-ONLY config (the secret API key that must never reach the
 * browser), and a `fetch` implementation, and returns a `{ status, json }` to send back.
 *
 * Why a proxy at all: the Analytics Query API authenticates with a secret `X-Api-Key` (a full
 * account key). Keeping it server-side keeps it off the client — the browser calls THIS proxy,
 * which injects the key and the Analytics license, then forwards to
 * `https://api.bitmovin.com/v1/analytics/queries/{aggregation}`. The browser never sees the key.
 *
 * Security: the only client-controlled part of the upstream URL is the aggregation segment, and
 * it's allow-listed (ALLOWED_AGGREGATIONS) — a client can't steer the proxy at an arbitrary URL.
 * The rest of the request is a JSON body that Bitmovin validates.
 */

export const ANALYTICS_BASE_URL = "https://api.bitmovin.com/v1/analytics/queries";

/** Aggregations Bitmovin exposes as `/queries/{type}`. Allow-listed (the only client-controlled
 *  URL segment) so the proxy can never be pointed at an arbitrary path. */
export const ALLOWED_AGGREGATIONS = [
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "median",
  "stddev",
  "percentile",
  "variance",
] as const;
export type Aggregation = (typeof ALLOWED_AGGREGATIONS)[number];

/** Server-only config. `apiKey` is the SECRET — it stays here and never reaches the client. */
export interface AnalyticsProxyConfig {
  apiKey?: string;
  /** The Analytics license whose data to query (the same license the collector reports to). */
  licenseKey?: string;
  /** Optional org id, required for organization-scoped API keys. */
  orgId?: string;
}

/** The query shape the browser sends to the proxy (a thin, validated subset). */
export interface AnalyticsQueryRequest {
  aggregation: string;
  dimension: string;
  start: string;
  end: string;
  interval?: string;
  filters?: unknown[];
  groupBy?: string[];
  limit?: number;
}

export interface ProxyResult {
  status: number;
  json: Record<string, unknown>;
}

const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T/;

export function isAggregation(x: unknown): x is Aggregation {
  return typeof x === "string" && (ALLOWED_AGGREGATIONS as readonly string[]).includes(x);
}

type BuildResult =
  | { ok: true; aggregation: Aggregation; query: Record<string, unknown> }
  | { ok: false; status: number; error: string; message: string };

/** Validate the client request and assemble the Bitmovin query body (injecting the license). */
export function buildBitmovinQuery(body: unknown, cfg: AnalyticsProxyConfig): BuildResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "bad_request", message: "Request body must be a JSON object." };
  }
  return buildObjectQuery(body as Record<string, unknown>, cfg);
}

function buildObjectQuery(body: Record<string, unknown>, cfg: AnalyticsProxyConfig): BuildResult {
  if (!isAggregation(body.aggregation)) {
    return { ok: false, status: 400, error: "bad_request", message: `aggregation must be one of: ${ALLOWED_AGGREGATIONS.join(", ")}` };
  }
  if (typeof body.dimension !== "string" || body.dimension.trim() === "") {
    return { ok: false, status: 400, error: "bad_request", message: "dimension is required" };
  }
  if (typeof body.start !== "string" || !ISO_PREFIX.test(body.start) || typeof body.end !== "string" || !ISO_PREFIX.test(body.end)) {
    return { ok: false, status: 400, error: "bad_request", message: "start and end must be ISO-8601 timestamps" };
  }
  if (!cfg.licenseKey) {
    return { ok: false, status: 503, error: "not_configured", message: "BITMOVIN_ANALYTICS_LICENSE_KEY is not set on the server." };
  }
  const query: Record<string, unknown> = {
    licenseKey: cfg.licenseKey,
    dimension: body.dimension,
    start: body.start,
    end: body.end,
  };
  if (typeof body.interval === "string" && body.interval) query.interval = body.interval;
  if (Array.isArray(body.filters)) query.filters = body.filters;
  if (Array.isArray(body.groupBy)) query.groupBy = body.groupBy;
  query.limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.min(Math.max(1, Math.trunc(body.limit)), 1000) : 200;
  return { ok: true, aggregation: body.aggregation, query };
}

/** Defensively pull `{ rows, rowCount }` out of Bitmovin's `{ data: { result } }` envelope. */
export function shapeAnalyticsResponse(raw: unknown): { rows: unknown[][]; rowCount: number } {
  const result = (raw as { data?: { result?: { rows?: unknown; rowCount?: unknown } } })?.data?.result ?? {};
  const rows = Array.isArray(result.rows) ? (result.rows as unknown[][]) : [];
  const rowCount = typeof result.rowCount === "number" ? result.rowCount : rows.length;
  return { rows, rowCount };
}

/** The proxy entry point. Returns the status + JSON to send back to the browser. */
export async function handleAnalyticsQuery(
  body: unknown,
  cfg: AnalyticsProxyConfig,
  fetchFn: typeof fetch,
): Promise<ProxyResult> {
  const built = buildBitmovinQuery(body, cfg);
  if (!built.ok) return { status: built.status, json: { error: built.error, message: built.message } };
  if (!cfg.apiKey) {
    return {
      status: 503,
      json: {
        error: "not_configured",
        message:
          "No Analytics API key on the server. Set BITMOVIN_API_KEY (or a dedicated BITMOVIN_ANALYTICS_API_KEY) and BITMOVIN_ANALYTICS_LICENSE_KEY in the repo-root .env to enable Analytics queries — the key stays server-side and is never sent to the browser.",
      },
    };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Api-Key": cfg.apiKey };
  if (cfg.orgId) headers["X-Tenant-Org-Id"] = cfg.orgId;

  let res: Response;
  let text: string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    res = await fetchFn(`${ANALYTICS_BASE_URL}/${built.aggregation}`, {
      method: "POST",
      headers,
      body: JSON.stringify(built.query),
      signal: controller.signal,
    });
    // Read the body inside the timeout window too, so a header-then-stall upstream can't hang.
    text = await res.text();
  } catch {
    // Transport errors can contain request headers or credentials. Keep them server-side.
    return { status: 502, json: { error: "upstream_unreachable", message: "Could not reach Bitmovin Analytics." } };
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    const message = `Bitmovin Analytics returned HTTP ${res.status}.`;
    // Preserve the auth status without echoing a response body that could reflect credentials.
    const status = res.status === 401 || res.status === 403 ? res.status : 502;
    return { status, json: { error: "upstream_error", upstreamStatus: res.status, message } };
  }

  const shaped = shapeAnalyticsResponse(parsed);
  return { status: 200, json: { ...shaped, aggregation: built.aggregation, dimension: built.query.dimension } };
}
