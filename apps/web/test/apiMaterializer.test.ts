import { expect, it, vi } from "vitest";
import { ApiMaterializer, ResourcePool, inputCode } from "../src/api/materialize";
import { BinaryInput, CallbackInput, FactoryInput, ResourceInput, type ApiSchema } from "../src/api/types";

const catalog: ApiSchema = { schemaVersion: 1, playerVersion: "8", uiVersion: "4", rows: [],
  nodes: { number: { kind: "number", label: "number" }, text: { kind: "string", label: "string" },
    empty: { kind: "void", label: "void" }, any: { kind: "unknown", label: "any" }, label: { kind: "instance", label: "Label", name: "Label", factories: ["Label"] } },
  constructors: { Label: { signatures: [{ parameters: [{ name: "text", schema: "text", optional: false, rest: false }], returns: "label" }] } } };

it("redacts copied URL credentials and header strings without mutating SDK inputs or callback programs", () => {
  const value = { url: "https://user:pass@example.test/master.m3u8?token=private-token&quality=hd", headers: { "X-Session": "private-header" }, data: "ordinary data" };
  const copied = inputCode(value);
  for (const secret of ["user:pass", "private-token", "private-header"]) expect(copied).not.toContain(secret);
  expect(copied).toContain("quality=hd"); expect(copied).toContain("ordinary data");
  expect(value.headers["X-Session"]).toBe("private-header");
  expect(value.url).toContain("private-token");
  expect(inputCode("https://example.test/master.m3u8?quality=hd")).toBe('"https://example.test/master.m3u8?quality=hd"');
  const body = 'return "https://example.test/a?token=program-data";';
  expect(inputCode(new CallbackInput(body, { parameters: [], returns: "text" }, true))).toContain(body);
  expect(JSON.parse(inputCode(body))).toBe(body);
});

it("creates a real typed object and preserves its identity within an apply context", () => {
  class Label { constructor(readonly text: string) {} }
  const pool = new ResourcePool({ Label });
  const materializer = new ApiMaterializer(catalog, { Label }, pool, {}, () => {});
  const input = new FactoryInput("Label", ["Play"]);
  const first = materializer.materialize(input);
  expect(first).toBeInstanceOf(Label);
  expect(first).toEqual(new Label("Play"));
  expect(materializer.materialize(input)).toBe(first);
  expect(() => materializer.materialize(new FactoryInput("Label", [3]))).toThrow(/text/);
});

it("compiles only approved callback bodies and validates their results when the SDK invokes them", () => {
  const notices: string[] = [];
  const materializer = new ApiMaterializer(catalog, {}, new ResourcePool({}), { factor: 2 }, message => notices.push(message));
  const signature = { parameters: [{ name: "value", schema: "number", optional: false, rest: false }], returns: "number" };
  expect(() => materializer.materialize(new CallbackInput("return value;", signature, false))).toThrow(/allow/i);
  const callback = materializer.materialize(new CallbackInput("return value * lab.factor;", signature, true)) as (n: number) => number;
  expect(notices).toHaveLength(0);
  expect(callback(3)).toBe(6);
  expect(notices).toHaveLength(1);
  const bad = materializer.materialize(new CallbackInput('return "wrong";', signature, true)) as (n: number) => number;
  expect(() => bad(3)).toThrow(/number/);
});

it("keeps callback identity for unsubscribe and ignores callbacks after disposal", () => {
  const materializer = new ApiMaterializer(catalog, {}, new ResourcePool({}), {}, () => {});
  const input = new CallbackInput("return value;", { parameters: [{ name: "value", schema: "number", optional: false, rest: false }], returns: "number" }, true);
  const callback = materializer.materialize(input) as (n: number) => unknown;
  expect(materializer.materialize(input)).toBe(callback);
  materializer.dispose();
  expect(callback(4)).toBeUndefined();
});

