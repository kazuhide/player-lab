import { PlayerUI, EventDispatcher, PlayerUIDOM, type UIManager } from "@showcase/ui-shared";
import { PlayerEvent, type PlayerAPI } from "bitmovin-player";
import { pick } from "../i18n";
import { valueEditor, type ValueEditor } from "./editor";
import { ApiMaterializer, ResourcePool, inputCode } from "./materialize";
import { ApiOverrides, apiPath, validateData } from "./values";
import { configurationCode, uiConfigurationCode } from "./code";
import { ResourceInput, type ApiEntry, type ApiSchema, type ConfigRoot, type PathPart, type Signature } from "./types";

export interface ApiExplorerOptions {
  getPlayer: () => PlayerAPI | undefined;
  getUi: () => UIManager | undefined;
  apply: (root: ConfigRoot) => Promise<void>;
  load: (source: unknown, forceTechnology: unknown, disableSeeking: unknown) => Promise<void>;
  destroy: () => Promise<void>;
  releaseUi: () => void;
  recreate: () => Promise<void>;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const element = node("button", text); element.type = "button"; element.addEventListener("click", action); return element;
}
function option(value: string, label: string): HTMLOptionElement { const element = node("option", label); element.value = value; return element; }
function readPath(root: unknown, path: PathPart[]): unknown {
  let current = root;
  for (const key of path) current = current && (typeof current === "object" || typeof current === "function")
    ? (current as Record<string | number, unknown>)[key] : undefined;
  return current;
}
function preview(value: unknown): string {
  const seen = new WeakSet<object>();
  const visit = (input: unknown, depth: number): unknown => {
    if (input === undefined) return "undefined";
    if (typeof input === "function") return "[Function]";
    if (typeof input === "string") return input.slice(0, 2000).replace(/([?&](?:token|key|signature|sig|password)=)[^&#\s]+/gi, "$1[redacted]");
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input) || depth > 4) return "[…]";
    seen.add(input);
    if (input instanceof Error) return { name: input.name, message: visit(input.message, depth + 1) };
    if (Array.isArray(input)) return input.slice(0, 32).map(item => visit(item, depth + 1));
    if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) return `[${input.constructor?.name || "SDK instance"}]`;
    return Object.fromEntries(Object.entries(input).slice(0, 64).map(([key, item]) => [key,
      /^(?:key|licenseKey|apiKey|password|token|authorization|proxy-authorization|headers)$/i.test(key) ? "[redacted]" : visit(item, depth + 1)]));
  };
  return JSON.stringify(visit(value, 0), null, 2).slice(0, 12000);
}

function configRoute(entry: ApiEntry, indices: number[]): { root: ConfigRoot; path: PathPart[] } {
  const path = apiPath(entry.id, indices);
  if (entry.root === "UIComponentConfigMap" || entry.root === "UIConstructorConfig") return { root: "UIConfig", path: ["componentConfigOverrides", ...path] };
  if (entry.root === "UIComponentLayoutOverrideMap") return { root: "UIConfig", path: ["componentLayoutOverrides", ...path] };
  if (!["PlayerConfig", "SourceConfig", "UIConfig"].includes(entry.root)) throw new Error("Unknown configuration owner.");
  return { root: entry.root as ConfigRoot, path };
}

/** The editor is mounted alongside the original controls and loaded only on demand. */
export class ApiExplorer {
  readonly overrides = new ApiOverrides();
  private catalog?: ApiSchema;
  private readonly constructors: Record<string, unknown> = { ...PlayerUI, EventDispatcher, DOM: PlayerUIDOM,
    ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView,
    HTMLElement, HTMLVideoElement, Element, Document, Node, RegExp, Blob, FormData, URLSearchParams };
  private readonly resources = new ResourcePool(this.constructors);
  private readonly contexts = new Map<string, ApiMaterializer>();
  private player: PlayerAPI | undefined;
  private ui: UIManager | undefined;
  private unsubscribe: (() => void)[] = [];
  private readonly details = node("details");
  private readonly summary = node("summary");
  private readonly content = node("div");
  private readonly status = node("p");
  private readonly log = node("pre");
  private readonly code = node("pre");
  private readonly result = node("pre");
  private readonly counts = new Map<string, number>();
  private readonly events: string[] = [];
  private logTimer: number | undefined;
  private operation = 0;
  private sourceGeneration = 0;
  private outputGeneration = 0;
  private writeSequence = 0;
  private readonly writes = new Map<string, { ticket: number; path: PathPart[] }>();
  private loading: Promise<void> | undefined;
  private preparingPlayer = false;

