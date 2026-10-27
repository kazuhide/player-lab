import type { PlayerAPI, PlayerConfig, SourceConfig } from "bitmovin-player";
import { PlayerEvent } from "bitmovin-player/modules/bitmovinplayer-core";
import { catalog } from "./catalog";
import { configurationOverrides, validateConfigurationShape, type ConfigInput } from "./configInputs";
import { ApiMaterializer, ResourcePool } from "./materialize";
import { apiPath } from "./values";
import type { ApiEntry, Signature } from "./types";
import { typedCode } from "./typedCode";
import { apiValue } from "./apiValues";
import { currentOperationAvailability, type OperationAvailability } from "./availability";

function runtimeConstructors(): Record<string, unknown> {
  const constructors: Record<string, unknown> = { ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView, Date, RegExp };
  for (const name of ["Blob", "Document", "SharedArrayBuffer", "FormData", "URLSearchParams"]) {
    const constructor: unknown = Reflect.get(globalThis, name);
    if (typeof constructor === "function") constructors[name] = constructor;
  }
  return constructors;
}
const eventValue = (raw: string): PlayerEvent => {
  const event = Object.values(PlayerEvent).find((event) => event === raw);
  if (event === undefined) throw new Error("Unknown Vega SDK event.");
  return event;
};

export class VegaSessionApi {
  private readonly constructors = runtimeConstructors();
  readonly resources = new ResourcePool(this.constructors);
  readonly materializer: ApiMaterializer;
  readonly id = Symbol("Vega API session");
  private active = true;
  private current: (() => boolean) | undefined;
  private player: PlayerAPI | undefined;
  private removeEvents: (() => void) | undefined;
  private ready = false;
  private sourceFailed = false;
  private sourceErrorRevision = 0;
  private pending: Promise<unknown> | undefined;
  private listeners = new Set<() => void>();
  private lines: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private recording = true;
  private retirement: (() => Promise<void>) | undefined;
  constructor() {
    const lab = Object.freeze({ getPlayer: () => this.requirePlayer(), getSource: () => this.requirePlayer().getSource() });
    this.materializer = new ApiMaterializer(catalog, this.constructors, this.resources, lab, (message) => this.event("Callback", message));
  }
  isActive(): boolean { return this.active && (this.current?.() ?? true); }
  isReady(): boolean { return this.isActive() && this.ready; }
  isBusy(): boolean { return Boolean(this.pending); }
  private requirePlayer(): PlayerAPI {
    if (!this.isActive() || !this.player) throw new Error("The Vega SDK session is no longer active.");
    return this.player;
  }
  prepare(config: PlayerConfig, source: SourceConfig, inputs: readonly ConfigInput[]): { config: PlayerConfig; source: SourceConfig } {
    if (!this.isActive()) throw new Error("The Vega session retired before applying configuration.");
    validateConfigurationShape(config, source, inputs);
    const overrides = configurationOverrides(inputs);
    const materialize = (value: unknown) => this.materializer.materialize(value);
    return { config: overrides.apply("PlayerConfig", config, materialize), source: overrides.apply("SourceConfig", source, materialize) };
  }
  bind(player: PlayerAPI, current: () => boolean): void {
    this.player = player; this.current = current;
    this.resources.add(player, "Current Player", "PlayerAPI");
    try { this.resources.add(player.getVideoElement(), "Current SDK video element", "HTMLVideoElement"); } catch { /* Some engines expose this only after loading. */ }
    const registrations: Array<{ event: PlayerEvent; callback: (event: unknown) => void }> = [];
    const remove = () => {
      // A failure in one engine-specific event must not retain the other listeners.
      for (const { event, callback } of registrations.splice(0)) {
        try { player.off(event, callback); } catch { /* Continue retiring the remaining callbacks. */ }
      }
    };
    this.removeEvents = remove;
    try {
      for (const entry of catalog.rows.filter((entry) => entry.category === "event")) {
        const event = eventValue(entry.value!);
        const callback = (value: unknown) => {
          if (!this.isActive()) return;
          if (event === PlayerEvent.Error) { this.sourceFailed = true; this.sourceErrorRevision++; }
          else if (event === PlayerEvent.SourceLoaded) this.sourceFailed = false;
          this.event(entry.id, value);
        };
        player.on(event, callback); registrations.push({ event, callback });
      }
    } catch (error) { remove(); throw error; }
  }
  loaded(): void { if (this.isActive()) { this.ready = true; this.notify(); } }
  setRetirement(retire: () => Promise<void>): void { this.retirement = retire; }
  onChange(callback: () => void): () => void { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
  private notify(): void { if (this.isActive()) for (const callback of this.listeners) callback(); }
  private event(name: string, value: unknown): void {
    if (!this.isActive()) return;
    if (this.recording) this.lines = [`${name}: ${apiValue(value).slice(0, 2000)}`, ...this.lines].slice(0, 80);
    // Pausing the optional event log must not freeze current API availability.
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.notify(); }, 125);
  }
  eventLines(): string[] { return this.lines; }
  setRecording(recording: boolean): void { this.recording = recording; this.notify(); }
  isRecording(): boolean { return this.recording; }
  clearEvents(): void { this.lines = []; this.notify(); }
  availability(): { id: string; callable: boolean; reason?: string }[] {
    this.requirePlayer();
    return catalog.rows.filter(entry => entry.category === "command" || entry.category === "observation")
      .map(entry => ({ id: entry.id, ...this.operationAvailability(entry) }));
  }
  operationAvailability(entry: ApiEntry, args?: readonly unknown[]): OperationAvailability {
    if (!this.isReady()) return { callable: false, reason: "Wait for the current Vega source to load." };
    if (this.pending) return { callable: false, reason: "The previous SDK operation is still pending; it has not been retried." };
    try {
      const player = this.requirePlayer();
      this.resolveMethod(player, entry);
      return currentOperationAvailability(player, entry.id, args, this.sourceFailed);
    } catch {
      return { callable: false, reason: "This public API cannot be read in the current native SDK state." };
    }
  }
  private requireOperation(entry: ApiEntry, args?: readonly unknown[]): void {
    const available = this.operationAvailability(entry, args);
    if (!available.callable) throw new Error(available.reason);
  }
  private resolveMethod(player: PlayerAPI, entry: ApiEntry): { owner: object | Function; method: Function } {
    const parts = apiPath(entry.id);
    let owner: unknown = player;
    for (const part of parts.slice(0, -1)) {
      if (!owner || (typeof owner !== "object" && typeof owner !== "function")) throw new Error("The selected SDK namespace is unavailable in this integration.");
      owner = Reflect.get(owner, part);
    }
    if (!owner || (typeof owner !== "object" && typeof owner !== "function")) throw new Error("The selected SDK API is unavailable in this integration.");
    const method: unknown = Reflect.get(owner, parts[parts.length - 1]!);
    if (typeof method !== "function") throw new Error("The selected SDK method is unavailable in this integration.");
    return { owner, method };
  }
  signature(entry: ApiEntry, overload: number): Signature {
    const signature = catalog.nodes[entry.schema!]?.signatures?.[overload];
    if (!signature) throw new Error("Choose a published SDK method signature.");
    return signature;
  }
  code(entry: ApiEntry, values: unknown[], overload = 0): string {
    const signature = this.signature(entry, overload);
    const supplied = [...values];
    while (supplied.length && supplied[supplied.length - 1] === undefined && signature.parameters[supplied.length - 1]?.optional) supplied.pop();
    return entry.id.replace(/^PlayerAPI/, "player") + "(" + supplied.map((value, index) =>
      (signature.parameters[index]?.rest ? "..." : "") + typedCode(signature.parameters[index]?.schema ?? "", value)).join(", ") + ");";
  }
  async run(entry: ApiEntry, overload: number, values: unknown[]): Promise<{ value: string; code: string }> {
    this.requireOperation(entry);
    const signature = this.signature(entry, overload);
    values.forEach((value) => this.materializer.preflight(value));
    const args = this.materializer.arguments(signature, values);
    const callCode = this.code(entry, values, overload);
    // Approved value factories can change the source or retire this owner.
    // Re-read state at dispatch instead of trusting the earlier picker result.
    this.requireOperation(entry, args);
    const player = this.requirePlayer();
    const sourceErrorRevision = this.sourceErrorRevision;
    let work: Promise<unknown>;
    if (entry.id === "PlayerAPI.destroy" && this.retirement) work = this.retirement();
    else {
      const { owner, method } = this.resolveMethod(player, entry);
      work = Promise.resolve(Reflect.apply(method, owner, args));
    }
    this.pending = work; this.notify();
    try {
      const value = await work;
      if (!this.isActive()) throw new Error("The Vega session retired before this operation completed.");
      if (entry.id === "PlayerAPI.load" && this.sourceErrorRevision === sourceErrorRevision) this.sourceFailed = false;
      const returns = catalog.nodes[signature.returns]!;
      const actualReturn = returns.kind === "promise" ? catalog.nodes[returns.value as string] : returns;
      const resource = actualReturn?.kind === "instance" ? this.resources.add(value, entry.id, actualReturn.name) : undefined;
      return { value: resource ? `${actualReturn!.label}: current SDK resource ${resource}` : apiValue(value), code: callCode };
    } finally { if (this.pending === work) this.pending = undefined; this.notify(); }
  }
  dispose(): void {
    if (!this.active) return;
    this.active = false; this.ready = false;
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    try { this.removeEvents?.(); } finally { this.materializer.dispose(); this.resources.clear(); this.listeners.clear(); this.player = undefined; this.current = undefined; }
  }
}