it("creates ArrayBuffer certificate bytes and exports factories without serializing SDK internals", () => {
  const materializer = new ApiMaterializer(catalog, {}, new ResourcePool({}), {}, () => {});
  const buffer = materializer.materialize(new BinaryInput("0001feff", "hex", "ArrayBuffer")) as ArrayBuffer;
  expect(buffer).toBeInstanceOf(ArrayBuffer);
  expect([...new Uint8Array(buffer)]).toEqual([0, 1, 254, 255]);
  expect(inputCode(new FactoryInput("Label", ["Play"]))).toBe('new PlayerUI.Label("Play")');
  expect(inputCode({ key: "private-value", autoplay: false })).not.toContain("private-value");
});

it("bounds owned resources and invalidates references across player generations", () => {
  class Label {}
  const pool = new ResourcePool({ Label }, 2);
  const id = pool.add(new Label(), "label", "Label")!;
  expect(pool.list({ kind: "instance", label: "Label", name: "Label" })).toHaveLength(1);
  pool.add(new Label(), "second", "Label");
  pool.add(new Label(), "third", "Label");
  expect(() => pool.get(id)).toThrow(/expired/i);
  pool.clear();
  expect(pool.list({ kind: "instance", label: "Label", name: "Label" })).toEqual([]);
});

it("checks syntax, constructor arguments and retired resources before changing the current player", () => {
  let created = 0;
  class Label { constructor(readonly text: string) { created++; } }
  const pool = new ResourcePool({ Label });
  const materializer = new ApiMaterializer(catalog, { Label }, pool, {}, () => {});
  const signature = { parameters: [], returns: "empty" };
  expect(() => materializer.preflight(new CallbackInput("return (;", signature, true))).toThrow(SyntaxError);
  expect(() => materializer.preflight(new CallbackInput("return;", signature, false))).toThrow(/allow/i);
  expect(() => materializer.preflight(new FactoryInput("Label", [7]))).toThrow(/text/);
  expect(() => materializer.preflight(new ResourceInput("expired"))).toThrow(/expired/i);
  materializer.preflight({ callback: new CallbackInput("return;", signature, true), label: new FactoryInput("Label", ["Title"]) });
  expect(created).toBe(0);
});

it("accepts a real SDK factory result when the published callback return type is any", () => {
  class Label {}
  const instance = new Label();
  const materializer = new ApiMaterializer(catalog, { Label }, new ResourcePool({ Label }), { instance }, () => {});
  const callback = materializer.materialize(new CallbackInput("return lab.instance;", { parameters: [], returns: "any" }, true)) as () => unknown;
  expect(callback()).toBe(instance);
});

it("honours the selected constructor overload and keeps binary code on its actual view type", () => {
  const overloaded: ApiSchema = { ...catalog, constructors: { ...catalog.constructors,
    Label: { signatures: [...catalog.constructors.Label!.signatures,
      { parameters: [{ name: "value", schema: "number", optional: false, rest: false }], returns: "label" }] } } };
  class Label { constructor(readonly value: string | number) {} }
  const materializer = new ApiMaterializer(overloaded, { Label }, new ResourcePool({ Label }), {}, () => {});
  expect(materializer.materialize(new FactoryInput("Label", [4], 1))).toEqual(new Label(4));
  expect(() => materializer.preflight(new FactoryInput("Label", [4], 20))).toThrow(/signature/i);
  const binary = new BinaryInput("0001feff", "hex", "DataView");
  const exported = new Function("return " + inputCode(binary))() as DataView;
  expect(exported).toBeInstanceOf(DataView);
  expect([...new Uint8Array(exported.buffer)]).toEqual([0, 1, 254, 255]);
});

