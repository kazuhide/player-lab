import { BinaryInput, CallbackInput, ElementInput, FactoryInput, ResourceInput,
  type ApiSchema, type InputSchema, type Signature } from "./types";
import { parseBinary, safeKey, validateData } from "./values";

type Constructors = Record<string, unknown>;
type CreationRecipe = FactoryInput | CallbackInput | ElementInput;
type Allocation = { sequence: number; input: object; value: unknown; live: boolean; cleanup?: () => void };

const releaseActions = new WeakMap<object, () => void>();

/** Share the public release call with the SDK without releasing the same instance twice. */
function releaseOnce(instance: object): (() => void) | undefined {
  const existing = releaseActions.get(instance);
  if (existing) return existing;
  const release = (instance as { release?: unknown }).release;
  if (typeof release !== "function") return undefined;
  let released = false;
  const once = function(this: unknown, ...args: unknown[]): unknown {
    if (released) return undefined;
    released = true;
    return Reflect.apply(release, this, args);
  };
  const cleanup = (): void => { once.call(instance); };
  const descriptor = Object.getOwnPropertyDescriptor(instance, "release");
  try {
    Object.defineProperty(instance, "release", { value: once,
      configurable: descriptor?.configurable ?? true, enumerable: descriptor?.enumerable ?? false,
      writable: descriptor && "writable" in descriptor ? descriptor.writable : true });
  } catch {
    cleanup();
    throw new Error("This SDK instance cannot safely share its release lifecycle with the player.");
  }
  releaseActions.set(instance, cleanup);
  return cleanup;
}

/** Only objects actually owned by this generation can be selected as SDK inputs. */
export class ResourcePool {
  private sequence = 0;
  private readonly values = new Map<string, { value: object | Function; label: string; type?: string; owner?: object; recipe?: CreationRecipe; published?: boolean }>();
  constructor(private readonly constructors: Constructors, private readonly limit = 64) {}
  add(value: unknown, label: string, type?: string, owner?: object, recipe?: CreationRecipe): string | undefined {
    if ((!value || typeof value !== "object") && typeof value !== "function") return undefined;
    const existing = [...this.values].find(([, entry]) => entry.value === value);
    if (existing) return existing[0];
    const id = "r" + (++this.sequence);
    this.values.set(id, { value: value as object, label, ...(type ? { type } : {}), ...(owner ? { owner } : {}), ...(recipe ? { recipe } : {}) });
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
    return [...this.values.values()].some(entry => entry.value === value && (entry.type === schema.label || entry.type === schema.name));
  }
  list(schema: InputSchema): { id: string; label: string }[] {
    return [...this.values].filter(([, entry]) => entry.published !== false && this.matches(schema, entry.value)).map(([id, entry]) => ({ id, label: `${entry.label} (${id})` }));
  }
  setPublished(value: unknown, owner: object, published: boolean): void {
    for (const entry of this.values.values()) if (entry.owner === owner && entry.value === value) entry.published = published;
  }
  clear(): void { this.values.clear(); }
  retire(owner: object): void { for (const [id, entry] of this.values) if (entry.owner === owner) this.values.delete(id); }
  remove(value: unknown, owner: object): void {
    for (const [id, entry] of this.values) if (entry.owner === owner && entry.value === value) this.values.delete(id);
  }

  /** Configuration replacement recreates editor-owned objects; API calls retain their exact identity. */
  forConfiguration(value: unknown): unknown {
    const expanding = new Set<string>();
    const visiting = new WeakSet<object>();
    const clones = new WeakMap<object, unknown>();
    const visit = (input: unknown, depth: number): unknown => {
      if (depth > 32) throw new Error("Configuration resources are nested too deeply.");
      if (input instanceof ResourceInput) {
        const entry = this.values.get(input.id);
        if (!entry) throw new Error("This SDK instance has expired. Obtain it again from the current player.");
        if (!entry.recipe) return input;
        if (expanding.has(input.id)) throw new Error("Configuration resource recipes contain a cycle.");
        expanding.add(input.id);
        try { return visit(entry.recipe, depth + 1); } finally { expanding.delete(input.id); }
      }
      if (!input || typeof input !== "object") return input;
      if (visiting.has(input)) throw new Error("Configuration resource recipes contain a cycle.");
      if (clones.has(input)) return clones.get(input);
      visiting.add(input);
      try {
        let output: unknown = input;
        if (input instanceof FactoryInput) output = new FactoryInput(input.name, input.args.map(item => visit(item, depth + 1)), input.overload, input.restIndex);
        else if (input instanceof CallbackInput) output = new CallbackInput(input.body, input.signature, input.approved);
        else if (input instanceof ElementInput) output = new ElementInput(input.tag);
        else if (input instanceof BinaryInput) output = new BinaryInput(input.text, input.encoding, input.name);
        else if (Array.isArray(input)) output = input.map(item => visit(item, depth + 1));
        else if (isRecord(input)) output = Object.fromEntries(Object.entries(input).map(([key, item]) => { safeKey(key); return [key, visit(item, depth + 1)]; }));
        clones.set(input, output);
        return output;
      } finally { visiting.delete(input); }
    };
    return visit(value, 0);
  }

