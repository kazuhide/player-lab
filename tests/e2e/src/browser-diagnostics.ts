import type { Page, Request, Response } from "@playwright/test";

interface Destination { origin: string; path: string }
interface Frame extends Destination { line: number; column: number }
interface DiagnosticEvent {
  kind: "pageerror" | "response" | "requestfailed";
  at: string;
  destination?: Destination;
  category?: "licensing-impression" | "licensing" | "network" | "script";
  name?: string;
  frames?: Frame[];
  status?: number;
  reason?: string;
  method?: string;
  resourceType?: string;
}

const REDACTED: Destination = { origin: "redacted", path: "redacted" };
const PUBLIC_HOSTS = new Set(["licensing.bitmovin.com", "cdn.bitmovin.com", "analytics-ingress-global.bitmovin.com"]);
const ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError"]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const RESOURCE_TYPES = new Set(["document", "stylesheet", "image", "media", "font", "script", "texttrack", "xhr", "fetch", "eventsource", "websocket", "manifest"]);
const FAILURE_REASONS = new Set([
  "net::ERR_ABORTED", "net::ERR_FAILED", "net::ERR_CONNECTION_RESET", "net::ERR_CONNECTION_CLOSED",
  "net::ERR_CONNECTION_REFUSED", "net::ERR_TIMED_OUT", "net::ERR_NAME_NOT_RESOLVED", "net::ERR_INTERNET_DISCONNECTED",
  "net::ERR_BLOCKED_BY_CLIENT", "net::ERR_SSL_PROTOCOL_ERROR", "net::ERR_CERT_AUTHORITY_INVALID",
  "net::ERR_ACCESS_DENIED", "net::ERR_ADDRESS_UNREACHABLE", "net::ERR_HTTP_RESPONSE_CODE_FAILURE", "net::ERR_EMPTY_RESPONSE",
  "NS_BINDING_ABORTED", "NS_ERROR_UNKNOWN_HOST", "NS_ERROR_NET_RESET", "NS_ERROR_NET_TIMEOUT", "Load failed",
]);

function localPath(path: string): string {
  if (/^\/player-lab\/(?:ja\/)?$/.test(path) || /^\/player-lab\/web\/(?:guide\.html)?$/.test(path)) return path;
  const guide = path.match(/^\/player-lab\/(ja\/)?guide\/(.*)$/);
  if (guide) return `/player-lab/${guide[1] ?? ""}guide/${guide[2] ? "<article>" : ""}`;
  const asset = path.match(/^\/player-lab\/web\/assets\/(main|styles|schema|guide)-[A-Za-z0-9_-]{8,20}\.(js|css)$/);
  if (asset) return `/player-lab/web/assets/${asset[1]}-<build>.${asset[2]}`;
  if (/^\/player-lab\/web\/media\/(?:vod-baseline|vod-multiaudio|vod-sprites)\/(?:master\.m3u8|manifest\.mpd|media_[0-3]\.m3u8|init-stream[0-3]\.m4s|chunk-stream[0-3]-\d{5}\.m4s|subtitle-(?:en|de)(?:-\d{2}\.vtt|\.m3u8))$/.test(path)) return path;
  return "redacted";
}

/** Keep known public endpoints; arbitrary host names and path text may identify private content. */
export function safeDestination(address: string): Destination {
  if (address.length > 8192) return { ...REDACTED };
  try {
    const url = new URL(address);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ...REDACTED };
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      return { origin: url.origin, path: localPath(url.pathname) };
    }
    if (url.protocol !== "https:" || !PUBLIC_HOSTS.has(url.hostname) || url.port) return { ...REDACTED };
    let path = "redacted";
    if (url.hostname === "licensing.bitmovin.com" && /^\/licensing(?:\/(?:v?\d+\/)?impressions?)?\/?$/.test(url.pathname)) path = url.pathname;
    if (url.hostname === "cdn.bitmovin.com" && /^\/player\/web\/\d+(?:\.\d+){0,2}\/bitmovinplayer(?:-core)?\.js$/.test(url.pathname)) path = url.pathname;
    if (url.hostname === "analytics-ingress-global.bitmovin.com" && ["/", "/api/v2/session"].includes(url.pathname)) path = url.pathname;
    return { origin: url.origin, path };
  } catch {
    return { ...REDACTED };
  }
}

function frames(stack: string | undefined): Frame[] {
  return (stack ?? "").slice(0, 16_384).split("\n").slice(1, 9).flatMap(line => {
    const match = line.match(/(https?:\/\/[^\s)]+):(\d{1,7}):(\d{1,7})\)?$/);
    return match ? [{ ...safeDestination(match[1]!), line: Number(match[2]), column: Number(match[3]) }] : [];
  });
}

export class DiagnosticBuffer {
  private events: DiagnosticEvent[] = [];
  private readonly limit: number;
  private readonly now: () => number;
  private droppedEvents = 0;
  uncaughtErrors = 0;

  constructor(options: { limit?: number; now?: () => number } = {}) {
    this.limit = options.limit ?? 120;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.limit) || this.limit < 1 || this.limit > 500) throw new Error("Invalid diagnostic event limit.");
  }

  private add(event: Omit<DiagnosticEvent, "at">): void {
    if (this.events.length === this.limit) { this.events.shift(); this.droppedEvents++; }
    this.events.push({ ...event, at: new Date(this.now()).toISOString() });
  }

  pageError(error: Error): void {
    this.uncaughtErrors++;
    const message = error.message.slice(0, 16_384);
    const category = /licens/i.test(message) ? (/impression/i.test(message) ? "licensing-impression" : "licensing")
      : /network|fetch/i.test(message) ? "network" : "script";
    this.add({ kind: "pageerror", name: ERROR_NAMES.has(error.name) ? error.name : "Error", category, frames: frames(error.stack) });
  }

  response(address: string, status: number): void {
    if (!Number.isInteger(status) || status < 100 || status > 599) return;
    const destination = safeDestination(address);
    if (status < 400 && destination.origin !== "https://licensing.bitmovin.com") return;
    this.add({ kind: "response", destination, status });
  }

  requestFailed(address: string, reason: string, method: string, resourceType: string): void {
    this.add({ kind: "requestfailed", destination: safeDestination(address),
      reason: FAILURE_REASONS.has(reason) ? reason : "other",
      method: METHODS.has(method) ? method : "OTHER",
      resourceType: RESOURCE_TYPES.has(resourceType) ? resourceType : "other" });
  }

  snapshot(): { schemaVersion: number; uncaughtErrors: number; droppedEvents: number; events: DiagnosticEvent[] } {
    return { schemaVersion: 1, uncaughtErrors: this.uncaughtErrors, droppedEvents: this.droppedEvents,
      events: this.events.map(event => ({ ...event, ...(event.frames ? { frames: event.frames.map(frame => ({ ...frame })) } : {}),
        ...(event.destination ? { destination: { ...event.destination } } : {}) })) };
  }
}

export function collectBrowserDiagnostics(page: Page): { buffer: DiagnosticBuffer; dispose: () => void } {
  const buffer = new DiagnosticBuffer();
  const error = (value: Error) => buffer.pageError(value);
  const response = (value: Response) => buffer.response(value.url(), value.status());
  const failed = (value: Request) => buffer.requestFailed(value.url(), value.failure()?.errorText ?? "", value.method(), value.resourceType());
  page.on("pageerror", error);
  page.on("response", response);
  page.on("requestfailed", failed);
  return { buffer, dispose: () => {
    page.off("pageerror", error); page.off("response", response); page.off("requestfailed", failed);
  } };
}
