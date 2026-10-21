import { CustomMessageHandler, CustomUi, Source, type FullscreenHandler, type HttpRequest, type HttpResponse, type ImaSettings, type MediaCodecInfo, type Player } from "bitmovin-player-react-native";
import type { NativeSettings } from "./nativeSettings";

export interface NativeScriptDraft { allowed: boolean; bodies: Record<string, string>; }
interface ScriptField {
  id: string; parameters: string[]; signature: string; initial: string;
  install: (settings: NativeSettings, owner: NativeScriptOwner, body: string) => void;
}
type Script = (...values: unknown[]) => unknown;
const code = new WeakMap<object, string>();
export const scriptCode = (value: object): string | undefined => code.get(value);
function functionSource(field: ScriptField, body: string): string {
  return `return ${field.signature.includes("=> Promise") ? "async " : ""}function(${field.parameters.join(", ")}) {\n"use strict";\n${body}\n};`;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const headers = (value: unknown): value is Record<string, string> => object(value) && Object.values(value).every((item) => typeof item === "string");
const optionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === "string";
const request = (value: unknown): value is HttpRequest => object(value) && headers(value.headers) && typeof value.method === "string" && typeof value.url === "string" && optionalString(value.body);
const response = (value: unknown): value is HttpResponse => object(value) && headers(value.headers) && request(value.request) && typeof value.status === "number" && Number.isFinite(value.status) && typeof value.url === "string" && optionalString(value.body);
const ima = (value: unknown): value is ImaSettings => object(value) && typeof value.language === "string" && typeof value.maxRedirects === "number" && Number.isFinite(value.maxRedirects)
  && [value.ppid, value.playerVersion, value.sessionId].every(optionalString)
  && [value.enableBackgroundPlayback, value.sameAppKeyEnabled].every((item) => item === undefined || typeof item === "boolean");
const codecs = (value: unknown): value is MediaCodecInfo[] => Array.isArray(value) && value.every((item) => object(item) && typeof item.name === "string" && typeof item.isSoftware === "boolean");
const fullscreen = (value: unknown): value is FullscreenHandler => object(value) && typeof value.isFullscreenActive === "boolean" && typeof value.enterFullscreen === "function" && typeof value.exitFullscreen === "function";

/** Each mounted Player owns compiled functions; a retired owner cannot act on its replacement. */
export class NativeScriptOwner {
  private active = true;
  private player: Player | undefined;
  private calls = new Map<string, number>();
  constructor(private readonly record: (name: string, value: unknown) => void,
    private readonly changeFullscreen: (active: boolean) => void) {}
  bind(player: Player): void { this.player = player; }
  assertActive(): void { if (!this.active) throw new Error("This handler belongs to a retired Player."); }
  retire(): void { this.active = false; this.player = undefined; this.calls.clear(); }
  defaultFullscreen(): FullscreenHandler {
    const owner = this;
    return { isFullscreenActive: false,
      enterFullscreen() { owner.assertActive(); this.isFullscreenActive = true; owner.changeFullscreen(true); },
      exitFullscreen() { owner.assertActive(); this.isFullscreenActive = false; owner.changeFullscreen(false); },
    };
  }
  protectFullscreen(handler: FullscreenHandler): FullscreenHandler {
    const owner = this;
    const guarded: FullscreenHandler = {
      get isFullscreenActive() { return handler.isFullscreenActive; },
      set isFullscreenActive(value: boolean) { owner.assertActive(); handler.isFullscreenActive = value; },
      enterFullscreen() { owner.assertActive(); handler.enterFullscreen(); },
      exitFullscreen() { owner.assertActive(); handler.exitFullscreen(); },
    };
    const body = code.get(handler); if (body) code.set(guarded, body);
    return guarded;
  }
  protectMessages(handler: CustomMessageHandler): CustomMessageHandler {
    const synchronous = handler.receivedSynchronousMessage.bind(handler);
    const asynchronous = handler.receivedAsynchronousMessage.bind(handler);
    const send = handler.sendMessage.bind(handler);
    handler.receivedSynchronousMessage = (message, data) => { this.assertActive(); return synchronous(message, data); };
    handler.receivedAsynchronousMessage = (message, data) => { this.assertActive(); return asynchronous(message, data); };
    handler.sendMessage = (message, data) => { this.assertActive(); return send(message, data); };
    return handler;
  }
  private readonly context = Object.freeze({
    getPlayer: () => { if (!this.active || !this.player) throw new Error("The callback Player is no longer active."); return this.player; },
    getSource: () => { if (!this.active) throw new Error("The callback Player is no longer active."); return this.player?.source; },
    setFullscreen: (active: boolean) => { if (this.active) this.changeFullscreen(Boolean(active)); },
    CustomMessageHandler, CustomUi, Source,
  });

  private compile(id: string, body: string): Script {
    const field = NATIVE_SCRIPT_FIELDS.find((item) => item.id === id);
    if (!field) throw new Error("Unknown callback API.");
    // Construction parses the explicitly approved body; it does not invoke that body.
    const factory = new Function("lab", functionSource(field, body)) as (lab: typeof this.context) => Script;
    const compiled = factory(this.context);
    return (...args) => {
      if (!this.active) throw new Error("This callback belongs to a retired Player.");
      const count = (this.calls.get(id) ?? 0) + 1;
      this.calls.set(id, count);
      // Payloads may contain license material or headers. Only bounded counts and outcomes are logged.
      if (count <= 20 || count % 100 === 0) this.record(id, { calls: count });
      try { return compiled(...args); }
      catch (error) { if (count <= 20) this.record(id, { calls: count, error: "Callback execution failed." }); throw error; }
    };
  }

  validated<T>(id: string, body: string, guard: (value: unknown) => value is T): (...args: unknown[]) => T {
    const invoke = this.compile(id, body);
    const callback = (...args: unknown[]): T => {
      const result = invoke(...args);
      if (!guard(result)) throw new Error(`${id} returned a value outside its SDK contract.`);
      return result;
    };
    const field = NATIVE_SCRIPT_FIELDS.find((item) => item.id === id)!;
    code.set(callback, `(${field.parameters.join(", ")}) => {\n${body}\n}`);
    return callback;
  }

  asynchronous<T>(id: string, body: string, guard: (value: unknown) => value is T): (...args: unknown[]) => Promise<T> {
    const invoke = this.compile(id, body);
    const callback = async (...args: unknown[]): Promise<T> => {
      const result = await invoke(...args);
      if (!this.active) throw new Error("The callback Player was retired while awaiting a result.");
      if (!guard(result)) throw new Error(`${id} returned a value outside its SDK contract.`);
      return result;
    };
    const field = NATIVE_SCRIPT_FIELDS.find((item) => item.id === id)!;
    code.set(callback, `async (${field.parameters.join(", ")}) => {\n${body}\n}`);
    return callback;
  }

  factory<T extends object>(id: string, body: string, guard: (value: unknown) => value is T): T {
    const result = this.validated(id, body, guard)();
    code.set(result, `(() => {\n${body}\n})()`);
    return result;
  }
}

const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

export const NATIVE_SCRIPT_FIELDS: ScriptField[] = [
  ...(["source", "offline"] as const).flatMap((scope) => {
    const prefix = scope === "source" ? "SourceConfig" : "OfflineContentConfig.sourceConfig";
    const target = (settings: NativeSettings) => scope === "source" ? settings.source : settings.offline.sourceConfig;
    const fairplay = (settings: NativeSettings) => { const source = target(settings); source.drmConfig ??= {}; return source.drmConfig.fairplay ??= { licenseUrl: "" }; };
    const widevine = (settings: NativeSettings) => { const source = target(settings); source.drmConfig ??= {}; return source.drmConfig.widevine ??= { licenseUrl: "" }; };
    return [
      { id: prefix + ".drmConfig.fairplay.prepareCertificate", parameters: ["certificate"], signature: "(certificate: string) => string", initial: "return certificate;", install: (s: NativeSettings, o: NativeScriptOwner, b: string) => { fairplay(s).prepareCertificate = o.validated(prefix + ".drmConfig.fairplay.prepareCertificate", b, isString); } },
      { id: prefix + ".drmConfig.fairplay.prepareMessage", parameters: ["message", "assetId"], signature: "(message: string, assetId: string) => string", initial: "return message;", install: (s: NativeSettings, o: NativeScriptOwner, b: string) => { fairplay(s).prepareMessage = o.validated(prefix + ".drmConfig.fairplay.prepareMessage", b, isString); } },
      { id: prefix + ".drmConfig.fairplay.prepareSyncMessage", parameters: ["syncMessage", "assetId"], signature: "(syncMessage: string, assetId: string) => string", initial: "return syncMessage;", install: (s: NativeSettings, o: NativeScriptOwner, b: string) => { fairplay(s).prepareSyncMessage = o.validated(prefix + ".drmConfig.fairplay.prepareSyncMessage", b, isString); } },
      { id: prefix + ".drmConfig.fairplay.prepareLicense", parameters: ["license"], signature: "(license: string) => string", initial: "return license;", install: (s: NativeSettings, o: NativeScriptOwner, b: string) => { fairplay(s).prepareLicense = o.validated(prefix + ".drmConfig.fairplay.prepareLicense", b, isString); } },
      { id: prefix + ".drmConfig.fairplay.prepareLicenseServerUrl", parameters: ["licenseServerUrl"], signature: "(licenseServerUrl: string) => string", initial: "return licenseServerUrl;", install: (s: NativeSettings, o: NativeScriptOwner, b: string) => { fairplay(s).prepareLicenseServerUrl = o.validated(prefix + ".drmConfig.fairplay.prepareLicenseServerUrl", b, isString); } },
      { id: prefix + ".drmConfig.fairplay.prepareContentId", parameters: ["contentId"], signature: "(contentId: string) => string", initial: "return contentId;", install: (s: NativeSettings, o: NativeScriptOwner, b: string) => { fairplay(s).prepareContentId = o.validated(prefix + ".drmConfig.fairplay.prepareContentId", b, isString); } },
      { id: prefix + ".drmConfig.widevine.prepareMessage", parameters: ["message"], signature: "(message: string) => string", initial: "return message;", install: (s: NativeSettings, o: NativeScriptOwner, b: string) => { widevine(s).prepareMessage = o.validated(prefix + ".drmConfig.widevine.prepareMessage", b, isString); } },
      { id: prefix + ".drmConfig.widevine.prepareLicense", parameters: ["license"], signature: "(license: string) => string", initial: "return license;", install: (s: NativeSettings, o: NativeScriptOwner, b: string) => { widevine(s).prepareLicense = o.validated(prefix + ".drmConfig.widevine.prepareLicense", b, isString); } },
    ];
  }),
  { id: "PlayerConfig.networkConfig.preprocessHttpRequest", parameters: ["type", "request"], signature: "(type: HttpRequestType, request: HttpRequest) => Promise<HttpRequest>", initial: "return Promise.resolve(request);", install: (s, o, b) => { s.player.networkConfig ??= {}; s.player.networkConfig.preprocessHttpRequest = o.asynchronous("PlayerConfig.networkConfig.preprocessHttpRequest", b, request); } },
  { id: "PlayerConfig.networkConfig.preprocessHttpResponse", parameters: ["type", "response"], signature: "(type: HttpRequestType, response: HttpResponse) => Promise<HttpResponse>", initial: "return Promise.resolve(response);", install: (s, o, b) => { s.player.networkConfig ??= {}; s.player.networkConfig.preprocessHttpResponse = o.asynchronous("PlayerConfig.networkConfig.preprocessHttpResponse", b, response); } },
  { id: "PlayerConfig.advertisingConfig.shouldLoadAdItem", parameters: ["adItem"], signature: "(adItem: AdItem) => boolean", initial: "return true;", install: (s, o, b) => { s.player.advertisingConfig ??= { schedule: [] }; s.player.advertisingConfig.shouldLoadAdItem = o.validated("PlayerConfig.advertisingConfig.shouldLoadAdItem", b, isBoolean); } },
  { id: "PlayerConfig.advertisingConfig.shouldPlayAdBreak", parameters: ["adBreak"], signature: "(adBreak: AdBreak) => boolean", initial: "return true;", install: (s, o, b) => { s.player.advertisingConfig ??= { schedule: [] }; s.player.advertisingConfig.shouldPlayAdBreak = o.validated("PlayerConfig.advertisingConfig.shouldPlayAdBreak", b, isBoolean); } },
  { id: "PlayerConfig.advertisingConfig.ima.beforeInitialization", parameters: ["settings"], signature: "(settings: ImaSettings) => ImaSettings | void", initial: "return settings;", install: (s, o, b) => { s.player.advertisingConfig ??= { schedule: [] }; s.player.advertisingConfig.ima ??= {}; s.player.advertisingConfig.ima.beforeInitialization = o.validated("PlayerConfig.advertisingConfig.ima.beforeInitialization", b, (value): value is ImaSettings | undefined => value === undefined || ima(value)); } },
  { id: "PlayerConfig.playbackConfig.decoderConfig.decoderPriorityProvider.overrideDecodersPriority", parameters: ["context", "preferredDecoders"], signature: "(context: DecoderContext, preferredDecoders: MediaCodecInfo[]) => MediaCodecInfo[]", initial: "return preferredDecoders;", install: (s, o, b) => { s.player.playbackConfig ??= {}; s.player.playbackConfig.decoderConfig ??= {}; s.player.playbackConfig.decoderConfig.decoderPriorityProvider = { overrideDecodersPriority: o.validated("PlayerConfig.playbackConfig.decoderConfig.decoderPriorityProvider.overrideDecodersPriority", b, codecs) }; } },
  { id: "PlayerViewProps.fullscreenHandler", parameters: [], signature: "() => FullscreenHandler", initial: "return { isFullscreenActive: false, enterFullscreen() { this.isFullscreenActive = true; lab.setFullscreen(true); }, exitFullscreen() { this.isFullscreenActive = false; lab.setFullscreen(false); } };", install: (s, o, b) => { s.props.fullscreenHandler = o.protectFullscreen(o.factory("PlayerViewProps.fullscreenHandler", b, fullscreen)); } },
  { id: "PlayerViewProps.customMessageHandler", parameters: [], signature: "() => CustomMessageHandler", initial: "return new lab.CustomMessageHandler({ onReceivedSynchronousMessage(message, data) { return data; }, onReceivedAsynchronousMessage(message, data) {} });", install: (s, o, b) => { s.props.customMessageHandler = o.protectMessages(o.factory("PlayerViewProps.customMessageHandler", b, (value): value is CustomMessageHandler => value instanceof CustomMessageHandler)); } },
];

export function validateNativeScripts(draft: NativeScriptDraft): void {
  if (Object.keys(draft.bodies).length && !draft.allowed) throw new Error("Enable execution of the edited JavaScript before Apply, or remove the callbacks.");
  for (const [id, body] of Object.entries(draft.bodies)) {
    const field = NATIVE_SCRIPT_FIELDS.find((item) => item.id === id);
    if (!field) throw new Error("Unknown callback API.");
    if (body.length > 100_000) throw new Error("A callback body must be at most 100000 characters.");
    // Only syntax is parsed during Apply. Bodies execute when the SDK calls them, or when a handler factory is explicitly applied.
    new Function("lab", functionSource(field, body));
  }
}

export function applyNativeScripts(settings: NativeSettings, draft: NativeScriptDraft, owner: NativeScriptOwner): void {
  if (!draft.allowed) return;
  for (const field of NATIVE_SCRIPT_FIELDS) {
    const body = draft.bodies[field.id];
    if (body !== undefined) field.install(settings, owner, body);
  }
  for (const source of [settings.source, settings.offline.sourceConfig]) {
    if (source.drmConfig?.fairplay && !source.drmConfig.fairplay.licenseUrl) throw new Error("FairPlay callbacks require a configured licenseUrl.");
    if (source.drmConfig?.widevine && !source.drmConfig.widevine.licenseUrl) throw new Error("Widevine callbacks require a configured licenseUrl.");
  }
}

export function validateNativeScriptSettings(settings: NativeSettings, draft: NativeScriptDraft): void {
  for (const [prefix, source] of [["SourceConfig", settings.source], ["OfflineContentConfig.sourceConfig", settings.offline.sourceConfig]] as const) {
    for (const drm of ["fairplay", "widevine"] as const) {
      if (Object.keys(draft.bodies).some((id) => id.startsWith(prefix + ".drmConfig." + drm + ".")) && !source.drmConfig?.[drm]?.licenseUrl) {
        throw new Error(`${prefix}.drmConfig.${drm}.licenseUrl is required before applying DRM callbacks.`);
      }
    }
  }
}
