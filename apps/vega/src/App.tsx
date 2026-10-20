import type { PlayerConfig } from "bitmovin-player";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { BitmovinPlayer } from "./BitmovinPlayer";
import { ControlPanel } from "./ControlPanel";
import type { DvrController } from "./dvrController";
import type { DvrState } from "./dvr/state";
import { SOURCES } from "./Sources";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { initialDraft, parseConfiguration, presetDraft, sameConfiguration } from "./configuration";

// Vega has no dotenv toolchain: the Kepler entry sets these globals before the app
// mounts (values come from the repo-root .env — the same canonical names as every
// other target; see README / docs/SETUP.md).
const ENV = globalThis as unknown as Record<string, string | undefined>;
const LICENSE_KEY = ENV.BITMOVIN_PLAYER_LICENSE_KEY ?? "YOUR_PLAYER_KEY";
const ANALYTICS_LICENSE_KEY = ENV.BITMOVIN_ANALYTICS_LICENSE_KEY ?? "";

export const App: React.FC = () => {
  const [activeId, setActiveId] = useState(SOURCES[0]!.id);
  const [applied, setApplied] = useState(() => parseConfiguration(initialDraft(SOURCES[0]!)));
  const [draft, setDraft] = useState(applied.draft);
  const [error, setError] = useState<string | null>(null);
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
      ...applied.player,
      tweaks: { app_id: "com.showcase.dvr.vega" },
      // §15: the analytics module is registered in vegaPlayer.ts; the collector
      // only activates when a key is configured here.
      ...(ANALYTICS_LICENSE_KEY ? { analytics: { key: ANALYTICS_LICENSE_KEY } } : {}),
    }),
    [applied.player],
  );

  const selectSource = (index: number) => {
    const source = SOURCES[index];
    if (!source) return;
    const fields = presetDraft(source);
    setApplied(parseConfiguration({ ...applied.draft, ...fields }));
    setDraft((current) => ({ ...current, ...fields }));
    setActiveId(source.id);
    setError(null);
    setDvr(null);
  };
  const apply = () => {
    try {
      const next = parseConfiguration(draft);
      setDraft(next.draft);
      setError(null);
      if (sameConfiguration(applied, next)) return;
      if (JSON.stringify(applied.source) !== JSON.stringify(next.source)) setActiveId("custom");
      setApplied(next);
      setDvr(null);
      setLog((lines) => ["Configuration applied; player recreated", ...lines].slice(0, 40));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid configuration.");
    }
  };

  return (
    <View style={styles.root}>
      <BitmovinPlayer
        config={config}
        source={applied.source}
        onDvr={onDvr}
        controllerRef={controllerRef}
        timeShiftEnabled={dvrAllowed}
      />
      <ScrollView>
        <ControlPanel
          sources={SOURCES}
          activeId={activeId}
          dvr={dvr}
          log={log}
          onSelectSource={selectSource}
          controllerRef={controllerRef}
          dvrAllowed={dvrAllowed}
          onDvrAllowedChange={setDvrAllowed}
        />
        <ConfigurationPanel draft={draft} onChange={setDraft} onApply={apply}
          onReset={() => { setDraft(applied.draft); setError(null); }}
          changed={JSON.stringify(draft) !== JSON.stringify(applied.draft)} error={error} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
});
