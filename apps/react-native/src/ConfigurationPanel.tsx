import React, { useEffect, useState } from "react";
import { Keyboard, ScrollView, View } from "react-native";
import { Button, Switch, Text, TextInput } from "./localization";
import type { ConfigurationDraft, NativePlatform } from "./configuration";
import { WorkspaceAction, WorkspaceChoice, WorkspacePage } from "./Workspace";
import { NativeSettingsPanel } from "./NativeSettingsPanel";
import { NativeArraysPanel } from "./NativeArraysPanel";
import { NativeScriptsPanel } from "./NativeScriptsPanel";
import { CastHostPanel } from "./CastHostPanel";
import { panelStyles as styles } from "./panelStyles";

interface Props {
  draft: ConfigurationDraft;
  onChange: (draft: ConfigurationDraft) => void;
  onApply: () => void;
  onReset: () => void;
  changed: boolean;
  error: string | null;
  platform: NativePlatform;
  appliedCode: string;
  sourceEditRequest?: number;
  keyboardVisible?: boolean;
}

/** Creation-time settings stay in the draft until Apply. Existing playback controls remain separate. */
export function ConfigurationPanel({ draft, onChange, onApply, onReset, changed, error, platform, sourceEditRequest = 0, keyboardVisible = false }: Props): React.JSX.Element {
  const [group, setGroup] = useState("source");
  const [sourceField, setSourceField] = useState("url");
  const [playerField, setPlayerField] = useState("autoplay");
  useEffect(() => { if (sourceEditRequest) { setGroup("source"); setSourceField("url"); } }, [sourceEditRequest]);
  const selected = group === "player" ? playerField : sourceField;
  const groups = [{ id: "source", label: "Source" }, { id: "player", label: "Player" },
    { id: "ui", label: "UI settings" }, { id: "sdk", label: "SDK overrides" }, { id: "arrays", label: "Subtitle lists and advertising" },
    { id: "callbacks", label: "JavaScript callbacks and native UI handlers" }, { id: "cast", label: "Cast startup settings" }];
  const sourceFields = [{ id: "url", label: "Source URL" }, { id: "type", label: "Source type" },
    { id: "title", label: "Source title" }, { id: "poster", label: "Poster URL" },
    { id: "subtitleUrl", label: "External WebVTT URL" }, { id: "subtitleLabel", label: "Subtitle label" },
    { id: "subtitleLanguage", label: "Subtitle language" }, { id: "subtitleDefault", label: "Mark as default" },
    { id: "startOffset", label: "Start offset (seconds)" },
    { id: "timeline", label: "Start offset reference" }];
  const playerFields = [{ id: "autoplay", label: "Autoplay" }, { id: "muted", label: "Mute on startup" },
    { id: "forwardDuration", label: "Forward buffer (seconds)" }, { id: "maxBitrate", label: "Maximum bitrate (bits per second)" }];
  const update = <K extends keyof ConfigurationDraft>(key: K, value: ConfigurationDraft[K]) => onChange({ ...draft, [key]: value });
  const field = (label: string, key: "url" | "title" | "poster" | "startOffset" | "forwardDuration" | "maxBitrate" | "subtitleUrl" | "subtitleLabel" | "subtitleLanguage", numeric = false) => (
    <View key={key} style={styles.field}>
      <Text>{label}</Text>
      <TextInput accessibilityLabel={label} value={draft[key]} onChangeText={(value) => update(key, value)}
        autoCapitalize="none" autoCorrect={false} keyboardType={numeric ? "numbers-and-punctuation" : "default"} style={styles.input} />
    </View>
  );
  return (
    <View style={{ flex: 1, minHeight: 0 }} testID="configuration-workspace">
      {!keyboardVisible && <View style={{ padding: 10, gap: 8, flexDirection: "row" }}>
        <WorkspaceChoice label="Configuration" selected={group} options={groups} onSelect={setGroup} testID="configuration-group-selector" />
        {(group === "source" || group === "player") && <WorkspaceChoice label="Setting" selected={selected}
          options={group === "player" ? playerFields : sourceFields} onSelect={group === "player" ? setPlayerField : setSourceField} testID="workspace-setting-selector" />}
      </View>}
      {keyboardVisible && <View style={{ paddingHorizontal: 12, paddingVertical: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text>Editing</Text><WorkspaceAction title="Done" onPress={() => Keyboard.dismiss()} />
      </View>}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
      {group === "source" && <>
        {selected === "url" && field("Source URL", "url")}
        {selected === "type" && <>
        <Text>Source type</Text>
        <View style={styles.row}>
          <Button title="HLS" onPress={() => update("type", "hls")} disabled={draft.type === "hls"} />
          {platform === "android" && <Button title="DASH" onPress={() => update("type", "dash")} disabled={draft.type === "dash"} />}
          <Button title="Progressive MP4" onPress={() => update("type", "progressive")} disabled={draft.type === "progressive"} />
        </View>
        {platform === "ios" && <Text style={styles.help}>The native iOS player supports HLS and progressive MP4; DASH presets are hidden.</Text>}
        </>}
        {selected === "title" && field("Source title", "title")}
        {selected === "poster" && field("Poster URL", "poster")}
        {selected === "subtitleUrl" && field("External WebVTT URL", "subtitleUrl")}
        {selected === "subtitleLabel" && field("Subtitle label", "subtitleLabel")}
        {selected === "subtitleLanguage" && field("Subtitle language", "subtitleLanguage")}
        {selected === "subtitleDefault" && <>
        <View style={styles.row}>
          <Text>Mark as default</Text><Switch accessibilityLabel="Mark as default" value={draft.subtitleDefault} onValueChange={(value) => update("subtitleDefault", value)} />
        </View>
        </>}
        {selected.startsWith("subtitle") && <Text style={styles.help}>Optional: add one external WebVTT track. Enter a label and IETF language tag (for example, en or en-US). A blank URL removes the track and clears its metadata. Mark as default sets track metadata; choose subtitles in the player menu to enable them.</Text>}
        {selected === "startOffset" && field("Start offset (seconds)", "startOffset", true)}
        {selected === "timeline" && <>
        <Text>Start offset reference</Text>
        <View style={styles.row}>
          <Button title="SDK default" onPress={() => update("timeline", "default")} disabled={draft.timeline === "default"} />
          <Button title="Start" onPress={() => update("timeline", "start")} disabled={draft.timeline === "start"} />
          <Button title="End" onPress={() => update("timeline", "end")} disabled={draft.timeline === "end"} />
        </View>
        <Text style={styles.help}>Start means beginning of the media or DVR window; End means end or live edge. SDK defaults: Start for VOD, End for live. Offsets may be signed.</Text>
        </>}
      </>}
      {group === "player" && <>
        {selected === "autoplay" && <View style={styles.row}><Text>Autoplay</Text><Switch accessibilityLabel="Autoplay" value={draft.autoplay} onValueChange={(value) => update("autoplay", value)} /></View>}
        {selected === "muted" && <View style={styles.row}><Text>Mute on startup</Text><Switch accessibilityLabel="Mute on startup" value={draft.muted} onValueChange={(value) => update("muted", value)} /></View>}
        {selected === "forwardDuration" && <>
        {field("Forward buffer (seconds)", "forwardDuration", true)}
        <Text style={styles.help}>{platform === "ios" ? "Blank uses the SDK default (0); zero lets the SDK choose a duration." : "Enter a positive duration. Blank uses the Android SDK default (50 seconds); zero is not an automatic setting on Android."}</Text>
        </>}
        {selected === "maxBitrate" && <>
        {field("Maximum bitrate (bits per second)", "maxBitrate", true)}
        <Text style={styles.help}>{platform === "android" ? "Enter a whole number from 1 to 2147483647 bit/s (Android integer limit)." : "Enter a whole number from 1 to 9007199254740991 bit/s (JavaScript exact-integer limit)."} Blank leaves it unlimited. Buffering and adaptation depend on the stream and device.</Text>
        </>}
      </>}
      <WorkspacePage active={group === "sdk"}><NativeSettingsPanel values={draft.apiSettings ?? {}} onChange={(apiSettings) => onChange({ ...draft, apiSettings })} /></WorkspacePage>
      <WorkspacePage active={group === "ui"}><NativeSettingsPanel scope="ui" values={draft.apiSettings ?? {}} onChange={(apiSettings) => onChange({ ...draft, apiSettings })} /></WorkspacePage>
      <WorkspacePage active={group === "cast"}><CastHostPanel values={draft.apiSettings ?? {}} /></WorkspacePage>
      <WorkspacePage active={group === "arrays"}><NativeArraysPanel values={draft.arraySettings ?? {}} onChange={(arraySettings) => onChange({ ...draft, arraySettings })} /></WorkspacePage>
      <WorkspacePage active={group === "callbacks"}><NativeScriptsPanel value={draft.scripts ?? { allowed: false, bodies: {} }} onChange={(scripts) => onChange({ ...draft, scripts })} /></WorkspacePage>
      <Text style={styles.help}>Apply recreates the player and reloads the selected source from its start offset. Playback position is not retained. Reset only discards draft edits.</Text>
      </ScrollView>
      <View testID="configuration-actions" style={{ gap: 8, padding: 12, backgroundColor: "#edf3fb", borderTopWidth: 1, borderColor: "#d6deeb" }}>
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <Text style={styles.help}>{changed ? "Draft changes have not been applied." : "The draft matches the applied configuration."}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><WorkspaceAction title="Reset draft" testID="configuration-reset" onPress={onReset} disabled={!changed && !error} /></View>
          <View style={{ flex: 1 }}><WorkspaceAction title="Apply configuration" testID="configuration-apply" primary onPress={onApply} disabled={!changed} /></View>
        </View>
      </View>
    </View>
  );
}
