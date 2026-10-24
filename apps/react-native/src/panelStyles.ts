import { Platform, StyleSheet } from "react-native";

/** Settings and API panels share the original form's controls and text roles. */
export const panelStyles = StyleSheet.create({
  panel: { gap: 10, borderTopWidth: 1, borderTopColor: "#d6deeb", paddingTop: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  field: { gap: 6 },
  input: { borderWidth: 1, borderColor: "#7b899b", borderRadius: 8, padding: 10, minHeight: 48, backgroundColor: "#ffffff", color: "#182c45", fontSize: 15 },
  heading: { fontWeight: "600", fontSize: 16, color: "#182c45" },
  label: { fontWeight: "600", fontSize: 12, color: "#445469" },
  help: { fontSize: 12, lineHeight: 18, color: "#445469" },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13, lineHeight: 19, color: "#182c45" },
  badge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#e0eaf7", color: "#32455c", fontSize: 12, fontWeight: "600" },
  result: { gap: 4, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "#d6deeb", backgroundColor: "#ffffff" },
  warning: { fontSize: 12, lineHeight: 18, color: "#714314", backgroundColor: "#fff1d6", borderRadius: 8, padding: 8 },
  scriptInput: { minHeight: 120, textAlignVertical: "top" },
  content: { gap: 8 },
  error: { color: "#a00000", fontSize: 13, lineHeight: 19 },
});
