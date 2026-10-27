import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Pressable, Text, TextInput, translateCopy, useLocale } from "./localization";

export type WorkspaceTab = "settings" | "apis" | "code" | "more";
const ChoiceContext = createContext({ presented: false, change: (_owner: symbol, _presented: boolean) => {} });

/** A picker owns its overlay so a keyboard event cannot remove its presenting editor. */
export function WorkspaceProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [owners, setOwners] = useState<ReadonlySet<symbol>>(() => new Set());
  const change = useCallback((owner: symbol, presented: boolean) => setOwners(current => {
    if (current.has(owner) === presented) return current;
    const next = new Set(current);
    if (presented) next.add(owner); else next.delete(owner);
    return next;
  }), []);
  return <ChoiceContext.Provider value={{ presented: owners.size > 0, change }}>{children}</ChoiceContext.Provider>;
}
export const useChoicePresented = () => useContext(ChoiceContext).presented;
const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "settings", label: "Settings" }, { id: "apis", label: "APIs" },
  { id: "code", label: "Code" }, { id: "more", label: "More" },
];

export function WorkspaceAction({ title, onPress, disabled = false, testID, primary = false }: {
  title: string; onPress: () => void; disabled?: boolean; testID?: string; primary?: boolean;
}): React.JSX.Element {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled }} disabled={disabled} onPress={() => { Keyboard.dismiss(); onPress(); }}
    style={[styles.action, primary && styles.primary, disabled && styles.disabled]}>
    <Text maxFontSizeMultiplier={1.5} style={[styles.actionText, primary && styles.primaryText]}>{title}</Text>
  </Pressable>;
}

export function WorkspaceNavigation({ selected, onSelect }: { selected: WorkspaceTab; onSelect: (tab: WorkspaceTab) => void }): React.JSX.Element {
  return <View style={styles.navigation} accessibilityRole="tablist">
    {TABS.map(tab => <Pressable key={tab.id} testID={`workspace-nav-${tab.id}`} accessibilityRole="tab"
      accessibilityLabel={tab.label} accessibilityState={{ selected: selected === tab.id }}
      onPress={() => { Keyboard.dismiss(); onSelect(tab.id); }} style={[styles.tab, selected === tab.id && styles.selectedTab]}>
      <Text maxFontSizeMultiplier={1.3} style={[styles.tabText, selected === tab.id && styles.selectedText]}>{tab.label}</Text>
    </Pressable>)}
  </View>;
}

/** Hiding a page preserves its draft and selection without exposing inactive controls. */
export function WorkspacePage({ active, children, testID }: { active: boolean; children: React.ReactNode; testID?: string }): React.JSX.Element {
  return <View testID={testID} style={[styles.page, !active && styles.hidden]}
    pointerEvents={active ? "auto" : "none"} accessibilityElementsHidden={!active}
    importantForAccessibility={active ? "auto" : "no-hide-descendants"}>{children}</View>;
}

