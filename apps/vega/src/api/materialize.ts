import { NumericInput, ExpressionInput, BinaryInput, CallbackInput, ElementInput, FactoryInput, ResourceInput,
  type ApiSchema, type InputSchema, type Signature } from "./types";
import { numericValue, parseBinary, safeKey, validateData } from "./values";
import { copiedConfigurationString } from "../../../../shared/configurationDifferences";

type Constructors = Record<string, unknown>;

/** Only objects actually owned by this generation can be selected as SDK inputs. */
export class ResourcePool {
  private sequence = 0;
  private readonly values = new Map<string, { value: object | Function; label: string; type?: string; owner?: object }>();
  constructor(private readonly constructors: Constructors, private readonly limit = 64) {}
  add(value: unknown, label: string, type?: string, owner?: object): string | undefined {
    if ((!value || typeof value !== "object") && typeof value !== "function") return undefined;
    const existing = [...this.values].find(([, entry]) => entry.value === value);
    if (existing) return existing[0];
    const id = "r" + (++this.sequence);
    this.values.set(id, { value: value as object, label, ...(type ? { type } : {}), ...(owner ? { owner } : {}) });
    while (this.values.size > this.limit) this.values.delete(this.values.keys().next().value!);
    return id;
  }
  get(id: string): unknown {
    const entry = this.values.get(id);
    if (!entry) throw new Error("This SDK instance has expired. Obtain it again from the current player.");
    return entry.value;
  }
  matches(schema: InputSchema, value: unknown): boolean {
    if (schema.kind === "function") return typeof value === "function";
    if (schema.kind === "unknown") return true;
    const constructor = this.constructors[schema.name ?? ""];
    if (typeof constructor === "function" && value instanceof constructor) return true;
    return [...this.values.values()].some(entry => entry.value === value && (entry.type === schema.label || entry.type === schema.name || schema.compatible?.includes(entry.type ?? "")));
  }
  list(schema: InputSchema): { id: string; label: string }[] {
    return [...this.values].filter(([, entry]) => this.matches(schema, entry.value)).map(([id, entry]) => ({ id, label: `${entry.label} (${id})` }));
  }
  clear(): void { this.values.clear(); }
  retire(owner: object): void { for (const [id, entry] of this.values) if (entry.owner === owner) this.values.delete(id); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Check SDK callback contracts without reapplying the editor's draft-size limits. */
function runtimeValue(catalog: ApiSchema, id: string, value: unknown, resources: ResourcePool, depth = 0): unknown {
  if (depth > 32) throw new Error("Callback result is nested too deeply.");
  const schema = catalog.nodes[id];
  if (!schema) throw new Error("Unknown SDK callback return type.");
  const reject = (): never => { throw new Error("Callback result: expected " + schema.label); };
  const next = (child: string, input: unknown) => runtimeValue(catalog, child, input, resources, depth + 1);
  switch (schema.kind) {
    case "unknown": case "void": return value;
    case "never": return reject();
    case "undefined": return value === undefined ? value : reject();
    case "null": return value === null ? value : reject();
    case "literal": return value === schema.value ? value : reject();
    case "string": return typeof value === "string" ? value : reject();
    case "number": return typeof value === "number" && !Number.isNaN(value) ? value : reject();
    case "boolean": return typeof value === "boolean" ? value : reject();
    case "function": return typeof value === "function" ? value : reject();
    case "instance": return resources.matches(schema, value) ? value : reject();
    case "binary": return value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? value : reject();
    case "promise": return value && typeof (value as PromiseLike<unknown>).then === "function" ? value : reject();
    case "union":
      for (const child of schema.options!) try { return next(child, value); } catch { /* Try another branch. */ }
      return reject();
    case "object":
      if (value === null || typeof value !== "object") return reject();
      // Runtime SDK objects can have private fields beyond their structural interface.
      for (const property of schema.properties!) {
        const input = (value as Record<string, unknown>)[property.name];
        if (input !== undefined || !property.optional) next(property.schema, input);
      }
      if (schema.additional) for (const input of Object.values(value)) next(schema.additional, input);
      return value;
    case "array":
      if (!Array.isArray(value)) return reject();
      value.forEach(input => next(schema.item!, input));
      return value;
    case "tuple":
      if (!Array.isArray(value) || value.length > schema.items!.length) return reject();
      schema.items!.forEach((child, index) => {
        if (index >= value.length && (schema.flags?.[index] ?? 0) & 2) return;
        next(child, value[index]);
      });
      return value;
    default: return reject();
  }
}

export function parameterNames(signature: Signature): string[] {
  return signature.parameters.map((parameter, index) => /^[A-Za-z_$][\w$]*$/.test(parameter.name)
    && !["eval", "arguments", "lab"].includes(parameter.name) ? parameter.name : "arg" + index);
}

function callbackParameters(signature: Signature): string {
  return parameterNames(signature).map((name, index) => (signature.parameters[index]!.rest ? "..." : "") + name).join(", ");
}

function callbackSource(value: CallbackInput): string {
  return '"use strict";\nreturn ' + (value.asynchronous ? "async " : "") + "function(" + callbackParameters(value.signature) + ") {\n" + value.body + "\n};";
}

export class ApiMaterializer {
  private active = true;
  private readonly memo = new WeakMap<object, unknown>();
  constructor(private readonly catalog: ApiSchema, private readonly constructors: Constructors,
    private readonly resources: ResourcePool, private readonly lab: object,
    private readonly notice: (message: string) => void) {}

  dispose(): void { this.active = false; this.resources.retire(this); }

  preflight(value: unknown): void {
    if (value instanceof NumericInput) { numericValue(value.raw); return; }
    if (value instanceof ExpressionInput) {
      if (!value.approved) throw new Error("Allow this JavaScript value factory before Apply.");
      new Function("lab", '"use strict";\n' + value.body);
    } else if (value instanceof CallbackInput) {
      if (!value.approved) throw new Error("Allow this callback to run before applying it.");
      new Function("lab", callbackSource(value));
    } else if (value instanceof FactoryInput) {
      const definition = this.catalog.constructors[value.name];
      if (!definition || typeof this.constructors[value.name] !== "function") throw new Error("This constructor is unavailable.");
      const signature = definition.signatures[value.overload];
      if (!signature) throw new Error("Choose a published constructor signature.");
      signature.parameters.forEach((parameter, index) => {
        const input = value.args[index];
        if (input !== undefined || !parameter.optional) validateData(this.catalog, parameter.schema, input, parameter.name);
        this.preflight(input);
      });
    } else if (value instanceof BinaryInput) parseBinary(value.text, value.encoding);
    else if (value instanceof ResourceInput) this.resources.get(value.id);
    else if (Array.isArray(value)) value.forEach(input => this.preflight(input));
    else if (isRecord(value)) Object.values(value).forEach(input => this.preflight(input));
  }

  arguments(signature: Signature, input: unknown[]): unknown[] {
    const output: unknown[] = [];
    signature.parameters.forEach((parameter, index) => {
      const value = input[index];
      if (value === undefined && parameter.optional) { output.push(undefined); return; }
      validateData(this.catalog, parameter.schema, value, parameter.name);
      const materialized = this.materialize(value);
      runtimeValue(this.catalog, parameter.schema, materialized, this.resources);
      if (parameter.rest) {
        if (!Array.isArray(materialized)) throw new Error("A rest parameter must be an array.");
        output.push(...materialized);
      } else output.push(materialized);
    });
    while (output[output.length - 1] === undefined && output.length) output.pop();
    return output;
  }

  materialize(value: unknown): unknown {
    if (!this.active) throw new Error("The previous player configuration is no longer active.");
    if (value && typeof value === "object" && this.memo.has(value)) return this.memo.get(value);
    if (value instanceof NumericInput) return numericValue(value.raw);
    if (value instanceof ExpressionInput) {
      if (!value.approved) throw new Error("Allow this JavaScript value factory before Apply.");
      const result: unknown = new Function("lab", '\"use strict\";\n' + value.body)(this.lab);
      this.memo.set(value, result); return result;
    }
    if (value instanceof ResourceInput) return this.resources.get(value.id);
    if (value instanceof BinaryInput) {
      const bytes = parseBinary(value.text, value.encoding);
      if (value.name === "ArrayBuffer") return bytes.buffer;
      const constructor = this.constructors[value.name];
      if (typeof constructor !== "function") throw new Error("Unsupported binary input type: " + value.name);
      return Reflect.construct(constructor, [bytes.buffer]);
    }
    if (value instanceof ElementInput) {
      if (!["div", "video", "img", "canvas"].includes(value.tag)) throw new Error("Unsupported element type.");
      throw new Error("Vega does not provide browser DOM elements. Use a supported native API or the current SDK resource.");
    }
    if (value instanceof FactoryInput) {
      const definition = this.catalog.constructors[value.name];
      const constructor = this.constructors[value.name];
      if (!definition || typeof constructor !== "function") throw new Error("This SDK constructor is not available: " + value.name);
      const signature = definition.signatures[value.overload];
      if (!signature) throw new Error("Choose a published constructor signature.");
      const args = this.arguments(signature, value.args);
      const instance = Reflect.construct(constructor, args);
      this.memo.set(value, instance);
      this.resources.add(instance, "new " + value.name, value.name, this);
      if (value.name === "EventDispatcher") instance.subscribe(() => { if (this.active) this.notice("Language-change dispatcher fired"); });
      return instance;
    }
    if (value instanceof CallbackInput) {
      if (!value.approved) throw new Error("Allow this callback to run before applying it.");
      // The body comes only from this editor after the user's explicit Apply action.
      // No URL, storage value, shared link or downloaded source is executed here.
      const compiled: Function = new Function("lab", callbackSource(value))(this.lab);
      const owner = this;
      let calls = 0;
      const callback = function(this: unknown, ...args: unknown[]): unknown {
        if (!owner.active) throw new Error("This callback belongs to a retired Vega session.");
        value.signature.parameters.forEach((parameter, index) => {
          const type = owner.catalog.nodes[parameter.schema];
          if (type?.kind === "instance") owner.resources.add(args[index], parameter.name, type.label, owner);
        });
        calls += 1;
        if (calls <= 20 || calls % 100 === 0) owner.notice("Callback invoked (" + calls + ")");
        try {
          const result = Reflect.apply(compiled, this, args);
          const returns = owner.catalog.nodes[value.signature.returns]!;
          const promise = returns.kind === "promise" ? returns : returns.kind === "union" ? returns.options?.map(id => owner.catalog.nodes[id]).find(type => type?.kind === "promise") : undefined;
          if (promise && result && typeof result.then === "function") {
            return Promise.resolve(result).then(output => {
              if (!owner.active) throw new Error("The Vega session retired before the callback resolved.");
              return runtimeValue(owner.catalog, promise.value as string, output, owner.resources);
            }).catch(error => { if (owner.active && calls <= 20) owner.notice("Callback rejected"); throw error; });
          }
          return runtimeValue(owner.catalog, value.signature.returns, result, owner.resources);
        } catch (error) { if (owner.active && calls <= 20) owner.notice("Callback execution failed"); throw error; }
      };
      this.memo.set(value, callback);
      this.resources.add(callback, "Callback", "Function", this);
      return callback;
    }
    if (Array.isArray(value)) return value.map(item => this.materialize(item));
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => { safeKey(key); return [key, this.materialize(item)]; }));
    return value;
  }
}

