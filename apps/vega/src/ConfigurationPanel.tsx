import React, { useState } from "react";
import { Button, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import type { ConfigurationDraft } from "./configuration";
import { ConfigurationCodeView } from "./ConfigurationCodeView";

interface Props {
  draft: ConfigurationDraft;
  onChange: (draft: ConfigurationDraft) => void;
  onApply: () => void;
  onReset: () => void;
  changed: boolean;
  error: string | null;
  appliedCode: string;
}

export function ConfigurationPanel({ draft, onChange, onApply, onReset, changed, error, appliedCode }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const update = <K extends keyof ConfigurationDraft>(key: K, value: ConfigurationDraft[K]) => onChange({ ...draft, [key]: value });
  const field = (label: string, key: "url" | "title" | "poster" | "startOffset" | "videoForwardDuration" | "audioForwardDuration" | "maxVideoBitrate", numeric = false) => (
    <View key={key} style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={draft[key]} onChangeText={(value) => update(key, value)}
        autoCapitalize="none" autoCorrect={false} keyboardType={numeric ? "numbers-and-punctuation" : "default"} style={styles.input} />
    </View>
  );
  return (
    <View style={styles.panel}>
      <Button title={expanded ? "Hide configuration" : "Show configuration"} onPress={() => setExpanded(!expanded)} />
      {expanded && <>
        <Text style={styles.help}>Apply recreates the player and reloads the selected source from its start offset. Playback position is not retained. Reset only discards draft edits.</Text>
        {field("Source URL", "url")}
        <Text style={styles.label}>Source type</Text>
        <View style={styles.row}>
          <Button title="HLS" onPress={() => update("type", "hls")} disabled={draft.type === "hls"} />
          <Button title="DASH" onPress={() => update("type", "dash")} disabled={draft.type === "dash"} />
          <Button title="Progressive MP4" onPress={() => update("type", "progressive")} disabled={draft.type === "progressive"} />
        </View>
        {field("Source title", "title")}
        {field("Poster URL", "poster")}
        <Text style={styles.help}>Title and poster are stored with the source. This screen displays no artwork overlay.</Text>
        {field("Start offset (seconds)", "startOffset", true)}
        <Text style={styles.label}>Start offset reference</Text>
        <View style={styles.row}>
          <Button title="SDK default" onPress={() => update("timeline", "default")} disabled={draft.timeline === "default"} />
          <Button title="Start" onPress={() => update("timeline", "start")} disabled={draft.timeline === "start"} />
          <Button title="End" onPress={() => update("timeline", "end")} disabled={draft.timeline === "end"} />
        </View>
        <Text style={styles.help}>Start means beginning of the media or DVR window; End means end or live edge. SDK defaults: Start for VOD, End for live. Offsets may be signed.</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Autoplay</Text><Switch focusable style={styles.toggle} accessibilityLabel="Autoplay" value={draft.autoplay} onValueChange={(value) => update("autoplay", value)} />
          <Text style={styles.label}>Mute on startup</Text><Switch focusable style={styles.toggle} accessibilityLabel="Mute on startup" value={draft.muted} onValueChange={(value) => update("muted", value)} />
        </View>
        {field("Video forward buffer (seconds)", "videoForwardDuration", true)}
        {field("Audio forward buffer (seconds)", "audioForwardDuration", true)}
        <Text style={styles.help}>This screen accepts positive buffer targets. Blank keeps the SDK default (40 seconds per media type); live windows can limit the effective buffer.</Text>
        {field("Maximum video bitrate (bits per second)", "maxVideoBitrate", true)}
        <Text style={styles.help}>Positive video bitrate cap; blank leaves it unlimited. Stream, engine and device support still apply.</Text>
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <View style={styles.row}>
          <Button title="Apply and recreate player" onPress={onApply} disabled={!changed} />
          <Button title="Reset draft" onPress={onReset} disabled={!changed && !error} />
        </View>
        <ConfigurationCodeView code={appliedCode} />
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#555555", backgroundColor: "#111111" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  field: { gap: 4 },
  input: { color: "#ffffff", borderWidth: 1, borderColor: "#888888", borderRadius: 4, padding: 8, minHeight: 44 },
  label: { color: "#ffffff" },
  toggle: { width: 72, height: 36 },
  help: { color: "#dddddd", fontSize: 12 },
  error: { color: "#ffb3b3" },
});
