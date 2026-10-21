import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import type { Player, SourceConfig } from "bitmovin-player-react-native";
import { nativeOperations } from "./apiOperations";
import { apiValue } from "./apiValues";

interface Props {
  player: Player;
  source: SourceConfig;
  ready: boolean;
  events: string[];
  recording: boolean;
  onRecording: (enabled: boolean) => void;
  onClearEvents: () => void;
  onRecreate: () => void;
}

/** The selected typed operation is dispatched only by an explicit user action. */
export function ApiPanel({ player, source, ready, events, recording, onRecording, onClearEvents, onRecreate }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(12);
  const operations = useMemo(() => nativeOperations(player, source), [player, source]);
  const [selectedId, setSelectedId] = useState("Player.play");
  const selected = operations.find((operation) => operation.id === selectedId) ?? operations[0]!;
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setBusy(false);
    setResult("");
    setCode("");
    return () => { generation.current += 1; };
  }, [player, source]);
  useEffect(() => {
    setValues(Object.fromEntries(selected.arguments.map((argument) => [argument.name, argument.initial])));
  }, [selected]);

  const run = async () => {
    if (!ready || player.isDestroyed || pending.current) return;
    const current = generation.current;
    pending.current = true;
    setBusy(true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const appliedCode = selected.code(values);
      const value = await Promise.race([
        Promise.resolve(selected.run(values)),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("No response within 10 seconds. The native call may still complete; it has not been retried.")), 10000); }),
      ]);
      if (generation.current === current) { setCode(appliedCode); setResult(apiValue(value)); }
    } catch (error) {
      if (generation.current === current) setResult(error instanceof Error ? error.message : "API call failed.");
    } finally {
      if (timeout) clearTimeout(timeout);
      if (generation.current === current) { pending.current = false; setBusy(false); }
    }
  };
  const matches = operations.filter((operation) => operation.id.toLowerCase().includes(filter.toLowerCase()));
  return <View style={styles.panel}>
    <Button title={expanded ? "Hide API experiments" : "Show API experiments"} onPress={() => setExpanded(!expanded)} />
    {expanded && <>
      <Text>Choose an operation, enter its arguments, then run it. A void result means the wrapper dispatched the call; use events and queries to check its effect. Platform and source requirements still apply.</Text>
      <TextInput accessibilityLabel="Filter API operations" value={filter} onChangeText={(value) => { setFilter(value); setLimit(12); }} autoCorrect={false} autoCapitalize="none" style={styles.input} />
      <View style={styles.row}>{matches.slice(0, limit).map((operation) => <Button key={operation.id} title={operation.id}
        disabled={busy || selected.id === operation.id} onPress={() => { setSelectedId(operation.id); setResult(""); setCode(""); }} />)}</View>
      {matches.length > limit && <Button title="Show more API operations" onPress={() => setLimit(limit + 12)} />}
      <Text style={styles.heading}>{selected.id}</Text>
      {selected.arguments.map((argument) => <View key={argument.name} style={styles.field}>
        <Text>{argument.label}</Text>
        {argument.choices ? <View style={styles.row}>{argument.choices.map((choice) => <Button key={choice} title={choice} disabled={values[argument.name] === choice}
          onPress={() => setValues((current) => ({ ...current, [argument.name]: choice }))} />)}</View>
          : <TextInput accessibilityLabel={argument.label} value={values[argument.name] ?? ""} onChangeText={(value) => setValues((current) => ({ ...current, [argument.name]: value }))}
            autoCorrect={false} autoCapitalize="none" multiline style={styles.input} />}
      </View>)}
      <Button title={busy ? "Waiting for API result" : "Run selected API"} disabled={!ready || busy || player.isDestroyed} onPress={() => { void run(); }} />
      <Button title="Recreate player after API experiments" disabled={busy} onPress={onRecreate} />
      <Text selectable accessibilityLabel="Executed API code" style={styles.mono}>{code}</Text>
      <Text selectable accessibilityLabel="API result" style={styles.mono}>{result}</Text>
      <Text style={styles.heading}>Player events</Text>
      <Text>Named public events are connected. The log retains recent payload summaries and redacts credential fields. Receiving an event requires its matching feature or source.</Text>
      <View style={styles.row}>
        <Button title={recording ? "Pause event log" : "Resume event log"} onPress={() => onRecording(!recording)} />
        <Button title="Clear API event log" onPress={onClearEvents} />
      </View>
      <Text selectable accessibilityLabel="API event log" style={styles.mono}>{events.slice(0, 12).join("\n")}</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 8, borderTopWidth: 1, borderTopColor: "#cccccc", paddingTop: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  field: { gap: 4 },
  input: { borderWidth: 1, borderColor: "#888888", borderRadius: 4, padding: 8, minHeight: 44 },
  heading: { fontWeight: "600" },
  mono: { fontFamily: "monospace", fontSize: 12 },
});
