import type { Page, Route } from "@playwright/test";

/** Test adapter only: preserve the original media and every timeline/audio edge.
 * PWX10.3.1 supports plain $Number$ here, but not RepresentationID/padded tokens.
 * This controlled manifest and its aliases do not rewrite application/custom URLs.
 */
export function compatibleDashManifest(xml: string): string {
  if (xml.length > 1024 * 1024 || !/<MPD\b[^>]*\btype="static"/.test(xml)) throw new Error("The controlled DASH fixture is invalid.");
  let count = 0;
  const output = xml.replace(/<Representation\b[^>]*>[\s\S]*?<\/Representation>/g, (representation) => {
    const id = /^<Representation\b[^>]*\bid="(\d+)"/.exec(representation)?.[1];
    if (!id || !representation.includes('initialization="init-stream$RepresentationID$.m4s"')
      || !representation.includes('media="chunk-stream$RepresentationID$-$Number%05d$.m4s"')) {
      throw new Error("The controlled DASH fixture template changed.");
    }
    count++;
    return representation.replace('initialization="init-stream$RepresentationID$.m4s"', `initialization="init-stream${id}.m4s"`)
      .replace('media="chunk-stream$RepresentationID$-$Number%05d$.m4s"', `media="chunk-stream${id}-$Number$.m4s"`);
  });
  if (!count || count > 10 || /\$RepresentationID\$|\$Number%/.test(output)) throw new Error("The controlled DASH fixture has unsupported templates.");
  return output;
}

export async function installCompatibleDashFixture(page: Page): Promise<{ url: string; dispose: () => Promise<void> }> {
  const base = new URL(page.url());
  if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) || !["http:", "https:"].includes(base.protocol)) {
    throw new Error("The DASH compatibility fixture is local-test-only.");
  }
  const original = new URL("media/vod-baseline/manifest.mpd", base);
  const manifest = new URL("pwx-compatible.mpd", original);
  const directory = new URL(".", original);
  const manifestPattern = new RegExp("^" + manifest.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\?[^#]*)?$");
  const aliasPattern = new RegExp("^" + directory.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "chunk-stream([0-9]+)-([1-9][0-9]*)\\.m4s$");
  const serveManifest = async (route: Route) => {
    const response = await route.fetch({ url: original.href });
    if (!response.ok()) throw new Error("The original controlled DASH manifest is unavailable.");
    await route.fulfill({ status: 200, contentType: "application/dash+xml", body: compatibleDashManifest(await response.text()) });
  };
  const serveAlias = async (route: Route) => {
    const match = aliasPattern.exec(route.request().url());
    if (!match || Number(match[2]) > 99_999) { await route.abort(); return; }
    const padded = new URL(`chunk-stream${match[1]}-${match[2]!.padStart(5, "0")}.m4s`, directory);
    // route.fetch preserves the original request (including Range). No media is regenerated.
    const response = await route.fetch({ url: padded.href });
    await route.fulfill({ response });
  };
  await page.route(manifestPattern, serveManifest);
  await page.route(aliasPattern, serveAlias);
  return { url: manifest.href, dispose: async () => {
    await page.unroute(manifestPattern, serveManifest); await page.unroute(aliasPattern, serveAlias);
  } };
}
