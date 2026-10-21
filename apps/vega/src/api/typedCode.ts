import { catalog } from "./catalog";
import { BinaryInput, CallbackInput, ExpressionInput, FactoryInput, NumericInput, ResourceInput } from "./types";
import { inputCode } from "./materialize";
import { validateData } from "./values";

/** Emit enum members from the same declaration graph used by the input editor. */
export function typedCode(schemaId: string, value: unknown, path: string[] = [], depth = 0): string {
  if (depth > 32) throw new Error("The code example is nested too deeply.");
  if (/^(key|licenseKey|apiKey|password|token|authorization|proxy-authorization)$/i.test(path[path.length - 1] ?? "")) return JSON.stringify(path.join(".") === "PlayerConfig.key" ? "YOUR_PLAYER_KEY" : path.includes("analytics") ? "YOUR_ANALYTICS_KEY" : "YOUR_VALUE");
  if (path.slice(0, -1).some((part) => /headers$/i.test(part))) return JSON.stringify("YOUR_HEADER_VALUE");
  if (value instanceof BinaryInput || value instanceof CallbackInput || value instanceof ExpressionInput || value instanceof FactoryInput || value instanceof NumericInput || value instanceof ResourceInput) return inputCode(value, path);
  const schema = catalog.nodes[schemaId];
  if (!schema) return inputCode(value, path);
  if (schema.kind === "union") {
    const selected = schema.options?.find((id) => { try { validateData(catalog, id, value); return true; } catch { return false; } });
    return selected ? typedCode(selected, value, path, depth + 1) : inputCode(value, path);
  }
  if (schema.kind === "literal" && /^[A-Z][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*$/.test(schema.label)) return "SDK." + schema.label;
  if (Array.isArray(value)) return "[" + value.map((item, index) => typedCode(schema.item ?? schema.items?.[index] ?? "", item, path, depth + 1)).join(", ") + "]";
  if (value && typeof value === "object") {
    const indent = "  ".repeat(depth + 1);
    return "{\n" + Object.entries(value).filter(([, item]) => item !== undefined).map(([name, item]) => {
      const child = schema.properties?.find((property) => property.name === name)?.schema ?? schema.additional ?? "";
      return indent + JSON.stringify(name) + ": " + typedCode(child, item, [...path, name], depth + 1);
    }).join(",\n") + "\n" + "  ".repeat(depth) + "}";
  }
  return inputCode(value, path);
}
