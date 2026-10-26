import { BinaryInput, CallbackInput, ElementInput, FactoryInput, ResourceInput,
  type ApiSchema, type ConfigRoot, type PathPart } from "./types";

const reserved = new Set(["__proto__", "prototype", "constructor"]);
export function safeKey(key: string): void {
  if (reserved.has(key)) throw new Error("Reserved property name: " + key);
}

export function apiPath(id: string, indices: number[] = []): PathPart[] {
  const source = id.replace(/\{\*\}/g, "");
  const matches = [...source.matchAll(/(?:^|\.)([A-Za-z_$][\w$]*)|\[("(?:[^"\\]|\\.)*")\]|(\[\])/g)];
  if (matches.map(match => match[0]).join("") !== source) throw new Error("Invalid SDK path.");
  let cursor = 0;
  const parts = matches.map((match): PathPart => {
    if (match[3]) {
      const index = indices[cursor++];
      if (!Number.isInteger(index) || index! < 0 || index! > 255) throw new Error("Choose an array index from 0 to 255.");
      return index!;
    }
    const key = match[1] || JSON.parse(match[2]!);
    safeKey(key);
    return key;
  });
  parts.shift();
  return parts;
}

export function parseBinary(text: string, encoding: "hex" | "base64"): Uint8Array {
  const source = text.replace(/\s/g, "");
  if (source.length > 131072) throw new Error("Certificate input exceeds 64 KiB.");
  if (encoding === "hex") {
    if (source.length % 2 || !/^[\da-f]*$/i.test(source)) throw new Error("Enter complete hexadecimal bytes.");
    return Uint8Array.from(source.match(/../g) ?? [], byte => parseInt(byte, 16));
  }
  if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(source)) throw new Error("Enter valid base64 bytes.");
  return Uint8Array.from(atob(source), character => character.charCodeAt(0));
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Validate editor data against the actual published type before applying it. */
export function validateData(catalog: ApiSchema, id: string, value: unknown, path = "value", depth = 0): unknown {
  if (depth > 32) throw new Error(path + ": input is nested too deeply.");
  const type = catalog.nodes[id];
  if (!type) throw new Error("Unknown SDK input type.");
  const reject = (): never => { throw new Error(path + ": expected " + type.label); };
  const next = (schema: string, input: unknown, name: string) => validateData(catalog, schema, input, name, depth + 1);
  switch (type.kind) {
    case "void": return value;
    case "undefined": return value === undefined ? value : reject();
    case "null": return value === null ? value : reject();
    case "never": return reject();
    case "literal": return value === type.value ? value : reject();
    case "string": return typeof value === "string" && value.length <= 65536 ? value : reject();
    case "number": return typeof value === "number" && !Number.isNaN(value) ? value : reject();
    case "boolean": return typeof value === "boolean" ? value : reject();
    case "union": {
      for (const option of type.options!) {
        try { return next(option, value, path); } catch { /* Try the other published branches. */ }
      }
      return reject();
    }
    case "function":
      if (value instanceof ResourceInput) return value;
      if (value instanceof CallbackInput) {
        if (!value.approved) throw new Error("Allow this callback to run before applying it.");
        if (value.body.length > 65536) throw new Error("The callback exceeds 64 KiB.");
        return value;
      }
      return typeof value === "function" ? value : reject();
    case "instance":
      if (value instanceof FactoryInput) return type.factories?.includes(value.name) ? value : reject();
      if (value instanceof ResourceInput) return value;
      if (value instanceof ElementInput) {
        const allowed = type.name === "HTMLVideoElement" ? ["video"] : type.name === "HTMLImageElement" ? ["img"]
          : type.name === "HTMLCanvasElement" ? ["canvas"] : ["HTMLElement", "Element", "Node"].includes(type.name ?? "") ? ["div", "video", "img", "canvas"] : [];
        return allowed.includes(value.tag) ? value : reject();
      }
      return reject();
    case "binary":
      if (value instanceof BinaryInput) {
        if (value.name !== type.name) return reject();
        parseBinary(value.text, value.encoding); return value;
      }
      return type.name === "ArrayBuffer" ? value instanceof ArrayBuffer ? value : reject()
        : ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === `[object ${type.name}]` ? value : reject();
    case "promise": return value && typeof (value as PromiseLike<unknown>).then === "function" ? value : reject();
    case "tuple": {
      if (!Array.isArray(value) || value.length > type.items!.length) return reject();
      return type.items!.map((schema, index) => {
        if (index >= value.length && (type.flags?.[index] ?? 0) & 2) return undefined;
        return next(schema, value[index], `${path}[${index}]`);
      });
    }
    case "array":
      if (value instanceof ResourceInput) return value;
      if (!Array.isArray(value) || value.length > 256) return reject();
      return Array.from(value, (item, index) => next(type.item!, item, `${path}[${index}]`));
    case "object": {
      if (value instanceof ResourceInput) return value;
      if (!plain(value) || Object.keys(value).length > 256) return reject();
      const output: Record<string, unknown> = {};
      const properties = new Map(type.properties!.map(property => [property.name, property]));
      for (const property of properties.values()) {
        if (!(property.name in value) && !property.optional) next(property.schema, undefined, path + "." + property.name);
      }
      for (const [name, item] of Object.entries(value)) {
        safeKey(name);
        const schema = properties.get(name)?.schema ?? type.additional;
        if (!schema) throw new Error(path + ": unknown property " + name);
        output[name] = next(schema, item, path + "." + name);
      }
      return output;
    }
    case "unknown": {
      if (value instanceof CallbackInput || value instanceof FactoryInput || value instanceof ResourceInput || value instanceof BinaryInput || value instanceof ElementInput) return value;
      if (Array.isArray(value)) {
        if (value.length > 256) return reject();
        return value.map((item, index) => next(id, item, `${path}[${index}]`));
      }
      if (plain(value)) {
        if (Object.keys(value).length > 256) return reject();
        return Object.fromEntries(Object.entries(value).map(([name, item]) => { safeKey(name); return [name, next(id, item, path + "." + name)]; }));
      }
      if (value === null || value === undefined || ["string", "number", "boolean", "function"].includes(typeof value)) return value;
      return reject();
    }
    default: return reject();
  }
}

function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => { safeKey(key); return [key, clone(item)]; }));
  return value;
}

