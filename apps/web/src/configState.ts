import type { DeepPartial } from "./configPanel";

/** Layer a patch onto a config without mutating it. Explicit undefined removes an
 * override; omitting a key keeps it. Empty parent objects are removed as well, so
 * clearing an override lets the preset or SDK default take effect again. */
export function deepMerge<T>(base: T, over: DeepPartial<T>): T {
  const out = { ...(base as Record<string, unknown>) } as Record<string, unknown>;
  for (const k of Object.keys(over as object)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const ov = (over as Record<string, unknown>)[k];
    const bv = out[k];
    if (ov === undefined) {
      delete out[k];
    } else if (ov !== null && typeof ov === "object" && !Array.isArray(ov)) {
      const parent = bv !== null && typeof bv === "object" && !Array.isArray(bv) ? bv : {};
      const merged = deepMerge(parent, ov as DeepPartial<typeof parent>);
      if (Object.keys(merged).length > 0) out[k] = merged;
      else delete out[k];
    } else {
      out[k] = ov;
    }
  }
  return out as T;
}

/** Read a config field without exposing unrelated configuration values. */
export function configValue(config: unknown, path: string): unknown {
  let value = config;
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
