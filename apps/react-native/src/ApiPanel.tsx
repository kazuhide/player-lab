import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import type { Player, SourceConfig } from "bitmovin-player-react-native";
import { nativeOperations } from "./apiOperations";
import { apiValue } from "./apiValues";
import { AuxiliaryOperations } from "./auxiliaryOperations";
import type { NativeSettings } from "./nativeSettings";
import { MetadataInput } from "./metadataInput";
import { panelStyles as styles } from "./panelStyles";

interface Props {
  player: Player;
  source: SourceConfig;
  ready: boolean;
  events: string[];
  recording: boolean;
  onRecording: (enabled: boolean) => void;
  onClearEvents: () => void;
  onRecreate: () => void;
  onSourceMutation: () => void;
  settings: NativeSettings;
  onEvent: (name: string, value: unknown) => void;
}

/** The selected typed operation is dispatched only by an explicit user action. */
export function ApiPanel({ player, source, ready, events, recording, onRecording, onClearEvents, onRecreate, onSourceMutation, settings, onEvent }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(12);
  const currentSettings = useRef(settings);
  currentSettings.current = settings;
  const auxiliary = useMemo(() => new AuxiliaryOperations(player, () => currentSettings.current, onEvent), [player, onEvent]);
  useEffect(() => () => auxiliary.dispose(), [auxiliary]);
  const operations = useMemo(() => [...nativeOperations(player, source), ...auxiliary.operations()].sort((left, right) => left.id.localeCompare(right.id)), [player, source, auxiliary]);
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
  }, [player, source, auxiliary]);
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
      if (["Player.load", "Player.loadSource", "Player.loadOfflineContent", "Player.unload", "Player.destroy", "Source.destroy"].includes(selected.id)) { onSourceMutation(); }
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
      <Text style={styles.help}>Choose an operation, enter its arguments, then run it. A void result means the wrapper dispatched the call; use events and queries to check its effect. Platform and source requirements still apply.</Text>
      <Text style={styles.help}>Offline inputs are edited under Additional SDK configuration. Initialize the offline manager, get options, then download; completion is an event. Delete and cancel affect only the chosen content identifier. The generated host includes the Google Cast SDK. SDK 1.29's deprecated initialize method does not apply edited options. Edit the receiver and namespace under Cast startup settings, select Save Cast options for next launch, then fully close and reopen the app. Use Read native Cast startup state to check the applied startup values and native initialization.</Text>
      <Text style={styles.help}>Offline addListener replaces the app's current offline listener. Select its named callbacks and optionally edit a JavaScript body using event, name and lab.getPlayer()/getSource(). A nonempty body requires explicit execution permission; it runs inside this app on future matching SDK events.</Text>
      <TextInput accessibilityLabel="Filter API operations" value={filter} onChangeText={(value) => { setFilter(value); setLimit(12); }} autoCorrect={false} autoCapitalize="none" style={styles.input} />
      <View style={styles.row}>{matches.slice(0, limit).map((operation) => <Button key={operation.id} title={operation.id}
        disabled={busy || selected.id === operation.id} onPress={() => { setSelectedId(operation.id); setResult(""); setCode(""); }} />)}</View>
      {matches.length > limit && <Button title="Show more API operations" onPress={() => setLimit(limit + 12)} />}
      <Text style={[styles.heading, styles.mono]}>{selected.id}</Text>
      {selected.arguments.map((argument) => <View key={argument.name} style={styles.field}>
        <Text>{argument.label}</Text>
        {argument.editor === "metadata" ? <MetadataInput key={selected.id + argument.name} value={values[argument.name] ?? argument.initial} onChange={(value) => setValues((current) => ({ ...current, [argument.name]: value }))} /> : argument.choices ? <View style={styles.row}>{argument.choices.map((choice) => <Button key={choice} title={choice} disabled={values[argument.name] === choice}
          onPress={() => setValues((current) => ({ ...current, [argument.name]: choice }))} />)}</View>
          : <TextInput accessibilityLabel={argument.label} value={values[argument.name] ?? ""} onChangeText={(value) => setValues((current) => ({ ...current, [argument.name]: value }))}
            autoCorrect={false} autoCapitalize="none" multiline style={styles.input} />}
      </View>)}
      <Button title={busy ? "Waiting for API result" : "Run selected API"} disabled={!ready || busy || player.isDestroyed} onPress={() => { void run(); }} />
      <Button title="Recreate player after API experiments" disabled={busy} onPress={onRecreate} />
      <Text selectable accessibilityLabel="Executed API code" accessibilityValue={{ text: code }} style={styles.mono}>{code}</Text>
      <Text selectable accessibilityLabel="API result" accessibilityValue={{ text: result }} style={styles.mono}>{result}</Text>
      <Text style={styles.heading}>Player events</Text>
      <Text style={styles.help}>Named public events are connected. The log retains recent payload summaries and redacts credential fields. Receiving an event requires its matching feature or source.</Text>
      <View style={styles.row}>
        <Button title={recording ? "Pause event log" : "Resume event log"} onPress={() => onRecording(!recording)} />
        <Button title="Clear API event log" onPress={onClearEvents} />
      </View>
      <Text selectable accessibilityLabel="API event log" accessibilityValue={{ text: events.slice(0, 12).join("\n") }} style={styles.mono}>{events.slice(0, 12).join("\n")}</Text>
    </>}
  </View>;
}