function mergeValue(base: unknown, value: unknown): unknown {
  if (!plain(value)) return value;
  const result = (plain(base) ? clone(base) : {}) as Record<string, unknown>;
  for (const [key, input] of Object.entries(value)) {
    safeKey(key);
    if (input === undefined) delete result[key];
    else result[key] = mergeValue(result[key], input);
  }
  return result;
}

type OverrideEntry = { path: PathPart[]; value: unknown };
type Mutation = { path: PathPart[]; revision: number };
type MutationState = { epoch: number; sets: Map<string, Mutation>; removes: Map<string, Mutation>; patches: Map<string, Mutation> };
type DiscardedPatch = { paths: PathPart[][]; removed: (OverrideEntry & { owner: PathPart[] })[]; order: string[]; epoch: number; checkpoint: number };

function restoreValue(value: unknown, path: PathPart[], restored: unknown): unknown {
  if (!path.length) return restored;
  const key = path[0]!;
  if (typeof key === "string") safeKey(key);
  const result = plain(value) ? { ...value } : {};
  result[key] = restoreValue(result[key], path.slice(1), restored);
  return result;
}

function pruneValue(value: unknown, path: PathPart[], removed: OverrideEntry[], prefix: PathPart[]): unknown {
  const key = path[0];
  if (!plain(value)) { removed.push({ path: prefix, value }); return undefined; }
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(value, key)) return value;
  const result = { ...value };
  const next = [...prefix, key];
  if (path.length === 1) { removed.push({ path: next, value: value[key] }); delete result[key]; }
  else {
    const checkpoint = removed.length;
    result[key] = pruneValue(value[key], path.slice(1), removed, next);
    if (result[key] === undefined || plain(result[key]) && Object.keys(result[key]).length === 0) {
      if (removed.length === checkpoint) removed.push({ path: next, value: value[key] });
      delete result[key];
    }
  }
  return result;
}

function put(target: Record<string, unknown>, parts: PathPart[], value: unknown): void {
  let cursor: Record<string | number, unknown> | unknown[] = target;
  for (let index = 0; index < parts.length; index++) {
    const key = parts[index]!;
    if (typeof key === "string") safeKey(key);
    if (typeof key === "number" && (!Array.isArray(cursor) || key > cursor.length)) throw new Error("Add array entries in order; sparse arrays are not SDK inputs.");
    if (index === parts.length - 1) {
      const record = cursor as Record<string | number, unknown>;
      if (value === undefined && typeof key === "string") delete record[key];
      else record[key] = mergeValue(record[key], value);
      break;
    }
    const current = (cursor as Record<string | number, unknown>)[key];
    const isArray = typeof parts[index + 1] === "number";
    if (isArray ? !Array.isArray(current) : !plain(current)) (cursor as Record<string | number, unknown>)[key] = isArray ? [] : {};
    cursor = (cursor as Record<string | number, unknown>)[key] as Record<string | number, unknown>;
  }
}

function overlaps(a: PathPart[], b: PathPart[]): boolean {
  return a.slice(0, Math.min(a.length, b.length)).every((part, index) => part === b[index]);
}

