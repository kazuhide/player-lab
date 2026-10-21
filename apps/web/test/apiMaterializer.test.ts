import { expect, it } from "vitest";
import { ApiMaterializer, ResourcePool, inputCode } from "../src/api/materialize";
import { BinaryInput, CallbackInput, FactoryInput, ResourceInput, type ApiSchema } from "../src/api/types";

const catalog: ApiSchema = { schemaVersion: 1, playerVersion: "8", uiVersion: "4", rows: [],
  nodes: { number: { kind: "number", label: "number" }, text: { kind: "string", label: "string" },
    empty: { kind: "void", label: "void" }, any: { kind: "unknown", label: "any" }, label: { kind: "instance", label: "Label", name: "Label", factories: ["Label"] } },
  constructors: { Label: { signatures: [{ parameters: [{ name: "text", schema: "text", optional: false, rest: false }], returns: "label" }] } } };

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
