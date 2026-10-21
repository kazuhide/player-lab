import { BitmovinCastManager, OfflineContentManager, OfflineEventType, Source, type OfflineContentManagerListener, type Player } from "bitmovin-player-react-native";
import type { ApiOperation } from "./apiOperations";
import type { NativeSettings } from "./nativeSettings";
import { finiteNumber } from "./apiValues";

interface OfflineOwner { manager: OfflineContentManager; ready: Promise<void>; remove: () => void; initialized: boolean; released?: Promise<void>; }

/** Native resources are retired only after their asynchronous initialization has settled. */
export class AuxiliaryOperations {
  private active = true;
  private offline: OfflineOwner | undefined;
  private loadedSource: Source | undefined;
  private revision = 0;
  private sourceRevision = 0;
  private retirement: Promise<void> = Promise.resolve();
  private listenerRevision = 0;
  constructor(private readonly player: Player, private readonly settings: () => NativeSettings,
    private readonly record: (name: string, value: unknown) => void) {}

  private listener(manager: OfflineContentManager, names: readonly string[] = Object.values(OfflineEventType), body = ""): OfflineContentManagerListener {
    const revision = ++this.listenerRevision;
    const run = body ? new Function("event", "name", "lab", '"use strict";\n' + body) as (event: unknown, name: string, lab: { getPlayer: () => Player; getSource: () => Source | undefined }) => unknown : undefined;
    const context = Object.freeze({
      getPlayer: () => { if (!this.active || this.offline?.manager !== manager || revision !== this.listenerRevision) throw new Error("The listener owner has retired."); return this.player; },
      getSource: () => { if (!this.active || this.offline?.manager !== manager || revision !== this.listenerRevision) throw new Error("The listener owner has retired."); return this.player.source; },
    });
    let calls = 0;
    const emit = (name: string, event: unknown) => {
      if (!this.active || this.offline?.manager !== manager || this.offline.released || revision !== this.listenerRevision) return;
      this.record("OfflineContentManagerListener." + name, event);
      calls += 1;
      try {
        const result = run?.(event, name, context);
        void Promise.resolve(result).catch(() => {
          if (calls <= 20 && this.active && this.offline?.manager === manager && revision === this.listenerRevision) this.record("OfflineContentManagerListener." + name, { error: "Edited offline listener rejected." });
        });
      }
      catch { if (calls <= 20) this.record("OfflineContentManagerListener." + name, { error: "Edited offline listener failed." }); }
    };
    const listener: OfflineContentManagerListener = {
      onCompleted: (e) => emit("onCompleted", e), onError: (e) => emit("onError", e),
      onProgress: (e) => emit("onProgress", e), onOptionsAvailable: (e) => emit("onOptionsAvailable", e),
      onDrmLicenseUpdated: (e) => emit("onDrmLicenseUpdated", e), onDrmLicenseExpired: (e) => emit("onDrmLicenseExpired", e),
      onSuspended: (e) => emit("onSuspended", e), onResumed: (e) => emit("onResumed", e), onCanceled: (e) => emit("onCanceled", e),
    };
    if (!names.includes("onCompleted")) delete listener.onCompleted;
    if (!names.includes("onError")) delete listener.onError;
    if (!names.includes("onProgress")) delete listener.onProgress;
    if (!names.includes("onOptionsAvailable")) delete listener.onOptionsAvailable;
    if (!names.includes("onDrmLicenseUpdated")) delete listener.onDrmLicenseUpdated;
    if (!names.includes("onDrmLicenseExpired")) delete listener.onDrmLicenseExpired;
    if (!names.includes("onSuspended")) delete listener.onSuspended;
    if (!names.includes("onResumed")) delete listener.onResumed;
    if (!names.includes("onCanceled")) delete listener.onCanceled;
    return listener;
  }

  private manager(): OfflineContentManager {
    if (!this.offline || this.offline.released) throw new Error("Run OfflineContentManager.initialize first.");
    if (!this.offline.initialized) throw new Error("Offline manager initialization is still pending.");
    return this.offline.manager;
  }