it("exports callback rest parameters with the same argument grouping as the live callback", () => {
  const seen: unknown[][] = [];
  const lab = { collect: (values: unknown[]) => { seen.push(values); } };
  const input = new CallbackInput("lab.collect(params);", { parameters: [
    { name: "message", schema: "any", optional: false, rest: false },
    { name: "params", schema: "any", optional: false, rest: true },
  ], returns: "empty" }, true);
  const materializer = new ApiMaterializer(catalog, {}, new ResourcePool({}), lab, () => {});
  const live = materializer.materialize(input) as (...args: unknown[]) => void;
  const exported = new Function("lab", "return (" + inputCode(input) + ")")(lab) as typeof live;
  live("message", "first", 2); exported("message", "first", 2);
  expect(seen).toEqual([["first", 2], ["first", 2]]);
});

it("preserves actual callback argument counts and this without exposing lab as an SDK argument", () => {
  const input = new CallbackInput('return arguments.length + "/" + String(value) + "/" + params.length + "/" + this.name + "/" + lab.suffix;', {
    parameters: [{ name: "value", schema: "any", optional: true, rest: false },
      { name: "params", schema: "any", optional: false, rest: true }], returns: "text" }, true);
  const lab = { suffix: "end" };
  const materializer = new ApiMaterializer(catalog, {}, new ResourcePool({}), lab, () => {});
  const live = materializer.materialize(input) as (...args: unknown[]) => string;
  const exported = new Function("lab", "return (" + inputCode(input) + ")")(lab) as typeof live;
  const owner = { name: "owner" };
  for (const args of [[], [undefined], [1, "first", "second"]]) {
    expect(live.apply(owner, args)).toBe(exported.apply(owner, args));
  }
});

it("exports constructor rest arguments with the same spreading as the live factory", () => {
  const typed: ApiSchema = { ...catalog, nodes: { ...catalog.nodes, numbers: { kind: "array", label: "number[]", item: "number" } },
    constructors: { Label: { signatures: [{ parameters: [{ name: "values", schema: "numbers", optional: false, rest: true }], returns: "label" }] } } };
  class Label { constructor(...values: number[]) { this.values = values; } readonly values: number[]; }
  const input = new FactoryInput("Label", [[1, 2, 3]], 0, 0);
  const materializer = new ApiMaterializer(typed, { Label }, new ResourcePool({ Label }), {}, () => {});
  const live = materializer.materialize(input) as Label;
  const exported = new Function("PlayerUI", "return " + inputCode(input))({ Label }) as Label;
  expect(live.values).toEqual([1, 2, 3]);
  expect(exported.values).toEqual(live.values);
});

it("selects SDK-returned structural array items without rebuilding their identity", () => {
  const typed: ApiSchema = { ...catalog, nodes: { ...catalog.nodes,
    variant: { kind: "object", label: "UIVariant", properties: [{ name: "id", schema: "text", optional: false }] },
    variants: { kind: "array", label: "UIVariant[]", item: "variant" } } };
  const owner = {};
  const pool = new ResourcePool({});
  const first = { id: "first" }; const second = { id: "second" };
  pool.captureResult(typed, "variants", [first, second], "variants", owner);
  const resource = pool.list(typed.nodes.variant!).find(item => pool.get(item.id) === second)!;
  expect(resource).toBeDefined();
  const materializer = new ApiMaterializer(typed, {}, pool, {}, () => {});
  const args = materializer.arguments({ parameters: [{ name: "variant", schema: "variant", optional: false, rest: false }], returns: "empty" }, [new ResourceInput(resource.id)]);
  expect(args[0]).toBe(second);
  pool.retire(owner);
  expect(() => materializer.arguments({ parameters: [{ name: "variant", schema: "variant", optional: false, rest: false }], returns: "empty" }, [new ResourceInput(resource.id)])).toThrow(/expired/i);
});

