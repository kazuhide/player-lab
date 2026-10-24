import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Text } from "./localization";
import * as Clipboard from "expo-clipboard";
import { panelStyles } from "./panelStyles";

export function ConfigurationCodeView({ code, initiallyExpanded = false }: { code: string; initiallyExpanded?: boolean }): React.JSX.Element {
  const [expanded, setExpanded] = useState(initiallyExpanded);
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
      <Text style={panelStyles.help}>Player, source and UI settings sent to the SDK. Draft edits are excluded and license keys use placeholders.</Text>
      <Button title="Copy code" onPress={() => {
        const ownRequest = ++request.current;
        setStatus(undefined);
        const update = (text: string): void => {
          if (mounted.current && request.current === ownRequest) setStatus({ code, text });
        };
        void Clipboard.setStringAsync(code).then(() => update("Copied.")).catch(() => update("Copy is unavailable. Select the code to copy it."));
      }} />
      {status?.code === code && <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={panelStyles.help}>{status.text}</Text>}
      <Text accessibilityLabel="Applied configuration code" selectable verbatim style={styles.code}>{code}</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 8 },
  code: { ...panelStyles.input, ...panelStyles.mono, minHeight: 180, color: "#111111" },
});
