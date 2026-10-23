import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { Text, TextInput } from "../localization";
import type { SourceConfig } from "bitmovin-player";
import { catalog } from "./catalog";
import { Action, ArgumentsEditor, initialValue, styles } from "./InputEditor";
import type { VegaSessionApi } from "./sessionApi";

const operations = catalog.rows.filter((entry) => entry.category === "command" || entry.category === "observation");
let nextArgumentOwner = 0;
export function ApiPanel({ session, source, onRecreate }: { session: VegaSessionApi | null; source: SourceConfig; onRecreate: () => void }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState("PlayerAPI.getDuration");
  const [overload, setOverload] = useState(0);
  const [argumentDraft, setArgumentDraft] = useState<{ key: string; values: unknown[] }>();
  const [result, setResult] = useState("");
  const [code, setCode] = useState("");
  const [availability, setAvailability] = useState("");
  const [, refresh] = useState(0);
  const selected = operations.find((entry) => entry.id === selectedId)!;
  const signatures = catalog.nodes[selected.schema!]!.signatures!;
  const signature = signatures[overload] ?? signatures[0]!;
  const argumentOwner = useMemo(() => ++nextArgumentOwner, [session, source]);
  const argumentKey = argumentOwner + ":" + selected.id + ":" + overload;
  const values = argumentDraft?.key === argumentKey ? argumentDraft.values : selected.id === "PlayerAPI.load" ? [source]
    : signature.parameters.map(parameter => parameter.optional ? undefined : initialValue(catalog, parameter.schema));
  useEffect(() => {
    let active = true;
    const remove = session?.onChange(() => { if (active) refresh((value) => value + 1); });
    setResult(""); setCode(""); setAvailability("");
    return () => { active = false; remove?.(); };
  }, [session]);
  const run = async () => {
    if (!session) return;
    try {
      const pending = session.run(selected, overload, values);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const applied = await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("The SDK call is still pending after 10 seconds. It has not been retried. Recreate the player if it does not settle.")), 10000); })]);
        if (session.isActive()) { setResult(applied.value); setCode(applied.code); }
      } finally { if (timer) clearTimeout(timer); }
    } catch (error) { if (session.isActive()) setResult(error instanceof Error ? error.message : "SDK operation failed."); }
  };
  return <View style={styles.panel}>
    <Action title={expanded ? "Hide SDK API experiments" : "Show SDK API experiments"} onPress={() => setExpanded(!expanded)} />
    {expanded && <>
      <Text style={styles.help}>Enter typed arguments and run a published SDK API. A dispatched call, a constant return or an empty result does not establish that its underlying feature is supported by the Vega integration. Read events and state to check the effect.</Text>
      <Action title="Inspect current SDK API availability" disabled={!session?.isReady()} onPress={() => {
        try { setAvailability(JSON.stringify(session?.availability(), null, 2)); }
        catch { setAvailability("Wait for the current native player before inspecting public APIs."); }
      }} />
      <Text style={styles.help}>Availability checks whether the current public SDK exposes a callable method. It does not execute the method or establish platform feature support. A callable API can still return a constant, do nothing or require additional content and device capabilities.</Text>
      {!!availability && <ScrollView focusable style={{ maxHeight: 240 }}><Text verbatim selectable accessibilityLabel="Vega SDK API availability" accessibilityValue={{ text: availability }} style={styles.codeText}>{availability}</Text></ScrollView>}
      <TextInput accessibilityLabel="Filter Vega API operations" value={filter} onChangeText={setFilter} autoCorrect={false} autoCapitalize="none" style={styles.input} />
      <View style={styles.row}>{operations.filter((entry) => entry.id.toLowerCase().includes(filter.toLowerCase())).slice(0, 12).map((entry) => <Action key={entry.id} title={entry.id} disabled={entry.id === selected.id || Boolean(session?.isBusy())} onPress={() => { setSelectedId(entry.id); setOverload(0); setResult(""); setCode(""); }} />)}</View>
      <Text style={styles.heading}>{selected.id}</Text>
      {signatures.length > 1 && <View style={styles.row}>{signatures.map((_, index) => <Action key={index} title={`Method signature ${index + 1}`} disabled={overload === index} onPress={() => setOverload(index)} />)}</View>}
      {session && <ArgumentsEditor key={argumentKey} catalog={catalog} signature={signature} values={values} onChange={values => setArgumentDraft({ key: argumentKey, values })} resources={session.resources} />}
      {!session?.isReady() && <Text style={styles.help}>No loaded native player is active. A source may still be loading, or the previous session has been released. Recreate the player to start a new owner after destroy.</Text>}
      {selected.id === "PlayerAPI.destroy" && <Text style={styles.help}>This operation starts release of the current SDK player and native media owner. The inactive-session status means this owner no longer accepts calls; it does not report completion of native cleanup. Use Recreate Vega player to start a new owner after the cleanup barrier.</Text>}
      <View style={styles.row}>
        <Action title="Run Vega SDK API" disabled={!session?.isReady() || Boolean(session?.isBusy())} onPress={() => { void run(); }} />
        <Action title="Recreate Vega player" onPress={onRecreate} />
      </View>
      <Text verbatim selectable accessibilityLabel="Vega executed API code" accessibilityValue={{ text: code }} style={styles.codeText}>{code}</Text>
      <Text verbatim selectable accessibilityLabel="Vega API result" accessibilityValue={{ text: result }} style={styles.codeText}>{result}</Text>
      <Text style={styles.heading}>SDK events</Text>
      <Text style={styles.help}>Named PlayerEvent values are registered for the current owner. Recent redacted summaries are bounded and old session callbacks are ignored. PlayerAPI.off needs the same callback instance as on; choose that callback from the current SDK resources.</Text>
      <View style={styles.row}>
        <Action title={session?.isRecording() ? "Pause Vega event log" : "Resume Vega event log"} onPress={() => session?.setRecording(!session.isRecording())} />
        <Action title="Clear Vega event log" onPress={() => session?.clearEvents()} />
      </View>
      <Text verbatim selectable accessibilityLabel="Vega SDK event log" accessibilityValue={{ text: session?.eventLines().slice(0, 12).join("\n") ?? "" }} style={styles.eventText}>{session?.eventLines().slice(0, 12).join("\n")}</Text>
    </>}
  </View>;
}