  captureResult(catalog: ApiSchema, id: string, value: unknown, label: string, owner: object): void {
    const seen = new WeakSet<object>();
    const visit = (key: string, input: unknown, name: string, depth: number): void => {
      const schema = catalog.nodes[key];
      if (!schema || depth > 4) return;
      if (schema.kind === "promise") { visit(schema.value as string, input, name, depth); return; }
      if ((!input || typeof input !== "object") && typeof input !== "function") return;
      if (seen.has(input as object)) return;
      if (schema.kind === "union") {
        for (const branch of schema.options!) {
          try { runtimeValue(catalog, branch, input, this); visit(branch, input, name, depth); return; } catch { /* Try the next public type. */ }
        }
        return;
      }
      seen.add(input as object);
      this.add(input, name, schema.label, owner);
      if (schema.kind === "array" && Array.isArray(input)) {
        input.slice(0, 32).forEach((item, index) => visit(schema.item!, item, `${name}[${index}]`, depth + 1));
      } else if (schema.kind === "object") {
        for (const property of schema.properties!.slice(0, 64)) {
          try { visit(property.schema, (input as Record<string, unknown>)[property.name], `${name}.${property.name}`, depth + 1); } catch { /* A public SDK getter may be unavailable in this state. */ }
        }
      }
    };
    visit(id, value, label, 0);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function runtimeValue(catalog: ApiSchema, id: string, value: unknown, resources: ResourcePool, depth = 0): unknown {
  if (depth > 32) throw new Error("Callback result is nested too deeply.");
  const schema = catalog.nodes[id]!;
  if (schema.kind === "unknown") return value;
  if (schema.kind === "instance" && resources.matches(schema, value)) return value;
  if (schema.kind === "union") {
    for (const child of schema.options!) try { return runtimeValue(catalog, child, value, resources, depth + 1); } catch { /* Try another branch. */ }
    throw new Error("Callback result: expected " + schema.label);
  }
  if (schema.kind === "object" && value !== null && typeof value === "object") {
    // SDK objects can have private fields beyond their public structural interface.
    for (const property of schema.properties!) {
      const input = (value as Record<string, unknown>)[property.name];
      if (input === undefined && property.optional) continue;
      runtimeValue(catalog, property.schema, input, resources, depth + 1);
    }
    if (schema.additional) for (const [key, input] of Object.entries(value)) {
      safeKey(key); runtimeValue(catalog, schema.additional, input, resources, depth + 1);
    }
    return value;
  }
  if (schema.kind === "array" && Array.isArray(value)) {
    value.forEach(input => runtimeValue(catalog, schema.item!, input, resources, depth + 1));
    return value;
  }
  return validateData(catalog, id, value, "callback result");
}

export function parameterNames(signature: Signature): string[] {
  return signature.parameters.map((parameter, index) => /^[A-Za-z_$][\w$]*$/.test(parameter.name)
    && !["eval", "arguments", "lab"].includes(parameter.name) ? parameter.name : "arg" + index);
}

function callbackParameters(signature: Signature): string {
  return parameterNames(signature).map((name, index) => (signature.parameters[index]!.rest ? "..." : "") + name).join(", ");
}

function callbackSource(value: CallbackInput): string {
  return '"use strict";\nreturn function(' + callbackParameters(value.signature) + ") {\n" + value.body + "\n};";
}

export class ApiMaterializer {
  private active = true;
  private readonly memo = new WeakMap<object, unknown>();
  private readonly allocations: Allocation[] = [];
  private sequence = 0;
  constructor(private readonly catalog: ApiSchema, private readonly constructors: Constructors,
    private readonly resources: ResourcePool, private readonly lab: object,
    private readonly notice: (message: string) => void) {}

  /** Invalidate this owner now; release its allocations after the SDK has released its UI. */
  retire(): () => void {
    this.active = false;
    this.resources.retire(this);
    return () => this.rollback(0);
  }

  dispose(): void { queueMicrotask(this.retire()); }

  checkpoint(): number { return this.sequence; }

  publish(checkpoint: number, through: number, published = true): void {
    for (const allocation of this.allocations) if (allocation.sequence > checkpoint && allocation.sequence <= through) {
      this.resources.setPublished(allocation.value, this, published);
    }
  }

  /** Discard only objects created by a failed construction or SDK invocation. */
  rollback(checkpoint: number, through = Infinity): void {
    for (let index = this.allocations.length - 1; index >= 0; index--) {
      const allocation = this.allocations[index]!;
      if (allocation.sequence <= checkpoint) break;
      if (allocation.sequence > through) continue;
      this.allocations.splice(index, 1);
      allocation.live = false;
      this.memo.delete(allocation.input);
      this.resources.remove(allocation.value, this);
      try { allocation.cleanup?.(); }
      catch { try { this.notice("An SDK input could not be fully released."); } catch { /* Continue releasing the other inputs. */ } }
    }
  }

  private remember(input: object, value: unknown, cleanup?: () => void): Allocation {
    const allocation = { sequence: ++this.sequence, input, value, live: true, ...(cleanup ? { cleanup } : {}) };
    this.memo.set(input, value);
    this.allocations.push(allocation);
    return allocation;
  }

  preflight(value: unknown): void {
    if (value instanceof CallbackInput) {
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
    const checkpoint = this.checkpoint();
    try {
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
    } catch (error) { this.rollback(checkpoint); throw error; }
  }

  materialize(value: unknown): unknown {
    if (!this.active) throw new Error("The previous player configuration is no longer active.");
    const checkpoint = this.checkpoint();
    try { return this.materializeInput(value); }
    catch (error) { this.rollback(checkpoint); throw error; }
  }

  private materializeInput(value: unknown): unknown {
    if (value && typeof value === "object" && this.memo.has(value)) return this.memo.get(value);
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
      const element = document.createElement(value.tag);
      this.remember(value, element, () => element.remove());
      this.resources.add(element, "new " + value.tag + " element", "HTMLElement", this, value);
      return element;
    }
    if (value instanceof FactoryInput) {
      const definition = this.catalog.constructors[value.name];
      const constructor = this.constructors[value.name];
      if (!definition || typeof constructor !== "function") throw new Error("This SDK constructor is not available: " + value.name);
      const signature = definition.signatures[value.overload];
      if (!signature) throw new Error("Choose a published constructor signature.");
      const args = this.arguments(signature, value.args);
      const instance = Reflect.construct(constructor, args);
      const release = releaseOnce(instance);
      let unsubscribe: (() => void) | undefined;
      const allocation = this.remember(value, instance, () => { try { unsubscribe?.(); } finally { release?.(); } });
      this.resources.add(instance, "new " + value.name, value.name, this, value);
      if (value.name === "EventDispatcher") {
        const listener = (): void => { if (this.active && allocation.live) this.notice("Language-change dispatcher fired"); };
        unsubscribe = () => { instance.unsubscribe(listener); };
        instance.subscribe(listener);
      }
      return instance;
    }
    if (value instanceof CallbackInput) {
      if (!value.approved) throw new Error("Allow this callback to run before applying it.");
      // The body comes only from this editor after the user's explicit Apply action.
      // No URL, storage value, shared link or downloaded source is executed here.
      const compiled = new Function("lab", callbackSource(value))(this.lab) as Function;
      const owner = this;
      let allocation: Allocation;
      const callback = function(this: unknown, ...args: unknown[]): unknown {
        if (!owner.active || !allocation.live) return undefined;
        value.signature.parameters.forEach((parameter, index) => {
          const type = owner.catalog.nodes[parameter.schema];
          if (type?.kind === "instance") owner.resources.add(args[index], parameter.name, type.label, owner);
        });
        owner.notice("Callback invoked");
        try {
          const result = Reflect.apply(compiled, this, args);
          const returns = owner.catalog.nodes[value.signature.returns]!;
          if (returns.kind === "promise") {
            if (!result || typeof result.then !== "function") throw new Error("Callback result: expected " + returns.label);
            return Promise.resolve(result).then(output => owner.active && allocation.live ? runtimeValue(owner.catalog, returns.value as string, output, owner.resources) : undefined)
              .catch(error => { if (owner.active && allocation.live) owner.notice("Callback rejected: " + (error instanceof Error ? error.message : "error")); throw error; });
          }
          return runtimeValue(owner.catalog, value.signature.returns, result, owner.resources);
        } catch (error) { if (owner.active && allocation.live) owner.notice("Callback rejected: " + (error instanceof Error ? error.message : "error")); throw error; }
      };
      allocation = this.remember(value, callback);
      this.resources.add(callback, "Callback", "Function", this, value);
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
  if (value instanceof CallbackInput) return `function(${callbackParameters(value.signature)}) {\n${value.body}\n}`;
  if (value instanceof FactoryInput) return `new ${value.name === "EventDispatcher" ? "EventDispatcher" : value.name === "DOM" ? "PlayerUIDOM" : "PlayerUI." + value.name}(${value.args.map((item, index) => (index === value.restIndex ? "..." : "") + inputCode(item)).join(", ")})`;
  if (value instanceof ElementInput) return `document.createElement(${JSON.stringify(value.tag)})`;
  if (value instanceof ResourceInput) return `resources[${JSON.stringify(value.id)}]`;
  if (value instanceof BinaryInput) {
    const bytes = parseBinary(value.text, value.encoding);
    const source = `new Uint8Array([${Array.from(bytes).join(", ")}])`;
    return value.name === "ArrayBuffer" ? source + ".buffer" : value.name === "Uint8Array" ? source : `new ${value.name}(${source}.buffer)`;
  }
  if (value === undefined) return "undefined";
  if (typeof value === "number") return String(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => inputCode(item, path)).join(", ")}]`;
  if (!isRecord(value)) return "/* SDK instance from the current player */ undefined";
  return `{${Object.entries(value).map(([name, item]) => `${JSON.stringify(name)}: ${inputCode(item, [...path, name])}`).join(", ")}}`;
}