export class ApiOverrides {
  private readonly values = new Map<ConfigRoot, Map<string, { path: PathPart[]; value: unknown }>>();
  private readonly mutations = new Map<ConfigRoot, MutationState>();
  private revision = 0;
  private state(root: ConfigRoot): MutationState {
    let state = this.mutations.get(root);
    if (!state) {
      state = { epoch: ++this.revision, sets: new Map(), removes: new Map(), patches: new Map() };
      this.mutations.set(root, state);
    }
    return state;
  }
  set(root: ConfigRoot, path: PathPart[], value: unknown): { path: PathPart[]; value: unknown }[] {
    path.forEach(part => { if (typeof part === "string") safeKey(part); });
    this.state(root).sets.set(JSON.stringify(path), { path: [...path], revision: ++this.revision });
    const values = this.values.get(root) ?? new Map();
    const replaced: { path: PathPart[]; value: unknown }[] = [];
    for (const [key, item] of values) if (overlaps(item.path, path) && item.path.length >= path.length) { replaced.push(item); values.delete(key); }
    values.set(JSON.stringify(path), { path: [...path], value });
    this.values.set(root, values);
    return replaced;
  }
  remove(root: ConfigRoot, path: PathPart[]): void {
    this.state(root).removes.set(JSON.stringify(path), { path: [...path], revision: ++this.revision });
    this.values.get(root)?.delete(JSON.stringify(path));
  }
  clear(root: ConfigRoot): void {
    this.values.delete(root);
    this.mutations.set(root, { epoch: ++this.revision, sets: new Map(), removes: new Map(), patches: new Map() });
  }
  entries(root: ConfigRoot): { path: PathPart[]; value: unknown }[] { return [...this.values.get(root)?.values() ?? []]; }
  apply<T extends object>(root: ConfigRoot, base: T, materialize: (value: unknown) => unknown = value => value): T {
    const result = clone(base) as Record<string, unknown>;
    for (const entry of this.entries(root)) put(result, entry.path, materialize(entry.value));
    return result as T;
  }
  discardPatch(root: ConfigRoot, patch: object): DiscardedPatch {
    const paths: PathPart[][] = [];
    const removed: DiscardedPatch["removed"] = [];
    const order = [...this.values.get(root)?.keys() ?? []];
    const visit = (value: object, prefix: PathPart[]) => {
      for (const [key, item] of Object.entries(value)) {
        safeKey(key);
        if (plain(item) && Object.keys(item).length) visit(item, [...prefix, key]);
        else paths.push([...prefix, key]);
      }
    };
    visit(patch, []);
    const state = this.state(root);
    const checkpoint = ++this.revision;
    for (const path of paths) state.patches.set(JSON.stringify(path), { path, revision: checkpoint });
    for (const [key, item] of this.values.get(root) ?? []) for (const path of paths) {
      if (!overlaps(path, item.path)) continue;
      if (path.length <= item.path.length) { removed.push({ ...item, owner: item.path }); this.values.get(root)!.delete(key); break; }
      const previous = item.value;
      const fragments: OverrideEntry[] = [];
      item.value = pruneValue(item.value, path.slice(item.path.length), fragments, item.path);
      removed.push(...fragments.map(fragment => ({ ...fragment, owner: item.path })));
      if (item.value === undefined || plain(item.value) && Object.keys(item.value).length === 0) {
        if (!fragments.length) removed.push({ ...item, value: previous, owner: item.path });
        this.values.get(root)!.delete(key); break;
      }
    }
    return { paths, removed, order, epoch: state.epoch, checkpoint };
  }
  restoreDiscarded(root: ConfigRoot, discarded: DiscardedPatch): void {
    const state = this.state(root);
    if (state.epoch !== discarded.epoch || !discarded.removed.length) return;
    const values = this.values.get(root) ?? new Map();
    const contains = (parent: PathPart[], child: PathPart[]) => parent.length <= child.length
      && parent.every((part, index) => part === child[index]);
    const newer = (mutation: Mutation) => mutation.revision > discarded.checkpoint;
    // Child edits keep their parent's history; a replaced parent stays retired.
    const sets = [...state.sets.values()].filter(newer);
    const removes = new Set([...state.removes.values()].filter(newer).map(write => JSON.stringify(write.path)));
    const patches = [...state.patches.values()].filter(newer);
    for (const entry of discarded.removed) {
      if (sets.some(write => contains(write.path, entry.owner)) || removes.has(JSON.stringify(entry.owner))
        || patches.some(write => overlaps(write.path, entry.path))) continue;
      const key = JSON.stringify(entry.owner);
      const value = restoreValue(values.get(key)?.value, entry.path.slice(entry.owner.length), entry.value);
      values.set(key, { path: [...entry.owner], value });
    }
    // Restore original layer order without replacing newer independent entries.
    const original = new Set(discarded.order);
    const keys = [...discarded.order.filter(key => values.has(key)), ...[...values.keys()].filter(key => !original.has(key))];
    this.values.set(root, new Map(keys.map(key => [key, values.get(key)!])));
  }
}
