import React from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import type { ConfigurationDraft, NativePlatform } from "./configuration";
import { Text, TextInput } from "./localization";
import { WorkspaceAction, WorkspaceChoice } from "./Workspace";
import { panelStyles as styles } from "./panelStyles";
import { CURRENT_SDK_VERSION } from "./configurationProfiles";
import { useConfigurationProfiles } from "./useConfigurationProfiles";

export function ConfigurationProfiles({ draft, onChange, platform, keyboardVisible = false, children }: {
  draft: ConfigurationDraft; onChange: (draft: ConfigurationDraft) => void; platform: NativePlatform; keyboardVisible?: boolean; children?: React.ReactNode;
}): React.JSX.Element {
  const state = useConfigurationProfiles(draft, onChange, platform === "ios" ? "react-native-ios" : "react-native-android");
  const confirmation = state.confirmation;
  return <View style={layout.root} testID="configuration-profiles">
    <View style={layout.row} testID="configuration-profile-fields">
      <View style={[styles.field, layout.name]}>
        <Text style={styles.label}>Configuration name</Text>
        <TextInput testID="configuration-profile-name" accessibilityLabel="Configuration name" value={state.name} onChangeText={state.setName}
          editable={!state.busy} autoCorrect={false} autoCapitalize="none" returnKeyType="done" style={styles.input} />
      </View>
      <View style={layout.action}>
        <WorkspaceChoice label="Saved configuration" selected={state.selectedName} translateChoices={false} singleLineValue
          disabled={state.busy || !state.profiles.length} options={state.profiles.map(profile => ({ id: profile.name, label: profile.name }))}
          onSelect={state.select} testID="configuration-profile-picker" />
      </View>
    </View>
    <View style={layout.actions} testID="configuration-profile-actions">
      <View style={layout.action}><WorkspaceAction title="Save draft" testID="configuration-profile-save" onPress={state.save} disabled={state.busy || state.canRecover} /></View>
      <View style={layout.action}><WorkspaceAction title="Load draft" testID="configuration-profile-restore" onPress={state.restore} disabled={state.busy || !state.selected} primary /></View>
      <View style={layout.action}><WorkspaceAction title="Delete saved configuration" testID="configuration-profile-delete" onPress={state.remove} disabled={state.busy || !state.selected} /></View>
    </View>
    <ScrollView testID="configuration-profile-details" style={layout.details} contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
    {state.busy && <Text accessibilityRole="alert" style={styles.help}>Loading saved configurations…</Text>}
    {state.notice && <Text accessibilityRole="alert" style={styles.help}>{state.notice}</Text>}
    {state.error && <View style={styles.field}><Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>
      <WorkspaceAction title={state.canRecover ? "Recover saved configurations" : "Retry saved configurations"}
        onPress={state.canRecover ? state.recover : state.retry} disabled={state.busy} testID="configuration-profile-retry" />
    </View>}
    {!state.profiles.length && !state.busy && <Text style={styles.help}>No saved configurations.</Text>}
    {!keyboardVisible && <>
      <Text style={styles.help}>Saves supported numeric, toggle and choice settings, and built-in sources. Keys, custom URLs, text, arrays and scripts are excluded.</Text>
      <Text style={styles.help}>Excluded fields keep their current values. Loading a draft does not change playback.</Text>
    </>}
    {children}
    </ScrollView>
    {confirmation && <Modal transparent visible animationType="fade" onRequestClose={state.cancel} supportedOrientations={["portrait", "landscape"]}>
      <View style={modal.scrim}><View style={modal.dialog} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.heading}>{confirmation.action === "replace" ? "Replace saved configuration?" : confirmation.action === "delete" ? "Delete saved configuration?"
            : confirmation.action === "recover" ? "Recover the saved configuration backup?" : "Load a draft saved with another SDK version?"}</Text>
          {confirmation.action !== "recover" && <Text verbatim selectable>{confirmation.profile.name}</Text>}
          {confirmation.action === "restore" && <><Text style={styles.help}>The supported fields have been validated. Playback changes only after Apply.</Text>
            <Text style={styles.help}>Saved SDK</Text><Text verbatim>{confirmation.profile.sdkVersion}</Text>
            <Text style={styles.help}>Current SDK</Text><Text verbatim>{CURRENT_SDK_VERSION}</Text></>}
          {confirmation.action === "recover" && <Text style={styles.help}>Recovery restores the previous saved list. It does not load or apply a player configuration.</Text>}
        </ScrollView>
        <View style={styles.row}>
          <WorkspaceAction title="Cancel" testID="configuration-profile-cancel" onPress={state.cancel} />
          <WorkspaceAction title={confirmation.action === "replace" ? "Replace" : confirmation.action === "delete" ? "Delete" : confirmation.action === "recover" ? "Recover" : "Load draft"}
            testID="configuration-profile-confirm" primary onPress={state.confirm} />
        </View>
      </View></View>
    </Modal>}
  </View>;
}
const layout = StyleSheet.create({
  root: { flex: 1, minHeight: 0, padding: 8, paddingVertical: 4, gap: 8 },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  actions: { flexDirection: "row", flexWrap: "nowrap", gap: 8, alignItems: "flex-end" },
  name: { flex: 1, minWidth: 0 }, action: { flex: 1, minWidth: 0 },
  details: { flex: 1, minHeight: 0 },
});
const modal = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "#00000066", padding: 20, justifyContent: "center" },
  dialog: { maxHeight: "90%", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#ffffff" },
});
