const BROWSERS = ["chromium", "firefox", "safari"] as const;
const SYSTEMS = ["android", "ios", "macos", "windows", "linux"] as const;
type MissingReason = "unavailable" | "unrecognized";
export type EnvironmentValue<T> = { readonly value: T; readonly reason: null }
  | { readonly value: null; readonly reason: MissingReason };
export interface EnvironmentSnapshot {
  readonly browserFamily: EnvironmentValue<typeof BROWSERS[number]>;
  readonly browserMajorVersion: EnvironmentValue<number>;
  readonly osFamily: EnvironmentValue<typeof SYSTEMS[number]>;
  readonly logicalProcessorCount: EnvironmentValue<number>;
  readonly approximateDeviceMemoryGiB: EnvironmentValue<number>;
  readonly viewportWidthCssPixels: EnvironmentValue<number>;
  readonly viewportHeightCssPixels: EnvironmentValue<number>;
  readonly devicePixelRatio: EnvironmentValue<number>;
}
interface EnvironmentSource {
  readonly userAgent?: unknown; readonly hardwareConcurrency?: unknown; readonly deviceMemory?: unknown;
  readonly innerWidth?: unknown; readonly innerHeight?: unknown; readonly devicePixelRatio?: unknown;
}
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const bounded = (maximum: number, integer = false) => (value: unknown): value is number =>
  positive(value) && value <= maximum && (!integer || Number.isSafeInteger(value));
const majorVersion = bounded(9999, true);
const processors = bounded(4096, true);
const memoryGiB = bounded(65536);
const viewportPixels = bounded(100000, true);
const pixelRatio = bounded(16);
const known = <T>(value: T): EnvironmentValue<T> => Object.freeze({ value, reason: null });
const missing = (reason: MissingReason): EnvironmentValue<never> => Object.freeze({ value: null, reason });

function number(value: unknown, accepts: (value: unknown) => value is number): EnvironmentValue<number> {
  return accepts(value) ? known(value)
    : missing(value === undefined || value === null ? "unavailable" : "unrecognized");
}

/** Read coarse reported values only. No raw user-agent or device identity survives. */
export function captureEnvironment(source: EnvironmentSource): EnvironmentSnapshot {
  const ua = typeof source.userAgent === "string" && source.userAgent.length <= 1024 ? source.userAgent : "";
  const reason = source.userAgent === undefined || source.userAgent === "" ? "unavailable" : "unrecognized";
  let browser: EnvironmentSnapshot["browserFamily"] = missing(reason);
  let major: EnvironmentValue<number> = missing(reason);
  for (const [family, pattern] of [
    ["firefox", /(?:Firefox|FxiOS)\/(\d+)/],
    ["chromium", /(?:HeadlessChrome|Chrome|Chromium|CriOS)\/(\d+)/],
    ["safari", /Version\/(\d+)(?:[.\d]*).*Safari\//],
  ] as const) {
    const match = ua.match(pattern);
    if (match) { browser = known(family); major = number(Number(match[1]), majorVersion); break; }
  }
  let os: EnvironmentSnapshot["osFamily"] = missing(reason);
  for (const [family, pattern] of [
    ["android", /Android/], ["ios", /iPhone|iPad|iPod/], ["windows", /Windows/],
    ["macos", /Macintosh|Mac OS X/], ["linux", /Linux/],
  ] as const) {
    if (pattern.test(ua)) { os = known(family); break; }
  }
  return Object.freeze({ browserFamily: browser, browserMajorVersion: major, osFamily: os,
    logicalProcessorCount: number(source.hardwareConcurrency, processors),
    approximateDeviceMemoryGiB: number(source.deviceMemory, memoryGiB),
    viewportWidthCssPixels: number(source.innerWidth, viewportPixels), viewportHeightCssPixels: number(source.innerHeight, viewportPixels),
    devicePixelRatio: number(source.devicePixelRatio, pixelRatio) });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid comparison environment.");
  return value as Record<string, unknown>;
}
function field<T>(input: unknown, accepts: (value: unknown) => value is T): EnvironmentValue<T> {
  const value = record(input);
  if (value.value === null && (value.reason === "unavailable" || value.reason === "unrecognized")) return missing(value.reason);
  if (value.reason !== null || !accepts(value.value)) throw new Error("Invalid comparison environment value.");
  return known(value.value);
}

/** Reconstruct the complete safe export shape, including explicit missing reasons. */
export function parseEnvironment(input: unknown): EnvironmentSnapshot {
  const value = record(input);
  return Object.freeze({
    browserFamily: field(value.browserFamily, (item): item is typeof BROWSERS[number] => BROWSERS.includes(item as typeof BROWSERS[number])),
    browserMajorVersion: field(value.browserMajorVersion, majorVersion),
    osFamily: field(value.osFamily, (item): item is typeof SYSTEMS[number] => SYSTEMS.includes(item as typeof SYSTEMS[number])),
    logicalProcessorCount: field(value.logicalProcessorCount, processors),
    approximateDeviceMemoryGiB: field(value.approximateDeviceMemoryGiB, memoryGiB),
    viewportWidthCssPixels: field(value.viewportWidthCssPixels, viewportPixels),
    viewportHeightCssPixels: field(value.viewportHeightCssPixels, viewportPixels),
    devicePixelRatio: field(value.devicePixelRatio, pixelRatio),
  });
}

export function parseUtc(input: unknown): string {
  if (typeof input !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input)
    || !Number.isFinite(Date.parse(input)) || new Date(input).toISOString() !== input) {
    throw new Error("Invalid comparison UTC timestamp.");
  }
  return input;
}

/** Preserve the existing epoch-aligned selection clock; do not sample Date.now. */
export function utcFromEpochMs(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Invalid comparison selection timestamp.");
  return parseUtc(new Date(value).toISOString());
}
