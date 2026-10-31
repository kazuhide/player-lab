import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Switch, Text, TextInput } from "./localization";
import type { ConfigurationDraft } from "./configuration";
import { ConfigurationProfiles } from "./ConfigurationProfilesPanel";
import { ConfigurationCodeView } from "./ConfigurationCodeView";
import { ConfigurationInputsPanel } from "./api/ConfigurationInputsPanel";

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
  const field = (label: string, key: "url" | "title" | "poster" | "startOffset" | "videoForwardDuration" | "audioForwardDuration" | "maxVideoBitrate" | "subtitleUrl" | "subtitleLabel" | "subtitleLanguage", numeric = false) => (
    <View key={key} style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={draft[key]} onChangeText={(value) => update(key, value)}
        placeholder={key === "subtitleLanguage" ? "en-US" : key === "poster" || key === "subtitleUrl" ? "Optional URL"
          : key === "url" ? "https://example.com/master.m3u8" : key === "maxVideoBitrate" ? "No limit" : numeric ? "SDK default" : ""}
        placeholderTextColor="#9aacc2"
        autoCapitalize="none" autoCorrect={false} keyboardType={numeric ? "numbers-and-punctuation" : "default"} style={styles.input} />
    </View>
  );
  return (
    <View style={styles.panel}>
      <Button title={expanded ? "Hide configuration" : "Show configuration"} onPress={() => setExpanded(!expanded)} />
      <ConfigurationProfiles draft={draft} onChange={onChange} />
      <View style={styles.actions}>
        <Text style={styles.badge}>{changed ? "Unapplied changes" : "Up to date"}</Text>
        <Text style={styles.help}>Apply reloads from the configured start position.</Text>
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <View style={styles.row}>
          <Button title="Apply and recreate player" onPress={onApply} disabled={!changed} />
          <Button title="Reset draft" onPress={onReset} disabled={!changed && !error} />
        </View>
      </View>
      {expanded && <>
        <Text style={styles.heading}>Source</Text>
        {field("Source URL", "url")}
        <Text style={styles.label}>Source type</Text>
        <View style={styles.row}>
          <Button title="HLS" onPress={() => update("type", "hls")} disabled={draft.type === "hls"} />
          <Button title="DASH" onPress={() => update("type", "dash")} disabled={draft.type === "dash"} />
          <Button title="Progressive MP4" onPress={() => update("type", "progressive")} disabled={draft.type === "progressive"} />
        </View>
        {field("Source title", "title")}
        {field("Poster URL", "poster")}
        {field("External WebVTT URL", "subtitleUrl")}
        {field("Subtitle label", "subtitleLabel")}
        {field("Subtitle language", "subtitleLanguage")}
        <View style={styles.row}>
          <Text style={styles.label}>Enable external subtitle on load</Text>
          <Switch focusable style={styles.toggle} accessibilityLabel="Enable external subtitle on load" value={draft.subtitleEnabled} onValueChange={(value) => update("subtitleEnabled", value)} />
        </View>
        <Text style={styles.help}>Clear the URL to remove the external subtitle.</Text>
        {field("Start offset (seconds)", "startOffset", true)}
        <Text style={styles.label}>Start offset reference</Text>
        <View style={styles.row}>
          <Button title="SDK default" onPress={() => update("timeline", "default")} disabled={draft.timeline === "default"} />
          <Button title="Start" onPress={() => update("timeline", "start")} disabled={draft.timeline === "start"} />
          <Button title="End" onPress={() => update("timeline", "end")} disabled={draft.timeline === "end"} />
        </View>
        <Text style={styles.heading}>Player</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Autoplay</Text><Switch focusable style={styles.toggle} accessibilityLabel="Autoplay" value={draft.autoplay} onValueChange={(value) => update("autoplay", value)} />
          <Text style={styles.label}>Mute on startup</Text><Switch focusable style={styles.toggle} accessibilityLabel="Mute on startup" value={draft.muted} onValueChange={(value) => update("muted", value)} />
        </View>
        {field("Video forward buffer (seconds)", "videoForwardDuration", true)}
        {field("Audio forward buffer (seconds)", "audioForwardDuration", true)}
        <Text style={styles.help}>Positive seconds; blank uses the SDK default.</Text>
        {field("Maximum video bitrate (bits per second)", "maxVideoBitrate", true)}
        <Text style={styles.help}>Positive bits per second; blank leaves it unlimited.</Text>
        <ConfigurationInputsPanel values={draft.apiInputs ?? []} onChange={(apiInputs) => onChange({ ...draft, apiInputs })} />
        <ConfigurationCodeView code={appliedCode} />
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12, padding: 24, borderTopWidth: 1, borderTopColor: "#3a4b62", backgroundColor: "#101820" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  field: { gap: 8 },
  input: { color: "#f4f7fb", backgroundColor: "#161f2c", borderWidth: 1, borderColor: "#6f829a", borderRadius: 8, padding: 12, minHeight: 52, fontSize: 18 },
  label: { color: "#f4f7fb", fontSize: 18 },
  heading: { color: "#f4f7fb", fontSize: 20, fontWeight: "600", marginTop: 4 },
  actions: { gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#3a4b62" },
  badge: { alignSelf: "flex-start", color: "#d5e2f2", backgroundColor: "#29374a", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, fontSize: 16 },
  toggle: { width: 72, height: 36 },
  help: { color: "#b8c6d9", fontSize: 16, lineHeight: 22 },
  error: { color: "#ffb3b3", fontSize: 18 },
});
