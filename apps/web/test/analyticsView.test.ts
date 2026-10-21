import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalyticsView } from "../src/analyticsView";
import { setLang } from "../src/i18n";

class TestElement extends EventTarget {
  className = "";
  textContent = "";
  disabled = false;
  hidden = false;
  dataset: Record<string, string> = {};
  children: TestElement[] = [];
  attributes = new Map<string, string>();
  append(...children: TestElement[]): void { this.children.push(...children); }
  appendChild(child: TestElement): TestElement { this.append(child); return child; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
}

function child(root: HTMLElement, className: string): TestElement {
  const found = (root as unknown as TestElement).children.find((element) => element.className === className);
  if (!found) throw new Error(`Missing ${className}`);
  return found;
}

describe("Analytics view on a static host", () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ rows: [[42]], rowCount: 1 })));

  beforeEach(() => {
    vi.stubGlobal("document", { createElement: () => new TestElement() });
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("MODE", "pages");
    vi.stubEnv("VITE_BITMOVIN_ANALYTICS_LICENSE_KEY", "");
    fetch.mockClear();
    setLang("en");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("explains the unavailable query before interaction and disables every preset", () => {
    const view = createAnalyticsView();
    expect(child(view.el, "analytics-intro").textContent).toContain("static host");
    expect(child(view.el, "analytics-intro").textContent).toContain("QoE");
    const buttons = child(view.el, "analytics-controls").children;
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks synthetic click events even when disabled controls dispatch them", async () => {
    const view = createAnalyticsView();
    for (const button of child(view.el, "analytics-controls").children) {
      button.dispatchEvent(new Event("click"));
    }
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(child(view.el, "analytics-status").textContent).toContain("static host");
    expect(child(view.el, "analytics-result").hidden).toBe(true);
  });

  it("discloses collection in both languages only when a public collector is configured", () => {
    const disabled = createAnalyticsView();
    expect((disabled.el as unknown as TestElement).children.some((element) => element.className === "analytics-collector-notice")).toBe(false);
    vi.stubEnv("VITE_BITMOVIN_ANALYTICS_LICENSE_KEY", "fake-public-analytics-key");
    const enabled = createAnalyticsView();
    const notice = child(enabled.el, "analytics-collector-notice");
    expect(notice.textContent).toContain("Playback and device information");
    expect(notice.textContent).not.toContain("fake-public-analytics-key");
    setLang("ja");
    enabled.relocalize();
    expect(notice.textContent).toContain("再生情報や端末情報");
    expect(child(enabled.el, "analytics-controls").children.every((button) => button.disabled)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("relocalizes the initial explanation and guarded query status", () => {
    const view = createAnalyticsView();
    child(view.el, "analytics-controls").children[0]!.dispatchEvent(new Event("click"));
    setLang("ja");
    view.relocalize();
    expect(child(view.el, "analytics-intro").textContent).toContain("静的ファイル");
    expect(child(view.el, "analytics-status").textContent).toContain("静的ファイル");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps normal development queries enabled and sends the existing server request", async () => {
    vi.stubEnv("MODE", "development");
    const view = createAnalyticsView();
    expect(child(view.el, "analytics-intro").textContent).toContain("/api/analytics/query");
    const buttons = child(view.el, "analytics-controls").children;
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    buttons[0]!.dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(child(view.el, "analytics-result").hidden).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/analytics/query");
    expect(request).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    const body = JSON.parse(request!.body as string);
    expect(body).toMatchObject({ aggregation: "count", dimension: "IMPRESSION_ID" });
    expect(Date.parse(body.end) - Date.parse(body.start)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(child(view.el, "analytics-result").textContent).toBe("42");
  });

  it("queries video startup using the public Analytics attribute", async () => {
    vi.stubEnv("MODE", "development");
    const view = createAnalyticsView();
    child(view.el, "analytics-controls").children[2]!.dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(child(view.el, "analytics-result").hidden).toBe(false));
    const [, request] = fetch.mock.calls[0]!;
    expect(JSON.parse(request!.body as string)).toMatchObject({
      aggregation: "avg", dimension: "VIDEO_STARTUPTIME",
    });
  });
});
