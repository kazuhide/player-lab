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
  SourceType,
  UserInterfaceType,
  usePlayer,
  type PlayerViewConfig,
  type WebUiConfig,
} from "bitmovin-player-react-native";
import type { DvrState } from "./src/dvr/state";
import { SnapshotController } from "./src/dvr/snapshotController";
import { SOURCES, type ShowcaseSource } from "./src/sources";

// Both keys flow from the repo-root .env via scripts/sync-env.sh → this app's .env
// (EXPO_PUBLIC_* = client-embedded; license keys are domain-locked, not secret).
const LICENSE_KEY = process.env.EXPO_PUBLIC_BITMOVIN_PLAYER_LICENSE_KEY ?? "";
const ANALYTICS_LICENSE_KEY = process.env.EXPO_PUBLIC_BITMOVIN_ANALYTICS_LICENSE_KEY ?? "";
// §15: enable the bundled analytics collector only when a key is configured.
const ANALYTICS = ANALYTICS_LICENSE_KEY
  ? { analyticsConfig: { licenseKey: ANALYTICS_LICENSE_KEY } }
  : {};

// The shared @showcase/ui-shared bundle, synced to assets/webui by scripts/sync-webui-bundle.sh.
// These point the Web UI at it for the custom modes; on-device the asset must be delivered to the
// native app (Expo prebuild copies assets/) — see README. Placeholders until that wiring lands.
const WEBUI_JS = Platform.select({
  android: "file:///android_asset/webui/bitmovinplayer-ui.js",
  default: "webui/bitmovinplayer-ui.js",
});
const WEBUI_CSS = Platform.select({
  android: "file:///android_asset/webui/bitmovinplayer-ui.css",
  default: "webui/bitmovinplayer-ui.css",
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

function sdkType(kind: ShowcaseSource["kind"]): SourceType {
  return kind === "live-hls" || kind === "vod-hls" ? SourceType.HLS : SourceType.DASH;
}

export default function App(): React.JSX.Element {
  const [uiMode, setUiMode] = useState<UiMode>(DEFAULT_MODE);
  // The selected source lives here (not in PlayerPane) so it survives a UI-mode switch, which
  // remounts the pane — otherwise every switch would snap back to the first source.
  const [source, setSource] = useState<ShowcaseSource | undefined>(SOURCES[0]);
  return (
    <View style={styles.container}>
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
      {/* Remount on UI change — styleConfig is fixed at player creation (like iOS). */}
      <PlayerPane key={uiMode.label} uiMode={uiMode} source={source} onSelectSource={setSource} />
    </View>
  );
}

interface PlayerPaneProps {
  uiMode: UiMode;
  source: ShowcaseSource | undefined;
  onSelectSource: (source: ShowcaseSource) => void;
}

function PlayerPane({ uiMode, source, onSelectSource }: PlayerPaneProps): React.JSX.Element {
  const player = usePlayer(
    uiMode.factoryFunction
      ? {
          licenseKey: LICENSE_KEY,
          ...ANALYTICS,
          styleConfig: {
            userInterfaceType: UserInterfaceType.Bitmovin,
            playerUiJs: WEBUI_JS,
            playerUiCss: WEBUI_CSS,
          },
        }
      : { licenseKey: LICENSE_KEY, ...ANALYTICS },
  );
  const [timeShiftEnabled, setTimeShiftEnabled] = useState(true);
  const [dvr, setDvr] = useState<DvrState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const snapshots = useRef<SnapshotController | null>(null);

  const append = useCallback((m: string) => setLog((l) => [m, ...l].slice(0, 40)), []);

  const load = useCallback(
    (s: ShowcaseSource) => {
      snapshots.current?.sourceChanged();
      setDvr(null);
      append(`load ${s.label}`);
      player.load({ url: s.url, type: sdkType(s.kind) });
    },
    [player, append],
  );

  useEffect(() => {
    const controller = new SnapshotController(player, setDvr, append);
    snapshots.current = controller;
    // Load the currently-selected source on mount/remount (a UI-mode switch remounts this pane),
    // so playback continues under the new UI instead of resetting to the first source.
    if (source) load(source);
    return () => {
      controller.dispose();
      if (snapshots.current === controller) snapshots.current = null;
      player.destroy();
    };
    // `player` identity is stable from usePlayer; `source` is read once per mount intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        onTimeChanged={refresh}
        onSourceLoaded={() => {
          append("SourceLoaded");
          void refresh();
        }}
        onTimeShifted={() => {
          append("TimeShifted");
          void refresh();
        }}
      />

      <View style={styles.row}>
        {SOURCES.map((s) => (
          <Button
            key={s.id}
            title={s.label}
            onPress={() => {
              onSelectSource(s); // remember it so a UI-mode switch keeps this source
              load(s);
            }}
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
          value={timeShiftEnabled}
          onValueChange={(v) => {
            // Update the controller before a refresh, including when playback is paused.
            snapshots.current?.setTimeShiftEnabled(v);
            setTimeShiftEnabled(v);
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
  container: { flex: 1, padding: 12, gap: 10 },
  player: { width: "100%", height: 220, backgroundColor: "#000" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  label: { marginRight: 6 },
  mono: { fontFamily: "monospace", fontSize: 12 },
  logBox: { height: 160 },
});
