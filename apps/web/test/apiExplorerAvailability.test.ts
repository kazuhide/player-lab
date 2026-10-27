import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlayerAPI } from "bitmovin-player";
import type { ApiMaterializer } from "../src/api/materialize";
import type { ApiEntry, ApiSchema, Signature } from "../src/api/types";

vi.mock("bitmovin-player", () => ({ PlayerEvent: new Proxy({}, { get: (_target, key) => String(key).toLowerCase() }) }));

// The repository has no DOM test dependency. Exercise the explorer's real form
// and event handlers with the same small EventTarget-based boundary used by its
// existing view tests; browser layout and native selection are E2E concerns.
class TestElement extends EventTarget {
  className = ""; textContent = ""; type = ""; hidden = false; disabled = false;
  checked = false; title = ""; id = ""; dataset: Record<string, string> = {};
  attributes = new Map<string, string>(); childNodes: TestElement[] = [];
  private selectedValue = "";
  constructor(readonly tagName = "div") { super(); }
  get children(): TestElement[] { return this.childNodes; }
  get options(): TestElement[] { return this.childNodes; }
  get value(): string { return this.selectedValue || (this.tagName === "select" ? this.options[0]?.value ?? "" : ""); }
  set value(value: string) { this.selectedValue = value; }
  set selectedIndex(index: number) { this.selectedValue = this.options[index]?.value ?? ""; }
  append(...children: TestElement[]): void { this.childNodes.push(...children); }
  replaceChildren(...children: TestElement[]): void { this.childNodes = children; this.selectedValue = ""; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  contains(element: TestElement): boolean { return this === element || this.childNodes.some(child => child.contains(element)); }
}

function elements(root: TestElement): TestElement[] { return [root, ...root.childNodes.flatMap(elements)]; }
function find(root: TestElement, predicate: (element: TestElement) => boolean): TestElement {
  const found = elements(root).find(predicate); if (!found) throw new Error("Missing test control"); return found;
}

const signature: Signature = { parameters: [], returns: "empty" };
const skip: ApiEntry = { id: "PlayerAPI.ads.skip", root: "PlayerAPI", category: "command", schema: "skip" };
const catalog: ApiSchema = { schemaVersion: 1, playerVersion: "8.281.0", uiVersion: "4.23.0", constructors: {},
  rows: [skip, { id: "PlayerAPI.timeShift", root: "PlayerAPI", category: "command", schema: "timeShift" }],
  nodes: { empty: { kind: "void", label: "void" }, number: { kind: "number", label: "number" },
    skip: { kind: "function", label: "skip", signatures: [signature] },
    timeShift: { kind: "function", label: "timeShift", signatures: [{ ...signature,
      parameters: [{ name: "offset", schema: "number", optional: false, rest: false }] }] } } };

interface ExplorerHarness {
  catalog: ApiSchema;
  render(): void;
  refresh(): void;
  relocalize(): void;
  context(key: string): ApiMaterializer;
  invoke(entry: ApiEntry, signature: Signature, inputs: unknown[]): Promise<void>;
}

function playerFixture() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  let activeAd: { isLinear: boolean; skippableAfter?: number } | null = null;
  let currentTime = 0; let live = true;
  const skipAd = vi.fn(async () => {});
  const player = {
    getSource: () => ({ hls: "https://example.test/source.m3u8" }), getConfig: () => ({}),
    isLive: () => live, getMaxTimeShift: () => -30, getCurrentTime: () => currentTime,
    ads: { getActiveAd: () => activeAd, isLinearAdActive: () => !!activeAd?.isLinear,
      getModuleInfo: () => ({ name: "advertising-bitmovin", version: "8.281.0" }), skip: skipAd },
    timeShift: vi.fn(), on(event: string, listener: (event: unknown) => void) {
      const group = listeners.get(event) ?? new Set(); group.add(listener); listeners.set(event, group);
    }, off(event: string, listener: (event: unknown) => void) { listeners.get(event)?.delete(listener); },
  } as unknown as PlayerAPI;
  return { player, skipAd, listeners, setAd: (ad: typeof activeAd) => { activeAd = ad; },
    setTime: (time: number) => { currentTime = time; }, setLive: (value: boolean) => { live = value; },
    emit: (event: string) => listeners.get(event)?.forEach(listener => listener({ type: event })) };
}