export function WorkspaceChoice({ label, selected, options, onSelect, testID }: {
  label: string; selected: string; options: ReadonlyArray<{ id: string; label: string; unavailable?: string | undefined }>;
  onSelect: (id: string) => void; testID: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const owner = useRef(Symbol("workspace-choice")).current;
  const { change } = useContext(ChoiceContext);
  useEffect(() => () => change(owner, false), [change, owner]);
  const { language } = useLocale();
  const compact = useWindowDimensions().height < 500;
  const current = options.find(option => option.id === selected);
  const query = filter.toLocaleLowerCase();
  const matches = options.filter(option => `${option.id} ${option.label} ${translateCopy(option.label, language)}`.toLocaleLowerCase().includes(query));
  const exactMatch = (option: { id: string; label: string }) =>
    [option.id, option.label, translateCopy(option.label, language)].some(value => {
      const normalized = value.toLocaleLowerCase();
      return normalized === query || normalized.slice(normalized.lastIndexOf(".") + 1) === query;
    });
  // A method such as play should precede unrelated matches on the Player namespace.
  if (query) matches.sort((left, right) => Number(exactMatch(right)) - Number(exactMatch(left)));
  const close = () => { Keyboard.dismiss(); setOpen(false); change(owner, false); };
  return <View style={styles.choice}>
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
      accessibilityValue={{ text: translateCopy(current?.label ?? selected, language) }}
      onPress={() => { Keyboard.dismiss(); setFilter(""); setOpen(true); change(owner, true); }} style={styles.choiceButton}>
      <Text maxFontSizeMultiplier={1.3} style={styles.choiceLabel}>{label}</Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.choiceValue}>{current?.label ?? selected}</Text>
    </Pressable>
    {open && <Modal transparent visible onRequestClose={close} animationType="fade" supportedOrientations={["portrait", "landscape"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.scrim, compact && styles.compactScrim]}>
        <View style={styles.dialog} accessibilityViewIsModal accessibilityLabel={label}>
          {!compact && <Text style={styles.dialogTitle}>{label}</Text>}
          <View style={compact && styles.searchRow}>
          <TextInput accessibilityLabel={`Find ${label}`} placeholder="Find an item"
            value={filter} onChangeText={setFilter} autoCapitalize="none" autoCorrect={false} style={[styles.search, compact && styles.searchFlex]} />
          {compact && <WorkspaceAction title="Close" onPress={close} />}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.options}>
            {matches.map(option => <Pressable key={option.id} testID={`${testID}-option-${option.id}`}
              accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{ selected: selected === option.id, disabled: Boolean(option.unavailable) }}
              disabled={Boolean(option.unavailable)} accessibilityHint={option.unavailable ? translateCopy(option.unavailable, language) : undefined}
              onPress={() => { if (!option.unavailable) { onSelect(option.id); close(); } }} style={[styles.option, selected === option.id && styles.selectedTab, option.unavailable && styles.disabled]}>
              <View style={{ flex: 1 }}><Text style={styles.optionText}>{option.label}</Text>
              {option.unavailable && <Text style={styles.choiceLabel}>{option.unavailable}</Text>}</View>
              {selected === option.id && <Text accessibilityElementsHidden>✓</Text>}
            </Pressable>)}
            {!matches.length && <Text style={styles.empty}>No matching items.</Text>}
          </ScrollView>
          {!compact && <WorkspaceAction title="Close" onPress={close} />}
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, minHeight: 0 }, hidden: { display: "none" },
  navigation: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#d6deeb", backgroundColor: "#edf3fb" },
  tab: { flex: 1, minHeight: 48, paddingHorizontal: 4, paddingVertical: 10, alignItems: "center", justifyContent: "center", borderBottomWidth: 3, borderBottomColor: "transparent" },
  selectedTab: { backgroundColor: "#d8e9fc", borderBottomColor: "#005caf" }, tabText: { color: "#32455c", fontWeight: "500", fontSize: 15 }, selectedText: { color: "#005caf", fontWeight: "700" },
  action: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: "#536c8c", borderRadius: 8, alignItems: "center", justifyContent: "center" },
  actionText: { color: "#005caf", textAlign: "center", fontWeight: "600", fontSize: 15 }, primary: { backgroundColor: "#005caf", borderColor: "#005caf" }, primaryText: { color: "#ffffff" }, disabled: { opacity: 0.5 },
  choice: { flexGrow: 1, flexShrink: 1, minWidth: 0 }, choiceButton: { minHeight: 48, padding: 8, borderWidth: 1, borderColor: "#7b899b", borderRadius: 8, backgroundColor: "#ffffff" },
  choiceLabel: { fontSize: 12, color: "#445469" }, choiceValue: { color: "#005caf", fontWeight: "600", fontSize: 15 },
  scrim: { flex: 1, backgroundColor: "#00000066", padding: 20, paddingTop: 48, paddingBottom: 32, justifyContent: "center" },
  compactScrim: { paddingTop: 12, paddingBottom: 12 },
  searchRow: { flexDirection: "row", gap: 8 }, searchFlex: { flex: 1 },
  dialog: { maxHeight: "100%", gap: 8, padding: 12, backgroundColor: "#ffffff", borderRadius: 12 },
  dialogTitle: { fontWeight: "600", fontSize: 18, color: "#182c45" },
  search: { borderWidth: 1, borderColor: "#7b899b", borderRadius: 8, minHeight: 48, padding: 10, color: "#111111" },
  options: { flexShrink: 1 }, option: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, padding: 12, borderBottomWidth: 1, borderColor: "#e1e6ed" },
  optionText: { flex: 1, color: "#182c45" }, empty: { padding: 16, color: "#445469" },
});
