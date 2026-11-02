import { describe, expect, it, vi } from "vitest";
import { compatibleDashManifest, installCompatibleDashFixture } from "../../../tests/e2e/src/compatible-dash";
type TestPage = Parameters<typeof installCompatibleDashFixture>[0];

const representation = (id: number) => `<Representation id="${id}"><SegmentTemplate timescale="48000" initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"><SegmentTimeline><S t="0" d="95232"/><S d="96256" r="5"/></SegmentTimeline></SegmentTemplate></Representation>`;
describe("controlled DASH compatibility fixture", () => {
  it("changes only per-representation address templates, preserving original segment timing and bytes", () => {
    const xml = `<MPD type="static"><Period>${representation(0)}${representation(2)}</Period></MPD>`;
    const output = compatibleDashManifest(xml);
    expect(output).toBe(xml.replace('initialization="init-stream$RepresentationID$.m4s"', 'initialization="init-stream0.m4s"')
      .replace('media="chunk-stream$RepresentationID$-$Number%05d$.m4s"', 'media="chunk-stream0-$Number$.m4s"')
      .replace('initialization="init-stream$RepresentationID$.m4s"', 'initialization="init-stream2.m4s"')
      .replace('media="chunk-stream$RepresentationID$-$Number%05d$.m4s"', 'media="chunk-stream2-$Number$.m4s"'));
  });
  it("refuses an unexpected manifest and refuses to install against a public origin", async () => {
    expect(() => compatibleDashManifest('<MPD type="dynamic"/>')).toThrow();
    expect(() => compatibleDashManifest('<MPD type="static"><Representation id="0"/></MPD>')).toThrow();
    const route = vi.fn();
    await expect(installCompatibleDashFixture({ url: () => "https://media.invalid/comparison.html", route } as unknown as TestPage)).rejects.toThrow("local-test-only");
    expect(route).not.toHaveBeenCalled();
  });
  it("aliases a plain-number segment to its original padded request, preserving the response", async () => {
    const handlers: { match: string | RegExp; handle: (route: unknown) => Promise<void> }[] = [];
    const page = { url: () => "http://localhost:5000/player-lab/web/comparison.html",
      route: vi.fn(async (match, handle) => { handlers.push({ match, handle }); }), unroute: vi.fn(async () => {}) };
    const fixture = await installCompatibleDashFixture(page as unknown as TestPage);
    expect(fixture.url).toBe("http://localhost:5000/player-lab/web/media/vod-baseline/pwx-compatible.mpd");
    const manifest = handlers[0]!.match;
    expect(manifest instanceof RegExp && manifest.test(fixture.url + "?token=do-not-export")).toBe(true);
    expect(manifest instanceof RegExp && manifest.test(fixture.url + "/other")).toBe(false);
    const alias = handlers.find((entry) => entry.match instanceof RegExp
      && entry.match.test("http://localhost:5000/player-lab/web/media/vod-baseline/chunk-stream2-17.m4s"))!;
    const response = {}; const fetch = vi.fn(async () => response); const fulfill = vi.fn(async () => {});
    await alias.handle({ request: () => ({ url: () => "http://localhost:5000/player-lab/web/media/vod-baseline/chunk-stream2-17.m4s" }), fetch, fulfill });
    expect(fetch).toHaveBeenCalledExactlyOnceWith({ url: "http://localhost:5000/player-lab/web/media/vod-baseline/chunk-stream2-00017.m4s" });
    expect(fulfill).toHaveBeenCalledExactlyOnceWith({ response }); await fixture.dispose(); expect(page.unroute).toHaveBeenCalledTimes(2);
  });
});
