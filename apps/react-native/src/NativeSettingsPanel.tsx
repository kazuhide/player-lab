import React, { useState } from "react";
import { View } from "react-native";
import { Button, Text, TextInput } from "./localization";
import { NATIVE_SETTING_FIELDS, type SettingValues } from "./nativeSettings";
import { panelStyles as styles } from "./panelStyles";
import { WorkspaceChoice } from "./Workspace";

/** Search keeps the native form small even when the SDK adds many fields. */
export function NativeSettingsPanel({ values, onChange, scope }: { values: SettingValues; onChange: (values: SettingValues) => void; scope?: "ui" }): React.JSX.Element {
  const fields = scope === "ui" ? NATIVE_SETTING_FIELDS.filter(field => /^(PlayerView|WebUi|PlayerConfig\.styleConfig)/.test(field.id)) : NATIVE_SETTING_FIELDS;
  const [selectedId, setSelectedId] = useState(() => scope === "ui" ? fields[0]!.id : "SourceConfig.description");
  const selected = fields.find((field) => field.id === selectedId) ?? fields[0]!;
  const enabled = Object.prototype.hasOwnProperty.call(values, selected.id);
  const update = (raw: string) => onChange({ ...values, [selected.id]: raw });
  const remove = () => { const next = { ...values }; delete next[selected.id]; onChange(next); };
  return <View style={styles.panel}>
    <WorkspaceChoice label="Configuration API" selected={selected.id} options={fields.map(field => ({ id: field.id, label: field.id }))}
      onSelect={setSelectedId} testID={scope === "ui" ? "ui-setting-selector" : "sdk-setting-selector"} />
    <View style={styles.row}>
      <Text style={styles.label}>Input type</Text><Text verbatim style={styles.mono}>{selected.kind}</Text>
      <Text style={styles.badge}>{enabled ? "Override set" : "No override"}</Text>
    </View>
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
    {selected.id.endsWith(".nativeId") && <Text style={styles.warning}>Reuses the native instance with this ID.</Text>}
  </View>;
}
