import type { DemoSource } from "./demo-contract";

/** Startup and seek share one rendition; the network scenario retains adaptation. */
export function defaultDemoSource(base: string, network: boolean): DemoSource {
  const playlist = network ? "master.m3u8" : "comparison-360p.m3u8";
  return { url: new URL(`media/vod-baseline/${playlist}`, base).href,
    format: "hls", custom: false, label: "Big Buck Bunny" };
}
