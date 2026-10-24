import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button, Switch, Text } from "./localization";
import type { PlaybackController } from "./playbackController";
import type { TimelineState } from "./playback/state";
import type { VegaSource } from "./Sources";

export interface ControlPanelProps {
  sources: VegaSource[];
  activeId: string;
  dvr: TimelineState | null;
  log: string[];
  onSelectSource: (index: number) => void;
  controllerRef: React.MutableRefObject<PlaybackController | null>;
  dvrAllowed: boolean;
  onDvrAllowedChange: (enabled: boolean) => void;
}

/** Runtime control panel (§13) in Kepler/RN components — TV-remote focusable. */
export const ControlPanel: React.FC<ControlPanelProps> = ({
  sources,
  activeId,
  dvr,
  log,
  onSelectSource,
  controllerRef,
  dvrAllowed,
  onDvrAllowedChange,
}) => {
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Source</Text>
      <View style={styles.row}>
        {sources.map((s, i) => (
          <Button key={s.id} title={s.id === activeId ? `${s.label} ●` : s.label} onPress={() => onSelectSource(i)} />
        ))}
      </View>

      <Text style={styles.heading}>Playback</Text>
      <View style={styles.row}>
        <Button title="Live edge" onPress={() => controllerRef.current?.goToLiveEdge()} />
        {[-10, -30, -60].map((offset) => (
          <Button
            key={offset}
            title={`${offset}s`}
            onPress={() => controllerRef.current?.seek(offset)}
            disabled={!dvr?.dvrAvailable}
          />
        ))}
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Allow DVR</Text>
        <Switch
          focusable
          style={styles.toggle}
          accessibilityLabel="Allow DVR"
          value={dvrAllowed}
          onValueChange={(v) => {
            onDvrAllowedChange(v);
            controllerRef.current?.setTimeShiftEnabled(v);
          }}
        />
      </View>

      <Text style={styles.label}>Playback state</Text>
      <Text verbatim style={styles.mono}>
        {dvr
          ? `mode=${dvr.mode}  dvrAvailable=${dvr.dvrAvailable}  behindLive=${dvr.behindLive.toFixed(
              1,
            )}s  window=${dvr.windowDuration.toFixed(0)}s  position=${dvr.currentTime.toFixed(1)}s`
          : "…"}
      </Text>

      {!!log.length && <ScrollView focusable style={styles.log}>
        {log.slice(0, 12).map((line, i) => (
          <Text key={i} style={styles.mono}>
            {line}
          </Text>
        ))}
      </ScrollView>}
    </View>
  );
};

const styles = StyleSheet.create({
  panel: { padding: 24, gap: 12, backgroundColor: "#101820" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  heading: { color: "#f4f7fb", fontSize: 20, fontWeight: "600" },
  label: { color: "#f4f7fb", fontSize: 18, marginRight: 6 },
  toggle: { width: 72, height: 36 },
  mono: { color: "#d5e2f2", fontFamily: "monospace", fontSize: 14, lineHeight: 20 },
  log: { maxHeight: 96 },
});