it("releases an unused factory component after disposal without leaving its global subscription", async () => {
  const subscribed = new Set<object>(); let released = 0;
  class Label {
    constructor(readonly text: string) { subscribed.add(this); }
    release() { released++; subscribed.delete(this); }
  }
  const materializer = new ApiMaterializer(catalog, { Label }, new ResourcePool({ Label }), {}, () => {});
  materializer.materialize(new FactoryInput("Label", ["Not adopted by a UI"]));
  expect(subscribed.size).toBe(1);
  materializer.dispose(); await Promise.resolve();
  expect(subscribed.size).toBe(0); expect(released).toBe(1);
});

it("releases nested components once when SDK release and materializer cleanup share their ownership", async () => {
  const released: string[] = [];
  class Label { constructor(readonly text: string) {} release() { released.push(this.text); } }
  class Parent { constructor(readonly child: Label) {} release() { released.push("parent"); this.child.release(); } }
  const typed: ApiSchema = { ...catalog, nodes: { ...catalog.nodes, parent: { kind: "instance", label: "Parent", name: "Parent", factories: ["Parent"] } },
    constructors: { ...catalog.constructors, Parent: { signatures: [{ parameters: [{ name: "child", schema: "label", optional: false, rest: false }], returns: "parent" }] } } };
  const materializer = new ApiMaterializer(typed, { Label, Parent }, new ResourcePool({ Label, Parent }), {}, () => {});
  const parent = materializer.materialize(new FactoryInput("Parent", [new FactoryInput("Label", ["child"])])) as Parent;
  const cleanup = materializer.retire();
  await Promise.resolve(); expect(released).toEqual([]);
  parent.release(); cleanup(); cleanup(); materializer.dispose(); await Promise.resolve();
  expect(released).toEqual(["parent", "child"]);
});

it("rolls back earlier constructor allocations on failure and rebuilds their memoized inputs on retry", () => {
  const subscribed = new Set<object>(); let fail = true;
  class Label { constructor(readonly text: string) { subscribed.add(this); } release() { subscribed.delete(this); } }
  class Parent { constructor(readonly child: Label) { if (fail) throw new Error("constructor failed"); } release() { this.child.release(); } }
  const typed: ApiSchema = { ...catalog, nodes: { ...catalog.nodes, parent: { kind: "instance", label: "Parent", name: "Parent", factories: ["Parent"] } },
    constructors: { ...catalog.constructors, Parent: { signatures: [{ parameters: [{ name: "child", schema: "label", optional: false, rest: false }], returns: "parent" }] } } };
  const pool = new ResourcePool({ Label, Parent });
  const materializer = new ApiMaterializer(typed, { Label, Parent }, pool, {}, () => {});
  const child = new FactoryInput("Label", ["child"]); const input = new FactoryInput("Parent", [child]);
  expect(() => materializer.materialize(input)).toThrow("constructor failed");
  expect(subscribed.size).toBe(0); expect(pool.list(typed.nodes.label!)).toEqual([]);
  fail = false;
  const parent = materializer.materialize(input) as Parent;
  expect(subscribed.has(parent.child)).toBe(true);
  const cleanup = materializer.retire(); cleanup(); expect(subscribed.size).toBe(0);
});

it("releases only new allocations after argument validation or a failed SDK invocation", () => {
  let released = 0;
  class Label { constructor(readonly text: string) {} release() { released++; } }
  const pool = new ResourcePool({ Label });
  const materializer = new ApiMaterializer(catalog, { Label }, pool, {}, () => {});
  const existing = materializer.materialize(new FactoryInput("Label", ["retained"]));
  const signature = { parameters: [{ name: "label", schema: "label", optional: false, rest: false }, { name: "size", schema: "number", optional: false, rest: false }], returns: "empty" };
  expect(() => materializer.arguments(signature, [new FactoryInput("Label", ["invalid call"]), "wrong"])).toThrow("number");
  expect(released).toBe(1); expect(pool.list(catalog.nodes.label!)).toHaveLength(1);
  const checkpoint = materializer.checkpoint();
  materializer.materialize(new FactoryInput("Label", ["SDK rejected"]));
  materializer.rollback(checkpoint);
  expect(released).toBe(2); expect(pool.list(catalog.nodes.label!)).toHaveLength(1);
  expect(pool.get(pool.list(catalog.nodes.label!)[0]!.id)).toBe(existing);
  materializer.retire()(); expect(released).toBe(3);
});

