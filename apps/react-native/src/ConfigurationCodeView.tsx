import React, { useEffect, useRef, useState } from "react";
import { Button, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";

export function ConfigurationCodeView({ code }: { code: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<{ code: string; text: string }>();
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current++; };
  }, []);
  return <View style={styles.container}>
    <Button title={expanded ? "Hide applied code" : "Show applied code"} onPress={() => { setExpanded(!expanded); setStatus(undefined); request.current++; }} />
    {expanded && <>
      <Text>Player, source and UI settings sent to the SDK. Draft edits are excluded and license keys use placeholders.</Text>
      <Button title="Copy code" onPress={() => {
        const ownRequest = ++request.current;
        setStatus(undefined);
        const update = (text: string): void => {
          if (mounted.current && request.current === ownRequest) setStatus({ code, text });
        };
        void Clipboard.setStringAsync(code).then(() => update("Copied.")).catch(() => update("Copy is unavailable. Select the code to copy it."));
      }} />
      <TextInput accessibilityLabel="Applied configuration code" value={code} editable={false}
        multiline selectTextOnFocus autoCorrect={false} style={styles.code} />
      {status?.code === code && <Text accessibilityRole="text" accessibilityLiveRegion="polite">{status.text}</Text>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 8 },
  code: { minHeight: 180, maxHeight: 360, borderWidth: 1, borderColor: "#888888", padding: 8,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, textAlignVertical: "top", color: "#111111" },
});