  constructor(container: HTMLElement, private readonly options: ApiExplorerOptions) {
    this.details.className = "api-explorer";
    this.content.className = "api-explorer-content";
    this.status.setAttribute("role", "status");
    this.result.className = "api-result";
    this.result.setAttribute("aria-live", "polite");
    this.log.className = "api-event-log";
    this.details.append(this.summary, this.content, this.status);
    container.append(this.details);
    this.relocalize();
    this.details.addEventListener("toggle", () => {
      if (this.details.open) void this.loadCatalog().catch(error => { this.status.textContent = String(error); });
    });
  }

  relocalize(): void {
    this.summary.textContent = pick({ ja: "SDKの詳細設定・API・イベント", en: "SDK settings, APIs and events" });
    if (this.catalog) this.render();
  }

  private async loadCatalog(): Promise<void> {
    if (this.catalog) { this.refresh(); return; }
    if (this.loading) return this.loading;
    this.status.textContent = pick({ ja: "SDKの項目を読み込んでいます。", en: "Loading SDK entries." });
    this.loading = import("./schema.json").then(module => {
      this.catalog = module.default as unknown as ApiSchema;
      if (this.catalog.schemaVersion !== 1) throw new Error("Unsupported SDK editor metadata.");
      this.status.textContent = "";
      this.render(); this.refresh();
    }).finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private context(key: string): ApiMaterializer {
    let context = this.contexts.get(key);
    if (!context) {
      if (!this.catalog) throw new Error("Open the SDK editor first.");
      context = new ApiMaterializer(this.catalog, this.constructors, this.resources,
        { ui: { ...PlayerUI, EventDispatcher, DOM: PlayerUIDOM }, getPlayer: this.options.getPlayer }, message => this.record("callback", message));
      this.contexts.set(key, context);
    }
    return context;
  }

  prepare<T extends object>(root: ConfigRoot, base: T): T {
    if (!this.catalog) return base;
    if (root === "SourceConfig") { this.operation++; this.sourceGeneration++; }
    this.contexts.get(root)?.dispose(); this.contexts.delete(root);
    const context = this.context(root);
    if (root === "UIConfig") {
      const config = this.overrides.apply(root, base);
      // GUI component factories run before UIManager's lazy layout. Install the
      // same localization first so they subscribe to the configured dispatcher.
      const localization = context.materialize((config as { localization?: unknown }).localization);
      PlayerUI.i18n.setConfig(localization as Parameters<typeof PlayerUI.i18n.setConfig>[0] ?? {});
      return context.materialize(config) as T;
    }
    const materializedBase = context.materialize(base) as T;
    return this.overrides.apply(root, materializedBase, value => context.materialize(value));
  }

  discardPatch(root: ConfigRoot, patch: object): void {
    this.outputGeneration++; this.operation++;
    for (const key of this.writes.keys()) if (key.startsWith(root)) this.writes.delete(key);
    this.overrides.discardPatch(root, patch);
  }
  setExternal(root: ConfigRoot, path: PathPart[], value: unknown): void {
    this.outputGeneration++; this.operation++; this.markWrite(root, path);
    this.overrides.set(root, path, value);
  }
  clearSource(notify = true): void {
    if (notify) { this.outputGeneration++; this.operation++; }
    for (const key of this.writes.keys()) if (key.startsWith("SourceConfig")) this.writes.delete(key);
    this.overrides.entries("SourceConfig").forEach(entry => this.overrides.remove("SourceConfig", entry.path));
  }
  uiCode(base: object): string {
    const config = this.overrides.apply("UIConfig", base);
    return this.overrides.entries("UIConfig").length ? uiConfigurationCode(config) : inputCode(config);
  }

  private markWrite(root: ConfigRoot, path: PathPart[]): { key: string; ticket: number } {
    for (const [key, prior] of this.writes) if (key.startsWith(root)
      && path.slice(0, Math.min(path.length, prior.path.length)).every((part, index) => part === prior.path[index])) this.writes.delete(key);
    const key = root + JSON.stringify(path);
    const ticket = ++this.writeSequence;
    this.writes.set(key, { ticket, path });
    return { key, ticket };
  }

  beginPlayerChange(): () => void {
    this.operation++; this.sourceGeneration++;
    this.unsubscribe.forEach(unsubscribe => { try { unsubscribe(); } catch { /* Already released. */ } });
    this.unsubscribe = [];
    const cleanups = [...this.contexts.values()].map(context => context.retire());
    this.contexts.clear(); this.resources.clear(); this.counts.clear(); this.events.length = 0;
    this.player = undefined; this.ui = undefined; this.preparingPlayer = true;
    this.result.textContent = ""; this.log.textContent = "";
    return () => cleanups.forEach(cleanup => cleanup());
  }

  refresh(): void {
    if (!this.catalog) return;
    const player = this.options.getPlayer();
    const ui = this.options.getUi();
    if (player === this.player && ui === this.ui) return;
    this.operation++;
    this.unsubscribe.forEach(unsubscribe => { try { unsubscribe(); } catch { /* The SDK may already have released it. */ } });
    this.unsubscribe = [];
    if (player !== this.player) {
      if (!this.preparingPlayer) {
        for (const context of this.contexts.values()) context.dispose();
        this.contexts.clear(); this.resources.clear();
      }
      this.preparingPlayer = false;
      this.counts.clear(); this.events.length = 0;
      this.result.textContent = "";
    } else if (this.ui) {
      this.resources.retire(this.ui);
      this.contexts.get("runtime:UIManager")?.dispose(); this.contexts.delete("runtime:UIManager");
    }
    this.player = player; this.ui = ui;
    if (player) this.resources.add(player, "Current Player", "PlayerAPI", player);
    if (ui) this.resources.add(ui, "Current UIManager", "UIManager", ui);
    const surface = document.getElementById("player");
    if (surface && player) this.resources.add(surface, "Player surface", "HTMLElement", player);
    const video = document.querySelector("#player video");
    if (video) this.resources.add(video, "Current video", "HTMLVideoElement", player);
    this.resources.add(document, "Document", "Document");
    for (const entry of this.catalog.rows.filter(entry => entry.category === "event")) {
      if (entry.root === "PlayerAPI" && player && entry.value && Object.values(PlayerEvent).includes(entry.value as PlayerEvent)) {
        const event = entry.value as PlayerEvent;
        const listener = (payload: unknown) => {
          if (this.options.getPlayer() !== player) return;
          if (event === PlayerEvent.SourceLoaded || event === PlayerEvent.SourceUnloaded) this.operation++;
          this.record(entry.id, preview(payload));
        };
        player.on(event, listener);
        this.unsubscribe.push(() => player.off(event, listener));
      } else if (entry.root === "UIManager" && ui) {
        const dispatcher = readPath(ui, [entry.name!]) as { subscribe: (listener: (...args: unknown[]) => void) => void; unsubscribe: (listener: (...args: unknown[]) => void) => void };
        const listener = (...args: unknown[]) => { if (this.options.getUi() === ui) this.record(entry.id, preview(args)); };
        dispatcher.subscribe(listener);
        this.unsubscribe.push(() => { dispatcher.unsubscribe(listener); });
      }
    }
  }

  private record(id: string, message: string): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    this.events.push(`${id}: ${message.slice(0, 1500)}`);
    while (this.events.length > 80) this.events.shift();
    if (this.logTimer === undefined) this.logTimer = window.setTimeout(() => {
      this.logTimer = undefined;
      this.log.textContent = [...this.counts].map(([id, count]) => `${id}: ${count}`).join("\n") + "\n\n" + [...this.events].reverse().join("\n");
    }, 125);
  }

