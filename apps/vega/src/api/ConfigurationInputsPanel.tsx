import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { Text, TextInput } from "../localization";
import { catalog } from "./catalog";
import { Action, InputEditor, initialValue, styles } from "./InputEditor";
import { ResourcePool } from "./materialize";
import { apiPath } from "./values";
import type { ConfigInput } from "./configInputs";

const entries = catalog.rows.filter((entry) => entry.category === "configuration");
export function ConfigurationInputsPanel({ values, onChange }: { values: ConfigInput[]; onChange: (values: ConfigInput[]) => void }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState("SourceConfig.description");
  const [indices, setIndices] = useState<string[]>([]);
  const [error, setError] = useState("");
  const resources = useMemo(() => new ResourcePool({}), []);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0]!;
  const count = (selected.id.match(/\[\]/g) ?? []).length;
  const positions = Array.from({ length: count }, (_, index) => Number(indices[index] ?? "0"));
  const present = values.find((input) => input.id === selected.id && JSON.stringify(input.indices) === JSON.stringify(positions));
  const update = (value: unknown) => {
    if (positions.some((index) => !Number.isInteger(index) || index < 0 || index > 255)) { setError("Choose array indices from 0 to 255."); return; }
    const nextPath = apiPath(selected.id, positions);
    const retained = values.filter((input) => {
      if (input.id.split(".")[0] !== selected.root) return true;
      const old = apiPath(input.id, input.indices);
      return !(old.length >= nextPath.length && nextPath.every((part, index) => old[index] === part));
    });
    onChange([...retained, { id: selected.id, indices: positions, value }]); setError("");
  };
  return <View style={styles.section}>
    <Action title={expanded ? "Hide all SDK configuration" : "Show all SDK configuration"} onPress={() => setExpanded(!expanded)} />
    {expanded && <>
      <Text style={styles.help}>Select an API and edit its published value type. Set values override the basic form after Apply. Removing an override restores the form or SDK default. Lists, dictionaries, binary data and callbacks have dedicated inputs. Parent object and list forms let you edit required sibling fields together before Apply.</Text>
      <TextInput accessibilityLabel="Filter Vega configuration APIs" value={filter} onChangeText={setFilter} autoCapitalize="none" autoCorrect={false} style={styles.input} />
      <View style={styles.row}>{entries.filter((entry) => entry.id.toLowerCase().includes(filter.toLowerCase())).slice(0, 12).map((entry) => <Action key={entry.id} title={entry.id} disabled={entry.id === selected.id} onPress={() => { setSelectedId(entry.id); setIndices([]); setError(""); }} />)}</View>
      <Text style={styles.heading}>{selected.id}</Text><Text style={styles.text}>{catalog.nodes[selected.schema!]!.label}</Text>
      {Array.from({ length: count }, (_, index) => <TextInput key={index} accessibilityLabel={`Vega API array index ${index}`} value={indices[index] ?? "0"} onChangeText={(value) => { const next = [...indices]; next[index] = value; setIndices(next); }} keyboardType="numeric" style={styles.input} />)}
      {present ? <>
        <InputEditor key={selected.id + JSON.stringify(positions)} catalog={catalog} schema={selected.schema!} value={present.value} onChange={update} resources={resources} />
        <Action title="Remove Vega API override" onPress={() => onChange(values.filter((input) => input !== present))} />
      </> : <Action title="Set Vega API value" onPress={() => update(initialValue(catalog, selected.schema!))} />}
      {!!error && <Text accessibilityRole="alert" style={styles.text}>{error}</Text>}
      <Text style={styles.help}>Configuration is passed to the Vega SDK, which still determines whether its native integration supports the requested feature. Native controls remain available. The SDK's browser HTML UI, browser DOM factories, Cast receivers and device sensors do not become available by setting their options. The native integration uses Fetch for network requests; an XHR requestApi override is rejected before Apply.</Text>
      <Text style={styles.help}>Advanced subtitle arrays replace the single-track form. The current Vega integration does not provide client-side advertising, the browser HTML UI or a browser canvas/WebGL VR renderer. Their declared inputs can be inspected and exported; that does not make these features work on the native media surface. Callbacks requiring real HTML containers cannot be satisfied by a plain object. DRM playback additionally needs compatible content, a license service and device support.</Text>
    </>}
  </View>;
}
