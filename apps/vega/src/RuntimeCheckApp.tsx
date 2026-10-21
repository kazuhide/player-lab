import React, { useReducer, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { App } from "./App";
import { createRuntimeMonitor } from "./runtimeObservation";

/** Test-only entry around the normal production App, native surface and session barrier. */
export const RuntimeCheckApp: React.FC = () => {
  const [, update] = useReducer((value: number) => value + 1, 0);
  const [monitor] = useState(createRuntimeMonitor);
  const [mounted, setMounted] = useState(true);
  const report = monitor.report();
  return <View style={styles.root}>
    <Text testID="runtime-report" accessibilityLabel={JSON.stringify(report)} style={styles.report}>
      Runtime checks: owner {report.owner?.generation ?? "none"}, time {report.owner?.sample?.time?.toFixed(1) ?? "—"}
    </Text>
    <View style={styles.actions}>
      <Button title="Read runtime report" onPress={() => { monitor.sample(); update(); }} />
      <Button title="Finish runtime checks" disabled={!mounted} onPress={() => setMounted(false)} />
    </View>
    <View style={styles.app}>{mounted && <App runtimeChecks={monitor} />}</View>
  </View>;
};
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" }, app: { flex: 1 },
  report: { fontSize: 14, color: "#ffffff" }, actions: { flexDirection: "row" },
});