  private release(owner: OfflineOwner): Promise<void> {
    if (owner.released) return owner.released;
    try { owner.remove(); } catch { /* Native cleanup must still run. */ }
    owner.released = owner.ready.catch(() => {}).then(() => owner.manager.destroy());
    return owner.released;
  }

  private async initialize(): Promise<void> {
    const revision = ++this.revision;
    if (this.offline) { const previous = this.offline; this.offline = undefined; this.retirement = this.release(previous); }
    await this.retirement;
    if (!this.active || revision !== this.revision) return;
    const config = this.settings().offline;
    if (!config.identifier.trim()) throw new Error("Set OfflineContentConfig.identifier to a stable content identifier.");
    const manager = new OfflineContentManager(config);
    const remove = manager.addListener(this.listener(manager));
    const ready = Promise.resolve().then(() => {
      if (this.active && this.offline?.manager === manager) return manager.initialize();
      return undefined;
    }).then(() => { if (this.active && this.offline?.manager === manager) this.offline.initialized = true; });
    this.offline = { manager, ready, remove, initialized: false };
    await ready;
  }

  operations(): ApiOperation[] {
    const operations: ApiOperation[] = [];
    const add = (id: string, run: () => unknown, code = id + "()") => operations.push({ id, arguments: [], run, code: () => code });
    add("OfflineContentManager.initialize", () => this.initialize(), "const offline = new SDK.OfflineContentManager(offlineConfig);\nawait offline.initialize();");
    add("OfflineContentManager.destroy", async () => {
      this.revision += 1;
      if (this.offline) this.retirement = this.release(this.offline);
      await this.retirement;
    }, "await offline.destroy();");
    const listenerInput = (values: Record<string, string>) => {
      const names = (values.events ?? "").split(/\s+/).filter(Boolean);
      if (names.some((name) => !Object.values<string>(OfflineEventType).includes(name))) throw new Error("Enter named OfflineEventType callbacks, separated by whitespace.");
      const body = values.body ?? "";
      if (body.length > 100_000) throw new Error("A listener body must be at most 100000 characters.");
      if (body && values.allow !== "yes") throw new Error("Allow edited listener JavaScript before running this operation.");
      if (body) new Function("event", "name", "lab", '"use strict";\n' + body);
      return { names, body };
    };
    operations.push({ id: "OfflineContentManager.addListener", arguments: [
      { name: "events", label: "Offline listener names (one per line; blank attaches an empty listener)", initial: Object.values(OfflineEventType).join("\n") },
      { name: "body", label: "Optional listener JavaScript body (event, name, lab)", initial: "" },
      { name: "allow", label: "Allow edited listener JavaScript in this app", initial: "no", choices: ["no", "yes"] },
    ], run: (values) => {
      const input = listenerInput(values);
      if (!this.offline || this.offline.released) throw new Error("Initialize the offline manager first.");
      this.offline.remove();
      this.offline.remove = this.offline.manager.addListener(this.listener(this.offline.manager, input.names, input.body));
      return "Selected offline listeners attached. Their bodies execute on SDK events.";
    }, code: (values) => {
      const input = listenerInput(values);
      return "const lab = { getPlayer: () => player, getSource: () => player.source };\nconst listener = {\n" + input.names.map((name) => `  ${name}: (event) => { const name = ${JSON.stringify(name)};\n${input.body}\n  },`).join("\n") + "\n};\nconst removeListener = offline.addListener(listener);";
    } });
    add("OfflineContentManager.state", () => this.manager().state(), "await offline.state();");
    add("OfflineContentManager.getOptions", () => this.manager().getOptions(), "await offline.getOptions(); // Inspect onOptionsAvailable.");
    add("OfflineContentManager.download", () => this.manager().download(this.settings().download), "await offline.download(downloadRequest); // Completion is reported by onCompleted.");
    add("OfflineContentManager.resume", () => this.manager().resume(), "await offline.resume();");
    add("OfflineContentManager.suspend", () => this.manager().suspend(), "await offline.suspend();");
    add("OfflineContentManager.cancelDownload", () => this.manager().cancelDownload(), "await offline.cancelDownload();");
    add("OfflineContentManager.usedStorage", () => this.manager().usedStorage(), "await offline.usedStorage();");
    add("OfflineContentManager.deleteAll", () => this.manager().deleteAll(), "await offline.deleteAll();");
    add("OfflineContentManager.downloadLicense", () => this.manager().downloadLicense(), "await offline.downloadLicense();");
    add("OfflineContentManager.releaseLicense", () => this.manager().releaseLicense(), "await offline.releaseLicense();");
    add("OfflineContentManager.renewOfflineLicense", () => this.manager().renewOfflineLicense(), "await offline.renewOfflineLicense();");
    add("OfflineContentManager.config", () => this.manager().config, "offline.config");
    add("OfflineContentManager.nativeId", () => this.manager().nativeId, "offline.nativeId");
    add("OfflineContentManager.isInitialized", () => this.manager().isInitialized, "offline.isInitialized");
    add("OfflineContentManager.isDestroyed", () => this.manager().isDestroyed, "offline.isDestroyed");
    add("Player.loadOfflineContent", () => this.player.loadOfflineContent(this.manager(), this.settings().offlineOptions), "player.loadOfflineContent(offline, offlineOptions);");
    add("Player.loadSource", async () => {
      const revision = ++this.sourceRevision;
      const previous = this.player.source;
      this.player.unload();
      previous?.destroy();
      const source = new Source(this.settings().source);
      try {
        await source.initialize();
        if (!this.active || revision !== this.sourceRevision) { source.destroy(); return; }
        this.player.loadSource(source);
        this.loadedSource = source;
      } catch (error) { source.destroy(); throw error; }
    }, "const previous = player.source;\nplayer.unload();\nprevious?.destroy();\nconst source = new SDK.Source(sourceConfig);\nawait source.initialize();\nplayer.loadSource(source);");
    add("BitmovinCastManager.isInitialized", () => BitmovinCastManager.isInitialized());
    add("BitmovinCastManager.initialize", () => BitmovinCastManager.initialize(this.settings().cast), "await SDK.BitmovinCastManager.initialize(castOptions);\n// SDK 1.29: this deprecated method is a no-op. Use Cast startup configuration, save and fully restart the app.\n// Inspect the actual native state with BitmovinCastManager.isInitialized().");
    add("BitmovinCastManager.updateContext", () => BitmovinCastManager.updateContext());
    operations.push({ id: "Player.scheduleAd", arguments: [{ name: "index", label: "Applied advertising schedule index (starting at 0)", initial: "0" }],
      run: (values) => {
        const index = finiteNumber(values.index ?? "", "Ad item index", 0);
        const item = this.settings().player.advertisingConfig?.schedule[index];
        if (!Number.isSafeInteger(index) || !item) throw new Error("Choose an index from the applied advertising schedule.");
        return this.player.scheduleAd(item);
      }, code: (values) => `player.scheduleAd(playerConfig.advertisingConfig!.schedule[${finiteNumber(values.index ?? "", "Ad item index", 0)}]!);` });
    operations.push({ id: "BitmovinCastManager.sendMessage", arguments: [
      { name: "message", label: "Cast message", initial: "" }, { name: "namespace", label: "Cast namespace (blank uses default)", initial: "" },
    ], run: (values) => BitmovinCastManager.sendMessage(values.message ?? "", values.namespace || null),
    code: (values) => `await SDK.BitmovinCastManager.sendMessage(${JSON.stringify(values.message ?? "")}, ${JSON.stringify(values.namespace || null)});` });
    return operations;
  }

  dispose(): void {
    this.active = false;
    this.revision += 1;
    this.sourceRevision += 1;
    if (this.offline) { const owner = this.offline; this.offline = undefined; this.retirement = this.release(owner); }
    void this.retirement.catch(() => console.warn("Offline manager cleanup failed."));
    if (this.loadedSource && this.player.source !== this.loadedSource) this.loadedSource.destroy();
    // The Player owns its currently attached source's native lifetime.
    this.loadedSource = undefined;
  }

  sourceChanged(): void { this.sourceRevision += 1; }
}
