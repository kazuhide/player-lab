/**
 * Common configuration controls grouped by application timing.
 *
 * The Bitmovin Web API splits configuration by how a change is applied:
 *  - ⚡ runtime  — applied immediately through the player API (volume, speed, view mode…).
 *  - 📥 reload   — `SourceConfig` fields take effect on the next `player.load(source)`.
 *  - 🔁 recreate — `PlayerConfig` fields are read once at `new Player(el, config)`, so a
 *    change needs a fresh player instance (destroy + recreate).
 *
 * Runtime + reload are "dynamic" (the player instance survives) and are surfaced first in
 * an emphasized band; the recreate fields follow in a second band. Each group is a
 * `<details>` accordion tagged with its apply-mode chip. Runtime edits apply on change;
 * reload/recreate edits stage into pending overrides and commit on a per-band Apply button.
 *
 * Objects, callbacks and the rest of the public SDK surface are edited through
 * the separate schema-driven API explorer. The control panel handles UI behavior
 * and live rewind through PlaybackConfig.timeShift.
 */
import type { PlayerAPI, PlayerConfig, SourceConfig, DynamicAdaptationConfig } from "bitmovin-player";
import { pick, userGuideHref, type L } from "./i18n";
import { DomLocalization } from "./domLocalization";
import { configurationValueText, redactConfigurationText, sameConfigurationValue } from "../../../shared/configurationDifferences";
import { FIELD_DOC } from "./configDocs";
import { infoChip } from "./infoChip";
import { applyErrorMessage, configValue, type ApplyOutcome } from "./configState";
import { javascriptValue } from "./configurationCode";
import { mountConfigurationCodeView } from "./configurationCodeView";

/** A minimal recursive partial — PlayerConfig is deeply nested (playback, tweaks, …). */
export type DeepPartial<T> = { [K in keyof T]?: (T[K] extends object ? DeepPartial<T[K]> : T[K]) | undefined };

export interface ConfigPanelOptions {
  /** The live player, for ⚡ runtime calls. May be undefined mid-rebuild. */
  getPlayer: () => PlayerAPI | undefined;
  /** The source with its applied overrides, also available while the player rebuilds. */
  getSource: () => SourceConfig;
  /** Only the app's applied UI overrides, never license or account configuration. */
  getUiConfig: () => Record<string, unknown>;
  /** Commit staged 🔁 PlayerConfig overrides — `main.ts` rebuilds the player with them. */
  onRecreate: (overrides: DeepPartial<PlayerConfig>) => Promise<ApplyOutcome>;
  /** Commit staged 📥 SourceConfig overrides — `main.ts` reloads the current source. */
  onReload: (overrides: DeepPartial<SourceConfig>) => Promise<ApplyOutcome>;
}

type Mode = "recreate" | "reload" | "runtime";

interface FieldDef {
  configPath?: string;
  label: string;
  kind: "bool" | "number" | "text" | "enum";
  options?: { value: string; label: string }[];
  initial: string | number | boolean;
  /** Read the applied value; absent values fall back to the field's default. */
  read?: () => unknown;
  apply: (raw: string | boolean) => void;
  validate?: (raw: string | boolean) => string | undefined;
  min?: number;
  hint?: string;
  /** Hover guidance ("?" chip overlay) — "what / when / default" for this field. For
   *  config-interface fields it's the SDK's own JSDoc (FIELD_DOC, bilingual); inline
   *  runtime/source fields set it directly as an `L`. */
  doc?: string | L;
}

interface Group {
  title: string;
  mode: Mode;
  fields: FieldDef[];
}

const MODE_BADGE: Record<Mode, { text: L; cls: string }> = {
  runtime: { text: { ja: "即時", en: "instant" }, cls: "mode-runtime" },
  reload: { text: { ja: "再読み込み", en: "reload" }, cls: "mode-reload" },
  recreate: { text: { ja: "再生成", en: "recreate" }, cls: "mode-recreate" },
};

const LOG_LEVELS = ["debug", "log", "warn", "error", "off"].map((v) => ({ value: v, label: v }));

// Every primitive TweaksConfig field (extracted from the v8 types — 64 of them, plus
// log_level handled as an enum). Generated into form fields below so the Tweaks group
// mirrors the API exhaustively, not a hand-picked subset. (Object/callback tweaks —
// query_parameters, segmentLoader, disable_retry_for_response_status, wish_abr_params,
// playstation_5 — can't be simple inputs and are intentionally omitted.)
const TWEAK_FIELDS: [string, "bool" | "number" | "text"][] = [
  ["max_buffer_level", "number"], ["startup_threshold", "number"], ["restart_threshold", "number"],
  ["native_hls_parsing", "bool"], ["native_hls_download_error_handling", "bool"], ["stop_download_on_pause", "bool"],
  ["licenseServer", "text"], ["impressionServer", "text"], ["hls_audio_only_threshold_bitrate", "number"],
  ["file_protocol", "bool"], ["app_id", "text"], ["adaptation_set_switching_without_supplemental_property", "bool"],
  ["drm_stall_recovery_settle_timeout_ms", "number"], ["drm_stall_recovery_license_activity_lookback_ms", "number"],
  ["ignore_mp4_edts_box", "bool"], ["ignore_hls_audio_groups", "bool"], ["prevent_video_element_preloading", "bool"],
  ["serviceworker_scope", "text"], ["fairplay_ignore_duplicate_init_data_key_errors", "bool"],
  ["no_quota_exceeded_adjustment", "bool"], ["segment_encryption_transition_handling", "bool"],
  ["enable_seek_for_live", "bool"], ["resume_live_content_at_previous_position_after_ad_break", "bool"],
  ["dword_base_media_decode_timestamps", "bool"], ["force_base_media_decode_time_rewrite", "bool"],
  ["tizen_max_safe_bmdt", "number"], ["tizen_max_safe_pto", "number"], ["webos_max_safe_bmdt", "number"],
  ["webos_max_safe_pto", "number"], ["akamai_datetime_parsing", "bool"], ["clear_buffers_on_seeking_backwards", "bool"],
  ["drop_invalid_segments", "bool"], ["min_size_for_gap_skipping", "number"], ["proactive_gap_skip_distance_seconds", "number"],
  ["force_software_decryption", "bool"], ["max_retries", "number"], ["max_cdn_retries", "number"],
  ["max_mpd_retries", "number"], ["mpd_retry_delay", "number"], ["mpd_update_period_tolerance", "number"],
  ["parse_cea_708_caption", "bool"], ["hls_sync_segment_playback_time_via_media_sequence", "bool"],
  ["hls_parse_manifest_in_worker", "bool"], ["hls_clear_buffers_on_discontinuity_switches", "bool"],
  ["chunked_cmaf_streaming", "bool"], ["parse_emsg_boxes", "bool"], ["hls_backup_stream_penalty_duration", "number"],
  ["check_all_drm_licenses_for_kid", "bool"], ["hls_parse_native_metadata", "bool"], ["prefer_managed_media_source", "bool"],
  ["infinite_retries_for_live", "bool"], ["minimal_backward_buffer_clearing_interval", "number"],
  ["max_safe_mse_duration", "number"], ["disable_parallel_segment_loading", "bool"], ["enable_muted_background_playback", "bool"],
  ["postpone_manifest_updates_until_playback_start", "bool"], ["max_startup_buffer", "number"],
  ["dash_clear_buffers_on_period_switches", "bool"], ["disable_auto_recovery_on_dvr_window_exceeded", "bool"],
  ["enable_performance_logs", "bool"], ["enable_sgai_handling", "bool"], ["audio_track_switch_buffer_grace_period", "number"],
  ["disable_audio_buffer_clearing_on_track_switch", "bool"], ["sgai_trigger_delay_compensation", "number"],
];

