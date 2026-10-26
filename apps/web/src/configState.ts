import type { DeepPartial } from "./configPanel";

/** A completed SDK action may belong to a player or source that has since changed. */
export type ApplyOutcome = "applied" | "superseded";

/** Retire both success and failure from an action whose player or source changed. */
export async function settleApply(action: Promise<unknown>, isCurrent: () => boolean): Promise<ApplyOutcome> {
  try { await action; }
  catch (error) { if (isCurrent()) throw error; }
  return isCurrent() ? "applied" : "superseded";
}

/** SDK rejections can be structured objects rather than JavaScript Errors. */
export function applyErrorMessage(error: unknown): string {
  const reason = (message: unknown): string => typeof message === "string" && message.trim()
    ? message : "The operation failed without an error message.";
  if (error instanceof Error) return reason(error.message);
  if (error && typeof error === "object" && "message" in error) {
    const code = "code" in error && (typeof error.code === "number" || typeof error.code === "string") ? `${error.code}: ` : "";
    return code + reason(error.message);
  }
  return reason(error == null ? undefined : String(error));
}

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
