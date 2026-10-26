const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object"
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const sensitive = /(?:^|[.\[\]])(?:key|licenseKey|apiKey|privateKey|publicKey)(?:$|[.\[\]])|token|authorization|cookie|password|secret|credential|headers?/i;
const callback = /(?:^|\.)(?:callbacks?|bodies|body)(?:\.|$)/i;
export const isSensitiveConfigurationPath = (path: string): boolean => sensitive.test(path);

/** Comparison stays in memory; only formatted, redacted values leave this module. */
export function sameConfigurationValue(left: unknown, right: unknown): boolean {
  const seen = new WeakMap<object, WeakSet<object>>();
  const equal = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (!(Array.isArray(a) && Array.isArray(b)) && !(record(a) && record(b))) return false;
    if (seen.get(a)?.has(b)) return true;
    const pairs = seen.get(a) ?? new WeakSet<object>(); pairs.add(b); seen.set(a, pairs);
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
    const left = Object.getOwnPropertyDescriptors(a), right = Object.getOwnPropertyDescriptors(b);
    const keys = Object.keys(left).filter(key => !Array.isArray(a) || key !== "length");
    if (keys.length !== Object.keys(right).filter(key => !Array.isArray(b) || key !== "length").length) return false;
    return keys.every(key => left[key] && right[key] && "value" in left[key]! && "value" in right[key]!
      && equal(left[key]!.value, right[key]!.value));
  };
  return equal(left, right);
}

export function redactConfigurationText(text: string): string {
  return text.replace(/(https?:\/\/)[^/?#\s@]+@/gi, "$1[redacted]@")
    .replace(/([?&])([^=&\s]+)=([^&#\s]*)/g, (match: string, separator: string, key: string) => {
      let name: string;
      try { name = decodeURIComponent(key.replace(/\+/g, " ")); }
      catch { return match; } // Keep malformed data unchanged; it is not an identified credential key.
      const credential = /^(?:(?:access|refresh|id|session|auth|bearer)[_-]?token|token|api[_-]?key|key|signature|sig|password|credentials?|authorization|auth|secret|client[_-]?secret|awsaccesskeyid|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential))$/i;
      return credential.test(name) ? `${separator}${key}=[redacted]` : match;
    })
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]");
}

/** Copy data strings safely while leaving arbitrary JavaScript program text unchanged. */
export function copiedConfigurationString(value: string, path: readonly string[] = []): string {
  const placeholders = ["YOUR_PLAYER_KEY", "YOUR_ANALYTICS_KEY", "YOUR_HEADER_VALUE", "YOUR_VALUE"];
  if (value && isSensitiveConfigurationPath(path.join(".")) && !placeholders.includes(value)) return "YOUR_VALUE";
  const url = value.trim();
  return /^https?:\/\/\S+$/i.test(url) ? value.replace(url, redactConfigurationText(url)) : value;
}

export function configurationValueText(value: unknown, path: string): string {
  let budget = 200;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, name: string, depth: number): unknown => {
    if (item === undefined) return "[not set]";
    if (isSensitiveConfigurationPath(name)) return "[redacted]";
    if (callback.test(name) || typeof item === "function") return "[callback]";
    if (budget-- <= 0 || depth > 8) return "[…]";
    if (typeof item === "string") return redactConfigurationText(item);
    if (typeof item === "number" && !Number.isFinite(item)) return String(item);
    if (!item || typeof item !== "object") return item;
    if (seen.has(item)) return "[circular]";
    seen.add(item);
    if (Array.isArray(item)) {
      const values = Array.from({ length: Math.min(item.length, budget + 1) }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        return !descriptor ? "[not set]" : "value" in descriptor ? visit(descriptor.value, `${name}.${index}`, depth + 1) : "[unavailable]";
      });
      if (values.length < item.length) values.push("[…]");
      return values;
    }
    if (!record(item)) return "[SDK value]";
    return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(item)).map(([key, descriptor]) => [
      redactConfigurationText(key), "value" in descriptor ? visit(descriptor.value, `${name}.${key}`, depth + 1) : "[unavailable]",
    ]));
  };
  const safe = visit(value, path, 0);
  if (safe === "") return '""';
  return (typeof safe === "string" ? safe : JSON.stringify(safe)).slice(0, 240);
}

export interface ConfigurationDifference {
  path: string;
  kind: "added" | "removed" | "changed";
  before: string;
  after: string;
}

export function configurationDifferences(before: unknown, after: unknown): ConfigurationDifference[] {
  const differences: ConfigurationDifference[] = [];
  const walk = (left: unknown, right: unknown, path: string, depth = 0) => {
    if (sameConfigurationValue(left, right)) return;
    const structured = (value: unknown) => record(value) || Array.isArray(value);
    const compatible = left === undefined || right === undefined || Array.isArray(left) === Array.isArray(right);
    if (depth < 32 && compatible && (structured(left) || left === undefined) && (structured(right) || right === undefined)) {
      const a = left && typeof left === "object" ? Object.getOwnPropertyDescriptors(left) : {};
      const b = right && typeof right === "object" ? Object.getOwnPropertyDescriptors(right) : {};
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => !(Array.isArray(left) || Array.isArray(right)) || key !== "length");
      if (keys.length) {
        for (const key of keys) walk(a[key]?.value, b[key]?.value, path ? `${path}.${key}` : key, depth + 1);
        return;
      }
    }
    differences.push({ path: redactConfigurationText(path), kind: left === undefined ? "added" : right === undefined ? "removed" : "changed",
      before: configurationValueText(left, path), after: configurationValueText(right, path) });
  };
  walk(before, after, "");
  return differences;
}