const sensitive = /^(?:key|licenseKey|apiKey|password|token|authorization|proxy-authorization)$/i;
export function inputCode(value: unknown, path: string[] = []): string {
  if (sensitive.test(path[path.length - 1] ?? "")) return '"YOUR_VALUE"';
  if (value instanceof NumericInput) return String(numericValue(value.raw));
  if (value instanceof ExpressionInput) return `(() => {\n${value.body}\n})()`;
  if (value instanceof CallbackInput) return `${value.asynchronous ? "async " : ""}function(${callbackParameters(value.signature)}) {\n${value.body}\n}`;
  if (value instanceof FactoryInput) return `new ${value.name === "EventDispatcher" ? "EventDispatcher" : value.name === "DOM" ? "PlayerUIDOM" : "PlayerUI." + value.name}(${value.args.map(item => inputCode(item)).join(", ")})`;
  if (value instanceof ElementInput) return "/* Browser DOM elements are unavailable on Vega. */ undefined";
  if (value instanceof ResourceInput) return `resources[${JSON.stringify(value.id)}]`;
  if (value instanceof BinaryInput) {
    const bytes = parseBinary(value.text, value.encoding);
    const source = `new Uint8Array([${Array.from(bytes).join(", ")}])`;
    return value.name === "ArrayBuffer" ? source + ".buffer" : value.name === "Uint8Array" ? source : `new ${value.name}(${source}.buffer)`;
  }
  if (value === undefined) return "undefined";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(copiedConfigurationString(value, path));
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => inputCode(item, path)).join(", ")}]`;
  if (!isRecord(value)) return "/* SDK instance from the current player */ undefined";
  return `{${Object.entries(value).map(([name, item]) => `${JSON.stringify(name)}: ${inputCode(item, [...path, name])}`).join(", ")}}`;
}
