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
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Platform, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
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
import { initialDraft, parseConfiguration, presetDraft, sameConfiguration, supportsSource, type Configuration } from "./src/configuration";

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
  label: string;
  factoryFunction: string | null;
}
const DEFAULT_MODE: UiMode = { label: "Default", factoryFunction: null };
const UI_MODES: UiMode[] = [
  DEFAULT_MODE,
  { label: "Sports", factoryFunction: "bitmovin.playerui.UIFactory.buildSportsUI" },
  { label: "Live (DVR)", factoryFunction: "bitmovin.playerui.UIFactory.buildLiveUI" },
  { label: "Cinema", factoryFunction: "bitmovin.playerui.UIFactory.buildCinemaUI" },
];

export default function App(): React.JSX.Element {
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const sources = SOURCES.filter((source) => supportsSource(source, platform));
  const [uiMode, setUiMode] = useState<UiMode>(DEFAULT_MODE);
  // Keep the complete applied source and control state outside the keyed player owner.
  const [applied, setApplied] = useState(() => parseConfiguration(initialDraft(sources[0]!), platform));
  const [draft, setDraft] = useState(applied.draft);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [timeShiftEnabled, setTimeShiftEnabled] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const append = useCallback((message: string) => setLog((lines) => [message, ...lines].slice(0, 40)), []);
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
    <ScrollView contentContainerStyle={styles.container}>
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
        log={log} append={append} />
      <ConfigurationPanel draft={draft} onChange={setDraft} onApply={apply}
        onReset={() => { setDraft(applied.draft); setError(null); }}
        changed={JSON.stringify(draft) !== JSON.stringify(applied.draft)} error={error} platform={platform} />
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
}

function PlayerPane({ uiMode, source, playerConfig, sources, onSelectSource, timeShiftEnabled, onTimeShiftEnabled, log, append }: PlayerPaneProps): React.JSX.Element {
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

  useEffect(() => {
    const controller = new SnapshotController(player, setDvr, append);
    active.current = true;
    snapshots.current = controller;
    return () => {
      active.current = false;
      controller.dispose();
      if (snapshots.current === controller) snapshots.current = null;
      player.destroy();
    };
  }, [player, append]);

  useEffect(() => {
    if (!viewReady || !active.current) return;
    snapshots.current?.sourceChanged();
    setDvr(null);
    append(`load ${source.title || "source"}`);
    // Player.load is void in wrapper 1.28.0; native Source/Player error events report failures.
    player.load(source);
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
      <PlayerView
        player={player}
        style={styles.player}
        {...(viewConfig ? { config: viewConfig } : {})}
        onPlayerViewReady={() => { if (active.current) setViewReady(true); }}
        onTimeChanged={() => { if (active.current) void refresh(); }}
        onSourceLoaded={() => {
          if (!active.current) return;
          append("SourceLoaded");
          void refresh();
        }}
        onTimeShifted={() => {
          if (!active.current) return;
          append("TimeShifted");
          void refresh();
        }}
        onPlayerError={(event) => { if (active.current) append(typeof event?.code === "number" ? `Player error (${event.code})` : "Player error"); }}
        onSourceError={(event) => { if (active.current) append(typeof event?.code === "number" ? `Source error (${event.code})` : "Source error"); }}
      />

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