async function mounted(getPlayer: () => PlayerAPI | undefined) {
  const { ApiExplorer } = await import("../src/api/explorer");
  const container = new TestElement();
  const explorer = new ApiExplorer(container as unknown as HTMLElement, { getPlayer, getUi: () => undefined,
    apply: async () => "applied", load: async () => {}, destroy: async () => {}, releaseUi: () => {}, recreate: async () => "applied" }) as unknown as ExplorerHarness;
  explorer.catalog = catalog; explorer.render(); explorer.refresh();
  const category = find(container, element => element.attributes.get("aria-label") === "API category");
  category.value = "command"; category.dispatchEvent(new Event("change"));
  const picker = find(container, element => element.attributes.get("aria-label") === "SDK entry");
  const select = (id: string) => { picker.value = id; picker.dispatchEvent(new Event("change")); };
  return { container, explorer, picker, select };
}

beforeEach(async () => {
  for (const name of ["HTMLElement", "HTMLVideoElement", "Element", "Document", "Node"]) vi.stubGlobal(name, TestElement);
  vi.stubGlobal("document", { createElement: (tag: string) => new TestElement(tag), createTextNode: (text: string) => {
    const node = new TestElement("text"); node.textContent = text; return node;
  }, getElementById: () => null, querySelector: () => null });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  const { setLang } = await import("../src/i18n"); setLang("en");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("disables ordinary-source skip in the picker and Run, then updates from SDK events without log catalog rows", async () => {
  const fixture = playerFixture(); const view = await mounted(() => fixture.player); view.select(skip.id);
  const run = find(view.container, element => element.textContent === "Run API");
  const choice = view.picker.options.find(option => option.value === skip.id)!;
  expect(choice.disabled).toBe(true); expect(run.disabled).toBe(true);
  expect(choice.textContent).toContain("No ad is active.");
  run.dispatchEvent(new Event("click")); await Promise.resolve();
  expect(fixture.skipAd).not.toHaveBeenCalled();
  fixture.setAd({ isLinear: true, skippableAfter: 5 }); fixture.setTime(4); fixture.emit("adstarted");
  expect(run.disabled).toBe(true);
  fixture.setTime(5); fixture.emit("timechanged");
  expect(run.disabled).toBe(false); expect(choice.disabled).toBe(false);
  fixture.setAd(null); fixture.emit("adfinished");
  expect(run.disabled).toBe(true); expect(view.picker.value).toBe(skip.id);
  fixture.setAd({ isLinear: false }); fixture.setTime(NaN); fixture.emit("nonlinearadstarted");
  expect(run.disabled).toBe(false);
  fixture.setAd(null); fixture.emit("nonlinearadfinished"); expect(run.disabled).toBe(true);
});

it("preserves the selected operation, argument node and draft through state and language changes", async () => {
  const fixture = playerFixture(); const view = await mounted(() => fixture.player); view.select("PlayerAPI.timeShift");
  const input = find(view.container, element => element.attributes.get("aria-label") === "number"); input.value = "-12";
  const run = find(view.container, element => element.textContent === "Run API");
  fixture.setLive(false); fixture.emit("timechanged");
  expect(run.disabled).toBe(true); expect(view.picker.value).toBe("PlayerAPI.timeShift");
  expect(find(view.container, element => element.attributes.get("aria-label") === "number")).toBe(input);
  expect(input.value).toBe("-12");
  const { setLang } = await import("../src/i18n"); setLang("ja"); view.explorer.relocalize();
  expect(view.picker.options.find(option => option.value === "PlayerAPI.timeShift")!.textContent).toContain("ライブソース");
  expect(input.value).toBe("-12");
});

it("rechecks prerequisites after argument materialization and rolls back without dispatching", async () => {
  const fixture = playerFixture(); fixture.setAd({ isLinear: false });
  const view = await mounted(() => fixture.player);
  const context = view.explorer.context("runtime:PlayerAPI");
  const materialize = context.arguments.bind(context);
  vi.spyOn(context, "arguments").mockImplementation((signature, values) => {
    const args = materialize(signature, values); fixture.setAd(null); return args;
  });
  await expect(view.explorer.invoke(skip, signature, [])).rejects.toThrow("No ad is active.");
  expect(fixture.skipAd).not.toHaveBeenCalled();
});

it("retains owner and method checks when materialization replaces the player or removes a method", async () => {
  const first = playerFixture(); const replacement = playerFixture(); let current = first.player;
  first.setAd({ isLinear: false }); replacement.setAd({ isLinear: false });
  const view = await mounted(() => current);
  const context = view.explorer.context("runtime:PlayerAPI");
  const materialize = context.arguments.bind(context);
  vi.spyOn(context, "arguments").mockImplementation((signature, values) => {
    const args = materialize(signature, values); current = replacement.player; return args;
  });
  await view.explorer.invoke(skip, signature, []);
  expect(first.skipAd).not.toHaveBeenCalled(); expect(replacement.skipAd).not.toHaveBeenCalled();
  view.explorer.refresh();
  const next = view.explorer.context("runtime:PlayerAPI");
  const nextMaterialize = next.arguments.bind(next);
  vi.spyOn(next, "arguments").mockImplementation((signature, values) => {
    const args = nextMaterialize(signature, values);
    Object.assign(replacement.player.ads, { skip: undefined }); return args;
  });
  await expect(view.explorer.invoke(skip, signature, [])).rejects.toThrow("Unavailable in the current SDK instance.");
  expect(replacement.skipAd).not.toHaveBeenCalled();
});

it("keeps a failed source unavailable despite its retained configuration until a new source loads", async () => {
  const fixture = playerFixture(); const view = await mounted(() => fixture.player);
  view.select("PlayerAPI.timeShift");
  const input = find(view.container, element => element.attributes.get("aria-label") === "number"); input.value = "-12";
  const run = find(view.container, element => element.textContent === "Run API");
  expect(run.disabled).toBe(false);
  fixture.emit("error"); fixture.emit("timechanged"); view.explorer.refresh();
  expect(fixture.player.getSource()).not.toBeNull();
  expect(run.disabled).toBe(true);
  expect(view.picker.options.find(option => option.value === "PlayerAPI.timeShift")!.disabled).toBe(true);
  run.dispatchEvent(new Event("click")); await Promise.resolve();
  expect(fixture.player.timeShift).not.toHaveBeenCalled();
  fixture.emit("sourceloaded");
  expect(run.disabled).toBe(false); expect(input.value).toBe("-12");
});

it("rejects an error received while arguments are materialized without dispatching to a failed source", async () => {
  const fixture = playerFixture(); const view = await mounted(() => fixture.player);
  const context = view.explorer.context("runtime:PlayerAPI");
  const materialize = context.arguments.bind(context);
  vi.spyOn(context, "arguments").mockImplementation((signature, values) => {
    const args = materialize(signature, values); fixture.emit("error"); return args;
  });
  const entry = catalog.rows.find(row => row.id === "PlayerAPI.timeShift")!;
  await expect(view.explorer.invoke(entry, catalog.nodes[entry.schema!]!.signatures![0]!, [-12])).rejects.toThrow("Load a source first.");
  expect(fixture.player.timeShift).not.toHaveBeenCalled();
});

it("ignores an error from a retired player and clears the old failure when a new player is attached", async () => {
  const first = playerFixture(); const second = playerFixture(); let current = first.player;
  const view = await mounted(() => current); view.select("PlayerAPI.timeShift");
  const run = find(view.container, element => element.textContent === "Run API");
  const retiredErrors = [...first.listeners.get("error")!];
  first.emit("error"); expect(run.disabled).toBe(true);
  current = second.player; view.explorer.refresh();
  retiredErrors.forEach(listener => listener({ type: "error" }));
  expect(run.disabled).toBe(false);
});
