/**
 * React Native (Expo) build of the Bitmovin Player Playground.
 *
 * The DVR coordinate logic lives in `src/dvr` (pure, unit-tested in this package).
 * RN's player API is async/Promise-based, so this app awaits the reads into a
 * `PlayerSnapshot` and feeds the sync helpers. RN has **no `onDurationChanged`**
 * event, so live→VOD is detected by polling snapshots on `onTimeChanged`.
 *
 * The "Player UI" picker reuses the shared `@showcase/ui-shared` bundle (§12): RN renders
 * the player UI as a Web UI, so the same bundle the web app uses runs here. Switching the
 * factory recreates the player (its `styleConfig` is creation-time), so the player + controls
 * live in a keyed `PlayerPane` that remounts on change — mirroring the Android `key(uiMode)`
 * approach. On-device, the bundle must be delivered to the native app (Expo prebuild) — see README.
 *
 * The screen and helpers type-check against the installed React Native and player
 * types. Native playback requires an external Expo development build; see README.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Platform, ScrollView, StyleSheet, Switch, Text, View, type GestureResponderEvent } from "react-native";
import {
  CustomUi,
  PlayerView,
  UserInterfaceType,
  usePlayer,
  type SourceConfig,
  type PlayerViewConfig,
  type WebUiConfig,
} from "bitmovin-player-react-native";
import type { DvrState } from "./src/dvr/state";
import { SnapshotController } from "./src/dvr/snapshotController";
import { SOURCES, type ShowcaseSource } from "./src/sources";
import { ConfigurationPanel } from "./src/ConfigurationPanel";
import { configurationCode } from "./src/configurationCode";
import { initialDraft, parseConfiguration, presetDraft, sameConfiguration, supportsSource, type Configuration } from "./src/configuration";
import type { RuntimeAppState, RuntimeMonitor, RuntimeOwner } from "./src/runtimeObservation";
import { ApiPanel } from "./src/ApiPanel";
import { nativeEventProps } from "./src/apiEvents";
import { apiValue } from "./src/apiValues";

// Both keys flow from the repo-root .env via scripts/sync-env.sh → this app's .env
// (EXPO_PUBLIC_* = client-embedded; license keys are domain-locked, not secret).
const LICENSE_KEY = process.env.EXPO_PUBLIC_BITMOVIN_PLAYER_LICENSE_KEY ?? "";
const ANALYTICS_LICENSE_KEY = process.env.EXPO_PUBLIC_BITMOVIN_ANALYTICS_LICENSE_KEY ?? "";
// §15: enable the bundled analytics collector only when a key is configured.
const ANALYTICS = ANALYTICS_LICENSE_KEY
  ? { analyticsConfig: { licenseKey: ANALYTICS_LICENSE_KEY } }
  : {};

// The shared @showcase/ui-shared bundle, synced to assets/webui by scripts/sync-webui-bundle.sh.
// The generated Expo host's config plugin packages these native resources during prebuild.
// React Native resolves relative iOS file URLs against the main application bundle.
const WEBUI_JS = Platform.select({
  android: "file:///android_asset/webui/bitmovinplayer-ui.js",
  default: "bitmovinplayer-ui.js",
});
const WEBUI_CSS = Platform.select({
  android: "file:///android_asset/webui/bitmovinplayer-ui.css",
  default: "bitmovinplayer-ui.css",
});

/** A selectable player UI: the SDK default, or one of our shared custom factories (§12). */
interface UiMode {
  label: RuntimeAppState["ui"];
  factoryFunction: string | null;
}
const DEFAULT_MODE: UiMode = { label: "Default", factoryFunction: null };
const UI_MODES: UiMode[] = [
  DEFAULT_MODE,
  { label: "Sports", factoryFunction: "bitmovin.playerui.UIFactory.buildSportsUI" },
  { label: "Live (DVR)", factoryFunction: "bitmovin.playerui.UIFactory.buildLiveUI" },
  { label: "Cinema", factoryFunction: "bitmovin.playerui.UIFactory.buildCinemaUI" },
];

