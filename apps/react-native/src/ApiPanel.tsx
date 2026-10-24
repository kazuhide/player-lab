import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Keyboard, ScrollView, View } from "react-native";
import { Button, Text, TextInput } from "./localization";
import type { Player, SourceConfig } from "bitmovin-player-react-native";
import { nativeOperations } from "./apiOperations";
import { apiValue } from "./apiValues";
import { AuxiliaryOperations } from "./auxiliaryOperations";
import type { NativeSettings } from "./nativeSettings";
import { MetadataInput } from "./metadataInput";
import { panelStyles as styles } from "./panelStyles";
import { WorkspaceAction, WorkspaceChoice, WorkspacePage } from "./Workspace";

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
  compactEditing?: boolean;
}

/** The selected typed operation is dispatched only by an explicit user action. */
export function ApiPanel({ player, source, ready, events, recording, onRecording, onClearEvents, onRecreate, onSourceMutation, settings, onEvent, compactEditing = false }: Props): React.JSX.Element {
  const [page, setPage] = useState("operations");
  const currentSettings = useRef(settings);
  currentSettings.current = settings;
  const auxiliary = useMemo(() => new AuxiliaryOperations(player, () => currentSettings.current, onEvent), [player, onEvent]);
  useEffect(() => () => auxiliary.dispose(), [auxiliary]);
  const operations = useMemo(() => [...nativeOperations(player, source), ...auxiliary.operations()].sort((left, right) => left.id.localeCompare(right.id)), [player, source, auxiliary]);
  const [selectedId, setSelectedId] = useState("Player.play");
  const selected = operations.find((operation) => operation.id === selectedId) ?? operations[0]!;
  const editor = useRef<ScrollView>(null);
  useLayoutEffect(() => { editor.current?.scrollTo({ y: 0, animated: false }); }, [page, selected]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState("");
  const [code, setCode] = useState("");
  const [executedId, setExecutedId] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setBusy(false);
    setResult("");
    setCode("");
    setExecutedId("");
    setFailed(false);
    return () => { generation.current += 1; };
  }, [player, source, auxiliary]);
  useEffect(() => {
    setValues(Object.fromEntries(selected.arguments.map((argument) => [argument.name, argument.initial])));
  }, [selected]);

  const run = async () => {
    if (!ready || player.isDestroyed || pending.current || (page === "state" && !isQuery(selected.id))) return;
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
      if (generation.current === current) { setCode(appliedCode); setResult(apiValue(value)); setExecutedId(selected.id); setFailed(false); }
    } catch (error) {
      if (generation.current === current) { setResult(error instanceof Error ? error.message : "API call failed."); setExecutedId(selected.id); setFailed(true); }
    } finally {
      if (timeout) clearTimeout(timeout);
      if (generation.current === current) { pending.current = false; setBusy(false); }
    }
  };
  const targets = page === "state" ? operations.filter(operation => isQuery(operation.id)) : operations;
  const validTarget = targets.some(operation => operation.id === selected.id);
  return <View style={{ flex: 1, minHeight: 0 }}>
    {!compactEditing && <View style={{ padding: 10, gap: 8 }}>
      <WorkspaceChoice label="API view" selected={page} options={[
        { id: "operations", label: "Operations" }, { id: "state", label: "State" },
        { id: "events", label: "Events" }, { id: "help", label: "API help" },
      ]} onSelect={value => {
        if (value === page) editor.current?.scrollTo({ y: 0, animated: false });
        setPage(value);
      }} testID="api-view-selector" />
      {(page === "operations" || page === "state") && <WorkspaceChoice label="API operation" selected={selected.id}
        options={targets.map(operation => ({ id: operation.id, label: operation.id }))} testID="api-operation-selector"
        onSelect={id => {
          if (id === selectedId) editor.current?.scrollTo({ y: 0, animated: false });
          setSelectedId(id); setResult(""); setCode(""); setExecutedId(""); setFailed(false);
        }} />}
    </View>}
    <ScrollView ref={editor} testID="api-fields-scroll" style={{ flex: 1 }} contentContainerStyle={{ padding: compactEditing ? 8 : 12, gap: compactEditing ? 4 : 10 }} keyboardShouldPersistTaps="handled">
      <WorkspacePage active={page === "help"}>
      <Text style={styles.help}>Use State or Events to check a command's effect.</Text>
      <Text style={styles.warning}>Recreate reloads applied settings and clears the current position.</Text>
      <Button title="Recreate player after API experiments" disabled={busy} onPress={onRecreate} />
      </WorkspacePage>
      <WorkspacePage active={page === "operations" || page === "state"}>
      {!validTarget && <Text style={styles.help}>Choose a state query before reading the SDK.</Text>}
      {compactEditing && <Text verbatim style={[styles.heading, styles.mono]}>{selected.id}</Text>}
      {selected.id === "OfflineContentManager.addListener" && <Text style={styles.warning}>Replaces the current offline listener. Edited JavaScript runs on future SDK events inside this app without a sandbox. Allow execution before Run.</Text>}
      {["OfflineContentManager.deleteAll", "OfflineContentManager.cancelDownload", "OfflineContentManager.releaseLicense"].includes(selected.id) && <View style={{ gap: 4 }}>
        <Text style={styles.warning}>{selected.id === "OfflineContentManager.deleteAll" ? "Deletes offline data for this content identifier."
          : selected.id === "OfflineContentManager.cancelDownload" ? "Cancels the download for this content identifier." : "Releases the offline license for this content identifier."}</Text>
        <Text verbatim style={styles.mono}>{settings.offline.identifier}</Text>
      </View>}
      {selected.id === "Player.destroy" && <Text style={styles.warning}>Destroys this player. Recreate to use it again.</Text>}
      {selected.id === "Source.destroy" && <Text style={styles.warning}>Releases the current source. Recreate to reload applied settings.</Text>}
      {selected.arguments.map((argument) => <View key={argument.name} style={styles.field}>
        <Text>{argument.label}</Text>
        {argument.editor === "metadata" ? <MetadataInput key={selected.id + argument.name} value={values[argument.name] ?? argument.initial} onChange={(value) => setValues((current) => ({ ...current, [argument.name]: value }))} /> : argument.choices ? <View style={styles.row}>{argument.choices.map((choice) => <Button key={choice} title={choice} disabled={values[argument.name] === choice}
          onPress={() => setValues((current) => ({ ...current, [argument.name]: choice }))} />)}</View>
          : <TextInput accessibilityLabel={argument.label} value={values[argument.name] ?? ""} onChangeText={(value) => setValues((current) => ({ ...current, [argument.name]: value }))}
            autoCorrect={false} autoCapitalize="none" multiline style={styles.input} />}
      </View>)}
      {!!code && !failed && <Text style={styles.label}>Executed call</Text>}
      <Text verbatim selectable accessibilityLabel="Executed API code" accessibilityValue={{ text: failed ? "" : code }} style={[styles.mono, !!code && !failed && styles.result]}>{failed ? "" : code}</Text>
      {!!executedId && <Text style={styles.label}>{failed ? "API error" : "Result"}</Text>}
      {!!executedId && <Text verbatim testID="api-result-origin" style={styles.mono}>{executedId}</Text>}
      <Text verbatim selectable accessibilityLabel="API result" accessibilityValue={{ text: result }} accessibilityRole={failed ? "alert" : "text"} style={[styles.mono, !!executedId && styles.result, failed && styles.error]}>{result}</Text>
      </WorkspacePage>
      <WorkspacePage active={page === "events"}>
      <Text style={styles.heading}>Player events</Text>
      <Text style={styles.badge}>{recording ? "Recording" : "Paused"}</Text>
      <View style={styles.row}>
        <Button title={recording ? "Pause event log" : "Resume event log"} onPress={() => onRecording(!recording)} />
        <Button title="Clear API event log" onPress={onClearEvents} />
      </View>
      {!events.length && <Text style={styles.help}>No events yet.</Text>}
      <Text verbatim selectable accessibilityLabel="API event log" accessibilityValue={{ text: events.slice(0, 12).join("\n") }} style={styles.mono}>{events.slice(0, 12).join("\n")}</Text>
      </WorkspacePage>
    </ScrollView>
    {(page === "operations" || page === "state") && <View style={{ padding: compactEditing ? 8 : 12, gap: 6, backgroundColor: "#edf3fb", borderTopWidth: 1, borderColor: "#d6deeb" }}>
      {!compactEditing && <Text verbatim style={styles.mono}>{selected.id}</Text>}
      <View style={{ flexDirection: "row", gap: 8 }}>
      {compactEditing && <WorkspaceAction title="Done" testID="api-done" onPress={() => Keyboard.dismiss()} />}
      <View style={{ flex: 1 }}>
      <WorkspaceAction title={busy ? "Waiting for API result" : page === "state" ? "Read state" : "Run selected API"}
        testID="api-run" primary disabled={!ready || busy || player.isDestroyed || !validTarget} onPress={() => { void run(); }} />
      </View>
      </View>
    </View>}
  </View>;
}

/** Queries are also kept in the complete Operations list; this view is a convenience filter. */
function isQuery(id: string): boolean { return /\.(get|is|has|read|query|list)[A-Z_.]/.test(id); }
