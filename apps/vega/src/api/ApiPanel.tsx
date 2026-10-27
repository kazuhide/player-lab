import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { Text, TextInput } from "../localization";
import type { SourceConfig } from "bitmovin-player";
import { catalog } from "./catalog";
import { Action, ArgumentsEditor, initialValue, styles } from "./InputEditor";
import type { VegaSessionApi } from "./sessionApi";
import { findApiEntries } from "../../../../shared/apiDiscovery";

const operations = catalog.rows.filter((entry) => entry.category === "command" || entry.category === "observation");
let nextArgumentOwner = 0;
export function ApiPanel({ session, source, onRecreate }: { session: VegaSessionApi | null; source: SourceConfig; onRecreate: () => void }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const matches = useMemo(() => findApiEntries(operations, filter), [filter]);
  const pageCount = Math.max(1, Math.ceil(matches.length / 12));
  const [selectedId, setSelectedId] = useState("PlayerAPI.getDuration");
  const [overload, setOverload] = useState(0);
  const [argumentDraft, setArgumentDraft] = useState<{ key: string; values: unknown[] }>();
  const [result, setResult] = useState("");
  const [code, setCode] = useState("");
  const [failed, setFailed] = useState(false);
  const [availability, setAvailability] = useState("");
  const [, refresh] = useState(0);
  const selected = operations.find((entry) => entry.id === selectedId)!;
  const signatures = catalog.nodes[selected.schema!]!.signatures!;
  const signature = signatures[overload] ?? signatures[0]!;
  const argumentOwner = useMemo(() => ++nextArgumentOwner, [session, source]);
  const argumentKey = argumentOwner + ":" + selected.id + ":" + overload;
  const values = argumentDraft?.key === argumentKey ? argumentDraft.values : selected.id === "PlayerAPI.load" ? [source]
    : signature.parameters.map(parameter => parameter.optional ? undefined : initialValue(catalog, parameter.schema));
  const selectedAvailability = session?.operationAvailability(selected, values);
  useEffect(() => {
    let active = true;
    const remove = session?.onChange(() => { if (active) refresh((value) => value + 1); });
    setResult(""); setCode(""); setAvailability(""); setFailed(false);
    return () => { active = false; remove?.(); };
  }, [session]);
  const run = async () => {
    if (!session) return;
    setFailed(false);
    try {
      const pending = session.run(selected, overload, values);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const applied = await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("The SDK call is still pending after 10 seconds. It has not been retried. Recreate the player if it does not settle.")), 10000); })]);
        if (session.isActive()) { setResult(applied.value); setCode(applied.code); }
      } finally { if (timer) clearTimeout(timer); }
    } catch (error) { if (session.isActive()) { setResult(error instanceof Error ? error.message : "SDK operation failed."); setFailed(true); } }
  };
  return <View style={styles.panel}>
    <Action title={expanded ? "Hide SDK API experiments" : "Show SDK API experiments"} onPress={() => setExpanded(!expanded)} />
    {expanded && <>
      <Text style={styles.heading}>API operation</Text>
      <TextInput accessibilityLabel="Filter Vega API operations" placeholder="Find an API" placeholderTextColor="#9aacc2" value={filter} onChangeText={value => { setFilter(value); setPage(0); }} autoCorrect={false} autoCapitalize="none" style={styles.input} />
      <View style={styles.row}>
        <Action title="Previous results" disabled={pageCount === 1} onPress={() => setPage((page + pageCount - 1) % pageCount)} />
        <Text verbatim style={styles.badge}>{matches.length ? `${page * 12 + 1}–${Math.min((page + 1) * 12, matches.length)} / ${matches.length}` : "0 / 0"}</Text>
        <Action title="Next results" disabled={pageCount === 1} onPress={() => setPage((page + 1) % pageCount)} />
      </View>
      {!matches.length && <Text style={styles.help}>No matching items.</Text>}
      <View style={styles.row}>{matches.slice(page * 12, (page + 1) * 12).map((entry) => {
        const available = session?.operationAvailability(entry);
        return <View key={entry.id}>
          <Action verbatim title={entry.id} disabled={entry.id === selected.id || !available?.callable} onPress={() => { setSelectedId(entry.id); setOverload(0); setResult(""); setCode(""); setFailed(false); }} />
          {available?.reason && <Text style={styles.help}>{available.reason}</Text>}
        </View>;
      })}</View>
      <Text verbatim style={styles.heading}>{selected.id}</Text>
      {signatures.length > 1 && <View style={styles.row}>{signatures.map((_, index) => <Action key={index} title={`Method signature ${index + 1}`} disabled={overload === index} onPress={() => setOverload(index)} />)}</View>}
      {session && <ArgumentsEditor key={argumentKey} catalog={catalog} signature={signature} values={values} onChange={values => setArgumentDraft({ key: argumentKey, values })} resources={session.resources} />}
      <Text style={styles.badge}>{session?.isBusy() ? "Waiting for API result" : session?.isReady() ? "Player ready" : "Player unavailable"}</Text>
      {!session?.isReady() && <Text style={styles.help}>The player is loading or inactive. Recreate after destroy.</Text>}
      {selectedAvailability?.reason && <Text accessibilityLabel="Vega API unavailable reason" style={styles.warning}>{selectedAvailability.reason}</Text>}
      {selected.id === "PlayerAPI.destroy" && <Text style={styles.warning}>Starts releasing this player. Use Recreate Vega player to start again.</Text>}
      <View style={styles.row}>
        <Action title="Run Vega SDK API" disabled={!selectedAvailability?.callable} onPress={() => { void run(); }} />
        <Action title="Recreate Vega player" onPress={onRecreate} />
      </View>
      {!!code && !failed && <Text style={styles.label}>Executed call</Text>}
      <Text verbatim selectable accessibilityLabel="Vega executed API code" accessibilityValue={{ text: failed ? "" : code }} style={code && !failed ? styles.codeText : undefined}>{failed ? "" : code}</Text>
      {!!result && <Text style={styles.label}>{failed ? "API error" : "Result"}</Text>}
      <Text verbatim selectable accessibilityLabel="Vega API result" accessibilityValue={{ text: result }} accessibilityRole={failed ? "alert" : "text"} style={[result ? styles.codeText : undefined, failed && styles.error]}>{result}</Text>
      <Text style={styles.heading}>SDK events</Text>
      <Text style={styles.badge}>{session?.isRecording() ? "Recording" : "Paused"}</Text>
      <View style={styles.row}>
        <Action title={session?.isRecording() ? "Pause Vega event log" : "Resume Vega event log"} onPress={() => session?.setRecording(!session.isRecording())} />
        <Action title="Clear Vega event log" onPress={() => session?.clearEvents()} />
      </View>
      <Text verbatim selectable accessibilityLabel="Vega SDK event log" accessibilityValue={{ text: session?.eventLines().slice(0, 12).join("\n") ?? "" }} style={styles.eventText}>{session?.eventLines().slice(0, 12).join("\n")}</Text>
      <Text style={styles.heading}>SDK availability</Text>
      <Action title="Inspect current SDK API availability" disabled={!session?.isReady()} onPress={() => {
        try { setAvailability(JSON.stringify(session?.availability(), null, 2)); }
        catch { setAvailability("Wait for the current native player before inspecting public APIs."); }
      }} />
      <Text style={styles.help}>Uses current SDK, source and feature state. Checked again before dispatch.</Text>
      {!!availability && <ScrollView focusable style={{ maxHeight: 240 }}><Text verbatim selectable accessibilityLabel="Vega SDK API availability" accessibilityValue={{ text: availability }} style={styles.codeText}>{availability}</Text></ScrollView>}
    </>}
  </View>;
}
