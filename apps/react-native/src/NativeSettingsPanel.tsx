import React, { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { NATIVE_SETTING_FIELDS, type SettingValues } from "./nativeSettings";

/** Search keeps the native form small even when the SDK adds many fields. */
export function NativeSettingsPanel({ values, onChange }: { values: SettingValues; onChange: (values: SettingValues) => void }): React.JSX.Element {
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(10);
  const [selectedId, setSelectedId] = useState("SourceConfig.description");
  const selected = NATIVE_SETTING_FIELDS.find((field) => field.id === selectedId) ?? NATIVE_SETTING_FIELDS[0]!;
  const matches = NATIVE_SETTING_FIELDS.filter((field) => field.id.toLowerCase().includes(filter.toLowerCase()));
  const enabled = Object.prototype.hasOwnProperty.call(values, selected.id);
  const update = (raw: string) => onChange({ ...values, [selected.id]: raw });
  const remove = () => { const next = { ...values }; delete next[selected.id]; onChange(next); };
  return <View style={styles.panel}>
    <Text style={styles.heading}>Additional SDK configuration</Text>
    <Text>Choose an API and edit its value. Changes are staged until Apply. Removing an override restores the form value or SDK default. Offline and Cast settings are used by their API experiments.</Text>
    <TextInput accessibilityLabel="Filter configuration APIs" value={filter} onChangeText={(text) => { setFilter(text); setLimit(10); }}
      autoCorrect={false} autoCapitalize="none" style={styles.input} />
    <View style={styles.row}>{matches.slice(0, limit).map((field) => <Button key={field.id} title={field.id} disabled={selected.id === field.id} onPress={() => setSelectedId(field.id)} />)}</View>
    {matches.length > limit && <Button title="Show more configuration APIs" onPress={() => setLimit(limit + 10)} />}
    <Text style={styles.heading}>{selected.id}</Text>
    <Text>Input: {selected.kind}. {enabled ? "Override is staged." : "No override."}</Text>
    {!enabled && <Button title="Set this API value" onPress={() => update(selected.choices?.[0] ?? (selected.kind === "number" ? "0" : ""))} />}
    {enabled && <>
      {selected.choices ? <View style={styles.row}>{selected.choices.map((choice) => <Button key={choice} title={choice} disabled={values[selected.id] === choice} onPress={() => update(choice)} />)}</View>
        : <TextInput accessibilityLabel={`Value for ${selected.id}`} value={values[selected.id] ?? ""} onChangeText={update}
          autoCorrect={false} autoCapitalize="none" multiline={selected.kind === "list" || selected.kind === "map"}
          secureTextEntry={/licenseKey/i.test(selected.id)} style={styles.input} />}
      {selected.kind === "list" && <Text>Enter one item per line. An empty value is an empty list.</Text>}
      {selected.kind === "map" && <Text>Enter one name=value pair per line. Names must be unique.</Text>}
      <Button title="Remove this API override" onPress={remove} />
    </>}
    <Text>License fields start empty and do not reveal environment values. Analytics metadata needs an Analytics license. A nativeId reuses a native instance with that ID; leave it unset unless reuse is intended. Platform-specific settings may have no effect on the other platform.</Text>
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 8, borderTopWidth: 1, borderTopColor: "#cccccc", paddingTop: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  input: { borderWidth: 1, borderColor: "#888888", borderRadius: 4, padding: 8, minHeight: 44 },
  heading: { fontWeight: "600" },
});
