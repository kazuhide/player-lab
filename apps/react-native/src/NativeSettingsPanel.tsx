import React, { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { NATIVE_SETTING_FIELDS, type SettingValues } from "./nativeSettings";
import { panelStyles as styles } from "./panelStyles";

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
    <Text style={styles.help}>Choose an API and edit its value. Changes are staged until Apply. Removing an override restores the form value or SDK default. Offline settings are used by their API experiments. Save Cast receiver and namespace inputs in Cast startup configuration below, then fully close and reopen the app to apply them.</Text>
    <TextInput accessibilityLabel="Filter configuration APIs" value={filter} onChangeText={(text) => { setFilter(text); setLimit(10); }}
      autoCorrect={false} autoCapitalize="none" style={styles.input} />
    <View style={styles.row}>{matches.slice(0, limit).map((field) => <Button key={field.id} title={field.id} disabled={selected.id === field.id} onPress={() => setSelectedId(field.id)} />)}</View>
    {matches.length > limit && <Button title="Show more configuration APIs" onPress={() => setLimit(limit + 10)} />}
    <Text style={[styles.heading, styles.mono]}>{selected.id}</Text>
    <Text style={styles.help}>Input: {selected.kind}. {enabled ? "Override is staged." : "No override."}</Text>
    {!enabled && <Button title="Set this API value" onPress={() => update(selected.choices?.[0] ?? (selected.kind === "number" ? "0" : ""))} />}
    {enabled && <>
      {selected.choices ? <View style={styles.row}>{selected.choices.map((choice) => <Button key={choice} title={choice} disabled={values[selected.id] === choice} onPress={() => update(choice)} />)}</View>
        : <TextInput accessibilityLabel={`Value for ${selected.id}`} value={values[selected.id] ?? ""} onChangeText={update}
          autoCorrect={false} autoCapitalize="none" multiline={selected.kind === "list" || selected.kind === "map"}
          secureTextEntry={/licenseKey/i.test(selected.id)} style={styles.input} />}
      {selected.kind === "list" && <Text style={styles.help}>Enter one item per line. An empty value is an empty list.</Text>}
      {selected.kind === "map" && <Text style={styles.help}>Enter one name=value pair per line. Names must be unique.</Text>}
      <Button title="Remove this API override" onPress={remove} />
    </>}
    <Text style={styles.help}>License fields start empty and do not reveal environment values. Analytics metadata needs an Analytics license. A nativeId reuses a native instance with that ID; leave it unset unless reuse is intended. Platform-specific settings may have no effect on the other platform.</Text>
    <Text style={styles.help}>These overrides are passed to their typed SDK fields after the basic form. The SDK validates platform, value and source support. WebUiConfig.variant accepts the name of any factory provided by the configured Web UI JavaScript file and creates a real CustomUi variant.</Text>
  </View>;
}
