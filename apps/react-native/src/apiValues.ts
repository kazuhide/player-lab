/** Bounded display for SDK values, including cyclic objects and sensitive configuration. */
export function apiValue(value: unknown): string {
  const seen = new Set<object>();
  let budget = 200;
  function visit(item: unknown, depth: number, name = ""): unknown {
    if (/key|token|authorization|cookie|password|secret|credential|header/i.test(name)) return "[redacted]";
    if (budget-- <= 0) return "[truncated]";
    if (item === undefined) return "undefined";
    if (typeof item === "number" && !Number.isFinite(item)) return String(item);
    if (typeof item === "string") return item.length > 1000 ? item.slice(0, 1000) + "…" : item;
    if (typeof item === "function") return "[function]";
    if (typeof item === "bigint") return String(item);
    if (!item || typeof item !== "object") return item;
    if (seen.has(item)) return "[circular]";
    if (depth >= 5) return "[nested object]";
    seen.add(item);
    if (Array.isArray(item)) return item.slice(0, 30).map((entry) => visit(entry, depth + 1));
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(item).slice(0, 40)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      try { output[key] = visit(Reflect.get(item, key), depth + 1, key); }
      catch { output[key] = "[unavailable]"; }
    }
    return output;
  }
  return JSON.stringify(visit(value, 0), null, 2) ?? String(value);
}

export function finiteNumber(raw: string, label: string, minimum = -Infinity, maximum = Infinity): number {
  if (!raw.trim()) throw new Error(`${label} requires a number.`);
  const value = Number(raw);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) ||
      !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function stringEntries(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/).filter((line) => line.trim())) {
    const equals = line.indexOf("=");
    if (equals <= 0) throw new Error("Enter one name=value pair per line.");
    const name = line.slice(0, equals).trim();
    if (["__proto__", "constructor", "prototype"].includes(name) || Object.prototype.hasOwnProperty.call(result, name)) {
      throw new Error("Names must be unique and cannot be prototype properties.");
    }
    result[name] = line.slice(equals + 1);
  }
  return result;
}