it("does not release an SDK-owned query instance merely because it was selected as an argument", async () => {
  let released = 0;
  class Label { release() { released++; } }
  const pool = new ResourcePool({ Label }); const instance = new Label();
  const id = pool.add(instance, "SDK result", "Label", {})!;
  const materializer = new ApiMaterializer(catalog, { Label }, pool, {}, () => {});
  expect(materializer.arguments({ parameters: [{ name: "label", schema: "label", optional: false, rest: false }], returns: "empty" }, [new ResourceInput(id)])).toEqual([instance]);
  materializer.dispose(); await Promise.resolve(); expect(released).toBe(0); expect(pool.get(id)).toBe(instance);
});

it("recreates GUI-owned factory and callback recipes only for configuration while runtime references keep identity", async () => {
  class Label { constructor(readonly text: string) {} release() {} }
  const pool = new ResourcePool({ Label });
  const first = new ApiMaterializer(catalog, { Label }, pool, {}, () => {});
  const label = first.materialize(new FactoryInput("Label", ["current"]));
  const labelId = pool.list(catalog.nodes.label!)[0]!.id;
  const callback = first.materialize(new CallbackInput("return value;", { parameters: [{ name: "value", schema: "number", optional: false, rest: false }], returns: "number" }, true));
  const functionType = { kind: "function", label: "Function" };
  const callbackId = pool.list(functionType)[0]!.id;
  expect(first.materialize(new ResourceInput(labelId))).toBe(label);
  expect(first.materialize(new ResourceInput(callbackId))).toBe(callback);
  const recipe = pool.forConfiguration({ label: new ResourceInput(labelId), callback: new ResourceInput(callbackId) });
  first.dispose(); await Promise.resolve();
  const second = new ApiMaterializer(catalog, { Label }, pool, {}, () => {});
  const applied = second.materialize(recipe) as { label: Label; callback: (value: number) => number };
  expect(applied.label).toEqual(label); expect(applied.label).not.toBe(label);
  expect(applied.callback).not.toBe(callback); expect(applied.callback(4)).toBe(4);
  expect((callback as (value: number) => unknown)(4)).toBeUndefined();
  second.dispose(); await Promise.resolve();
});


it("preserves repeated recipe identity across a configuration replacement and rejects recipe cycles", () => {
  class Label { constructor(readonly text: string) {} release() {} }
  const pool = new ResourcePool({ Label });
  const first = new ApiMaterializer(catalog, { Label }, pool, {}, () => {});
  first.materialize(new FactoryInput("Label", ["shared"]));
  const id = pool.list(catalog.nodes.label!)[0]!.id;
  const recipe = pool.forConfiguration([new ResourceInput(id), new ResourceInput(id)]) as FactoryInput[];
  expect(recipe[0]).toBe(recipe[1]);
  first.retire()();
  const second = new ApiMaterializer(catalog, { Label }, pool, {}, () => {});
  const applied = second.materialize(recipe) as Label[];
  expect(applied[0]).toBe(applied[1]);
  second.retire()();
  const cycle: unknown[] = []; cycle.push(cycle);
  expect(() => pool.forConfiguration(cycle)).toThrow(/cycle/i);
  expect(() => pool.forConfiguration(new ResourceInput("expired"))).toThrow(/expired/i);
});

