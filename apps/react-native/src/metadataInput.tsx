import React, { useState } from "react";
import { View } from "react-native";
import { Button, Text, TextInput } from "./localization";
import { finiteNumber } from "./apiValues";
import { panelStyles as styles } from "./panelStyles";

type Kind = "string" | "number" | "boolean" | "null" | "object" | "array";
interface Node { kind: Kind; text: string; children: Array<{ key: string; node: Node }>; }
type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
const kinds: Kind[] = ["string", "number", "boolean", "null", "object", "array"];
const empty = (kind: Kind): Node => ({ kind, text: kind === "boolean" ? "false" : kind === "number" ? "0" : "", children: [] });
export const EMPTY_METADATA = JSON.stringify(empty("null"));
const forbidden = (key: string) => ["__proto__", "prototype", "constructor"].includes(key);

function read(raw: string): Node {
  let budget = 1000;
  function node(value: unknown, depth = 0): Node {
    if (--budget < 0 || depth > 20) throw new Error("Metadata is limited to 1000 values and 20 nested levels.");
    if (!value || typeof value !== "object" || !("kind" in value) || !kinds.some((kind) => kind === value.kind)
      || !("text" in value) || typeof value.text !== "string" || !("children" in value) || !Array.isArray(value.children)) throw new Error("Invalid metadata editor state.");
    const kind = kinds.find((kind) => kind === value.kind)!;
    const children = value.children.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || !("key" in entry) || typeof entry.key !== "string" || !("node" in entry)) throw new Error("Invalid metadata field.");
      return { key: entry.key, node: node(entry.node, depth + 1) };
    });
    return { kind, text: value.text, children };
  }
  return node(JSON.parse(raw));
}

export function metadataValue(raw: string): Record<string, Value> | null {
  const root = read(raw);
  const parse = (node: Node): Value => {
    if (node.kind === "null") return null;
    if (node.kind === "string") return node.text;
    if (node.kind === "number") return finiteNumber(node.text, "Metadata number");
    if (node.kind === "boolean") { if (node.text !== "true" && node.text !== "false") throw new Error("Select a metadata boolean."); return node.text === "true"; }
    if (node.kind === "array") return node.children.map((entry) => parse(entry.node));
    const result: Record<string, Value> = {};
    for (const entry of node.children) {
      if (forbidden(entry.key) || Object.prototype.hasOwnProperty.call(result, entry.key)) throw new Error("Metadata field names must be unique and must not change object prototypes.");
      result[entry.key] = parse(entry.node);
    }
    return result;
  };
  if (root.kind !== "object" && root.kind !== "null") throw new Error("Source metadata must be an object or null.");
  if (root.kind === "null") return null;
  const result: Record<string, Value> = {};
  for (const entry of root.children) {
    if (forbidden(entry.key) || Object.prototype.hasOwnProperty.call(result, entry.key)) throw new Error("Metadata field names must be unique and must not change object prototypes.");
    result[entry.key] = parse(entry.node);
  }
  return result;
}

/** A tree editor supplies serializable values of their actual types, without a JSON text box. */
export function MetadataInput({ value, onChange }: { value: string; onChange: (value: string) => void }): React.JSX.Element {
  const [path, setPath] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const root = read(value || EMPTY_METADATA);
  let current = root;
  const validPath: number[] = [];
  for (const index of path) { const next = current.children[index]; if (!next) break; current = next.node; validPath.push(index); }
  const replace = (next: Node) => {
    const update = (node: Node, remaining: number[]): Node => remaining.length ? { ...node, children: node.children.map((entry, index) => index === remaining[0] ? { ...entry, node: update(entry.node, remaining.slice(1)) } : entry) } : next;
    try {
      const serialized = JSON.stringify(update(root, validPath));
      read(serialized);
      onChange(serialized); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid metadata editor state."); }
  };
  const add = () => {
    const key = current.kind === "array" ? String(current.children.length) : name;
    if (current.kind === "object" && (forbidden(key) || current.children.some((entry) => entry.key === key))) { setError("Choose a unique field name that does not change an object prototype."); return; }
    replace({ ...current, children: [...current.children, { key, node: empty("string") }] }); setName("");
  };
  return <View style={styles.content}>
    <Text>Metadata value {validPath.length ? validPath.map((index) => `[${index}]`).join("") : "root"}</Text>
    {!!validPath.length && <Button title="Metadata parent" onPress={() => setPath(validPath.slice(0, -1))} />}
    <View style={styles.row}>{(validPath.length ? kinds : ["object", "null"] as Kind[]).map((kind) => <Button key={kind} title={`Metadata ${kind}`} disabled={current.kind === kind} onPress={() => replace(empty(kind))} />)}</View>
    {(current.kind === "string" || current.kind === "number") && <TextInput accessibilityLabel="Metadata scalar value" value={current.text} onChangeText={(text) => replace({ ...current, text })} style={styles.input} autoCapitalize="none" autoCorrect={false} />}
    {current.kind === "boolean" && <View style={styles.row}>{["true", "false"].map((text) => <Button key={text} title={text} disabled={current.text === text} onPress={() => replace({ ...current, text })} />)}</View>}
    {(current.kind === "object" || current.kind === "array") && <>
      {current.children.map((entry, index) => <View key={index} style={styles.row}>
        <Button title={`Edit metadata ${current.kind === "array" ? index : entry.key}`} onPress={() => setPath([...validPath, index])} />
        <Text>{entry.node.kind}</Text><Button title={`Remove metadata ${index}`} onPress={() => replace({ ...current, children: current.children.filter((_, i) => i !== index) })} />
      </View>)}
      {current.kind === "object" && <TextInput accessibilityLabel="New metadata field name" value={name} onChangeText={setName} style={styles.input} autoCapitalize="none" autoCorrect={false} />}
      <Button title={current.kind === "array" ? "Append metadata array value" : "Add metadata field"} onPress={add} />
    </>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Text style={styles.help}>Object fields and array entries can contain strings, numbers, booleans, null, objects or arrays. Null clears source metadata. Values must be serializable across the native bridge; JavaScript functions and native instances are not metadata.</Text>
  </View>;
}
