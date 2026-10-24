import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Text, translateCopy, useLocale } from "./localization";

export function ConfigurationCodeView({ code }: { code: string }): React.JSX.Element {
  const { language } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const lines = code.split("\n");
  return <View style={styles.container}>
    <Button title={expanded ? "Hide applied code" : "Show applied code"} onPress={() => setExpanded(!expanded)} />
    {expanded && <>
      <Text style={styles.badge}>Applied values</Text>
      <View accessibilityLabel={translateCopy("Applied configuration code", language)} style={styles.code}>
        {lines.map((line, index) => <View key={index} focusable accessible
          testID={`applied-code-line-${index}${index === lines.length - 1 ? "-last" : ""}`}
          accessibilityLabel={line || translateCopy("Blank code line", language)}>
          <Text verbatim selectable style={styles.line}>{line || "\u00a0"}</Text>
        </View>)}
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 12, marginTop: 8 },
  badge: { alignSelf: "flex-start", color: "#d5e2f2", backgroundColor: "#29374a", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, fontSize: 16 },
  code: { backgroundColor: "#161f2c", padding: 12, borderRadius: 8 },
  line: { fontFamily: "monospace", fontSize: 14, lineHeight: 20, color: "#d5e2f2" },
});