it("unsubscribes only the materializer's exact dispatcher observer and retires rolled-back callbacks", () => {
  class EventDispatcher {
    readonly listeners = new Set<() => void>();
    subscribe(listener: () => void) { this.listeners.add(listener); }
    unsubscribe(listener: () => void) { return this.listeners.delete(listener); }
  }
  const typed: ApiSchema = { ...catalog, constructors: { ...catalog.constructors,
    EventDispatcher: { signatures: [{ parameters: [], returns: "any" }] } } };
  const notices: string[] = [];
  const pool = new ResourcePool({ EventDispatcher });
  const materializer = new ApiMaterializer(typed, { EventDispatcher }, pool, {}, text => notices.push(text));
  const dispatcher = materializer.materialize(new FactoryInput("EventDispatcher", [])) as EventDispatcher;
  const external = () => {}; dispatcher.subscribe(external);
  expect(dispatcher.listeners.size).toBe(2);
  const checkpoint = materializer.checkpoint();
  const callbackInput = new CallbackInput("return value;", { parameters: [{ name: "value", schema: "number", optional: false, rest: false }], returns: "number" }, true);
  const callback = materializer.materialize(callbackInput) as (value: number) => unknown;
  materializer.rollback(checkpoint); expect(callback(3)).toBeUndefined(); expect(notices).toEqual([]);
  const retried = materializer.materialize(callbackInput) as typeof callback;
  expect(retried).not.toBe(callback); expect(retried(3)).toBe(3);
  materializer.retire()(); expect(dispatcher.listeners).toEqual(new Set([external]));
});

it("continues releasing other inputs if a public SDK release throws", () => {
  const released: string[] = []; const notices: string[] = [];
  class Label {
    constructor(readonly text: string) {}
    release() { released.push(this.text); if (this.text === "fails") throw new Error("SDK release failed"); }
  }
  const materializer = new ApiMaterializer(catalog, { Label }, new ResourcePool({ Label }), {}, text => notices.push(text));
  materializer.materialize(new FactoryInput("Label", ["retained"]));
  const failing = materializer.materialize(new FactoryInput("Label", ["fails"])) as Label;
  const cleanup = materializer.retire(); cleanup(); cleanup(); failing.release();
  expect(released).toEqual(["fails", "retained"]);
  expect(notices).toEqual(["An SDK input could not be fully released."]);
});


it("rolls back only the failed call's allocation range when a later SDK call has already created its inputs", () => {
  const released: string[] = [];
  class Label { constructor(readonly text: string) {} release() { released.push(this.text); } }
  const pool = new ResourcePool({ Label });
  const materializer = new ApiMaterializer(catalog, { Label }, pool, {}, () => {});
  const before = materializer.checkpoint();
  materializer.materialize(new FactoryInput("Label", ["failed call"]));
  const through = materializer.checkpoint();
  const later = materializer.materialize(new FactoryInput("Label", ["later call"]));
  materializer.rollback(before, through);
  expect(released).toEqual(["failed call"]);
  expect(pool.list(catalog.nodes.label!)).toHaveLength(1);
  expect(pool.get(pool.list(catalog.nodes.label!)[0]!.id)).toBe(later);
  materializer.retire()(); expect(released).toEqual(["failed call", "later call"]);
});

it("keeps new pending API inputs out of selectors until SDK success without hiding existing resources", () => {
  class Label { constructor(readonly text: string) {} release() {} }
  const pool = new ResourcePool({ Label });
  const materializer = new ApiMaterializer(catalog, { Label }, pool, {}, () => {});
  const existing = materializer.materialize(new FactoryInput("Label", ["existing"]));
  const before = materializer.checkpoint();
  const pending = materializer.materialize(new FactoryInput("Label", ["pending"]));
  const through = materializer.checkpoint();
  materializer.publish(before, through, false);
  expect(pool.list(catalog.nodes.label!).map(item => pool.get(item.id))).toEqual([existing]);
  materializer.publish(before, through);
  expect(pool.list(catalog.nodes.label!).map(item => pool.get(item.id))).toEqual([existing, pending]);
  materializer.retire()();
});


