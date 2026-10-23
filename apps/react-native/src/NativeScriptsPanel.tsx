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
    <Text style={styles.heading}>JavaScript callbacks and native UI handlers</Text>
    <WorkspaceChoice label="Callback API" selected={selected.id} options={NATIVE_SCRIPT_FIELDS.map(field => ({ id: field.id, label: field.id }))}
      onSelect={setSelectedId} testID="callback-selector" />
    <View style={styles.row}><Text>Allow edited JavaScript execution</Text><Switch accessibilityLabel="Allow edited JavaScript execution" value={value.allowed} onValueChange={(allowed) => onChange({ ...value, allowed })} /></View>
    <Text style={[styles.heading, styles.mono]}>{selected.id}</Text><Text style={styles.mono}>{selected.signature}</Text>
    {body === undefined ? <Button title="Edit this callback" onPress={() => update(selected.initial)} /> : <>
      <Button title="Finish editing JavaScript" onPress={() => Keyboard.dismiss()} />
      <TextInput accessibilityLabel={`JavaScript body for ${selected.id}`} value={body} onChangeText={update} autoCorrect={false} autoCapitalize="none" multiline style={[styles.input, styles.mono, styles.scriptInput]} />
      <Button title="Remove this callback" onPress={() => { const bodies = { ...value.bodies }; delete bodies[selected.id]; onChange({ ...value, bodies }); }} />
    </>}
    <Text style={styles.help}>These inputs contain JavaScript function bodies, not JSON. Edited code runs inside this app only after you enable execution and Apply. Handler factories execute on Apply and player recreation; SDK callbacks execute when called by the SDK. Code can access this app's JavaScript runtime. It is not sandboxed. Only run code you trust.</Text>
    <Text style={styles.help}>Use lab.getPlayer(), lab.getSource(), lab.setFullscreen(boolean), lab.Source, lab.CustomUi and lab.CustomMessageHandler for the current public SDK objects. No environment or account API values are supplied. Return values are checked against the callback contract. DRM callbacks require their license URL. Network callbacks may return a Promise; synchronous callbacks must return synchronously. The decoder's context argument is the SDK DecoderContext, separate from lab.</Text>
    <Text style={styles.help}>Fullscreen handler factories must return isFullscreenActive, enterFullscreen and exitFullscreen. Custom message handler factories must return a real lab.CustomMessageHandler instance. Their functions should use lab accessors so calls from a retired player are rejected. Selecting a source preset with configured callbacks also recreates the player.</Text>
  </View>;
}
