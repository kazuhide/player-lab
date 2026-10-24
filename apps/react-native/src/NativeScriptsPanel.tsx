import React, { useState } from "react";
import { Keyboard, View } from "react-native";
import { Button, Switch, Text, TextInput } from "./localization";
import { NATIVE_SCRIPT_FIELDS, type NativeScriptDraft } from "./nativeScripts";
import { panelStyles as styles } from "./panelStyles";
import { WorkspaceChoice } from "./Workspace";

export function NativeScriptsPanel({ value, onChange }: { value: NativeScriptDraft; onChange: (value: NativeScriptDraft) => void }): React.JSX.Element {
  const [selectedId, setSelectedId] = useState("PlayerConfig.networkConfig.preprocessHttpRequest");
  const selected = NATIVE_SCRIPT_FIELDS.find((field) => field.id === selectedId)!;
  const body = value.bodies[selected.id];
  const update = (body: string) => onChange({ ...value, bodies: { ...value.bodies, [selected.id]: body } });
  return <View style={styles.panel}>
    <WorkspaceChoice label="Callback API" selected={selected.id} options={NATIVE_SCRIPT_FIELDS.map(field => ({ id: field.id, label: field.id }))}
      onSelect={setSelectedId} testID="callback-selector" />
    <View style={styles.row}><Text>Allow edited JavaScript execution</Text><Switch accessibilityLabel="Allow edited JavaScript execution" value={value.allowed} onValueChange={(allowed) => onChange({ ...value, allowed })} /></View>
    <Text style={styles.warning}>Allow execution, then Apply. Edited code runs in this app without a sandbox; handler factories also run on player recreation. The SDK invokes callbacks. Editing alone does not run code.</Text>
    <Text verbatim style={styles.mono}>{selected.signature}</Text>
    {body === undefined ? <Button title="Edit this callback" onPress={() => update(selected.initial)} /> : <>
      <Button title="Finish editing JavaScript" onPress={() => Keyboard.dismiss()} />
      <TextInput accessibilityLabel={`JavaScript body for ${selected.id}`} value={body} onChangeText={update} autoCorrect={false} autoCapitalize="none" multiline style={[styles.input, styles.mono, styles.scriptInput]} />
      <Button title="Remove this callback" onPress={() => { const bodies = { ...value.bodies }; delete bodies[selected.id]; onChange({ ...value, bodies }); }} />
    </>}
  </View>;
}