function componentLifecycleFixture() {
  class Dispatcher {
    readonly listeners = new Set<Function>();
    subscribe(listener: Function) { this.listeners.add(listener); }
    unsubscribe(listener: Function) { return this.listeners.delete(listener); }
  }
  const initial = new Dispatcher(); let current = initial;
  const i18n = { getConfig: () => ({ events: { onLanguageChanged: current } }) };
  const released: object[] = [];
  class Component {
    private readonly handler = () => {};
    constructor() { i18n.getConfig().events.onLanguageChanged.subscribe(this.handler); }
    release() { released.push(this); i18n.getConfig().events.onLanguageChanged.unsubscribe(this.handler); }
  }
  class Label extends Component { constructor(readonly text: string) { super(); } }
  class Container extends Component {
    protected readonly children: Component[] = [];
    getComponents() { return this.children; }
  }
  class SettingsPanelItem extends Container {
    constructor(private readonly config: { label?: string; settingComponent?: Component }) {
      super();
      if (config.label) this.children.push(new Label(config.label));
    }
    getConfig() { return this.config; }
  }
  const constructors = { Component, Label, Container, SettingsPanelItem, i18n };
  const typed: ApiSchema = { ...catalog, nodes: { ...catalog.nodes,
    panel: { kind: "instance", name: "SettingsPanelItem", label: "SettingsPanelItem" },
    component: { kind: "instance", name: "Component", label: "Component" },
    panelConfig: { kind: "object", label: "SettingsPanelItemConfig", properties: [
      { name: "label", schema: "text", optional: true }, { name: "settingComponent", schema: "component", optional: true },
    ] } }, constructors: { ...catalog.constructors,
      SettingsPanelItem: { signatures: [{ parameters: [{ name: "config", schema: "panelConfig", optional: false, rest: false }], returns: "panel" }] },
    } };
  return { initial, released, constructors, typed, Label, SettingsPanelItem,
    replaceDispatcher() { current = new Dispatcher(); return current; } };
}

it("unsubscribes unused components from their exact creation dispatcher after global localization changes", async () => {
  const f = componentLifecycleFixture();
  const materializer = new ApiMaterializer(f.typed, f.constructors, new ResourcePool(f.constructors), {}, () => {});
  const label = materializer.materialize(new FactoryInput("Label", ["unused"])) as { release(): void };
  expect(f.initial.listeners.size).toBe(1);
  const originalSubscribe = f.initial.subscribe;
  const replacement = f.replaceDispatcher();
  const other = new f.Label("New SDK owner");
  label.release();
  expect(f.initial.listeners.size).toBe(0); expect(replacement.listeners.size).toBe(1);
  expect(f.initial.subscribe).toBe(originalSubscribe);
  expect(Object.prototype.hasOwnProperty.call(f.initial, "subscribe")).toBe(false);
  materializer.dispose(); await Promise.resolve(); expect(f.released).toEqual([label]);
  other.release(); expect(replacement.listeners.size).toBe(0);
});

it("releases internally constructed settings labels once while retaining borrowed SDK components", async () => {
  const f = componentLifecycleFixture();
  const pool = new ResourcePool(f.constructors);
  const borrowed = new f.Label("SDK-owned"); const id = pool.add(borrowed, "SDK query", "Label", {})!;
  const materializer = new ApiMaterializer(f.typed, f.constructors, pool, {}, () => {});
  const panel = materializer.materialize(new FactoryInput("SettingsPanelItem", [{ label: "internally created", settingComponent: new ResourceInput(id) }])) as InstanceType<typeof f.SettingsPanelItem>;
  const internal = panel.getComponents()[0]!;
  expect(f.initial.listeners.size).toBe(3);
  materializer.dispose(); await Promise.resolve();
  expect(f.initial.listeners.size).toBe(1);
  expect(f.released).toEqual([panel, internal]); expect(pool.get(id)).toBe(borrowed);
  panel.release(); internal.release(); expect(f.released).toEqual([panel, internal]);
  borrowed.release(); expect(f.initial.listeners.size).toBe(0);
});

