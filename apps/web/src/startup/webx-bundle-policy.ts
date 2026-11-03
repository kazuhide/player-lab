import type { DemoSource } from "./demo-contract";

/** Internal controlled build condition; arbitrary sources always retain full bundles. */
export const COMPACT_COMMON_HLS = true;

export function isCommonFixedHls(source: Pick<DemoSource, "url" | "format" | "custom">, base: string): boolean {
  if (source.custom || source.format !== "hls") return false;
  try { return source.url === new URL("media/vod-baseline/comparison-360p.m3u8", base).href; }
  catch { return false; }
}

export function useCompactCommonHls(source: Pick<DemoSource, "url" | "format" | "custom">, base: string): boolean {
  return COMPACT_COMMON_HLS && isCommonFixedHls(source, base);
}
