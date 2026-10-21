import React, { useState } from "react";
import { Button, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { NATIVE_SCRIPT_FIELDS, type NativeScriptDraft } from "./nativeScripts";

export function NativeScriptsPanel({ value, onChange }: { value: NativeScriptDraft; onChange: (value: NativeScriptDraft) => void }): React.JSX.Element {
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState("PlayerConfig.networkConfig.preprocessHttpRequest");
  const selected = NATIVE_SCRIPT_FIELDS.find((field) => field.id === selectedId)!;
  const body = value.bodies[selected.id];
  const update = (body: string) => onChange({ ...value, bodies: { ...value.bodies, [selected.id]: body } });
  return <View style={styles.panel}>
    <Text style={styles.heading}>JavaScript callbacks and native UI handlers</Text>
    <Text>These inputs contain JavaScript function bodies, not JSON. Edited code runs inside this app only after you enable execution and Apply. Handler factories execute on Apply and player recreation; SDK callbacks execute when called by the SDK. Code can access this app's JavaScript runtime. It is not sandboxed. Only run code you trust.</Text>
    <View style={styles.row}><Text>Allow edited JavaScript execution</Text><Switch accessibilityLabel="Allow edited JavaScript execution" value={value.allowed} onValueChange={(allowed) => onChange({ ...value, allowed })} /></View>
    <TextInput accessibilityLabel="Filter callback APIs" value={filter} onChangeText={setFilter} autoCapitalize="none" autoCorrect={false} style={styles.input} />
    <View style={styles.row}>{NATIVE_SCRIPT_FIELDS.filter((field) => field.id.toLowerCase().includes(filter.toLowerCase())).map((field) => <Button key={field.id} title={field.id} disabled={field.id === selected.id} onPress={() => setSelectedId(field.id)} />)}</View>
    <Text style={styles.heading}>{selected.id}</Text><Text>{selected.signature}</Text>
    {body === undefined ? <Button title="Edit this callback" onPress={() => update(selected.initial)} /> : <>
      <TextInput accessibilityLabel={`JavaScript body for ${selected.id}`} value={body} onChangeText={update} autoCorrect={false} autoCapitalize="none" multiline style={[styles.input, styles.code]} />
      <Button title="Remove this callback" onPress={() => { const bodies = { ...value.bodies }; delete bodies[selected.id]; onChange({ ...value, bodies }); }} />
    </>}
    <Text>Use lab.getPlayer(), lab.getSource(), lab.setFullscreen(boolean), lab.Source, lab.CustomUi and lab.CustomMessageHandler for the current public SDK objects. No environment or account API values are supplied. Return values are checked against the callback contract. DRM callbacks require their license URL. Network callbacks may return a Promise; synchronous callbacks must return synchronously. The decoder's context argument is the SDK DecoderContext, separate from lab.</Text>
    <Text>Fullscreen handler factories must return isFullscreenActive, enterFullscreen and exitFullscreen. Custom message handler factories must return a real lab.CustomMessageHandler instance. Their functions should use lab accessors so calls from a retired player are rejected. Selecting a source preset with configured callbacks also recreates the player.</Text>
  </View>;
}
const styles = StyleSheet.create({
  panel: { gap: 8, borderTopWidth: 1, borderTopColor: "#cccccc", paddingTop: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  input: { borderWidth: 1, borderColor: "#888888", borderRadius: 4, padding: 8, minHeight: 44 },
  code: { fontFamily: "monospace", minHeight: 120 }, heading: { fontWeight: "600" },
});
