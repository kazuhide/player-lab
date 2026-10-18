/**
 * Comprehensive Player Config editor (collapsible), ordered DYNAMIC-FIRST.
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
 * Field coverage mirrors the v8 config interfaces (PlaybackConfig, AdaptationConfig,
 * BufferConfig, TweaksConfig, StyleConfig, LogsConfig, CastConfig, LiveConfig + the
 * SourceConfig surface). `timeShift` is left as the headline DVR control in the control
 * panel (noted in Playback). The schema is data-driven, so the remaining niche tweaks /
 * platform flags are one array entry each to add.
 */
import type { PlayerAPI, PlayerConfig, SourceConfig, DynamicAdaptationConfig } from "bitmovin-player";
import { pick, type L } from "./i18n";
import { FIELD_DOC } from "./configDocs";
import { infoChip } from "./infoChip";

/** A minimal recursive partial — PlayerConfig is deeply nested (playback, tweaks, …). */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface ConfigPanelOptions {
  /** The live player, for ⚡ runtime calls. May be undefined mid-rebuild. */
  getPlayer: () => PlayerAPI | undefined;
  /** Commit staged 🔁 PlayerConfig overrides — `main.ts` rebuilds the player with them. */
  onRecreate: (overrides: DeepPartial<PlayerConfig>) => void;
  /** Commit staged 📥 SourceConfig overrides — `main.ts` reloads the current source. */
  onReload: (overrides: Partial<SourceConfig>) => void;
}

type Mode = "recreate" | "reload" | "runtime";

interface FieldDef {
  label: string;
  kind: "bool" | "number" | "text" | "enum";
  options?: { value: string; label: string }[];
  initial: string | number | boolean;
  apply: (raw: string | boolean) => void;
  hint?: string;
  /** Hover guidance ("?" chip overlay) — "what / when / default" for this field. For
   *  config-interface fields it's the SDK's own JSDoc (FIELD_DOC, bilingual); inline
   *  runtime/source fields set it directly as an `L`. */
  doc?: string | L;
}

interface Group {
  title: string;
  mode: Mode;
  blurb: string;
  fields: FieldDef[];
}

