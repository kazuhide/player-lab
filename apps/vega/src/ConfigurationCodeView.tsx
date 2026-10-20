import React, { useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

export function ConfigurationCodeView({ code }: { code: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.container}>
    <Button title={expanded ? "Hide applied code" : "Show applied code"} onPress={() => setExpanded(!expanded)} />
    {expanded && <>
      <Text style={styles.help}>Player and source settings sent to the SDK. Draft edits are excluded and license keys use placeholders.</Text>
      <Text style={styles.help}>This TV host has no clipboard integration.</Text>
      <Text selectable accessibilityLabel="Applied configuration code" style={styles.code}>{code}</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 8 },
  help: { color: "#dddddd" },
  code: { fontFamily: "monospace", fontSize: 12, color: "#dddddd", backgroundColor: "#181818", padding: 8 },
});
