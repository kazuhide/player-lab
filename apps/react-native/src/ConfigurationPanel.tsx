import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Keyboard, Platform, ScrollView, View } from "react-native";
import { Button, Switch, Text, TextInput } from "./localization";
import type { ConfigurationDraft, NativePlatform } from "./configuration";
import { WorkspaceAction, WorkspaceChoice, WorkspacePage } from "./Workspace";
import { NativeSettingsPanel } from "./NativeSettingsPanel";
import { NativeArraysPanel } from "./NativeArraysPanel";
import { NativeScriptsPanel } from "./NativeScriptsPanel";
import { ConfigurationProfiles } from "./ConfigurationProfilesPanel";
import { CastHostPanel } from "./CastHostPanel";
import { panelStyles as styles } from "./panelStyles";
import type { ConfigurationDifference } from "./differenceValues";

interface Props {
  draft: ConfigurationDraft;
  onChange: (draft: ConfigurationDraft) => void;
  onApply: () => void;
  onReset: () => void;
  changed: boolean;
  differences: readonly ConfigurationDifference[];
  error: string | null;
  platform: NativePlatform;
  appliedCode: string;
  sourceEditRequest?: number;
  keyboardVisible?: boolean;
  compactEditing?: boolean;
}

/** Creation-time settings stay in the draft until Apply. Existing playback controls remain separate. */
export function ConfigurationPanel({ draft, onChange, onApply, onReset, changed, differences, error, platform, sourceEditRequest = 0, keyboardVisible = false, compactEditing = false }: Props): React.JSX.Element {
  const [group, setGroup] = useState("source");
  const [sourceField, setSourceField] = useState("url");
  const [playerField, setPlayerField] = useState("autoplay");
  const editor = useRef<ScrollView>(null);
  useEffect(() => { if (sourceEditRequest) { setGroup("source"); setSourceField("url"); } }, [sourceEditRequest]);
  const selected = group === "player" ? playerField : sourceField;
  // Keep the single input in view while typing; its explanatory text returns after Done.
  const compactBasicEditing = compactEditing && (group === "source" || group === "player");
  // A newly selected editor starts at its inputs; editing and tab changes keep its position.
  useLayoutEffect(() => { editor.current?.scrollTo({ y: 0, animated: false }); }, [group, selected, sourceEditRequest]);
  const revealCompactInput = () => editor.current?.scrollToEnd({ animated: false });
  const compactInputEvents = Platform.OS === "android" && compactBasicEditing
    ? { onLayout: revealCompactInput, onContentSizeChange: revealCompactInput } : {};
  const groups = [{ id: "source", label: "Source" }, { id: "player", label: "Player" },
    { id: "profiles", label: "Saved configurations" }, { id: "ui", label: "UI settings" }, { id: "sdk", label: "SDK overrides" }, { id: "arrays", label: "Subtitles and ads" },
    { id: "callbacks", label: "JavaScript callbacks" }, { id: "cast", label: "Cast startup settings" }];
  const sourceFields = [{ id: "url", label: "Source URL" }, { id: "type", label: "Source type" },
    { id: "title", label: "Source title" }, { id: "poster", label: "Poster URL" },
    { id: "subtitleUrl", label: "External WebVTT URL" }, { id: "subtitleLabel", label: "Subtitle label" },
    { id: "subtitleLanguage", label: "Subtitle language" }, { id: "subtitleDefault", label: "Mark as default" },
    { id: "startOffset", label: "Start offset (seconds)" },
    { id: "timeline", label: "Start offset reference" }];
  const playerFields = [{ id: "autoplay", label: "Autoplay" }, { id: "muted", label: "Mute on startup" },
    { id: "forwardDuration", label: "Forward buffer (seconds)" }, { id: "maxBitrate", label: "Maximum bitrate (bits per second)" }];
  const differenceLabel = (path: string) => [...sourceFields, ...playerFields].find(field => field.id === path)?.label
    ?? (path === "scripts.allowed" ? "Allow edited JavaScript execution" : path
      .replace(/^apiSettings\.|^scripts\.bodies\./, "")
      .replace(/^arraySettings\.subtitles/, "SourceConfig.subtitleTracks")
      .replace(/^arraySettings\.offlineSubtitles/, "OfflineContentConfig.sourceConfig.subtitleTracks")
      .replace(/^arraySettings\.ads/, "PlayerConfig.advertisingConfig.schedule").replace(/\.(\d+)(?=\.|$)/g, "[$1]"));
  const update = <K extends keyof ConfigurationDraft>(key: K, value: ConfigurationDraft[K]) => onChange({ ...draft, [key]: value });
  const field = (label: string, key: "url" | "title" | "poster" | "startOffset" | "forwardDuration" | "maxBitrate" | "subtitleUrl" | "subtitleLabel" | "subtitleLanguage", numeric = false) => (
    <View key={key} style={styles.field}>
      {keyboardVisible && <Text>{label}</Text>}
      <TextInput accessibilityLabel={label} value={draft[key]} onChangeText={(value) => update(key, value)}
        placeholder={key === "subtitleLanguage" ? "en-US" : key === "poster" || key === "subtitleUrl" ? "Optional URL"
          : key === "url" ? "https://example.com/master.m3u8" : key === "maxBitrate" ? "No limit" : numeric ? "SDK default" : ""}
        placeholderTextColor="#6c7d92"
        autoCapitalize="none" autoCorrect={false} keyboardType={numeric ? "numbers-and-punctuation" : "default"} style={styles.input} />
    </View>
  );
  return (
    <View style={{ flex: 1, minHeight: 0 }} testID="configuration-workspace">
      {!keyboardVisible && <View style={{ padding: 10, gap: 8, flexDirection: "row" }}>
        <WorkspaceChoice label="Configuration" selected={group} options={groups} onSelect={value => {
          if (value === group) editor.current?.scrollTo({ y: 0, animated: false });
          setGroup(value);
        }} testID="configuration-group-selector" />
        {(group === "source" || group === "player") && <WorkspaceChoice label="Setting" selected={selected}
          options={group === "player" ? playerFields : sourceFields} onSelect={value => {
            if (value === selected) editor.current?.scrollTo({ y: 0, animated: false });
            (group === "player" ? setPlayerField : setSourceField)(value);
          }} testID="workspace-setting-selector" />}
      </View>}
      {keyboardVisible && !compactEditing && <View style={{ paddingHorizontal: 12, paddingVertical: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text>Editing</Text><WorkspaceAction title="Done" onPress={() => Keyboard.dismiss()} />
      </View>}
      <ScrollView ref={editor} {...compactInputEvents} testID="configuration-fields-scroll" style={{ flex: 1 }} contentContainerStyle={{ padding: compactEditing ? 8 : 12, gap: compactEditing ? 4 : 8 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
      <WorkspacePage active={group === "profiles"}><ConfigurationProfiles draft={draft} onChange={onChange} platform={platform} keyboardVisible={keyboardVisible} /></WorkspacePage>
      {group === "source" && <>
        {selected === "url" && field("Source URL", "url")}
        {selected === "type" && <>
        <Text>Source type</Text>
        <View style={styles.row}>
          <Button title="HLS" onPress={() => update("type", "hls")} disabled={draft.type === "hls"} />
          {platform === "android" && <Button title="DASH" onPress={() => update("type", "dash")} disabled={draft.type === "dash"} />}
          <Button title="Progressive MP4" onPress={() => update("type", "progressive")} disabled={draft.type === "progressive"} />
        </View>
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
        {!compactBasicEditing && selected === "subtitleUrl" && <Text style={styles.help}>Clear the URL to remove the external subtitle.</Text>}
        {!compactBasicEditing && selected === "subtitleDefault" && <Text style={styles.help}>Enable subtitles in the player menu.</Text>}
        {selected === "startOffset" && field("Start offset (seconds)", "startOffset", true)}
        {selected === "timeline" && <>
        <Text>Start offset reference</Text>
        <View style={styles.row}>
          <Button title="SDK default" onPress={() => update("timeline", "default")} disabled={draft.timeline === "default"} />
          <Button title="Start" onPress={() => update("timeline", "start")} disabled={draft.timeline === "start"} />
          <Button title="End" onPress={() => update("timeline", "end")} disabled={draft.timeline === "end"} />
        </View>
        </>}
      </>}
      {group === "player" && <>
        {selected === "autoplay" && <View style={styles.row}><Text>Autoplay</Text><Switch accessibilityLabel="Autoplay" value={draft.autoplay} onValueChange={(value) => update("autoplay", value)} /></View>}
        {selected === "muted" && <View style={styles.row}><Text>Mute on startup</Text><Switch accessibilityLabel="Mute on startup" value={draft.muted} onValueChange={(value) => update("muted", value)} /></View>}
        {selected === "forwardDuration" && <>
        {field("Forward buffer (seconds)", "forwardDuration", true)}
        {!compactBasicEditing && <Text style={styles.help}>{platform === "ios" ? "Blank uses the SDK default. Zero selects automatically." : "Positive seconds; blank uses the SDK default."}</Text>}
        </>}
        {selected === "maxBitrate" && <>
        {field("Maximum bitrate (bits per second)", "maxBitrate", true)}
        {!compactBasicEditing && <Text style={styles.help}>Positive whole bits per second; blank leaves it unlimited.</Text>}
        </>}
      </>}
      <WorkspacePage active={group === "sdk"}><NativeSettingsPanel values={draft.apiSettings ?? {}} onChange={(apiSettings) => onChange({ ...draft, apiSettings })} /></WorkspacePage>
      <WorkspacePage active={group === "ui"}><NativeSettingsPanel scope="ui" values={draft.apiSettings ?? {}} onChange={(apiSettings) => onChange({ ...draft, apiSettings })} /></WorkspacePage>
      <WorkspacePage active={group === "cast"}><CastHostPanel values={draft.apiSettings ?? {}} /></WorkspacePage>
      <WorkspacePage active={group === "arrays"}><NativeArraysPanel values={draft.arraySettings ?? {}} onChange={(arraySettings) => onChange({ ...draft, arraySettings })} /></WorkspacePage>
      <WorkspacePage active={group === "callbacks"}><NativeScriptsPanel value={draft.scripts ?? { allowed: false, bodies: {} }} onChange={(scripts) => onChange({ ...draft, scripts })} /></WorkspacePage>
      {!compactEditing && differences.length > 0 && <View testID="configuration-differences" style={styles.panel}>
        <Text style={styles.label}>Changes</Text>
        {differences.map(change => <View key={change.path} testID={`configuration-difference-${change.path}`} style={styles.field}>
          <View style={styles.row}>
            <Text style={styles.badge}>{change.kind === "added" ? "Added" : change.kind === "removed" ? "Removed" : "Changed"}</Text>
            <Text style={[styles.label, { flexShrink: 1, maxWidth: "100%" }]}>{differenceLabel(change.path)}</Text>
          </View>
          <Text style={styles.help}>Before</Text><Text verbatim selectable style={styles.mono}>{change.before}</Text>
          <Text style={styles.help}>After</Text><Text verbatim selectable style={styles.mono}>{change.after}</Text>
        </View>)}
      </View>}
      </ScrollView>
      <View testID="configuration-actions" style={{ gap: 8, padding: compactEditing ? 8 : 12, backgroundColor: "#edf3fb", borderTopWidth: 1, borderColor: "#d6deeb" }}>
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {!compactEditing && <View style={{ gap: 6 }}>
          <Text style={styles.badge}>{changed ? "Unapplied changes" : "Up to date"}</Text>
          {changed && <Text style={styles.help}>Apply recreates the player and clears the current position.</Text>}
        </View>}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {compactEditing && <WorkspaceAction title="Done" testID="configuration-done" onPress={() => Keyboard.dismiss()} />}
          <View style={{ flex: 1 }}><WorkspaceAction title="Reset draft" testID="configuration-reset" onPress={onReset} disabled={!changed && !error} /></View>
          <View style={{ flex: 1 }}><WorkspaceAction title="Apply configuration" testID="configuration-apply" primary onPress={onApply} disabled={!changed} /></View>
        </View>
      </View>
    </View>
  );
}
