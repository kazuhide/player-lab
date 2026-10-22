import { Platform, StyleSheet } from "react-native";

/** Settings and API panels share the original form's controls and text roles. */
export const panelStyles = StyleSheet.create({
  panel: { gap: 8, borderTopWidth: 1, borderTopColor: "#cccccc", paddingTop: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  field: { gap: 4 },
  input: { borderWidth: 1, borderColor: "#888888", borderRadius: 4, padding: 8, minHeight: 44 },
  heading: { fontWeight: "600" },
  help: { fontSize: 12, color: "#444444" },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12 },
  scriptInput: { minHeight: 120, textAlignVertical: "top" },
  content: { gap: 8 },
  error: { color: "#a00000" },
});
