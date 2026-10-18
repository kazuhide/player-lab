import type { PlayerConfig } from "bitmovin-player";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BitmovinPlayer } from "./BitmovinPlayer";
import { ControlPanel } from "./ControlPanel";
import type { DvrController } from "./dvrController";
import type { DvrState } from "./dvr/state";
import { SOURCES } from "./Sources";

// Vega has no dotenv toolchain: the Kepler entry sets these globals before the app
// mounts (values come from the repo-root .env — the same canonical names as every
// other target; see README / docs/SETUP.md).
const ENV = globalThis as unknown as Record<string, string | undefined>;
const LICENSE_KEY = ENV.BITMOVIN_PLAYER_LICENSE_KEY ?? "YOUR_PLAYER_KEY";
const ANALYTICS_LICENSE_KEY = ENV.BITMOVIN_ANALYTICS_LICENSE_KEY ?? "";

export const App: React.FC = () => {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [dvr, setDvr] = useState<DvrState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [dvrAllowed, setDvrAllowed] = useState(true);
  const controllerRef = useRef<DvrController | null>(null);

  const onDvr = useCallback((state: DvrState, line?: string) => {
    setDvr(state);
    if (line) setLog((l) => [line, ...l].slice(0, 40));
  }, []);

  const config = useMemo<PlayerConfig>(
    () => ({
      key: LICENSE_KEY,
      ui: false,
      playback: { autoplay: true, muted: true },
      tweaks: { app_id: "com.showcase.dvr.vega" },
      // §15: the analytics module is registered in vegaPlayer.ts; the collector
      // only activates when a key is configured here.
      ...(ANALYTICS_LICENSE_KEY ? { analytics: { key: ANALYTICS_LICENSE_KEY } } : {}),
    }),
    [],
  );

  const source = SOURCES[sourceIndex] ?? SOURCES[0]!;

  return (
    <View style={styles.root}>
      <BitmovinPlayer
        config={config}
        source={source.config}
        onDvr={onDvr}
        controllerRef={controllerRef}
        timeShiftEnabled={dvrAllowed}
      />
      <ControlPanel
        sources={SOURCES}
        activeId={source.id}
        dvr={dvr}
        log={log}
        onSelectSource={setSourceIndex}
        controllerRef={controllerRef}
        dvrAllowed={dvrAllowed}
        onDvrAllowedChange={setDvrAllowed}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
});