it("cleans constructor-time subscriptions when a constructor throws before returning its instance", () => {
  const f = componentLifecycleFixture();
  class BrokenPanel extends f.SettingsPanelItem { constructor(config: { label: string }) { super(config); throw new Error("internal constructor failed"); } }
  const typed: ApiSchema = { ...f.typed, constructors: { ...f.typed.constructors, BrokenPanel: f.typed.constructors.SettingsPanelItem! } };
  const constructors = { ...f.constructors, BrokenPanel };
  const materializer = new ApiMaterializer(typed, constructors, new ResourcePool(constructors), {}, () => {});
  expect(() => materializer.materialize(new FactoryInput("BrokenPanel", [{ label: "private child" }]))).toThrow("internal constructor failed");
  expect(f.initial.listeners.size).toBe(0);
});


it("retains an entire borrowed component subtree during cleanup of a newly created parent", () => {
  const f = componentLifecycleFixture();
  const borrowed = new f.SettingsPanelItem({ label: "SDK-owned internal label" });
  const pool = new ResourcePool(f.constructors); const id = pool.add(borrowed, "SDK subtree", "Component", {})!;
  const materializer = new ApiMaterializer(f.typed, f.constructors, pool, {}, () => {});
  const panel = materializer.materialize(new FactoryInput("SettingsPanelItem", [{ label: "GUI label", settingComponent: new ResourceInput(id) }])) as InstanceType<typeof f.SettingsPanelItem>;
  expect(f.initial.listeners.size).toBe(4);
  materializer.retire()();
  expect(f.initial.listeners.size).toBe(2); expect(f.released).toEqual([panel, panel.getComponents()[0]]);
  borrowed.release(); borrowed.getComponents().forEach(child => child.release());
  expect(f.initial.listeners.size).toBe(0);
});

it("uses the installed SDK's public subscriptions and component children after a dispatcher replacement", async () => {
  const { PlayerUI, EventDispatcher } = await import("@showcase/ui-shared");
  const previous = PlayerUI.i18n.getConfig();
  type ChangeDispatcher = NonNullable<NonNullable<typeof previous.events>["onLanguageChanged"]>;
  const original: ChangeDispatcher = new EventDispatcher();
  const replacement: ChangeDispatcher = new EventDispatcher();
  PlayerUI.i18n.setConfig({ ...previous, events: { onLanguageChanged: original } });
  const subscribe = vi.spyOn(original, "subscribe"); const unsubscribe = vi.spyOn(original, "unsubscribe");
  const constructors = { ...PlayerUI };
  const typed: ApiSchema = { ...catalog, nodes: { ...catalog.nodes,
    config: { kind: "object", label: "SettingsPanelItemConfig", properties: [{ name: "label", schema: "text", optional: true }] } },
    constructors: { ...catalog.constructors, SettingsPanelItem: { signatures: [{ parameters: [{ name: "config", schema: "config", optional: false, rest: false }], returns: "any" }] } } };
  const materializer = new ApiMaterializer(typed, constructors, new ResourcePool(constructors), {}, () => {});
  try {
    const panel = materializer.materialize(new FactoryInput("SettingsPanelItem", [{ label: "Actual SDK label" }])) as { release(): void; getComponents(): { release(): void }[] };
    expect(panel.getComponents()).toHaveLength(1); expect(subscribe).toHaveBeenCalledTimes(2);
    const handlers = subscribe.mock.calls.map(call => call[0]);
    PlayerUI.i18n.setConfig({ ...previous, events: { onLanguageChanged: replacement } });
    materializer.retire()();
    for (const handler of handlers) expect(unsubscribe).toHaveBeenCalledWith(handler);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    panel.release(); panel.getComponents()[0]!.release(); expect(unsubscribe).toHaveBeenCalledTimes(2);
  } finally { materializer.retire()(); PlayerUI.i18n.setConfig(previous); vi.restoreAllMocks(); }
});
