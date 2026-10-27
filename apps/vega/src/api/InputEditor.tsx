import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Switch, Text, TextInput, Pressable, translateCopy, useLocale } from "../localization";
import { BinaryInput, CallbackInput, ExpressionInput, NumericInput, ResourceInput, type ApiSchema, type InputSchema, type Signature } from "./types";
import { safeKey } from "./values";
import { parameterNames, ResourcePool } from "./materialize";

export function Action({ title, onPress, disabled = false, verbatim = false }: { title: string; onPress: () => void; disabled?: boolean; verbatim?: boolean }): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  return <Pressable verbatim={verbatim} accessibilityRole="button" accessibilityLabel={title} disabled={disabled} focusable={!disabled} accessibilityState={{ disabled }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={() => { if (!disabled) onPress(); }}
    style={[styles.button, focused && !disabled ? styles.focused : null, disabled ? styles.disabled : null,
      focused ? { borderColor: "#ffffff" } : null]}>
    <Text verbatim={verbatim} style={styles.buttonText}>{title}</Text>
  </Pressable>;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
export const promises = (catalog: ApiSchema, id: string): boolean => catalog.nodes[id]?.kind === "promise" || Boolean(catalog.nodes[id]?.options?.some((option) => catalog.nodes[option]?.kind === "promise"));

export function initialValue(catalog: ApiSchema, id: string, depth = 0): unknown {
  const schema = catalog.nodes[id];
  if (!schema || depth > 8) return undefined;
  switch (schema.kind) {
    case "literal": return schema.value;
    case "string": return "";
    case "number": return new NumericInput("0");
    case "boolean": return false;
    case "null": return null;
    case "array": return [];
    case "tuple": return schema.items?.map((item) => initialValue(catalog, item, depth + 1));
    case "object": return Object.fromEntries((schema.properties ?? []).filter((property) => !property.optional).map((property) => [property.name, initialValue(catalog, property.schema, depth + 1)]));
    case "union": return initialValue(catalog, schema.options?.find((option) => catalog.nodes[option]?.kind !== "undefined") ?? schema.options![0]!, depth + 1);
    case "function": {
      const signature = schema.signatures?.[0];
      return signature ? new CallbackInput("return undefined;", signature, false, promises(catalog, signature.returns)) : undefined;
    }
    case "binary": return new BinaryInput("", "hex", schema.name ?? "ArrayBuffer");
    case "unknown": return "";
    default: return undefined;
  }
}

function matches(catalog: ApiSchema, id: string, value: unknown): boolean {
  const schema = catalog.nodes[id];
  if (!schema) return false;
  switch (schema.kind) {
    case "union": return Boolean(schema.options?.some((option) => matches(catalog, option, value)));
    case "literal": return value === schema.value;
    case "undefined": return value === undefined;
    case "null": return value === null;
    case "string": case "boolean": return typeof value === schema.kind;
    case "number": return typeof value === "number" || value instanceof NumericInput;
    case "function": return value instanceof CallbackInput;
    case "binary": return value instanceof BinaryInput;
    case "instance": return value instanceof ResourceInput;
    case "array": case "tuple": return Array.isArray(value);
    case "object": return record(value);
    default: return schema.kind === "unknown";
  }
}

interface Props { catalog: ApiSchema; schema: string; value: unknown; onChange: (value: unknown) => void; resources: ResourcePool; level?: number; }

/** Render only the selected object property or array item, keeping the TV form bounded. */
export function InputEditor({ catalog, schema: id, value, onChange, resources, level = 0 }: Props): React.JSX.Element {
  const { language } = useLocale();
  const schema = catalog.nodes[id]!;
  const [branch, setBranch] = useState(() => schema.options?.find((option) => matches(catalog, option, value)) ?? schema.options?.[0] ?? "");
  const [property, setProperty] = useState("");
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(0);
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");
  const [unknownKind, setUnknownKind] = useState(() => value instanceof ExpressionInput ? "factory" : value instanceof CallbackInput ? "function" : value instanceof NumericInput ? "number" : value instanceof BinaryInput ? "binary" : value instanceof ResourceInput ? "resource" : Array.isArray(value) ? "array" : value === null ? "null" : value === undefined ? "undefined" : typeof value);
  const expiredResource = value instanceof ResourceInput && !resources.has(value.id)
    ? <Text style={styles.warning}>This SDK instance has expired. Obtain it again from the current player.</Text> : null;
  const input = (label: string, text: string, update: (text: string) => void, multiline = false) => <TextInput accessibilityLabel={label} value={text} onChangeText={update} style={[styles.input, multiline ? styles.code : null]} multiline={multiline} autoCapitalize="none" autoCorrect={false} />;
  const child = (schema: string, value: unknown, update: (value: unknown) => void, key: string | number = schema) => <InputEditor key={key} catalog={catalog} schema={schema} value={value} onChange={update} resources={resources} level={level + 1} />;
  if (level > 20) return <Text style={styles.help}>This editor supports up to 20 nested levels. Remove a containing value to shorten the input.</Text>;
  if (schema.kind === "union") return <View style={styles.section}>
    <Text style={styles.text}>Select the input type</Text>
    <View style={styles.row}>{schema.options!.map((option) => <Action key={option} verbatim title={catalog.nodes[option]!.label} disabled={branch === option} onPress={() => { setBranch(option); onChange(initialValue(catalog, option)); }} />)}</View>
    {child(branch, value, onChange, branch)}
  </View>;
  if (schema.kind === "undefined" || schema.kind === "void" || schema.kind === "null" || schema.kind === "never" || schema.kind === "literal") return <Text verbatim style={styles.text}>{schema.kind === "literal" ? JSON.stringify(schema.value) : schema.label}</Text>;
  if (schema.kind === "string") return input("SDK text value", typeof value === "string" ? value : "", onChange);
  if (schema.kind === "number") return input("SDK numeric value", value instanceof NumericInput ? value.raw : String(value ?? ""), (raw) => onChange(new NumericInput(raw)));
  if (schema.kind === "boolean") return <View style={styles.row}><Text verbatim style={styles.text}>{String(Boolean(value))}</Text><Switch focusable style={styles.toggle} accessibilityLabel="SDK boolean value" value={value === true} onValueChange={onChange} /></View>;
  if (schema.kind === "object") {
    const values = record(value) ? value : {};
    const properties = schema.properties ?? [];
    const names = [...new Set([...properties.map((entry) => entry.name), ...Object.keys(values)])];
    const selected = names.includes(property) ? property : names[0];
    const selectedType = properties.find((entry) => entry.name === selected)?.schema ?? schema.additional;
    const present = selected !== undefined && Object.prototype.hasOwnProperty.call(values, selected);
    return <View style={styles.section}>
      {input("Filter SDK object fields", filter, setFilter)}
      <View style={styles.row}>{names.filter((name) => name.toLowerCase().includes(filter.toLowerCase())).slice(0, 12).map((name) => <Action key={name} verbatim title={name + (Object.prototype.hasOwnProperty.call(values, name) ? translateCopy(" (set)", language) : "")} disabled={name === selected} onPress={() => setProperty(name)} />)}</View>
      {selected !== undefined && selectedType && <>
        <Text verbatim style={styles.heading}>{selected}{properties.find((entry) => entry.name === selected)?.optional ? translateCopy(" (optional)", language) : ""}</Text>
        {present ? <>
          {child(selectedType, values[selected], (item) => { safeKey(selected); onChange({ ...values, [selected]: item }); }, selected)}
          <Action title="Remove selected SDK field" onPress={() => { const next = { ...values }; delete next[selected]; onChange(next); }} />
        </> : <Action title="Set selected SDK field" onPress={() => { safeKey(selected); onChange({ ...values, [selected]: initialValue(catalog, selectedType) }); }} />}
      </>}
      {!!schema.additional && <>
        {input("New SDK map field", newKey, setNewKey)}
        <Action title="Add SDK map field" onPress={() => {
          try { safeKey(newKey); if (Object.prototype.hasOwnProperty.call(values, newKey)) throw new Error("The map field already exists."); onChange({ ...values, [newKey]: initialValue(catalog, schema.additional!) }); setProperty(newKey); setNewKey(""); setError(""); }
          catch { setError("Choose a unique field name that does not change object prototypes."); }
        }} />
      </>}
      {!!error && <Text accessibilityRole="alert" style={styles.text}>{error}</Text>}
    </View>;
  }
  if (schema.kind === "array" || schema.kind === "tuple") {
    const items = Array.isArray(value) ? value : [];
    const selected = Math.min(index, Math.max(0, items.length - 1));
    const itemType = schema.kind === "array" ? schema.item! : schema.items?.[selected];
    return <View style={styles.section}>
      <Text style={styles.text}>{items.length ? `Selected item ${selected}` : "Empty list"}</Text>
      <View style={styles.row}>
        <Action title="Previous SDK list item" disabled={!selected} onPress={() => setIndex(selected - 1)} />
        <Action title="Next SDK list item" disabled={selected >= items.length - 1} onPress={() => setIndex(selected + 1)} />
        <Action title="Add SDK list item" disabled={items.length >= 256 || (schema.kind === "tuple" && items.length >= (schema.items?.length ?? 0))} onPress={() => { const type = schema.kind === "array" ? schema.item! : schema.items?.[items.length]; if (type) { onChange([...items, initialValue(catalog, type)]); setIndex(items.length); } }} />
      </View>
      {items.length > 0 && itemType && <>
        {child(itemType, items[selected], (next) => onChange(items.map((item, i) => i === selected ? next : item)), selected)}
        <Action title="Remove SDK list item" onPress={() => { onChange(items.filter((_, i) => i !== selected)); setIndex(Math.max(0, selected - 1)); }} />
      </>}
    </View>;
  }
  if (schema.kind === "function") {
    const signatures = schema.signatures ?? [];
    const callback = value instanceof CallbackInput ? value : new CallbackInput("return undefined;", signatures[0]!, false, promises(catalog, signatures[0]!.returns));
    return <View style={styles.section}>
      <View style={styles.row}>{resources.list(schema).map((resource) => <Action key={resource.id} verbatim title={resource.label} disabled={value instanceof ResourceInput && value.id === resource.id} onPress={() => onChange(new ResourceInput(resource.id))} />)}</View>
      {value instanceof ResourceInput ? <>
        {expiredResource ?? <Text style={styles.help}>Using current callback instance {value.id}. This preserves the identity needed by off.</Text>}
        <Action title="Edit a new SDK callback" onPress={() => onChange(new CallbackInput("return undefined;", signatures[0]!, false, promises(catalog, signatures[0]!.returns)))} />
      </> : <>
      <Text style={styles.warning}>JavaScript runs in this app without a sandbox when the SDK calls it. Enable permission, then Apply or Run. Editing alone does not run code.</Text>
      {signatures.length > 1 && <View style={styles.row}>{signatures.map((signature, index) => <Action key={index} title={`Callback signature ${index + 1}`} disabled={callback.signature === signature} onPress={() => onChange(new CallbackInput(callback.body, signature, false, promises(catalog, signature.returns)))} />)}</View>}
      <Text verbatim style={styles.text}>{parameterNames(callback.signature).map((name, i) => name + ": " + catalog.nodes[callback.signature.parameters[i]!.schema]!.label).join(", ")} → {catalog.nodes[callback.signature.returns]!.label}</Text>
      {input("SDK callback JavaScript body", callback.body, (body) => onChange(new CallbackInput(body, callback.signature, callback.approved, callback.asynchronous)), true)}
      <View style={styles.row}><Text style={styles.text}>Allow this callback</Text><Switch focusable style={styles.toggle} accessibilityLabel="Allow this SDK callback" value={callback.approved} onValueChange={(approved) => onChange(new CallbackInput(callback.body, callback.signature, approved, callback.asynchronous))} /></View>
      </>}
    </View>;
  }
  if (schema.kind === "binary") {
    const binary = value instanceof BinaryInput ? value : new BinaryInput("", "hex", schema.name ?? "ArrayBuffer");
    return <View style={styles.section}><View style={styles.row}>{(["hex", "base64"] as const).map((encoding) => <Action key={encoding} verbatim title={encoding} disabled={binary.encoding === encoding} onPress={() => onChange(new BinaryInput("", encoding, binary.name))} />)}</View>
      {input("SDK binary bytes", binary.text, (text) => onChange(new BinaryInput(text, binary.encoding, binary.name)), true)}
      <Text style={styles.help}>Bytes become a real <Text verbatim>{binary.name}</Text>. Certificates are limited to 64 KiB.</Text>
    </View>;
  }
  if (schema.kind === "instance") return <View style={styles.section}>
    <Text style={styles.help}>Required instance: <Text verbatim>{schema.label}</Text></Text>
    {expiredResource}
    {resources.list(schema).map((resource) => <Action key={resource.id} verbatim title={resource.label} disabled={value instanceof ResourceInput && value.id === resource.id} onPress={() => onChange(new ResourceInput(resource.id))} />)}
    {!resources.list(schema).length && <Text style={styles.help}>No compatible current SDK instance is available. Run the corresponding query first. An object literal cannot satisfy this instance contract.</Text>}
  </View>;
  if (schema.kind === "unknown") {
    const types = ["string", "number", "boolean", "null", "undefined", "object", "array", "function", "factory", "binary", "resource"];
    const synthetic = "editor-" + unknownKind;
    const unknown: InputSchema = unknownKind === "object" ? { kind: "object", label: "Object", properties: [], additional: id }
      : unknownKind === "array" ? { kind: "array", label: "Array", item: id }
      : unknownKind === "function" ? { kind: "function", label: "Function", signatures: [{ parameters: [{ name: "args", schema: "editor-rest", optional: false, rest: true }], returns: id }] }
      : unknownKind === "binary" ? { kind: "binary", label: "ArrayBuffer", name: "ArrayBuffer" }
      : { kind: unknownKind, label: unknownKind };
    const enriched: ApiSchema = { ...catalog, nodes: { ...catalog.nodes, [synthetic]: unknown, "editor-rest": { kind: "array", label: "unknown[]", item: id } } };
    const expression = value instanceof ExpressionInput ? value : new ExpressionInput("return undefined;", false);
    return <View style={styles.section}>
      <Text verbatim style={styles.text}>{schema.label}</Text>
      <View style={styles.row}>{types.map((kind) => <Action key={kind} verbatim title={kind} disabled={unknownKind === kind} onPress={() => {
        setUnknownKind(kind);
        onChange(kind === "factory" ? new ExpressionInput("return undefined;", false) : kind === "resource" ? undefined : initialValue({ ...enriched, nodes: { ...enriched.nodes, [synthetic]: { ...unknown, kind } } }, synthetic));
      }} />)}</View>
      {unknownKind === "factory" ? <>
        <Text style={styles.warning}>Approved JavaScript runs in this app without a sandbox on Apply, Run and session recreation.</Text>
        {input("SDK value factory JavaScript body", expression.body, (body) => onChange(new ExpressionInput(body, expression.approved)), true)}
        <View style={styles.row}><Text style={styles.text}>Allow this value factory</Text><Switch focusable style={styles.toggle} accessibilityLabel="Allow this SDK value factory" value={expression.approved} onValueChange={(approved) => onChange(new ExpressionInput(expression.body, approved))} /></View>
      </> : unknownKind === "resource" ? <View style={styles.row}>{expiredResource}{resources.list(schema).map((resource) => <Action key={resource.id} verbatim title={resource.label} onPress={() => onChange(new ResourceInput(resource.id))} />)}</View> : <InputEditor key={unknownKind} catalog={enriched} schema={synthetic} value={value} onChange={onChange} resources={resources} level={level + 1} />}
    </View>;
  }
  return <Text style={styles.help}>This input requires <Text verbatim>{schema.label}</Text>. A Promise must be returned from an approved callback; it cannot be replaced by a JSON value.</Text>;
}

export function ArgumentsEditor({ catalog, signature, values, onChange, resources }: { catalog: ApiSchema; signature: Signature; values: unknown[]; onChange: (values: unknown[]) => void; resources: ResourcePool }): React.JSX.Element {
  const { language } = useLocale();
  return <View style={styles.section}>{signature.parameters.map((parameter, index) => <View key={index} style={styles.section}>
    <Text verbatim style={styles.heading}>{parameter.name}{parameter.optional ? translateCopy(" (optional)", language) : ""}{parameter.rest ? translateCopy(" (remaining arguments)", language) : ""}: {catalog.nodes[parameter.schema]!.label}</Text>
    {parameter.optional && <Action title={values[index] === undefined ? `Set ${parameter.name}` : `Omit ${parameter.name}`} onPress={() => { const next = [...values]; next[index] = values[index] === undefined ? initialValue(catalog, parameter.schema) : undefined; onChange(next); }} />}
    {(!parameter.optional || values[index] !== undefined) && <InputEditor catalog={catalog} schema={parameter.schema} value={values[index]} resources={resources} onChange={(value) => { const next = [...values]; next[index] = value; onChange(next); }} />}
  </View>)}</View>;
}

export const styles = StyleSheet.create({
  panel: { gap: 12, padding: 24, borderTopWidth: 1, borderTopColor: "#3a4b62", backgroundColor: "#101820" },
  section: { gap: 12, marginVertical: 8 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  text: { color: "#d5e2f2", fontSize: 18 }, help: { color: "#b8c6d9", fontSize: 16, lineHeight: 22 },
  label: { color: "#b8c6d9", fontSize: 16, fontWeight: "600" },
  heading: { color: "#f4f7fb", fontWeight: "600", fontSize: 20 },
  badge: { alignSelf: "flex-start", color: "#d5e2f2", backgroundColor: "#29374a", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, fontSize: 16 },
  button: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#005caf", borderColor: "#005caf", borderWidth: 2, borderRadius: 8 },
  focused: { borderColor: "#ffffff", backgroundColor: "#1a6bb5" },
  buttonText: { color: "#ffffff", fontSize: 18, fontWeight: "600" }, disabled: { backgroundColor: "#29374a", borderColor: "#4a5a70" },
  input: { color: "#f4f7fb", backgroundColor: "#161f2c", borderColor: "#6f829a", borderWidth: 1, padding: 12, borderRadius: 8, minHeight: 52, fontSize: 18 },
  toggle: { width: 72, height: 36 },
  code: { minHeight: 120, fontFamily: "monospace", fontSize: 16 },
  codeText: { color: "#d5e2f2", backgroundColor: "#161f2c", borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 14, lineHeight: 20 },
  eventText: { color: "#d5e2f2", fontFamily: "monospace", fontSize: 14, lineHeight: 20 },
  warning: { color: "#ffd7a3", fontSize: 16, lineHeight: 22 },
  error: { color: "#ffb3b3" },
});
