import React, { useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

export function ConfigurationCodeView({ code }: { code: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const lines = code.split("\n");
  return <View style={styles.container}>
    <Button title={expanded ? "Hide applied code" : "Show applied code"} onPress={() => setExpanded(!expanded)} />
    {expanded && <>
      <Text style={styles.help}>Player and source settings sent to the SDK. Draft edits are excluded and license keys use placeholders.</Text>
      <Text style={styles.help}>This TV host has no clipboard integration.</Text>
      <View accessibilityLabel="Applied configuration code" style={styles.code}>
        {lines.map((line, index) => <View key={index} focusable accessible
          testID={`applied-code-line-${index}${index === lines.length - 1 ? "-last" : ""}`}
          accessibilityLabel={line || "Blank code line"}>
          <Text selectable style={styles.line}>{line || "\u00a0"}</Text>
        </View>)}
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 8 },
  help: { color: "#dddddd" },
  code: { backgroundColor: "#181818", padding: 8 },
  line: { fontFamily: "monospace", fontSize: 12, color: "#dddddd" },
});