/** Set a value at a dotted path inside a (possibly empty) nested object, creating
 *  intermediate objects as needed. Used to build up the staged override objects. */
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  // Defensive: never walk into prototype keys (all current paths are literals, but this
  // keeps the helper safe if it's ever reused with dynamic keys).
  if (keys.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")) return;
  let node = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (typeof node[k] !== "object" || node[k] === null) node[k] = {};
    node = node[k] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]!] = value;
}

/** Parse a numeric input. Empty / NaN clears the corresponding override. */
function num(raw: string | boolean): number | undefined {
  const n = Number(raw);
  return raw === "" || Number.isNaN(n) ? undefined : n;
}

export interface ConfigPanelHandle {
  /** Refresh applied fields, preserving edits that have not been applied yet. */
  refresh: () => void;
  relocalize: () => void;
}

// The SDK has no getters for these runtime setters. Remember successful calls for
// this player instance only; recreating it must not retain the old instance's values.
const runtimeValues = new WeakMap<PlayerAPI, Record<string, unknown>>();

export function mountConfigPanel(container: HTMLElement, options: ConfigPanelOptions): ConfigPanelHandle {
  // Staged overrides, committed on the per-band Apply buttons.
  let playerOverrides: DeepPartial<PlayerConfig> = {};
  let sourceOverrides: DeepPartial<SourceConfig> = {};
  const staged = new Set<FieldDef>();
  const revisions = new Map<FieldDef, number>();
  const rawValues = new Map<FieldDef, string | boolean>();
  const invalid = new Map<FieldDef, Mode>();
  const readers: (() => void)[] = [];
  const labels = new DomLocalization();
  let recreateDirty = false;
  let reloadDirty = false;
  let applyRecreateBtn: HTMLButtonElement | undefined;
  let applyReloadBtn: HTMLButtonElement | undefined;
  let pending = false;
  const outcomes = new Map<Mode, { state: "pending" | "success" | "error" | "superseded"; error?: string }>();
  const failedOwners = new Map<Mode, { player: PlayerAPI | undefined; source: SourceConfig }>();
  const statuses = new Map<Mode, HTMLElement>();
  const resetButtons = new Map<Mode, HTMLButtonElement>();
  const resetters = new Map<FieldDef, () => void>();

  function refreshStatus(): void {
    for (const [mode, element] of statuses) {
      const outcome = outcomes.get(mode);
      element.textContent = !outcome ? "" : outcome.state === "pending" ? pick({ ja: "適用しています。", en: "Applying settings." })
        : outcome.state === "success" ? pick({ ja: "適用しました。", en: "Applied." })
        : outcome.state === "superseded" ? pick({ ja: "Playerまたはソースが変わりました。もう一度適用してください。", en: "The player or source changed. Apply again." })
        : pick({ ja: "適用できませんでした。", en: "Could not apply settings." }) + " " + outcome.error;
      element.classList.toggle("config-error", outcome?.state === "error");
    }
  }

  function refreshButtons(): void {
    for (const [mode, button] of resetButtons) button.disabled = pending || !groups.some(group => group.mode === mode && group.fields.some(field => staged.has(field)));
    if (applyRecreateBtn) {
      applyRecreateBtn.disabled = pending || !recreateDirty || [...invalid.values()].includes("recreate");
      applyRecreateBtn.classList.toggle("is-dirty", recreateDirty);
    }
    if (applyReloadBtn) {
      applyReloadBtn.disabled = pending || !reloadDirty || [...invalid.values()].includes("reload");
      applyReloadBtn.classList.toggle("is-dirty", reloadDirty);
    }
  }

  /** Stage a 🔁 PlayerConfig override at `path`. AdaptationConfig is per-platform, so
   *  adaptation.* is written to BOTH desktop and mobile. */
  function stagePlayer(path: string, value: unknown): void {
    if (path.startsWith("adaptation.")) {
      const leaf = path.slice("adaptation.".length);
      setPath(playerOverrides as Record<string, unknown>, `adaptation.desktop.${leaf}`, value);
      setPath(playerOverrides as Record<string, unknown>, `adaptation.mobile.${leaf}`, value);
    } else {
      setPath(playerOverrides as Record<string, unknown>, path, value);
    }
    recreateDirty = true;
    refreshButtons();
  }

  function stageSource(path: string, value: unknown): void {
    setPath(sourceOverrides as Record<string, unknown>, path, value);
    reloadDirty = true;
    refreshButtons();
  }

  const readPlayer = (path: string): unknown => configValue(
    options.getPlayer()?.getConfig(false),
    path.startsWith("adaptation.") ? path.replace("adaptation.", "adaptation.desktop.") : path,
  );
  const readRuntime = (key: string): unknown => {
    const p = options.getPlayer();
    return p ? runtimeValues.get(p)?.[key] : undefined;
  };
  const rememberRuntime = (p: PlayerAPI, key: string, value: unknown): void => {
    runtimeValues.set(p, { ...runtimeValues.get(p), [key]: value });
  };

  /** Shorthand field builders. Each pulls the field's SDK JSDoc (FIELD_DOC[path]) as its
   *  hover tooltip, so every config knob carries its official "what / when / default" note. */
  const pBool = (label: string, path: string, initial: boolean): FieldDef => ({
    label,
    configPath: path,
    kind: "bool",
    initial,
    read: () => readPlayer(path),
    apply: (v) => stagePlayer(path, v),
    ...(FIELD_DOC[path] ? { doc: FIELD_DOC[path] } : {}),
  });
  const pNum = (label: string, path: string, initial: number | string = ""): FieldDef => ({
    label,
    configPath: path,
    kind: "number",
    initial,
    read: () => readPlayer(path),
    apply: (v) => stagePlayer(path, num(v)),
    ...(FIELD_DOC[path] ? { doc: FIELD_DOC[path] } : {}),
  });
  const pText = (label: string, path: string, hint?: string): FieldDef => ({
    label,
    configPath: path,
    kind: "text",
    initial: "",
    ...(hint ? { hint } : {}),
    read: () => readPlayer(path),
    apply: (v) => stagePlayer(path, v === "" ? undefined : v),
    ...(FIELD_DOC[path] ? { doc: FIELD_DOC[path] } : {}),
  });
  const pEnum = (label: string, path: string, opts: { value: string; label: string }[], initial = ""): FieldDef => ({
    label,
    configPath: path,
    kind: "enum",
    options: opts,
    initial,
    read: () => readPlayer(path),
    apply: (v) => stagePlayer(path, v === "" ? undefined : v),
    ...(FIELD_DOC[path] ? { doc: FIELD_DOC[path] } : {}),
  });
  const timeoutField = (label: string, path: string): FieldDef => ({
    ...pNum(label, path),
    min: 0,
    validate: (raw) => raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) < 0)
      ? pick({ ja: "0以上の有限の秒数を入力してください。", en: "Enter a finite number of seconds, zero or greater." })
      : undefined,
    hint: pick({ ja: "秒。空欄でこの上書きを削除。", en: "Seconds. Leave empty to remove this override." }),
    doc: {
      ja: "通信のタイムアウトを秒で指定します。個別のリクエスト種別の値は defaultRequestTimeout より優先されます。既定のタイムアウトは20秒です。",
      en: "Network timeout in seconds. A request-type timeout overrides defaultRequestTimeout. The SDK default timeout is 20 seconds.",
    },
  });

  // ⚡ player.adaptation.setConfig(DynamicAdaptationConfig) — runtime adaptation updates.
  // Read the current dynamic config, merge the change, set it back (so one field doesn't
  // reset the others).
  function dynAdapt(mutate: (cur: DynamicAdaptationConfig) => DynamicAdaptationConfig): void {
    const p = options.getPlayer();
    if (!p) return;
    p.adaptation.setConfig(mutate(p.adaptation.getConfig()));
  }
  function dynRes(key: string, val: number | undefined): void {
    if (val === undefined) return;
    dynAdapt((c) => ({ ...c, resolution: { ...(c.resolution ?? {}), [key]: val } }));
  }
  // ⚡ player.lowlatency.set{Catchup,Fallback}Config(LowLatencySyncConfig) — runtime latency tuning.
  // This works on a NORMAL live HLS/DASH stream (not only LL-HLS / chunked-CMAF): catchup applies
  // when latency EXCEEDS the target (too far behind → speed up / seek toward edge); fallback when it
  // FALLS BELOW it (too close to edge → slow down / seek back). Read-merge-write so one sub-field
  // doesn't reset the others. getCatchupConfig() returns null until first set, so the spread starts
  // from {}. Wrapped in try/catch only as a guard for VOD / no live source.
  function dynLowLatency(
    kind: "catchup" | "fallback",
    // Keys of LowLatencySyncConfig, derived from the API (the type isn't exported by name) so a
    // typo in the field wiring is a compile error rather than a silent merge of a bogus property.
    key: keyof ReturnType<PlayerAPI["lowlatency"]["getCatchupConfig"]>,
    val: number | undefined,
  ): void {
    if (val === undefined) return;
    const p = options.getPlayer();
    if (!p) return;
    try {
      const cur = kind === "catchup" ? p.lowlatency.getCatchupConfig() : p.lowlatency.getFallbackConfig();
      const next = { ...cur, [key]: val };
      if (kind === "catchup") p.lowlatency.setCatchupConfig(next);
      else p.lowlatency.setFallbackConfig(next);
    } catch {
      /* no live source (e.g. VOD) — ignore */
    }
  }
  /** A staged 🔁 PlayerConfig field whose control kind is data-driven (used for Tweaks). */
  const pField = (name: string, kind: "bool" | "number" | "text", path: string): FieldDef =>
    kind === "bool" ? pBool(name, path, false) : kind === "number" ? pNum(name, path) : pText(name, path);

  const makeGroups = (): Group[] => [
    // ===== DYNAMIC band (player instance survives) =====
    {
      title: "Player API",
      mode: "runtime",
      fields: [
        {
          label: "volume (0–100)",
          read: () => options.getPlayer()?.getVolume(),
          kind: "number",
          initial: 100,
          doc: { ja: "音量 0–100(0=無音, 100=最大)。ミュートとは独立。多くのブラウザは音声付き自動再生をブロックします。", en: "Volume 0–100 (0 = silent, 100 = max). Independent of mute. Note many browsers block autoplay with sound." },
          apply: (v) => options.getPlayer()?.setVolume(Math.max(0, Math.min(100, num(v) ?? 100))),
        },
        {
          label: "mute",
          read: () => options.getPlayer()?.isMuted(),
          kind: "bool",
          initial: true,
          doc: { ja: "音声を消す/戻す。音声付き自動再生はブロックされやすいので、自動再生にはミュートが実質必須です。", en: "Silence / restore audio. Muted is effectively required for autoplay, since sound-on autoplay is widely blocked." },
          apply: (v) => {
            const p = options.getPlayer();
            if (!p) return;
            if (v) p.mute();
            else p.unmute();
          },
        },
        {
          label: "playbackSpeed",
          read: () => options.getPlayer()?.getPlaybackSpeed(),
          kind: "number",
          initial: 1,
          doc: { ja: "再生速度の倍率(1=等倍, 2=2倍, 0.5=半分)。ライブの先頭付近では効果が限定されます。", en: "Playback rate multiplier (1 = normal, 2 = 2×, 0.5 = half). Has limited effect near the live edge." },
          apply: (v) => options.getPlayer()?.setPlaybackSpeed(num(v) ?? 1),
        },
        {
          label: "buffer target forward (s)",
          read: () => {
            const p = options.getPlayer();
            return p?.buffer.getLevel(p.exports.BufferType.ForwardDuration, p.exports.MediaType.Video).targetLevel;
          },
          kind: "number",
          initial: 40,
          doc: { ja: "先読みする秒数。大きいほど安定する一方、遅延とメモリ消費が増えます。DVRウィンドウは広がりません。", en: "Seconds to buffer ahead. Larger = steadier but more latency/memory. Does NOT widen the DVR window." },
          apply: (v) => {
            const p = options.getPlayer();
            const n = num(v);
            if (!p || n === undefined) return;
            const { BufferType, MediaType } = p.exports;
            p.buffer.setTargetLevel(BufferType.ForwardDuration, n, MediaType.Video);
          },
        },
        {
          label: "viewMode",
          read: () => options.getPlayer()?.getViewMode(),
          kind: "enum",
          initial: "inline",
          doc: { ja: "表示モード: inline(既定)/ PiP(ピクチャインピクチャ)/ fullscreen。ユーザー操作を起点にしないと拒否される場合があります。", en: "Display mode: inline (default) / PiP / fullscreen. May be rejected unless triggered by a user gesture." },
          options: [
            { value: "inline", label: "inline" },
            { value: "pictureinpicture", label: "PiP" },
            { value: "fullscreen", label: "fullscreen" },
          ],
          apply: (v) => {
            const p = options.getPlayer();
            if (!p) return;
            const map = {
              inline: p.exports.ViewMode.Inline,
              pictureinpicture: p.exports.ViewMode.PictureInPicture,
              fullscreen: p.exports.ViewMode.Fullscreen,
            } as const;
            p.setViewMode(map[v as keyof typeof map]);
          },
        },
        {
          label: "setAspectRatio",
          read: () => options.getPlayer()?.getAspectRatio() || undefined,
          kind: "text",
          initial: "",
          hint: pick({ ja: "例: 16:9 / 1.78", en: "e.g. 16:9 / 1.78" }),
          doc: { ja: "プレイヤーの縦横比。'16:9' のような比率、または 1.78 のような数値で指定します。", en: "Player aspect ratio. Give a ratio like '16:9' or a number like 1.78." },
          apply: (v) => {
            const p = options.getPlayer();
            if (!p || v === "") return;
            p.setAspectRatio(v as string);
          },
        },
        {
          label: "setPosterImage (URL)",
          read: () => readRuntime("poster") ?? options.getSource().poster,
          kind: "text",
          initial: "",
          doc: { ja: "この欄は setPosterImage(URL, true) を呼び、再生中も画像を保持します。音声のみのソースにも使えます。読み込み時だけ表示したい場合は SourceConfig の poster と options.persistentPoster を使います。", en: "This field calls setPosterImage(URL, true), keeping the image during playback, including audio-only sources. For a loading poster, use SourceConfig poster and options.persistentPoster." },
          apply: (v) => {
            const p = options.getPlayer();
            if (!p || v === "") return;
            p.setPosterImage(v as string, true);
            rememberRuntime(p, "poster", v);
          },
        },
        {
          label: "setLogLevel",
          read: () => readRuntime("logLevel") ?? options.getPlayer()?.getConfig(true).logs?.level,
          kind: "enum",
          initial: "warn",
          doc: { ja: "コンソールのログ詳細度。player.setLogLevel() は実行時メソッドなので、再生中に変更すると即座に反映されます(再生挙動は変わりません)。debug は詳しい反面、本番や長時間再生では性能が落ちます。通常は warn/error。", en: "Console log verbosity. player.setLogLevel() is a runtime method, so changing it mid-playback takes effect immediately (it doesn’t change playback). debug is detailed but hurts performance in production / long playback; use warn or error normally." },
          options: LOG_LEVELS,
          apply: (v) => {
            const p = options.getPlayer();
            if (!p) return;
            p.setLogLevel(v as Parameters<PlayerAPI["setLogLevel"]>[0]);
            rememberRuntime(p, "logLevel", v);
          },
        },
      ],
    },
    {
      title: pick({ ja: "Adaptation(動的)", en: "Adaptation (dynamic)" }),
      mode: "runtime",
      fields: [
        {
          label: "limitToPlayerSize",
          read: () => options.getPlayer()?.adaptation.getConfig().limitToPlayerSize,
          kind: "bool",
          initial: false,
          doc: { ja: "自動画質をプレイヤーの表示サイズに制限。映像要素より高解像度を選びません(モバイルの帯域節約に有効)。既定 false。", en: "Cap auto quality to the player's display size — never pick a resolution higher than the video element (saves bandwidth on small players). Default false." },
          apply: (v) => dynAdapt((c) => ({ ...c, limitToPlayerSize: Boolean(v) })),
        },
        {
          label: "qualityStabilityBalance (0–1)",
          read: () => options.getPlayer()?.adaptation.getConfig().qualityStabilityBalance,
          kind: "number",
          initial: 0.5,
          doc: { ja: "0 は画質優先、1 は停止を抑える安定性優先（既定 0.5）。Low Latency の適応ロジックを使う場合にのみ有効です。", en: "0 favors quality; 1 favors stability with fewer stalls (default 0.5). Only relevant with the Low Latency adaptation logic." },
          apply: (v) => dynAdapt((c) => ({ ...c, qualityStabilityBalance: num(v) ?? 0.5 })),
        },
        {
          label: "resolution.maxSelectableVideoHeight",
          read: () => options.getPlayer()?.adaptation.getConfig().resolution?.maxSelectableVideoHeight,
          kind: "number",
          initial: "",
          doc: { ja: "選択可能な映像の高さの上限(px)。これより高い解像度は選ばれません。", en: "Upper bound on selectable video height (px). Qualities taller than this are not selected." },
          apply: (v) => dynRes("maxSelectableVideoHeight", num(v)),
        },
        {
          label: "resolution.minSelectableVideoHeight",
          read: () => options.getPlayer()?.adaptation.getConfig().resolution?.minSelectableVideoHeight,
          kind: "number",
          initial: "",
          doc: { ja: "選択可能な映像の高さの下限(px)。これより低い解像度は選ばれません。", en: "Lower bound on selectable video height (px). Qualities shorter than this are not selected." },
          apply: (v) => dynRes("minSelectableVideoHeight", num(v)),
        },
        {
          label: "resolution.maxSelectableVideoWidth",
          read: () => options.getPlayer()?.adaptation.getConfig().resolution?.maxSelectableVideoWidth,
          kind: "number",
          initial: "",
          doc: { ja: "選択可能な映像の幅の上限(px)。これより広い解像度は選ばれません。", en: "Upper bound on selectable video width (px). Qualities wider than this are not selected." },
          apply: (v) => dynRes("maxSelectableVideoWidth", num(v)),
        },
        {
          label: "resolution.minSelectableVideoWidth",
          read: () => options.getPlayer()?.adaptation.getConfig().resolution?.minSelectableVideoWidth,
          kind: "number",
          initial: "",
          doc: { ja: "選択可能な映像の幅の下限(px)。これより狭い解像度は選ばれません。", en: "Lower bound on selectable video width (px). Qualities narrower than this are not selected." },
          apply: (v) => dynRes("minSelectableVideoWidth", num(v)),
        },
      ],
    },
    {
      title: pick({ ja: "Low Latency(動的)", en: "Low Latency (dynamic)" }),
      mode: "runtime",
      fields: [
        {
          label: "targetLatency (s)",
          read: () => options.getPlayer()?.lowlatency.getTargetLatency(),
          kind: "number",
          initial: "",
          doc: { ja: "ライブ端からの目標距離(秒)。小さいほど低遅延だがリバッファのリスクが上がる。catchup/fallback を設定すると、再生速度やシークでこの距離へ追従します。通常の HLS/DASH ライブでも有効(超低遅延のみ LL ストリームが必要)。", en: "Target distance from the live edge (s). Smaller = lower latency but higher rebuffer risk. With catchup/fallback set, the player steers to this distance via playback speed / seeks. Works on a normal HLS/DASH live stream (only sub-second latency needs an LL stream)." },
          apply: (v) => {
            const p = options.getPlayer();
            const n = num(v);
            if (!p || n === undefined) return;
            try {
              p.lowlatency.setTargetLatency(n);
            } catch {
              /* no live source (e.g. VOD) — ignore */
            }
          },
        },
        {
          label: "catchup: playbackRateThreshold (s)",
          read: () => options.getPlayer()?.lowlatency.getCatchupConfig()?.playbackRateThreshold,
          kind: "number",
          initial: "",
          doc: { ja: "目標より遅れた量がこの秒数を超えたら、再生速度を上げて(catchup)追いつく。既定 Infinity(無効)— 有限値で有効化。", en: "When latency runs over target by more than this many seconds, catch up by raising the playback speed. Default Infinity (off) — a finite value enables it." },
          apply: (v) => dynLowLatency("catchup", "playbackRateThreshold", num(v)),
        },
        {
          label: "catchup: seekThreshold (s)",
          read: () => options.getPlayer()?.lowlatency.getCatchupConfig()?.seekThreshold,
          kind: "number",
          initial: "",
          doc: { ja: "目標より遅れた量がこの秒数を超えたら、ライブ端方向へシークして追いつく。既定 Infinity(無効)。", en: "When latency runs over target by more than this many seconds, catch up by seeking toward the live edge. Default Infinity (off)." },
          apply: (v) => dynLowLatency("catchup", "seekThreshold", num(v)),
        },
        {
          label: "catchup: playbackRate",
          read: () => options.getPlayer()?.lowlatency.getCatchupConfig()?.playbackRate,
          kind: "number",
          initial: "",
          doc: { ja: "catchup 中の再生速度(>1 で加速)。既定 1.2。", en: "Playback speed used while catching up (>1 = faster). Default 1.2." },
          apply: (v) => dynLowLatency("catchup", "playbackRate", num(v)),
        },
        {
          label: "fallback: playbackRateThreshold (s)",
          read: () => options.getPlayer()?.lowlatency.getFallbackConfig()?.playbackRateThreshold,
          kind: "number",
          initial: "",
          doc: { ja: "目標より寄りすぎた(latency が小さすぎる)量がこの秒数を超えたら、再生速度を落として(fallback)戻す。既定 Infinity(無効)。", en: "When latency runs under target by more than this many seconds, fall back by lowering the playback speed. Default Infinity (off)." },
          apply: (v) => dynLowLatency("fallback", "playbackRateThreshold", num(v)),
        },
        {
          label: "fallback: seekThreshold (s)",
          read: () => options.getPlayer()?.lowlatency.getFallbackConfig()?.seekThreshold,
          kind: "number",
          initial: "",
          doc: { ja: "目標より寄りすぎた量がこの秒数を超えたら、シークして目標距離へ戻す。既定 Infinity(無効)。", en: "When latency runs under target by more than this many seconds, fall back by seeking to the target distance. Default Infinity (off)." },
          apply: (v) => dynLowLatency("fallback", "seekThreshold", num(v)),
        },
        {
          label: "fallback: playbackRate",
          read: () => options.getPlayer()?.lowlatency.getFallbackConfig()?.playbackRate,
          kind: "number",
          initial: "",
          doc: { ja: "fallback 中の再生速度(<1 で減速)。既定 0.95。", en: "Playback speed used while falling back (<1 = slower). Default 0.95." },
          apply: (v) => dynLowLatency("fallback", "playbackRate", num(v)),
        },
      ],
    },
    {
      title: "Source",
      mode: "reload",
      fields: [
        {
          label: "title",
          kind: "text",
          initial: "",
          hint: pick({ ja: "TitleBar に表示", en: "Shown in the TitleBar" }),
          doc: { ja: "ソースのタイトル。TitleBar を持つUI(一部のテーマ)に表示されます。", en: "Source title. Shown by UIs that include a TitleBar (some themes)." },
          read: () => configValue(options.getSource(), "title"),
          apply: (v) => stageSource("title", v === "" ? undefined : v),
        },
        {
          label: "description",
          kind: "text",
          initial: "",
          doc: { ja: "ソースの説明。タイトルと併せて TitleBar 付きUIに表示されます。", en: "Source description. Shown alongside the title in TitleBar-equipped UIs." },
          read: () => configValue(options.getSource(), "description"),
          apply: (v) => stageSource("description", v === "" ? undefined : v),
        },
        {
          label: "poster (URL)",
          kind: "text",
          initial: "",
          doc: { ja: "再生開始前に表示するサムネイル画像のURL。", en: "URL of the thumbnail image shown before playback starts." },
          read: () => configValue(options.getSource(), "poster"),
          apply: (v) => stageSource("poster", v === "" ? undefined : v),
        },
        {
          label: "options.persistentPoster",
          kind: "bool",
          initial: false,
          doc: { ja: "再生中もポスター画像を表示します。音声のみのソースで画像を残したい場合に使います。", en: "Keep the poster visible during playback, for example when an audio-only source should retain an image." },
          read: () => configValue(options.getSource(), "options.persistentPoster"),
          apply: (v) => stageSource("options.persistentPoster", v),
        },
        {
          label: "options.startOffset (s)",
          kind: "number",
          initial: "",
          hint: pick({ ja: "ライブは負値で端から", en: "Negative = behind the live edge" }),
          doc: { ja: "再生開始位置。VODは先頭からの秒数。ライブは負値で端からの距離。下の reference と併用します。", en: "Start position. For VOD, seconds from the start; for live, a negative value = distance behind the edge. Pairs with the reference below." },
          read: () => configValue(options.getSource(), "options.startOffset"),
          apply: (v) => stageSource("options.startOffset", num(v)),
        },
        {
          label: "options.startOffsetTimelineReference",
          kind: "enum",
          initial: "",
          doc: { ja: "startOffset の基準点。ライブ端からのオフセットには end を指定します。", en: "Reference point for startOffset. Use end to offset from the live edge." },
          options: [
            { value: "", label: pick({ ja: "（既定）", en: "(default)" }) },
            { value: "start", label: "start" },
            { value: "end", label: "end" },
          ],
          read: () => configValue(options.getSource(), "options.startOffsetTimelineReference"),
          apply: (v) => stageSource("options.startOffsetTimelineReference", v === "" ? undefined : v),
        },
      ],
    },

    // ===== STATIC band (needs a fresh Player) =====
    {
      title: "Playback",
      mode: "recreate",
      fields: [
        pBool("autoplay", "playback.autoplay", true),
        pBool(pick({ ja: "muted（初期）", en: "muted (initial)" }), "playback.muted", true),
        pNum(pick({ ja: "volume（初期, 0–100）", en: "volume (initial, 0–100)" }), "playback.volume", 100),
        pBool("playsInline", "playback.playsInline", true),
        pBool("seeking", "playback.seeking", true),
        pBool("allowDecodingErrorRecovery", "playback.allowDecodingErrorRecovery", false),
        pText("audioLanguage", "playback.audioLanguage", pick({ ja: "例: en, de（空で既定）", en: "e.g. en, de (empty = default)" })),
        pText("subtitleLanguage", "playback.subtitleLanguage", pick({ ja: "例: en（空で無効）", en: "e.g. en (empty = off)" })),
      ],
    },
    {
      title: pick({ ja: "Adaptation（初期）", en: "Adaptation (initial)" }),
      mode: "recreate",
      fields: [
        pText("startupBitrate", "adaptation.startupBitrate", pick({ ja: '"auto" または bps', en: '"auto" or bps' })),
        pText("maxStartupBitrate", "adaptation.maxStartupBitrate", pick({ ja: '"auto" / bps / 空', en: '"auto" / bps / empty' })),
        pBool("preload", "adaptation.preload", true),
        pBool("disableDownloadCancelling", "adaptation.disableDownloadCancelling", false),
        pNum("qualityThreshold", "adaptation.qualityThreshold"),
        pNum("qualityUpperThreshold", "adaptation.qualityUpperThreshold"),
        pText("bitrates.maxSelectableVideoBitrate", "adaptation.bitrates.maxSelectableVideoBitrate", pick({ ja: "bps / Infinity", en: "bps / Infinity" })),
        pText("bitrates.minSelectableVideoBitrate", "adaptation.bitrates.minSelectableVideoBitrate"),
        pText("bitrates.maxSelectableAudioBitrate", "adaptation.bitrates.maxSelectableAudioBitrate"),
        pText("bitrates.minSelectableAudioBitrate", "adaptation.bitrates.minSelectableAudioBitrate"),
        pEnum("logic", "adaptation.logic", [
          { value: "", label: pick({ ja: "（既定）", en: "(default)" }) },
          { value: "v1", label: "v1 (buffer)" },
          { value: "v2", label: "v2 (fill-rate)" },
          { value: "v3", label: "v3 (download-prediction)" },
          { value: "low-latency-v1", label: "low-latency-v1" },
          { value: "wish", label: "wish" },
        ]),
        pEnum("rttEstimationMethod", "adaptation.rttEstimationMethod", [
          { value: "", label: pick({ ja: "（既定）", en: "(default)" }) },
          { value: "weightedaverage", label: "weightedaverage" },
          { value: "median", label: "median" },
        ]),
      ],
    },
    {
      title: pick({ ja: "Buffer（初期）", en: "Buffer (initial)" }),
      mode: "recreate",
      fields: [
        pNum("video.forwardduration (s)", "buffer.video.forwardduration", 40),
        pNum("video.backwardduration (s)", "buffer.video.backwardduration"),
        pNum("audio.forwardduration (s)", "buffer.audio.forwardduration", 40),
        pNum("audio.backwardduration (s)", "buffer.audio.backwardduration"),
      ],
    },
    {
      title: "Network",
      mode: "recreate",
      fields: [
        pEnum("requestApi", "network.requestApi", [
          { value: "", label: pick({ ja: "（既定: xhr）", en: "(default: xhr)" }) },
          { value: "xhr", label: "xhr" },
          { value: "fetch", label: "fetch" },
        ]),
        timeoutField("defaultRequestTimeout (s)", "network.defaultRequestTimeout"),
        ...["manifest/dash", "manifest/hls/master", "manifest/hls/variant", "media/video", "media/audio", "media/subtitles", "media/thumbnails"].map(
          (type) => timeoutField(`requestTimeout[${type}] (s)`, `network.requestTimeout.${type}`),
        ),
      ],
    },
    {
      title: "Tweaks",
      mode: "recreate",
      fields: [
        {
          ...pEnum("log_level", "tweaks.log_level", [{ value: "", label: pick({ ja: "（既定）", en: "(default)" }) }, ...LOG_LEVELS]),
          hint: pick({ ja: "Logs グループの level と同じ", en: "Same as the Logs group’s level" }),
        },
        ...TWEAK_FIELDS.map(([n, k]) => pField(n, k, `tweaks.${n}`)),
      ],
    },
    {
      title: "Logs",
      mode: "recreate",
      fields: [pEnum("level", "logs.level", LOG_LEVELS, "warn"), pBool(pick({ ja: "bitmovin (ロゴログ)", en: "bitmovin (logo log)" }), "logs.bitmovin", true)],
    },
    {
      title: "Style",
      mode: "recreate",
      fields: [
        pText("aspectratio", "style.aspectratio", pick({ ja: "例: 16:9 / 4:3 / 空", en: "e.g. 16:9 / 4:3 / empty" })),
        pText("width", "style.width", pick({ ja: "例: 100% / 640px", en: "e.g. 100% / 640px" })),
        pText("height", "style.height", pick({ ja: "例: 100% / 360px", en: "e.g. 100% / 360px" })),
        pBool("nativeSubtitles", "style.nativeSubtitles", false),
      ],
    },
    {
      title: "Cast",
      mode: "recreate",
      fields: [
        pBool("enable", "cast.enable", false),
        pText("application_id", "cast.application_id"),
        pText("message_namespace", "cast.message_namespace"),
        pText("receiverStylesheetUrl", "cast.receiverStylesheetUrl"),
      ],
    },
    {
      title: "Live",
      mode: "recreate",
      fields: [
        pBool("incrementalManifestUpdates", "live.incrementalManifestUpdates", false),
        pNum("lowLatency.targetLatency (s)", "live.lowLatency.targetLatency"),
      ],
    },
    {
      title: "Location",
      mode: "recreate",
      fields: [
        pText("ui", "location.ui"),
        pText("ui_css", "location.ui_css"),
        pText("cast", "location.cast"),
        pText("google_ima", "location.google_ima"),
        pText("serviceworker", "location.serviceworker"),
      ],
    },
    {
      title: pick({ ja: "その他", en: "Misc" }),
      mode: "recreate",
      fields: [
        pNum("licensing.delay (ms)", "licensing.delay"),
        pBool("storage.disableStorageApi", "storage.disableStorageApi", false),
      ],
    },
  ];
  const groups = makeGroups();

  // --- Render ---
  container.innerHTML = "";
  const head = document.createElement("div");
  head.className = "config-head";
  const h2 = document.createElement("h2");
  h2.textContent = "PlayerConfig / SourceConfig";
  const guide = document.createElement("a");
  labels.bind(() => { guide.href = userGuideHref("web-player-config"); });
  labels.text(guide, { ja: "設定の使い方", en: "Configuration guide" });
  head.append(h2, guide);
  container.appendChild(head);

  let fieldId = 0;
  function field(def: FieldDef, mode: Mode): HTMLElement {
    const row = document.createElement("label");
    row.className = "config-field";
    const name = document.createElement("span");
    name.className = "config-field-label";
    labels.bind(() => {
      name.replaceChildren();
      for (const [index, part] of def.label.split(".").entries()) {
        if (index > 0) name.append(".", document.createElement("wbr"));
        name.append(part);
      }
      if (def.doc) name.appendChild(infoChip(def.doc));
    });
    row.appendChild(name);

    // Hover guidance: a "?" chip carrying the SDK's own "what / when / default" note,
    // shown via the shared styled overlay (infoChip handles click-swallow + a11y).

    const error = document.createElement("span");
    error.className = "config-error";
    error.id = `config-error-${fieldId++}`;
    error.setAttribute("role", "alert");
    error.hidden = true;
    const difference = document.createElement("span");
    difference.className = "config-draft-status";
    const fieldValue = (raw: unknown): unknown => def.kind === "bool" ? Boolean(raw)
      : raw === "" || raw === undefined ? undefined : def.kind === "number" ? Number(raw) : String(raw);
    let appliedValue: unknown = fieldValue(def.initial);
    const renderDifference = () => {
      const after = fieldValue(rawValues.get(def));
      const draft = staged.has(def) && (invalid.has(def) || !sameConfigurationValue(appliedValue, after));
      row.classList.toggle("is-dirty", draft);
      difference.hidden = !draft;
      difference.textContent = pick({ ja: "適用済み: ", en: "Before: " }) + configurationValueText(appliedValue, def.configPath ?? def.label)
        + pick({ ja: " → 編集後: ", en: " → After: " }) + (invalid.has(def)
          ? pick({ ja: "入力が未完了です。", en: "Incomplete input." }) : configurationValueText(after, def.configPath ?? def.label));
    };
    labels.bind(renderDifference);

    let input: HTMLInputElement | HTMLSelectElement;
    if (def.kind === "bool") {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Boolean(def.initial);
      cb.addEventListener("change", () => apply(cb.checked));
      input = cb;
      row.classList.add("is-bool");
    } else if (def.kind === "enum") {
      const sel = document.createElement("select");
      for (const o of def.options ?? []) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === String(def.initial)) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => apply(sel.value));
      input = sel;
      labels.bind(() => [...sel.options].forEach((option, index) => { option.textContent = def.options?.[index]?.label ?? option.value; }));
    } else {
      const inp = document.createElement("input");
      inp.type = def.kind === "number" ? "number" : "text";
      inp.value = String(def.initial);
      inp.className = "config-input";
      if (def.kind === "number") inp.step = "any";
      if (def.min !== undefined) inp.min = String(def.min);
      if (def.validate || mode !== "runtime" && def.kind === "number") inp.addEventListener("input", () => apply(inp.value));
      inp.addEventListener("change", () => apply(inp.value));
      input = inp;
    }
    function sync(force = false): void {
      let applied: unknown;
      const failed = failedOwners.get(mode);
      const retain = failed && failed.player === options.getPlayer() && (mode !== "reload" || failed.source === options.getSource());
      if (failed && !retain) failedOwners.delete(mode);
      try { applied = retain || mode === "recreate" && !options.getPlayer() ? appliedValue : def.read?.(); }
      catch { /* Runtime APIs can be unavailable before a source loads. */ }
      const value = applied ?? def.initial;
      if (!pending) appliedValue = fieldValue(value);
      if (!pending && mode !== "runtime" && staged.has(def) && !invalid.has(def)
        && sameConfigurationValue(appliedValue, fieldValue(rawValues.get(def)))) {
        staged.delete(def); rawValues.delete(def); rebuildDraft(mode); refreshButtons();
      }
      renderDifference();
      if (staged.has(def) || !force && document.activeElement === input) return;
      if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = Boolean(value);
      else input.value = typeof value === "number" && !Number.isFinite(value) ? "" : String(value);
    }
    function apply(value: string | boolean): void {
      if (mode !== "runtime") {
        staged.add(def);
        rawValues.set(def, value);
        revisions.set(def, (revisions.get(def) ?? 0) + 1);
        if (!pending) outcomes.delete(mode);
        refreshStatus();
      }
      const message = def.validate?.(value) ?? (input instanceof HTMLInputElement && input.type === "number" && input.validity.badInput
        ? pick({ ja: "有効な数値を入力してください。", en: "Enter a valid number." }) : undefined);
      if (message) {
        invalid.set(def, mode);
        renderDifference();
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", error.id);
        error.textContent = message;
        error.hidden = false;
        refreshButtons();
        return;
      }
      invalid.delete(def);
      renderDifference();
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
      error.textContent = "";
      error.hidden = true;
      if (mode !== "runtime" && !pending && sameConfigurationValue(appliedValue, fieldValue(value))) {
        staged.delete(def); rawValues.delete(def);
        rebuildDraft(mode);
        renderDifference(); refreshButtons();
        return;
      }
      def.apply(value);
      if (mode === "runtime") sync();
      refreshButtons();
    }
    readers.push(sync);
    resetters.set(def, () => {
      input.removeAttribute("aria-invalid"); input.removeAttribute("aria-describedby");
      error.textContent = ""; error.hidden = true;
      sync(true);
    });
    sync();
    row.appendChild(input);
    if (def.validate || def.kind === "number") row.appendChild(error);
    if (mode !== "runtime") row.appendChild(difference);
    labels.bind(() => {
      if (invalid.has(def)) error.textContent = def.validate?.(rawValues.get(def)!) ?? pick({ ja: "有効な数値を入力してください。", en: "Enter a valid number." });
    });

    if (def.hint) {
      const hint = document.createElement("span");
      hint.className = "config-hint";
      labels.bind(() => { hint.textContent = def.hint ?? ""; });
      row.appendChild(hint);
    }
    return row;
  }

  function groupEl(group: Group, openByDefault: boolean): HTMLElement {
    const badge = MODE_BADGE[group.mode];
    const details = document.createElement("details");
    details.className = "config-group";
    details.open = openByDefault;

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.className = "config-group-title";
    labels.bind(() => { title.textContent = group.title; });
    const tag = document.createElement("span");
    tag.className = `config-mode ${badge.cls}`;
    labels.text(tag, badge.text);
    summary.append(title, tag);
    details.appendChild(summary);

    const fields = document.createElement("div");
    fields.className = "config-fields";
    for (const f of group.fields) fields.appendChild(field(f, group.mode));
    details.appendChild(fields);
    return details;
  }

  function applyButton(label: string, onApply: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "config-apply";
    btn.disabled = true;
    btn.textContent = label;
    btn.addEventListener("click", onApply);
    return btn;
  }

  function rebuildDraft(mode: Mode): void {
    if (mode === "reload") sourceOverrides = {};
    else playerOverrides = {};
    const fields = groups.filter(group => group.mode === mode).flatMap(group => group.fields);
    for (const field of fields) if (staged.has(field) && !invalid.has(field)) field.apply(rawValues.get(field)!);
    if (mode === "reload") reloadDirty = fields.some(field => staged.has(field));
    else recreateDirty = fields.some(field => staged.has(field));
  }

  async function applyDraft(mode: "reload" | "recreate"): Promise<void> {
    if (pending || [...invalid.values()].includes(mode)) return;
    pending = true;
    const submitted = new Map(groups.filter(group => group.mode === mode).flatMap(group => group.fields)
      .filter(field => staged.has(field)).map(field => [field, revisions.get(field)]));
    outcomes.set(mode, { state: "pending" });
    refreshButtons(); refreshStatus();
    try {
      const outcome = mode === "reload" ? await options.onReload(structuredClone(sourceOverrides))
        : await options.onRecreate(structuredClone(playerOverrides));
      if (outcome === "applied") {
        failedOwners.delete(mode);
        for (const [field, revision] of submitted) if (revisions.get(field) === revision) {
          staged.delete(field); rawValues.delete(field);
        }
        rebuildDraft(mode);
      }
      outcomes.set(mode, { state: outcome === "applied" ? "success" : "superseded" });
    } catch (error) {
      failedOwners.set(mode, { player: options.getPlayer(), source: options.getSource() });
      outcomes.set(mode, { state: "error", error: redactConfigurationText(applyErrorMessage(error)) });
    } finally {
      pending = false;
      readers.forEach(read => read());
      refreshButtons(); refreshStatus();
    }
  }

  function status(mode: Mode): HTMLElement {
    const element = document.createElement("span");
    element.setAttribute("role", "status");
    statuses.set(mode, element);
    return element;
  }

  function resetButton(mode: "reload" | "recreate"): HTMLButtonElement {
    const button = applyButton("", () => {
      if (pending) return;
      for (const group of groups.filter(group => group.mode === mode)) for (const field of group.fields) {
        staged.delete(field); invalid.delete(field); rawValues.delete(field);
        revisions.set(field, (revisions.get(field) ?? 0) + 1);
        resetters.get(field)?.();
      }
      rebuildDraft(mode);
      outcomes.delete(mode);
      refreshButtons(); refreshStatus();
    });
    labels.text(button, { ja: "編集をリセット", en: "Reset draft" });
    resetButtons.set(mode, button);
    return button;
  }

  // Dynamic band (runtime + reload) — emphasized, open by default.
  const dynBand = document.createElement("section");
  dynBand.className = "config-band config-band-dynamic";
  const dynHead = document.createElement("h3");
  dynHead.className = "config-band-head";
  labels.text(dynHead, {
    ja: "再生中の設定とソース",
    en: "Playback and source settings",
  });
  dynBand.appendChild(dynHead);
  const dynGrid = document.createElement("div");
  dynGrid.className = "config-grid";
  for (const g of groups.filter((g) => g.mode !== "recreate")) {
    dynGrid.appendChild(groupEl(g, true));
  }
  dynBand.appendChild(dynGrid);
  applyReloadBtn = applyButton(pick({ ja: "ソースを再読み込みして適用", en: "Reload the source to apply" }), () => {
    void applyDraft("reload");
  });
  const dynBar = document.createElement("div");
  dynBar.className = "config-apply-bar";
  dynBar.append(applyReloadBtn, resetButton("reload"), status("reload"));
  dynBand.appendChild(dynBar);
  container.appendChild(dynBand);

  // Static band (recreate) — collapsed by default.
  const statBand = document.createElement("section");
  statBand.className = "config-band config-band-static";
  const statHead = document.createElement("h3");
  statHead.className = "config-band-head";
  labels.text(statHead, {
    ja: "Playerの初期設定",
    en: "Player creation settings",
  });
  statBand.appendChild(statHead);
  const statGrid = document.createElement("div");
  statGrid.className = "config-grid";
  for (const g of groups.filter((g) => g.mode === "recreate")) {
    statGrid.appendChild(groupEl(g, false));
  }
  statBand.appendChild(statGrid);
  applyRecreateBtn = applyButton(pick({ ja: "プレイヤーを再生成して適用", en: "Recreate the player to apply" }), () => {
    void applyDraft("recreate");
  });
  const statBar = document.createElement("div");
  statBar.className = "config-apply-bar";
  statBar.append(applyRecreateBtn, resetButton("recreate"), status("recreate"));
  statBand.appendChild(statBar);
  container.appendChild(statBand);

  const codeView = mountConfigurationCodeView(container, () => {
    const p = options.getPlayer();
    const source = p?.getSource();
    if (!p || !source) return undefined;
    const actual = p.getConfig(false);
    const playerConfig: Record<string, unknown> = { playback: { ...actual.playback } };
    for (const group of groups) for (const def of group.fields) {
      if (!def.configPath) continue;
      const paths = def.configPath.startsWith("adaptation.")
        ? [def.configPath.replace("adaptation.", "adaptation.desktop."), def.configPath.replace("adaptation.", "adaptation.mobile.")]
        : [def.configPath];
      for (const path of paths) {
        const value = configValue(actual, path);
        if (value !== undefined) setPath(playerConfig, path, value);
      }
    }
    const runtime = [
      `player.setVolume(${javascriptValue(p.getVolume())});`,
      p.isMuted() ? "player.mute();" : "player.unmute();",
      `player.setPlaybackSpeed(${javascriptValue(p.getPlaybackSpeed())});`,
      `player.setAspectRatio(${javascriptValue(p.getAspectRatio())});`,
      `player.adaptation.setConfig(${javascriptValue(p.adaptation.getConfig())});`,
    ];
    const forward = p.buffer.getLevel(p.exports.BufferType.ForwardDuration, p.exports.MediaType.Video).targetLevel;
    if (forward !== undefined) runtime.push(`player.buffer.setTargetLevel(player.exports.BufferType.ForwardDuration, ${javascriptValue(forward)}, player.exports.MediaType.Video);`);
    const poster = readRuntime("poster");
    if (poster !== undefined) runtime.push(`player.setPosterImage(${javascriptValue(poster)}, true);`);
    const logLevel = readRuntime("logLevel");
    if (logLevel !== undefined) runtime.push(`player.setLogLevel(player.exports.LogLevel[${javascriptValue(String(logLevel).toUpperCase())}]);`);
    if (p.isLive()) {
      runtime.push(`player.lowlatency.setTargetLatency(${javascriptValue(p.lowlatency.getTargetLatency())});`);
      const catchup = p.lowlatency.getCatchupConfig();
      const fallback = p.lowlatency.getFallbackConfig();
      if (catchup) runtime.push(`player.lowlatency.setCatchupConfig(${javascriptValue(catchup)});`);
      if (fallback) runtime.push(`player.lowlatency.setFallbackConfig(${javascriptValue(fallback)});`);
    }
    return { player: playerConfig, source: { ...source }, ui: options.getUiConfig(), runtime };
  });

  refreshButtons();
  labels.bind(() => { applyReloadBtn!.textContent = pick({ ja: "ソースを再読み込みして適用", en: "Reload the source to apply" }); });
  labels.bind(() => { applyRecreateBtn!.textContent = pick({ ja: "プレイヤーを再生成して適用", en: "Recreate the player to apply" }); });
  return {
    refresh: () => readers.forEach(read => read()),
    relocalize: () => {
      const translated = makeGroups();
      groups.forEach((group, index) => {
        group.title = translated[index]!.title;
        group.fields.forEach((field, fieldIndex) => Object.assign(field, translated[index]!.fields[fieldIndex]));
      });
      labels.refresh();
      refreshStatus();
      codeView.relocalize();
    },
  };
}
