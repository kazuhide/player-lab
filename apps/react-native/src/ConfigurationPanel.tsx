import React, { useState } from "react";
import { Button, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import type { ConfigurationDraft, NativePlatform } from "./configuration";
import { ConfigurationCodeView } from "./ConfigurationCodeView";
import { NativeSettingsPanel } from "./NativeSettingsPanel";
import { NativeArraysPanel } from "./NativeArraysPanel";

interface Props {
  draft: ConfigurationDraft;
  onChange: (draft: ConfigurationDraft) => void;
  onApply: () => void;
  onReset: () => void;
  changed: boolean;
  error: string | null;
  platform: NativePlatform;
  appliedCode: string;
}

/** Creation-time settings stay in the draft until Apply. Existing playback controls remain separate. */
export function ConfigurationPanel({ draft, onChange, onApply, onReset, changed, error, platform, appliedCode }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const update = <K extends keyof ConfigurationDraft>(key: K, value: ConfigurationDraft[K]) => onChange({ ...draft, [key]: value });
  const field = (label: string, key: "url" | "title" | "poster" | "startOffset" | "forwardDuration" | "maxBitrate" | "subtitleUrl" | "subtitleLabel" | "subtitleLanguage", numeric = false) => (
    <View key={key} style={styles.field}>
      <Text>{label}</Text>
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
        <Text>Source type</Text>
        <View style={styles.row}>
          <Button title="HLS" onPress={() => update("type", "hls")} disabled={draft.type === "hls"} />
          {platform === "android" && <Button title="DASH" onPress={() => update("type", "dash")} disabled={draft.type === "dash"} />}
          <Button title="Progressive MP4" onPress={() => update("type", "progressive")} disabled={draft.type === "progressive"} />
        </View>
        {platform === "ios" && <Text style={styles.help}>The native iOS player supports HLS and progressive MP4; DASH presets are hidden.</Text>}
        {field("Source title", "title")}
        {field("Poster URL", "poster")}
        {field("External WebVTT URL", "subtitleUrl")}
        {field("Subtitle label", "subtitleLabel")}
        {field("Subtitle language", "subtitleLanguage")}
        <View style={styles.row}>
          <Text>Mark as default</Text><Switch accessibilityLabel="Mark as default" value={draft.subtitleDefault} onValueChange={(value) => update("subtitleDefault", value)} />
        </View>
        <Text style={styles.help}>Optional: add one external WebVTT track. Enter a label and IETF language tag (for example, en or en-US). A blank URL removes the track and clears its metadata. Mark as default sets track metadata; choose subtitles in the player menu to enable them.</Text>
        {field("Start offset (seconds)", "startOffset", true)}
        <Text>Start offset reference</Text>
        <View style={styles.row}>
          <Button title="SDK default" onPress={() => update("timeline", "default")} disabled={draft.timeline === "default"} />
          <Button title="Start" onPress={() => update("timeline", "start")} disabled={draft.timeline === "start"} />
          <Button title="End" onPress={() => update("timeline", "end")} disabled={draft.timeline === "end"} />
        </View>
        <Text style={styles.help}>Start means beginning of the media or DVR window; End means end or live edge. SDK defaults: Start for VOD, End for live. Offsets may be signed.</Text>
        <View style={styles.row}>
          <Text>Autoplay</Text><Switch accessibilityLabel="Autoplay" value={draft.autoplay} onValueChange={(value) => update("autoplay", value)} />
          <Text>Mute on startup</Text><Switch accessibilityLabel="Mute on startup" value={draft.muted} onValueChange={(value) => update("muted", value)} />
        </View>
        {field("Forward buffer (seconds)", "forwardDuration", true)}
        <Text style={styles.help}>{platform === "ios" ? "Blank uses the SDK default (0); zero lets the SDK choose a duration." : "Enter a positive duration. Blank uses the Android SDK default (50 seconds); zero is not an automatic setting on Android."}</Text>
        {field("Maximum bitrate (bits per second)", "maxBitrate", true)}
        <Text style={styles.help}>{platform === "android" ? "Enter a whole number from 1 to 2147483647 bit/s (Android integer limit)." : "Enter a whole number from 1 to 9007199254740991 bit/s (JavaScript exact-integer limit)."} Blank leaves it unlimited. Buffering and adaptation depend on the stream and device.</Text>
        <NativeSettingsPanel values={draft.apiSettings ?? {}} onChange={(apiSettings) => onChange({ ...draft, apiSettings })} />
        <NativeArraysPanel values={draft.arraySettings ?? {}} onChange={(arraySettings) => onChange({ ...draft, arraySettings })} />
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
  panel: { gap: 8, borderTopWidth: 1, borderTopColor: "#cccccc", paddingTop: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  field: { gap: 4 },
  input: { borderWidth: 1, borderColor: "#888888", borderRadius: 4, padding: 8, minHeight: 44 },
  help: { fontSize: 12, color: "#444444" },
  error: { color: "#a00000" },
});