const MODE_BADGE: Record<Mode, { icon: string; text: L; cls: string }> = {
  runtime: { icon: "⚡", text: { ja: "即時", en: "instant" }, cls: "mode-runtime" },
  reload: { icon: "📥", text: { ja: "リロード", en: "reload" }, cls: "mode-reload" },
  recreate: { icon: "🔁", text: { ja: "再生成", en: "recreate" }, cls: "mode-recreate" },
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

/** Parse a numeric input; empty / NaN → undefined (so it doesn't override with NaN).
 *  Note: staging is additive — clearing a field back to "" won't *remove* an already
 *  staged value, it just won't add one. Re-applying with a fresh value replaces it. */
function num(raw: string | boolean): number | undefined {
  const n = Number(raw);
  return raw === "" || Number.isNaN(n) ? undefined : n;
}

export function mountConfigPanel(container: HTMLElement, options: ConfigPanelOptions): void {
  // Staged overrides, committed on the per-band Apply buttons.
  let playerOverrides: DeepPartial<PlayerConfig> = {};
  let sourceOverrides: Partial<SourceConfig> = {};
  let recreateDirty = false;
  let reloadDirty = false;
  let applyRecreateBtn: HTMLButtonElement | undefined;
  let applyReloadBtn: HTMLButtonElement | undefined;

  function refreshButtons(): void {
    if (applyRecreateBtn) {
      applyRecreateBtn.disabled = !recreateDirty;
      applyRecreateBtn.classList.toggle("is-dirty", recreateDirty);
    }
    if (applyReloadBtn) {
      applyReloadBtn.disabled = !reloadDirty;
      applyReloadBtn.classList.toggle("is-dirty", reloadDirty);
    }
  }

  /** Stage a 🔁 PlayerConfig override at `path`. AdaptationConfig is per-platform, so
   *  adaptation.* is written to BOTH desktop and mobile. */
  function stagePlayer(path: string, value: unknown): void {
    if (value === undefined) return;
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
    if (value === undefined) return;
    setPath(sourceOverrides as Record<string, unknown>, path, value);
    reloadDirty = true;
    refreshButtons();
  }

  /** Shorthand field builders. Each pulls the field's SDK JSDoc (FIELD_DOC[path]) as its
   *  hover tooltip, so every config knob carries its official "what / when / default" note. */
  const pBool = (label: string, path: string, initial: boolean): FieldDef => ({
    label,
    kind: "bool",
    initial,
    apply: (v) => stagePlayer(path, v),
    ...(FIELD_DOC[path] ? { doc: FIELD_DOC[path] } : {}),
  });
  const pNum = (label: string, path: string, initial: number | string = ""): FieldDef => ({
    label,
    kind: "number",
    initial,
    apply: (v) => stagePlayer(path, num(v)),
    ...(FIELD_DOC[path] ? { doc: FIELD_DOC[path] } : {}),
  });
  const pText = (label: string, path: string, hint?: string): FieldDef => ({
    label,
    kind: "text",
    initial: "",
    ...(hint ? { hint } : {}),
    apply: (v) => stagePlayer(path, v === "" ? undefined : v),
    ...(FIELD_DOC[path] ? { doc: FIELD_DOC[path] } : {}),
  });
  const pEnum = (label: string, path: string, opts: { value: string; label: string }[], initial = ""): FieldDef => ({
    label,
    kind: "enum",
    options: opts,
    initial,
    apply: (v) => stagePlayer(path, v === "" ? undefined : v),
    ...(FIELD_DOC[path] ? { doc: FIELD_DOC[path] } : {}),
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

  const groups: Group[] = [
    // ===== DYNAMIC band (player instance survives) =====
    {
      title: "Player API",
      mode: "runtime",
      blurb: pick({ ja: "再生中に即時反映。プレイヤーの作り直しもソース再読み込みも不要です。", en: "Applied immediately while playing — no player recreate, no source reload." }),
      fields: [
        {
          label: "volume (0–100)",
          kind: "number",
          initial: 100,
          doc: { ja: "音量 0–100(0=無音, 100=最大)。ミュートとは独立。多くのブラウザは音声付き自動再生をブロックします。", en: "Volume 0–100 (0 = silent, 100 = max). Independent of mute. Note many browsers block autoplay with sound." },
          apply: (v) => options.getPlayer()?.setVolume(Math.max(0, Math.min(100, num(v) ?? 100))),
        },
        {
          label: "mute",
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
          kind: "number",
          initial: 1,
          doc: { ja: "再生速度の倍率(1=等倍, 2=2倍, 0.5=半分)。ライブの先頭付近では効果が限定されます。", en: "Playback rate multiplier (1 = normal, 2 = 2×, 0.5 = half). Has limited effect near the live edge." },
          apply: (v) => options.getPlayer()?.setPlaybackSpeed(num(v) ?? 1),
        },
        {
          label: "buffer target forward (s) §8",
          kind: "number",
          initial: 40,
          doc: { ja: "先読みする秒数(§8)。大きいほど安定する一方、遅延とメモリ消費が増えます。DVRウィンドウは広がりません。", en: "Seconds to buffer ahead (§8). Larger = steadier but more latency/memory. Does NOT widen the DVR window." },
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
          kind: "text",
          initial: "",
          doc: { ja: "再生前に表示する画像のURL。第2引数 true で再生中も保持します。", en: "Poster image URL shown before playback. Passing true (2nd arg) keeps it during playback too." },
          apply: (v) => {
            const p = options.getPlayer();
            if (!p || v === "") return;
            p.setPosterImage(v as string, true);
          },
        },
        {
          label: "setLogLevel",
          kind: "enum",
          initial: "warn",
          doc: { ja: "コンソールのログ詳細度。player.setLogLevel() は実行時メソッドなので、再生中に変更すると即座に反映されます(再生挙動は変わりません)。debug は詳しい反面、本番や長時間再生では性能が落ちます。通常は warn/error。", en: "Console log verbosity. player.setLogLevel() is a runtime method, so changing it mid-playback takes effect immediately (it doesn’t change playback). debug is detailed but hurts performance in production / long playback; use warn or error normally." },
          options: LOG_LEVELS,
          apply: (v) => {
            const p = options.getPlayer();
            if (!p) return;
            p.setLogLevel(v as Parameters<PlayerAPI["setLogLevel"]>[0]);
          },
        },
      ],
    },
    {
      title: pick({ ja: "Adaptation(動的)", en: "Adaptation (dynamic)" }),
      mode: "runtime",
      blurb: pick({
        ja: "実行中に player.adaptation.setConfig() で更新できる適応制御(DynamicAdaptationConfig)。limitToPlayerSize など。",
        en: "Adaptation updatable at runtime via player.adaptation.setConfig() (DynamicAdaptationConfig) — limitToPlayerSize, etc.",
      }),
      fields: [
        {
          label: "limitToPlayerSize",
          kind: "bool",
          initial: false,
          doc: { ja: "自動画質をプレイヤーの表示サイズに制限。映像要素より高解像度を選びません(モバイルの帯域節約に有効)。既定 false。", en: "Cap auto quality to the player's display size — never pick a resolution higher than the video element (saves bandwidth on small players). Default false." },
          apply: (v) => dynAdapt((c) => ({ ...c, limitToPlayerSize: Boolean(v) })),
        },
        {
          label: "qualityStabilityBalance (0–1)",
          kind: "number",
          initial: 0.5,
          doc: { ja: "0–1。安定性(切替を減らす)と画質追従のバランス。低いほど安定重視、高いほど画質優先。既定 0.5。", en: "0–1. Balance between stability (fewer switches) and chasing quality. Lower = steadier, higher = sharper. Default 0.5." },
          apply: (v) => dynAdapt((c) => ({ ...c, qualityStabilityBalance: num(v) ?? 0.5 })),
        },
        {
          label: "resolution.maxSelectableVideoHeight",
          kind: "number",
          initial: "",
          doc: { ja: "選択可能な映像の高さの上限(px)。これより高い解像度は選ばれません。", en: "Upper bound on selectable video height (px). Qualities taller than this are not selected." },
          apply: (v) => dynRes("maxSelectableVideoHeight", num(v)),
        },
        {
          label: "resolution.minSelectableVideoHeight",
          kind: "number",
          initial: "",
          doc: { ja: "選択可能な映像の高さの下限(px)。これより低い解像度は選ばれません。", en: "Lower bound on selectable video height (px). Qualities shorter than this are not selected." },
          apply: (v) => dynRes("minSelectableVideoHeight", num(v)),
        },
        {
          label: "resolution.maxSelectableVideoWidth",
          kind: "number",
          initial: "",
          doc: { ja: "選択可能な映像の幅の上限(px)。これより広い解像度は選ばれません。", en: "Upper bound on selectable video width (px). Qualities wider than this are not selected." },
          apply: (v) => dynRes("maxSelectableVideoWidth", num(v)),
        },
        {
          label: "resolution.minSelectableVideoWidth",
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
      blurb: pick({
        ja: "ライブ配信中の latency 制御。通常の HLS/DASH ライブでも動作します(超低遅延=サブ秒級には LL-HLS / chunked CMAF が必要)。targetLatency は setTargetLatency()、catchup/fallback は set{Catchup,Fallback}Config(LowLatencySyncConfig) で適用。catchup=遅れすぎた時に追いつく / fallback=ライブ端へ寄りすぎた時に戻す。閾値は空欄=既定 Infinity(無効)。",
        en: "Runtime latency control for live playback. Works on a NORMAL HLS/DASH live stream too (only sub-second latency needs LL-HLS / chunked CMAF). targetLatency via setTargetLatency(); catchup/fallback via set{Catchup,Fallback}Config(LowLatencySyncConfig). catchup = recover when too far BEHIND target; fallback = back off when too CLOSE to the edge. Empty threshold = default Infinity (off).",
      }),
      fields: [
        {
          label: "targetLatency (s)",
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
          kind: "number",
          initial: "",
          doc: { ja: "目標より遅れた量がこの秒数を超えたら、再生速度を上げて(catchup)追いつく。既定 Infinity(無効)— 有限値で有効化。", en: "When latency runs over target by more than this many seconds, catch up by raising the playback speed. Default Infinity (off) — a finite value enables it." },
          apply: (v) => dynLowLatency("catchup", "playbackRateThreshold", num(v)),
        },
        {
          label: "catchup: seekThreshold (s)",
          kind: "number",
          initial: "",
          doc: { ja: "目標より遅れた量がこの秒数を超えたら、ライブ端方向へシークして追いつく。既定 Infinity(無効)。", en: "When latency runs over target by more than this many seconds, catch up by seeking toward the live edge. Default Infinity (off)." },
          apply: (v) => dynLowLatency("catchup", "seekThreshold", num(v)),
        },
        {
          label: "catchup: playbackRate",
          kind: "number",
          initial: "",
          doc: { ja: "catchup 中の再生速度(>1 で加速)。既定 1.2。", en: "Playback speed used while catching up (>1 = faster). Default 1.2." },
          apply: (v) => dynLowLatency("catchup", "playbackRate", num(v)),
        },
        {
          label: "fallback: playbackRateThreshold (s)",
          kind: "number",
          initial: "",
          doc: { ja: "目標より寄りすぎた(latency が小さすぎる)量がこの秒数を超えたら、再生速度を落として(fallback)戻す。既定 Infinity(無効)。", en: "When latency runs under target by more than this many seconds, fall back by lowering the playback speed. Default Infinity (off)." },
          apply: (v) => dynLowLatency("fallback", "playbackRateThreshold", num(v)),
        },
        {
          label: "fallback: seekThreshold (s)",
          kind: "number",
          initial: "",
          doc: { ja: "目標より寄りすぎた量がこの秒数を超えたら、シークして目標距離へ戻す。既定 Infinity(無効)。", en: "When latency runs under target by more than this many seconds, fall back by seeking to the target distance. Default Infinity (off)." },
          apply: (v) => dynLowLatency("fallback", "seekThreshold", num(v)),
        },
        {
          label: "fallback: playbackRate",
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
      blurb: pick({ ja: "ソース単位の設定(SourceConfig)。現在のソースに重ねて load() で適用します。", en: "Per-source settings (SourceConfig). Layered onto the current source and applied with load()." }),
      fields: [
        {
          label: "title",
          kind: "text",
          initial: "",
          hint: pick({ ja: "TitleBar に表示", en: "Shown in the TitleBar" }),
          doc: { ja: "ソースのタイトル。TitleBar を持つUI(一部のテーマ)に表示されます。", en: "Source title. Shown by UIs that include a TitleBar (some themes)." },
          apply: (v) => stageSource("title", v === "" ? undefined : v),
        },
        {
          label: "description",
          kind: "text",
          initial: "",
          doc: { ja: "ソースの説明。タイトルと併せて TitleBar 付きUIに表示されます。", en: "Source description. Shown alongside the title in TitleBar-equipped UIs." },
          apply: (v) => stageSource("description", v === "" ? undefined : v),
        },
        {
          label: "poster (URL)",
          kind: "text",
          initial: "",
          doc: { ja: "再生開始前に表示するサムネイル画像のURL。", en: "URL of the thumbnail image shown before playback starts." },
          apply: (v) => stageSource("poster", v === "" ? undefined : v),
        },
        {
          label: "options.startOffset (s)",
          kind: "number",
          initial: "",
          hint: pick({ ja: "ライブは負値で端から", en: "Negative = behind the live edge" }),
          doc: { ja: "再生開始位置。VODは先頭からの秒数。ライブは負値で端からの距離(§11)。下の reference と併用します。", en: "Start position. For VOD, seconds from the start; for live, a negative value = distance behind the edge (§11). Pairs with the reference below." },
          apply: (v) => stageSource("options.startOffset", num(v)),
        },
        {
          label: "options.startOffsetTimelineReference",
          kind: "enum",
          initial: "",
          doc: { ja: "startOffset の基準点。ライブ端からのオフセットには end を指定します(§11)。", en: "Reference point for startOffset. Use end to offset from the live edge (§11)." },
          options: [
            { value: "", label: pick({ ja: "（既定）", en: "(default)" }) },
            { value: "start", label: "start" },
            { value: "end", label: "end" },
          ],
          apply: (v) => stageSource("options.startOffsetTimelineReference", v === "" ? undefined : v),
        },
      ],
    },

    // ===== STATIC band (needs a fresh Player) =====
    {
      title: "Playback",
      mode: "recreate",
      blurb: pick({ ja: "再生の初期挙動(PlaybackConfig)。timeShift(DVR 許可)は操作パネルの「DVR を許可」にあります。", en: "Initial playback behavior (PlaybackConfig). timeShift (Allow DVR) lives in the control panel’s “Allow DVR”." }),
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
      blurb: pick({
        ja: "構築時の適応制御(AdaptationConfig、desktop/mobile 両方)。実行中に変えられる分は ⚡「Adaptation(動的)」へ。",
        en: "Construction-time adaptation (AdaptationConfig, desktop+mobile). The runtime-updatable subset is in ⚡ “Adaptation (dynamic)”.",
      }),
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
      blurb: pick({ ja: "初期バッファ設定(BufferConfig)。再生中の目標は ⚡ Runtime の buffer target で変えられます(§8)。", en: "Initial buffer config (BufferConfig). The live target is changed via ⚡ Runtime’s buffer target (§8)." }),
      fields: [
        pNum("video.forwardduration (s)", "buffer.video.forwardduration", 40),
        pNum("video.backwardduration (s)", "buffer.video.backwardduration"),
        pNum("audio.forwardduration (s)", "buffer.audio.forwardduration", 40),
        pNum("audio.backwardduration (s)", "buffer.audio.backwardduration"),
      ],
    },
    {
      title: "Tweaks",
      mode: "recreate",
      blurb: pick({
        ja: `低レベル調整(TweaksConfig)。プリミティブな全項目(${TWEAK_FIELDS.length})＋ log_level を網羅。オブジェクト/コールバック系は除外。`,
        en: `Low-level tweaks (TweaksConfig). All primitive fields (${TWEAK_FIELDS.length}) + log_level; object/callback tweaks excluded.`,
      }),
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
      blurb: pick({ ja: "ログ出力(LogsConfig)。", en: "Log output (LogsConfig)." }),
      fields: [pEnum("level", "logs.level", LOG_LEVELS, "warn"), pBool(pick({ ja: "bitmovin (ロゴログ)", en: "bitmovin (logo log)" }), "logs.bitmovin", true)],
    },
    {
      title: "Style",
      mode: "recreate",
      blurb: pick({ ja: "表示スタイル(StyleConfig)。width/height はこのデモのCSSが上書きする場合があります。", en: "Display style (StyleConfig). width/height may be overridden by this demo’s CSS." }),
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
      blurb: pick({ ja: "Chromecast 設定(CastConfig)。", en: "Chromecast settings (CastConfig)." }),
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
      blurb: pick({ ja: "ライブ設定(LiveConfig)。低遅延の目標レイテンシなど。", en: "Live settings (LiveConfig) — e.g. the low-latency target latency." }),
      fields: [
        pBool("incrementalManifestUpdates", "live.incrementalManifestUpdates", false),
        pNum("lowLatency.targetLatency (s)", "live.lowLatency.targetLatency"),
      ],
    },
    {
      title: "Location",
      mode: "recreate",
      blurb: pick({ ja: "アセットの読み込み先(LocationConfig)。UI/CSS/Cast/IMA/ServiceWorker の URL。", en: "Where assets load from (LocationConfig): UI / CSS / Cast / IMA / ServiceWorker URLs." }),
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
      blurb: pick({ ja: "ライセンス遅延(LicensingConfig)とストレージ(StorageConfig)。", en: "Licensing delay (LicensingConfig) and storage (StorageConfig)." }),
      fields: [
        pNum("licensing.delay (ms)", "licensing.delay"),
        pBool("storage.disableStorageApi", "storage.disableStorageApi", false),
      ],
    },
  ];

  // --- Render ---
  container.innerHTML = "";
  const head = document.createElement("div");
  head.className = "config-head";
  const h2 = document.createElement("h2");
  h2.textContent = pick({ ja: "Player Config — 全設定", en: "Player Config — all settings" });
  const intro = document.createElement("p");
  intro.className = "config-intro";
  intro.textContent =
    pick({
      ja: "反映方法で並べています。⚡ は即時、📥/🔁 は変更を貯めて各バンドの「適用」で反映します。各項目の ⓘ に、どんな時にどの値を設定すべきかの説明があります(公式 SDK ドキュメント由来・英語)。",
      en: "Ordered by how each change applies. ⚡ applies on change; 📥/🔁 stage and commit on each band’s Apply button. The ⓘ on each field explains when/what to set (from the official SDK docs).",
    });
  const note = document.createElement("p");
  note.className = "config-note";
  note.textContent = pick({
    ja:
      "未掲載(値が動的なリスト、またはオブジェクト/コールバック設定のため): quality/track 選択(setVideoQuality / setAudioQuality / setAudio、字幕は player.subtitles ＝ プレイヤーの設定歯車)、" +
      "player.lowlatency の catchup/fallback、setQueryParameters / setAuthentication / setVideoElement、network のリクエストコールバック(preprocessHttpRequest 等)、player.drm / advertising / vr 各API。",
    en:
      "Not surfaced here (values are dynamic lists, or object/callback config): quality/track selection (setVideoQuality / setAudioQuality / setAudio; subtitles via player.subtitles — i.e. the player’s settings gear), " +
      "player.lowlatency catchup/fallback, setQueryParameters / setAuthentication / setVideoElement, the network request callbacks (preprocessHttpRequest etc.), and the player.drm / advertising / vr APIs.",
  });
  head.append(h2, intro, note);
  container.appendChild(head);

  function field(def: FieldDef): HTMLElement {
    const row = document.createElement("label");
    row.className = "config-field";
    const name = document.createElement("span");
    name.className = "config-field-label";
    name.textContent = def.label;
    row.appendChild(name);

    // Hover guidance: a "?" chip carrying the SDK's own "what / when / default" note,
    // shown via the shared styled overlay (infoChip handles click-swallow + a11y).
    if (def.doc) name.appendChild(infoChip(def.doc));

    let input: HTMLInputElement | HTMLSelectElement;
    if (def.kind === "bool") {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Boolean(def.initial);
      cb.addEventListener("change", () => def.apply(cb.checked));
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
      sel.addEventListener("change", () => def.apply(sel.value));
      input = sel;
    } else {
      const inp = document.createElement("input");
      inp.type = def.kind === "number" ? "number" : "text";
      inp.value = String(def.initial);
      inp.className = "config-input";
      inp.addEventListener("change", () => def.apply(inp.value));
      input = inp;
    }
    row.appendChild(input);

    if (def.hint) {
      const hint = document.createElement("span");
      hint.className = "config-hint";
      hint.textContent = def.hint;
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
    title.textContent = group.title;
    const tag = document.createElement("span");
    tag.className = `config-mode ${badge.cls}`;
    tag.textContent = `${badge.icon} ${pick(badge.text)}`;
    summary.append(title, tag);
    details.appendChild(summary);

    const blurb = document.createElement("p");
    blurb.className = "config-group-blurb";
    blurb.textContent = group.blurb;
    details.appendChild(blurb);

    const fields = document.createElement("div");
    fields.className = "config-fields";
    for (const f of group.fields) fields.appendChild(field(f));
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

  // Dynamic band (runtime + reload) — emphasized, open by default.
  const dynBand = document.createElement("section");
  dynBand.className = "config-band config-band-dynamic";
  const dynHead = document.createElement("h3");
  dynHead.className = "config-band-head";
  dynHead.textContent = pick({
    ja: "Dynamic(動的)— プレイヤー作り直し不要:即時の Player API(⚡)と load() のソース更新(📥)",
    en: "Dynamic — no player recreate: the instant Player API (⚡) and load() source updates (📥)",
  });
  dynBand.appendChild(dynHead);
  const dynGrid = document.createElement("div");
  dynGrid.className = "config-grid";
  for (const g of groups.filter((g) => g.mode !== "recreate")) {
    dynGrid.appendChild(groupEl(g, true));
  }
  dynBand.appendChild(dynGrid);
  applyReloadBtn = applyButton(pick({ ja: "📥 ソースを再読み込みして適用", en: "📥 Reload the source to apply" }), () => {
    options.onReload(sourceOverrides);
    sourceOverrides = {};
    reloadDirty = false;
    refreshButtons();
  });
  const dynBar = document.createElement("div");
  dynBar.className = "config-apply-bar";
  dynBar.appendChild(applyReloadBtn);
  dynBand.appendChild(dynBar);
  container.appendChild(dynBand);

  // Static band (recreate) — collapsed by default.
  const statBand = document.createElement("section");
  statBand.className = "config-band config-band-static";
  const statHead = document.createElement("h3");
  statHead.className = "config-band-head";
  statHead.textContent = pick({
    ja: "Static(静的)— PlayerConfig(🔁):変更には新しい Player インスタンスが必要",
    en: "Static — PlayerConfig (🔁): changing it requires a new Player instance",
  });
  statBand.appendChild(statHead);
  const statGrid = document.createElement("div");
  statGrid.className = "config-grid";
  for (const g of groups.filter((g) => g.mode === "recreate")) {
    statGrid.appendChild(groupEl(g, false));
  }
  statBand.appendChild(statGrid);
  applyRecreateBtn = applyButton(pick({ ja: "🔁 プレイヤーを再生成して適用", en: "🔁 Recreate the player to apply" }), () => {
    options.onRecreate(playerOverrides);
    playerOverrides = {};
    recreateDirty = false;
    refreshButtons();
  });
  const statBar = document.createElement("div");
  statBar.className = "config-apply-bar";
  statBar.appendChild(applyRecreateBtn);
  statBand.appendChild(statBar);
  container.appendChild(statBand);

  refreshButtons();
}
