import React, { useEffect, useReducer, useState } from "react";
import { AppState, Button, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import App from "../App";
import { createRuntimeMonitor } from "./runtimeObservation";

/** Opt-in test entry. All player creation, configuration and controls remain owned by App. */
export function RuntimeCheckApp(): React.JSX.Element {
  const [, update] = useReducer((value: number) => value + 1, 0);
  const [monitor] = useState(() => createRuntimeMonitor());
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    const lifecycle = (value: string) => monitor.lifecycle(value === "active" || value === "background" || value === "inactive" ? value : "unknown");
    lifecycle(AppState.currentState);
    const subscription = AppState.addEventListener("change", lifecycle);
    return () => subscription.remove();
  }, [monitor]);
  const report = monitor.report();
  return <SafeAreaProvider><View style={styles.root}>
    <SafeAreaView edges={["top", "left", "right"]}>
    <Text testID="runtime-report" accessibilityLabel={JSON.stringify(report)} style={styles.report}>
      Runtime checks: owner {report.owner?.generation ?? "none"}, time {report.owner?.sample?.time?.toFixed(1) ?? "—"}
    </Text>
    <Button title="Read runtime report" onPress={() => { void monitor.sample().then(update); }} />
    <Button title="Read playback samples" onPress={() => { const pending = monitor.sampleBatch(); update(); void pending.then(update); }} />
    <View style={styles.actions}>
      <Button title="Check copied code" onPress={() => { void monitor.checkClipboard(Clipboard.getStringAsync).then(update); }} />
      <Button title="Finish runtime checks" disabled={!mounted} onPress={() => setMounted(false)} />
    </View>
    </SafeAreaView>
    <View style={styles.app}>{mounted && <App runtimeChecks={monitor} />}</View>
  </View></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, app: { flex: 1 }, report: { fontSize: 11, paddingHorizontal: 8 },
  actions: { flexDirection: "row", justifyContent: "space-between" },
});