/** The optional observer is supplied only by the generated runtime-check entry. */
export default function App({ runtimeChecks }: { runtimeChecks?: RuntimeMonitor } = {}): React.JSX.Element {
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const sources = SOURCES.filter((source) => supportsSource(source, platform));
  const [uiMode, setUiMode] = useState<UiMode>(DEFAULT_MODE);
  // Keep the complete applied source and control state outside the keyed player owner.
  const [applied, setApplied] = useState(() => parseConfiguration(initialDraft(sources[0]!), platform));
  const [draft, setDraft] = useState(applied.draft);
  const [revision, setRevision] = useState(0);
  const recreate = useCallback(() => setRevision((value) => value + 1), []);
  const [error, setError] = useState<string | null>(null);
  const [timeShiftEnabled, setTimeShiftEnabled] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const [playerTouchOwner, setPlayerTouchOwner] = useState<symbol | null>(null);
  const onPlayerTouchChange = useCallback((owner: symbol, touching: boolean) => {
    setPlayerTouchOwner((current) => touching ? owner : current === owner ? null : current);
  }, []);
  const appliedCode = useMemo(() => configurationCode(applied, platform, uiMode.factoryFunction), [applied, platform, uiMode]);
  useEffect(() => { runtimeChecks?.appliedCode(appliedCode); }, [runtimeChecks, appliedCode]);
  const append = useCallback((message: string) => setLog((lines) => [message, ...lines].slice(0, 40)), []);
  useEffect(() => {
    runtimeChecks?.appState({ ui: uiMode.label, revision, dvrAllowed: timeShiftEnabled, logCount: log.length,
      sourceType: applied.draft.type, startOffset: applied.source.options?.startOffset ?? null,
      autoplay: applied.draft.autoplay, startupMuted: applied.draft.muted,
      forwardBuffer: applied.player.bufferConfig?.audioAndVideo?.forwardDuration ?? null,
      maxBitrate: applied.player.adaptationConfig?.maxSelectableBitrate ?? null,
      externalSubtitleConfigured: Boolean(applied.source.subtitleTracks?.length) });
  }, [runtimeChecks, uiMode.label, revision, timeShiftEnabled, log.length, applied]);
  const selectSource = (source: ShowcaseSource) => {
    const fields = presetDraft(source);
    const next = parseConfiguration({ ...applied.draft, ...fields }, platform);
    setApplied(next);
    setDraft((current) => ({ ...current, ...fields }));
    setError(null);
  };
  const apply = () => {
    try {
      const next = parseConfiguration(draft, platform);
      setDraft(next.draft);
      setError(null);
      if (sameConfiguration(applied, next)) return;
      setApplied(next);
      setRevision((value) => value + 1);
      append("Configuration applied; player recreated");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid configuration.");
    }
  };
  return (
    <ScrollView testID="player-lab-screen" contentContainerStyle={styles.container} automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
      scrollEnabled={Platform.OS !== "android" || playerTouchOwner === null}>
      {/* Player UI: the SDK default vs. our shared @showcase/ui-shared custom factories (§12). */}
      <View style={styles.row}>
        <Text style={styles.label}>UI:</Text>
        {UI_MODES.map((mode) => (
          <Button
            key={mode.label}
            title={mode.label}
            onPress={() => setUiMode(mode)}
            disabled={uiMode.label === mode.label}
          />
        ))}
      </View>
      <PlayerPane key={`${uiMode.label}:${revision}`} uiMode={uiMode} source={applied.source} playerConfig={applied.player}
        sources={sources} onSelectSource={selectSource} timeShiftEnabled={timeShiftEnabled} onTimeShiftEnabled={setTimeShiftEnabled}
        log={log} append={append} runtimeChecks={runtimeChecks} onPlayerTouchChange={onPlayerTouchChange} onRecreate={recreate} />
      <ConfigurationPanel draft={draft} onChange={setDraft} onApply={apply}
        onReset={() => { setDraft(applied.draft); setError(null); }}
        changed={JSON.stringify(draft) !== JSON.stringify(applied.draft)} error={error} platform={platform} appliedCode={appliedCode} />
    </ScrollView>
  );
}

interface PlayerPaneProps {
  uiMode: UiMode;
  source: SourceConfig;
  playerConfig: Configuration["player"];
  sources: ShowcaseSource[];
  onSelectSource: (source: ShowcaseSource) => void;
  timeShiftEnabled: boolean;
  onTimeShiftEnabled: (enabled: boolean) => void;
  log: string[];
  append: (message: string) => void;
  onPlayerTouchChange: (owner: symbol, touching: boolean) => void;
  runtimeChecks?: RuntimeMonitor | undefined;
  onRecreate: () => void;
}