  private identityItems(id: string): unknown[] | undefined {
    const ui = this.options.getUi();
    if (!ui) return undefined;
    if (id === "UIManager.switchToUiVariant") return ui.getUiVariants();
    if (id === "UIManager.removeTimelineMarker" || id === "UIManager.timelineMarkers.remove") return ui.getTimelineMarkers();
    if (id === "UIManager.recommendations.remove") return ui.recommendations.list();
    return undefined;
  }

  private render(): void {
    const catalog = this.catalog!;
    const note = node("p", pick({ ja: "公開SDKの項目を検索して個別に編集・実行できます。作成時の設定はPlayerを再生成し、ソース設定は再読み込み、UI設定は現在のテーマを再生成して適用します。イベントは現在のPlayerとUIだけを記録します。", en: "Search public SDK entries to edit settings and run APIs. Creation settings recreate the Player, source settings reload the source, and UI settings rebuild the current theme. Events belong to the current Player and UI." }));
    const controls = node("div"); controls.className = "api-explorer-controls";
    const search = node("input"); search.type = "search"; search.setAttribute("aria-label", pick({ ja: "APIを検索", en: "Search APIs" }));
    const category = node("select"); category.setAttribute("aria-label", pick({ ja: "APIの種類", en: "API category" }));
    category.append(option("configuration", pick({ ja: "設定", en: "Configuration" })), option("command", pick({ ja: "操作", en: "Commands" })), option("observation", pick({ ja: "状態の取得", en: "Read state" })), option("event", pick({ ja: "イベント", en: "Events" })));
    const selection = node("select"); selection.size = 9; selection.setAttribute("aria-label", pick({ ja: "SDKの項目", en: "SDK entry" }));
    const form = node("div"); form.className = "api-explorer-form";
    const layout = node("div"); layout.className = "api-explorer-layout";
    const list = node("div"); list.className = "api-explorer-list"; list.append(search, category, selection);
    controls.append(button(pick({ ja: "Playerを再生成", en: "Recreate Player" }), () => {
      void this.options.recreate().catch(error => { this.status.textContent = String(error); });
    }), button(pick({ ja: "イベント履歴を消去", en: "Clear event history" }), () => { this.counts.clear(); this.events.length = 0; this.log.textContent = ""; }));
    layout.append(list, form);
    this.content.replaceChildren(note, controls, layout, node("h3", pick({ ja: "適用・実行したコード", en: "Applied or executed code" })), this.code,
      node("h3", pick({ ja: "結果", en: "Result" })), this.result, node("h3", pick({ ja: "イベントとコールバック", en: "Events and callbacks" })), this.log);

    const renderSelected = () => {
      form.replaceChildren();
      const entry = catalog.rows.find(entry => entry.id === selection.value);
      if (!entry) return;
      form.append(node("h3", entry.id));
      if (entry.container) form.append(node("p", pick({ ja: "このオブジェクト・配列をまとめて編集します。必須フィールドを揃えてから適用してください。", en: "Edit this object or array as a whole. Complete its required fields before applying it." })));
      if (entry.reference) { const link = node("a", pick({ ja: "公式APIリファレンス", en: "Official API reference" })); link.href = entry.reference; link.target = "_blank"; link.rel = "noopener noreferrer"; form.append(link); }
      if (entry.blocked) { form.append(node("p", pick({ ja: "このパスはSDK型定義のコンポーネント本体から列挙されたもので、コンストラクターの設定ではありません。設定として渡してもメソッドは実行されません。UIConstructorConfig.ToggleSettingsPanelItemで実際のコンストラクター入力を編集してください。", en: "This path was enumerated from the SDK component class, rather than its constructor configuration. Passing it as configuration does not invoke its method. Use UIConstructorConfig.ToggleSettingsPanelItem to edit the actual constructor input." }))); return; }
      if (entry.category === "event") { form.append(node("p", pick({ ja: "現在のインスタンスへの購読結果は下のイベント欄で確認できます。必要な素材・機能・端末の操作を行うと発生回数と内容が更新されます。", en: "Subscriptions for the current instance are shown in the event log below. Counts and payloads update when the required source, feature or device interaction produces the event." }))); return; }
      const schema = catalog.nodes[entry.schema!]!;
      const indexInputs: HTMLInputElement[] = [];
      let editor: ValueEditor;
      let signature: Signature | undefined;
      let args: ValueEditor[] = [];
      const resources = { list: (schema: Parameters<ResourcePool["list"]>[0]) => this.resources.list(schema) };
      if (entry.category === "configuration") {
        for (let i = 0; i < (entry.id.match(/\[\]/g)?.length ?? 0); i++) {
          const input = node("input"); input.type = "number"; input.min = "0"; input.max = "255"; input.value = "0";
          input.setAttribute("aria-label", `Array index ${i + 1}`); indexInputs.push(input); form.append(input);
        }
        editor = valueEditor(catalog, entry.schema!, resources);
        form.append(editor.element);
        const apply = button(pick({ ja: "設定を適用", en: "Apply setting" }), () => {
          const output = ++this.outputGeneration;
          this.status.textContent = pick({ ja: "設定を適用しています。", en: "Applying setting." });
          void (async () => {
            apply.disabled = true;
            const route = configRoute(entry, indexInputs.map(input => Number(input.value)));
            let write: { key: string; ticket: number } | undefined;
            let replaced: { path: PathPart[]; value: unknown }[] = [];
            let submitted = false;
            const submittedPlayer = this.options.getPlayer();
            let submittedSourceGeneration = this.sourceGeneration;
            try {
              const value = validateData(catalog, entry.schema!, this.resources.forConfiguration(editor.read()));
              this.context("preflight").preflight(value);
              write = this.markWrite(route.root, route.path);
              replaced = this.overrides.set(route.root, route.path, value);
              submitted = true;
              const pending = this.options.apply(route.root);
              submittedSourceGeneration = this.sourceGeneration;
              await pending;
              if (output === this.outputGeneration) {
                this.showConfigCode(route.root);
                this.status.textContent = pick({ ja: "設定を送信しました。機能の状態は結果・イベントとプレイヤー画面で確認してください。", en: "Configuration submitted. Check feature state in the results, events and player." });
              }
            } catch (error) {
              const currentOwner = route.root === "PlayerConfig" || this.options.getPlayer() === submittedPlayer;
              const currentSource = route.root !== "SourceConfig" || this.sourceGeneration === submittedSourceGeneration;
              if (submitted && currentOwner && currentSource && write && this.writes.get(write.key)?.ticket === write.ticket) {
                this.overrides.remove(route.root, route.path);
                for (const prior of replaced) this.overrides.set(route.root, prior.path, prior.value);
                try { await this.options.apply(route.root); } catch { /* Keep the original SDK error visible. */ }
              }
              if (output === this.outputGeneration) this.status.textContent = String(error);
            } finally { apply.disabled = false; this.refresh(); }
          })().catch(error => { this.status.textContent = String(error); apply.disabled = false; });
        });
        form.append(apply, button(pick({ ja: "この上書きを解除", en: "Remove this override" }), () => {
          const output = ++this.outputGeneration;
          this.status.textContent = pick({ ja: "上書きを解除しています。", en: "Removing override." });
          void (async () => {
            const route = configRoute(entry, indexInputs.map(input => Number(input.value)));
            this.markWrite(route.root, route.path);
            this.overrides.remove(route.root, route.path);
            await this.options.apply(route.root);
            if (output === this.outputGeneration) {
              this.showConfigCode(route.root);
              this.status.textContent = pick({ ja: "上書きを解除しました。", en: "Override removed." });
            }
          })().catch(error => { if (output === this.outputGeneration) this.status.textContent = String(error); });
        }));
      } else {
        const overload = node("select"); overload.setAttribute("aria-label", pick({ ja: "APIのシグネチャー", en: "API signature" }));
        schema.signatures!.forEach((signature, index) => overload.append(option(String(index), `(${signature.parameters.map(parameter => parameter.name + (parameter.optional ? "?" : "") + ": " + catalog.nodes[parameter.schema]!.label).join(", ")})`)));
        const body = node("div");
        const update = () => {
          signature = schema.signatures![Number(overload.value)]!;
          args = []; body.replaceChildren();
          for (const [index, parameter] of signature.parameters.entries()) {
            let value: ValueEditor;
            const identities = index === 0 ? this.identityItems(entry.id) : undefined;
            if (identities) {
              const owner = this.options.getUi();
              const select = node("select"); select.setAttribute("aria-label", pick({ ja: "SDKオブジェクト", en: "SDK object" }));
              identities.forEach((_, itemIndex) => select.append(option("resource:" + itemIndex, `Current item [${itemIndex}]`)));
              value = { element: select, read: () => {
                if (!select.value) throw new Error("The current UI has no object for this operation.");
                if (owner !== this.options.getUi()) throw new Error("This UI has been replaced. Select the operation again.");
                const itemIndex = Number(select.value.slice(9));
                const id = this.resources.add(identities[itemIndex], `${entry.id} item ${itemIndex}`, catalog.nodes[parameter.schema]!.label, owner);
                if (!id) throw new Error("Select a current SDK object.");
                return new ResourceInput(id);
              } };
            } else value = valueEditor(catalog, parameter.schema, resources);
            const enabled = node("input"); enabled.type = "checkbox"; enabled.checked = !parameter.optional; enabled.disabled = !parameter.optional;
            const label = node("label"); label.append(enabled, document.createTextNode(" " + parameter.name));
            value.element.hidden = !enabled.checked;
            enabled.addEventListener("change", () => { value.element.hidden = !enabled.checked; });
            const field = node("fieldset"); field.append(label, value.element); body.append(field);
            args.push({ element: field, read: () => enabled.checked ? value.read() : undefined });
          }
        };
        overload.addEventListener("change", update); update(); form.append(overload, body);
        const run = button(pick(entry.category === "observation" ? { ja: "状態を取得", en: "Read state" } : { ja: "APIを実行", en: "Run API" }), () => {
          run.disabled = true;
          void (async () => this.invoke(entry, signature!, args.map(arg => arg.read())))()
            .then(() => { if (selection.value === entry.id) renderSelected(); })
            .catch(error => { this.status.textContent = String(error); })
            .finally(() => { run.disabled = false; });
        });
        form.append(run);
      }
    };
    const filter = () => {
      const current = selection.value;
      const query = search.value.toLocaleLowerCase();
      selection.replaceChildren(...catalog.rows.filter(entry => entry.category === category.value && entry.id.toLocaleLowerCase().includes(query)).map(entry => option(entry.id, entry.id)));
      if ([...selection.options].some(option => option.value === current)) selection.value = current;
      if (!selection.value && selection.options.length) selection.selectedIndex = 0;
      renderSelected();
    };
    search.addEventListener("input", filter); category.addEventListener("change", filter); selection.addEventListener("change", renderSelected); filter();
  }

