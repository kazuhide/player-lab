import React, { useState } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import type { ConfigurationDraft } from "./configuration";
import { Button, Text, TextInput } from "./localization";
import { CURRENT_SDK_VERSION } from "./configurationProfiles";
import { useConfigurationProfiles } from "./useConfigurationProfiles";

export function ConfigurationProfiles({ draft, onChange }: {
  draft: ConfigurationDraft; onChange: (draft: ConfigurationDraft) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState(false);
  const state = useConfigurationProfiles(draft, onChange, "vega");
  const confirmation = state.confirmation;
  const close = () => { setPicker(false); state.cancel(); };
  return <View style={styles.content} testID="configuration-profiles">
    <Button title={expanded ? "Hide saved configurations" : "Saved configurations"} testID="configuration-profile-toggle" onPress={() => setExpanded(!expanded)} />
    {expanded && <>
      <Text style={styles.help}>Saves supported numeric, toggle and choice settings, and built-in sources. Keys, custom URLs, text, arrays and scripts are excluded.</Text>
      <Text style={styles.label}>Configuration name</Text>
      <TextInput testID="configuration-profile-name" accessibilityLabel="Configuration name" value={state.name} onChangeText={state.setName}
        editable={!state.busy} autoCorrect={false} autoCapitalize="none" style={styles.input} />
      <View style={styles.row}>
        <Button title="Save draft" testID="configuration-profile-save" onPress={state.save} disabled={state.busy} />
        <Button title="Select saved configuration" testID="configuration-profile-picker" onPress={() => setPicker(true)} disabled={state.busy || !state.profiles.length} />
      </View>
      {state.selected ? <Text verbatim style={styles.label}>{state.selected.name}</Text> : !state.busy && <Text style={styles.help}>No saved configurations.</Text>}
      <View style={styles.row}>
        <Button title="Load draft" testID="configuration-profile-restore" onPress={state.restore} disabled={state.busy || !state.selected} />
        <Button title="Delete saved configuration" testID="configuration-profile-delete" onPress={state.remove} disabled={state.busy || !state.selected} />
      </View>
      <Text style={styles.help}>Excluded fields keep their current values. Loading a draft does not change playback.</Text>
      {state.busy && <Text accessibilityRole="alert" style={styles.help}>Loading saved configurations…</Text>}
      {state.notice && <Text accessibilityRole="alert" style={styles.help}>{state.notice}</Text>}
      {state.error && <><Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>
        <Button title="Retry saved configurations" onPress={state.retry} disabled={state.busy} testID="configuration-profile-retry" />
      </>}
    </>}
    {(picker || confirmation) && <Modal transparent visible animationType="fade" onRequestClose={close}>
      <View style={styles.scrim}><View style={styles.dialog} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.content}>
          {picker ? <><Text style={styles.heading}>Saved configuration</Text>
            {state.profiles.map((profile, index) => <Button key={profile.name} verbatim title={profile.name} testID={`configuration-profile-option-${index}`}
              onPress={() => { state.select(profile.name); setPicker(false); }} />)}
          </> : confirmation && <>
            <Text style={styles.heading}>{confirmation.action === "replace" ? "Replace saved configuration?" : confirmation.action === "delete" ? "Delete saved configuration?"
              : "Load a draft saved with another SDK version?"}</Text>
            <Text verbatim style={styles.label}>{confirmation.profile.name}</Text>
            {confirmation.action === "restore" && <><Text style={styles.help}>The supported fields have been validated. Playback changes only after Apply.</Text>
              <Text style={styles.help}>Saved SDK</Text><Text verbatim>{confirmation.profile.sdkVersion}</Text>
            <Text style={styles.help}>Current SDK</Text><Text verbatim>{CURRENT_SDK_VERSION}</Text></>}
          </>}
        </ScrollView>
        <View style={styles.row}>
          <Button title="Cancel" testID="configuration-profile-cancel" onPress={close} />
          {!picker && confirmation && <Button title={confirmation.action === "replace" ? "Replace" : confirmation.action === "delete" ? "Delete" : "Load draft"}
            testID="configuration-profile-confirm" onPress={state.confirm} />}
        </View>
      </View></View>
    </Modal>}
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: 12 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  input: { color: "#f4f7fb", backgroundColor: "#161f2c", borderWidth: 1, borderColor: "#6f829a", borderRadius: 8, padding: 12, minHeight: 52, fontSize: 18 },
  label: { color: "#f4f7fb", fontSize: 18 }, heading: { color: "#f4f7fb", fontSize: 20, fontWeight: "600" },
  help: { color: "#b8c6d9", fontSize: 16, lineHeight: 22 }, error: { color: "#ffb3b3", fontSize: 18 },
  scrim: { flex: 1, backgroundColor: "#000000b3", padding: 32, justifyContent: "center" },
  dialog: { maxHeight: "90%", gap: 16, padding: 24, borderRadius: 8, borderWidth: 1, borderColor: "#6f829a", backgroundColor: "#101820" },
});