function PlayerPane({ uiMode, source, playerConfig, sources, onSelectSource, timeShiftEnabled, onTimeShiftEnabled, log, append, runtimeChecks, onPlayerTouchChange, onRecreate }: PlayerPaneProps): React.JSX.Element {
  const player = usePlayer(
    uiMode.factoryFunction
      ? {
          licenseKey: LICENSE_KEY,
          ...ANALYTICS,
          ...playerConfig,
          styleConfig: {
            userInterfaceType: UserInterfaceType.Bitmovin,
            playerUiJs: WEBUI_JS,
            playerUiCss: WEBUI_CSS,
          },
        }
      : { licenseKey: LICENSE_KEY, ...ANALYTICS, ...playerConfig },
  );
  const [dvr, setDvr] = useState<DvrState | null>(null);
  const [viewReady, setViewReady] = useState(false);
  const snapshots = useRef<SnapshotController | null>(null);
  const active = useRef(true);
  const [apiEvents, setApiEvents] = useState<string[]>([]);
  const [recordingEvents, setRecordingEvents] = useState(true);
  const recording = useRef(recordingEvents);
  recording.current = recordingEvents;
  const eventBuffer = useRef<string[]>([]);
  const eventFlush = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recordApiEvent = useCallback((name: string, event: unknown) => {
    if (!active.current || !recording.current) return;
    eventBuffer.current = [`${name}: ${apiValue(event).slice(0, 2000)}`, ...eventBuffer.current].slice(0, 80);
    // Batch high-frequency bridge events rather than rendering once per callback.
    if (!eventFlush.current) eventFlush.current = setTimeout(() => {
      eventFlush.current = undefined;
      if (active.current) setApiEvents(eventBuffer.current);
    }, 125);
  }, []);
  const apiEventProps = useMemo(() => nativeEventProps(recordApiEvent), [recordApiEvent]);
  useEffect(() => () => { if (eventFlush.current) clearTimeout(eventFlush.current); }, []);
  const observed = useRef<RuntimeOwner | null>(null);
  const touchOwner = useMemo(() => Symbol("player-touch"), []);
  const playerPointers = useRef(new Set<string>());
  const touchMounted = useRef(true);
  useLayoutEffect(() => {
    touchMounted.current = true;
    return () => {
      touchMounted.current = false;
      playerPointers.current.clear();
      onPlayerTouchChange(touchOwner, false);
    };
  }, [onPlayerTouchChange, touchOwner]);
  const startPlayerTouch = (event: GestureResponderEvent) => {
    if (!touchMounted.current) return;
    playerPointers.current.add(event.nativeEvent.identifier);
    onPlayerTouchChange(touchOwner, true);
  };
  const finishPlayerTouch = (event: GestureResponderEvent) => {
    if (!touchMounted.current) return;
    const remaining = new Set(event.nativeEvent.touches.map((touch) => touch.identifier));
    for (const pointer of playerPointers.current) {
      if (!remaining.has(pointer)) playerPointers.current.delete(pointer);
    }
    onPlayerTouchChange(touchOwner, playerPointers.current.size > 0);
  };

  useEffect(() => {
    const controller = new SnapshotController(player, setDvr, append);
    active.current = true;
    snapshots.current = controller;
    const owner = runtimeChecks?.attach(player) ?? null;
    observed.current = owner;
    return () => {
      active.current = false;
      controller.dispose();
      if (snapshots.current === controller) snapshots.current = null;
      try { player.destroy(); }
      finally { owner?.retire(); }
      if (observed.current === owner) observed.current = null;
    };
  }, [player, append, runtimeChecks]);

  useEffect(() => {
    if (!viewReady || !active.current) return;
    snapshots.current?.sourceChanged();
    setDvr(null);
    append(`load ${source.title || "source"}`);
    // Player.load is void in wrapper 1.29.0; native Source/Player error events report failures.
    player.load(source);
    observed.current?.sourceLoad();
  }, [source, player, viewReady, append]);

  useEffect(() => {
    snapshots.current?.setTimeShiftEnabled(timeShiftEnabled);
    if (viewReady) void snapshots.current?.refresh();
  }, [timeShiftEnabled, viewReady]);

  const refresh = useCallback(() => snapshots.current?.refresh(), []);
  const seek = useCallback((offset: number) => snapshots.current?.seek(offset), []);

  // Select our custom factory by name; omitted for the SDK default UI.
  const viewConfig: PlayerViewConfig | undefined = uiMode.factoryFunction
    ? { uiConfig: { variant: new CustomUi(uiMode.factoryFunction) } satisfies WebUiConfig }
    : undefined;

  return (
    <>
      <View testID="player-lab-player" {...(Platform.OS === "android" ? {
        // Let the embedded SDK menu consume video gestures before the outer form.
        onTouchStartCapture: startPlayerTouch,
        onTouchEndCapture: finishPlayerTouch,
        onTouchCancelCapture: finishPlayerTouch,
      } : {})}>
      <PlayerView
        {...apiEventProps}
        player={player}
        style={styles.player}
        {...(viewConfig ? { config: viewConfig } : {})}
        onPlayerViewReady={() => { if (active.current) { recordApiEvent("onPlayerViewReady", undefined); observed.current?.viewReady(); setViewReady(true); } }}
        onTimeChanged={(event) => { apiEventProps.onTimeChanged?.(event); if (active.current) { observed.current?.event("timeChanged"); void refresh(); } }}
        onCueEnter={(event) => { apiEventProps.onCueEnter?.(event); if (active.current) observed.current?.event("cueEnter"); }}
        onSourceLoaded={(event) => {
          apiEventProps.onSourceLoaded?.(event);
          if (!active.current) return;
          append("SourceLoaded");
          observed.current?.event("sourceLoaded");
          void refresh();
        }}
        onTimeShifted={(event) => {
          apiEventProps.onTimeShifted?.(event);
          if (!active.current) return;
          append("TimeShifted");
          void refresh();
        }}
        onPlayerError={(event) => { apiEventProps.onPlayerError?.(event); if (active.current) { observed.current?.event("error", event?.code); append(typeof event?.code === "number" ? `Player error (${event.code})` : "Player error"); } }}
        onSourceError={(event) => { apiEventProps.onSourceError?.(event); if (active.current) { observed.current?.event("error", event?.code); append(typeof event?.code === "number" ? `Source error (${event.code})` : "Source error"); } }}
      />
      </View>

      <View style={styles.row}>
        {sources.map((s) => (
          <Button
            key={s.id}
            title={s.label}
            onPress={() => onSelectSource(s)}
          />
        ))}
      </View>

      <View style={styles.row}>
        <Button title="Live edge" onPress={() => player.timeShift(0)} />
        {[-10, -30, -60].map((o) => (
          <Button key={o} title={`${o}s`} onPress={() => seek(o)} disabled={!dvr?.dvrAvailable} />
        ))}
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Allow DVR</Text>
        <Switch
          accessibilityLabel="Allow DVR"
          value={timeShiftEnabled}
          onValueChange={(v) => {
            // Update the controller before a refresh, including when playback is paused.
            snapshots.current?.setTimeShiftEnabled(v);
            onTimeShiftEnabled(v);
            void refresh();
          }}
        />
      </View>

      <Text style={styles.mono}>
        {dvr
          ? `mode=${dvr.mode}  dvrAvailable=${dvr.dvrAvailable}  behindLive=${dvr.behindLive.toFixed(
              1,
            )}s  window=${dvr.windowDuration.toFixed(0)}s`
          : "…"}
      </Text>

      <ScrollView style={styles.logBox}>
        {log.slice(0, 12).map((line, i) => (
          <Text key={i} style={styles.mono}>
            {line}
          </Text>
        ))}
      </ScrollView>
      <ApiPanel player={player} source={source} ready={viewReady} events={apiEvents} recording={recordingEvents}
        onRecording={setRecordingEvents} onClearEvents={() => { eventBuffer.current = []; setApiEvents([]); }} onRecreate={onRecreate} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, gap: 10 },
  player: { width: "100%", height: 220, backgroundColor: "#000" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  label: { marginRight: 6 },
  mono: { fontFamily: "monospace", fontSize: 12 },
  logBox: { height: 160 },
});