  private showConfigCode(root: ConfigRoot): void {
    this.code.textContent = configurationCode(root, this.overrides.entries(root));
  }

  private async invoke(entry: ApiEntry, signature: Signature, inputs: unknown[]): Promise<void> {
    const token = ++this.operation;
    const output = ++this.outputGeneration;
    this.status.textContent = pick({ ja: "SDKを呼び出しています。", en: "Calling the SDK." });
    this.result.textContent = "";
    const root = entry.root === "PlayerAPI" ? this.options.getPlayer() : this.options.getUi();
    if (!root) throw new Error("Create a player and UI first.");
    const context = this.context("runtime:" + entry.root);
    const checkpoint = context.checkpoint();
    let through = checkpoint;
    let result: unknown;
    try {
      const submitted = entry.id === "PlayerAPI.load" ? [this.resources.forConfiguration(inputs[0]), ...inputs.slice(1)] : inputs;
      let args: unknown[];
      if (entry.id === "PlayerAPI.load") {
        // SourceConfig owns these callbacks. Validate now and construct them once
        // in that source's context rather than creating unused runtime copies.
        validateData(this.catalog!, signature.parameters[0]!.schema, submitted[0]);
        context.preflight(submitted[0]);
        args = [submitted[0], ...context.arguments({ ...signature, parameters: signature.parameters.slice(1) }, submitted.slice(1))];
      } else args = context.arguments(signature, submitted);
      through = context.checkpoint();
      context.publish(checkpoint, through, false);
      const identities = this.identityItems(entry.id);
      if (identities && (!(submitted[0] instanceof ResourceInput) || !identities.includes(args[0]))) {
        throw new Error("Select an object owned by the current UI. Read its current collection again if it has changed.");
      }
      const path = apiPath(entry.id);
      const owner = readPath(root, path.slice(0, -1));
      const fn = readPath(root, path);
      if (typeof fn !== "function") throw new Error("This API is unavailable in the current SDK instance.");
      if (root !== (entry.root === "PlayerAPI" ? this.options.getPlayer() : this.options.getUi())) { context.rollback(checkpoint, through); return; }
      this.code.textContent = `${entry.id.replace(/^PlayerAPI/, "player").replace(/^UIManager/, "uiManager")}(${submitted.map(input => inputCode(input)).join(", ")});`;
      if (entry.id === "PlayerAPI.destroy") result = await this.options.destroy();
      else if (entry.id === "PlayerAPI.load") result = await this.options.load(submitted[0], args[1], args[2]);
      else if (entry.id === "UIManager.release") result = this.options.releaseUi();
      else result = await Reflect.apply(fn, owner, args);
      context.publish(checkpoint, through);
    } catch (error) {
      context.rollback(checkpoint, through);
      if (token !== this.operation || output !== this.outputGeneration || root !== (entry.root === "PlayerAPI" ? this.options.getPlayer() : this.options.getUi())) return;
      throw error;
    }
    if (token !== this.operation || output !== this.outputGeneration || root !== (entry.root === "PlayerAPI" ? this.options.getPlayer() : this.options.getUi())) return;
    this.resources.captureResult(this.catalog!, signature.returns, result, entry.id + " result", root);
    this.result.textContent = preview(result);
    this.status.textContent = pick({ ja: "SDKの呼び出しが完了しました。", en: "SDK call completed." });
    this.refresh();
  }
}
